from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import AudioFile, Chunk, Document, PlaybackProgress
from app.schemas import DocumentCreate, DocumentDetail, DocumentSummary, Progress
from app.services.chunker import chunk_text
from app.services.extractor import ExtractionError, extract_article
from app.services.fetcher import FetchError, fetch_html
from app.services.generation import cancel_generation, remove_files

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("", response_model=DocumentDetail, status_code=status.HTTP_201_CREATED)
async def create_document(
    body: DocumentCreate, session: AsyncSession = Depends(get_session)
):
    url = str(body.url)
    try:
        html = await fetch_html(url)
        title, text = await extract_article(html, url)
    except (FetchError, ExtractionError) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    document = Document(
        source_url=url,
        title=title,
        text=text,
        chunks=[Chunk(**c) for c in chunk_text(text)],
    )
    session.add(document)
    await session.commit()
    return document


@router.get("", response_model=list[DocumentSummary])
async def list_documents(session: AsyncSession = Depends(get_session)):
    result = await session.scalars(
        select(Document).order_by(Document.created_at.desc())
    )
    return result.all()


@router.get("/{document_id}", response_model=DocumentDetail)
async def get_document(document_id: int, session: AsyncSession = Depends(get_session)):
    document = await session.scalar(
        select(Document)
        .where(Document.id == document_id)
        .options(selectinload(Document.chunks))
    )
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return document


@router.get("/{document_id}/progress", response_model=Progress)
async def get_progress(document_id: int, session: AsyncSession = Depends(get_session)):
    if await session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    progress = await session.get(PlaybackProgress, document_id)
    # A document that has never been played starts at the beginning.
    return progress or Progress(chunk_index=0, offset_sec=0)


@router.put("/{document_id}/progress", status_code=status.HTTP_204_NO_CONTENT)
async def save_progress(
    document_id: int, body: Progress, session: AsyncSession = Depends(get_session)
):
    if await session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    # Insert, or update the existing row, in one statement, so two saves
    # arriving at the same moment can't both try to insert.
    statement = insert(PlaybackProgress).values(
        document_id=document_id, **body.model_dump()
    )
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[PlaybackProgress.document_id],
            set_={**body.model_dump(), "updated_at": func.now()},
        )
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: int, session: AsyncSession = Depends(get_session)
):
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    # Otherwise a running job would keep generating audio for deleted chunks.
    await cancel_generation(document_id=document_id)
    audio_paths = (
        await session.scalars(
            select(AudioFile.file_path)
            .join(Chunk, Chunk.id == AudioFile.chunk_id)
            .where(Chunk.document_id == document_id)
        )
    ).all()
    await session.delete(document)
    await session.commit()
    remove_files(list(audio_paths))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
