from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import AudioFile, Chunk, Document, PlaybackProgress
from app.schemas import DocumentCreate, DocumentDetail, LibraryItem, Progress
from app.services.chunker import chunk_text
from app.services.extractor import ExtractionError, extract_article
from app.services.fetcher import FetchError, fetch_html
from app.services.generation import cancel_generation, remove_files

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Seconds of speech per character, used before a document has any audio.
SECONDS_PER_CHAR = 0.065


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


@router.get("", response_model=list[LibraryItem])
async def list_documents(session: AsyncSession = Depends(get_session)):
    documents = await session.scalars(
        select(Document)
        .order_by(Document.created_at.desc())
        .options(selectinload(Document.progress))
    )
    # Each document's chunk lengths, in order.
    chunk_chars: dict[int, list[int]] = defaultdict(list)
    for document_id, chars in await session.execute(
        select(Chunk.document_id, Chunk.char_count).order_by(
            Chunk.document_id, Chunk.index
        )
    ):
        chunk_chars[document_id].append(chars)
    # Each document's speaking pace, from the audio made for it so far (any
    # voice), like the player's estimate for chunks without audio.
    pace = dict(
        (
            await session.execute(
                select(
                    Chunk.document_id,
                    func.sum(AudioFile.duration_sec) / func.sum(Chunk.char_count),
                )
                .join(AudioFile, AudioFile.chunk_id == Chunk.id)
                .where(AudioFile.duration_sec.is_not(None))
                .group_by(Chunk.document_id)
            )
        ).all()
    )
    return [
        _library_item(d, chunk_chars[d.id], pace.get(d.id, SECONDS_PER_CHAR))
        for d in documents
    ]


def _library_item(
    document: Document, chunk_chars: list[int], seconds_per_char: float
) -> LibraryItem:
    total = sum(chunk_chars)
    progress = document.progress
    if progress is None:
        done = 0
    elif progress.finished:
        done = total
    else:
        # The chunks before the current one, plus an estimate of how much of
        # the current one has been read, from the time into its audio.
        index = min(progress.chunk_index, len(chunk_chars))
        current = chunk_chars[index] if index < len(chunk_chars) else 0
        done = sum(chunk_chars[:index]) + min(
            current, progress.offset_sec / seconds_per_char
        )
    return LibraryItem(
        id=document.id,
        title=document.title,
        source_url=document.source_url,
        created_at=document.created_at,
        finished=bool(progress and progress.finished),
        fraction=done / total if total else 0,
        seconds_left=(total - done) * seconds_per_char,
    )


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
