from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import AudioFile, Chunk, Collection, Document, PlaybackProgress
from app.schemas import (
    DocumentCreate,
    DocumentDetail,
    DocumentIds,
    DocumentsMove,
    LibraryItem,
    Progress,
)
from app.services.chunker import chunk_text
from app.services.covers import cover_path, save_cover
from app.services.extractor import ExtractionError, extract_article
from app.services.fetcher import FetchError, fetch_html
from app.services.deletion import delete_documents
from app.services.next_link import without_fragment

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Seconds of speech per character, used before a document has any audio.
SECONDS_PER_CHAR = 0.065


@router.post("", response_model=DocumentDetail, status_code=status.HTTP_201_CREATED)
async def create_document(
    body: DocumentCreate, session: AsyncSession = Depends(get_session)
):
    url = without_fragment(str(body.url))
    if body.collection_id is not None and not await session.get(
        Collection, body.collection_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found.")
    # Checked before downloading anything. The unique source_url below also
    # catches the rare case of the same page being added twice at once.
    existing = await session.scalar(select(Document.id).where(Document.source_url == url))
    if existing is not None:
        raise await _already_added(session, existing)
    try:
        html = await fetch_html(url)
        article = await extract_article(html, url)
    except (FetchError, ExtractionError) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    document = Document(
        collection_id=body.collection_id,
        source_url=url,
        title=article.title,
        text=article.text,
        next_url=article.next_url,
        chunks=[Chunk(**c) for c in chunk_text(article.text)],
    )
    session.add(document)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(
            select(Document.id).where(Document.source_url == url)
        )
        raise await _already_added(session, existing)
    # Saved after the document, since the image is named by its id.
    document.cover_type = await save_cover(document.id, article.image_url)
    if document.cover_type:
        await session.commit()
    return await _detail(session, document)


async def _already_added(session: AsyncSession, document_id: int) -> HTTPException:
    # Names where it is, and the id lets the page link to it.
    name = await session.scalar(
        select(Collection.name)
        .join(Document, Document.collection_id == Collection.id)
        .where(Document.id == document_id)
    )
    return HTTPException(
        status.HTTP_409_CONFLICT,
        {
            "message": f"That page is already in “{name or 'Unsorted'}”.",
            "document_id": document_id,
        },
    )


async def _detail(session: AsyncSession, document: Document) -> DocumentDetail:
    detail = DocumentDetail.model_validate(document)
    if document.collection_id is not None:
        detail.collection_name = await session.scalar(
            select(Collection.name).where(Collection.id == document.collection_id)
        )
    # Looked up each time rather than saved, so it's right even if the next
    # part was added from the Library, or deleted, since this one was added.
    if document.next_url:
        detail.next_document_id = await session.scalar(
            select(Document.id).where(Document.source_url == document.next_url)
        )
    return detail


@router.post("/move", status_code=status.HTTP_204_NO_CONTENT)
async def move_documents(
    body: DocumentsMove, session: AsyncSession = Depends(get_session)
):
    """Moves documents into a collection, in one go however many there are."""
    if await session.get(Collection, body.collection_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found.")
    await session.execute(
        update(Document)
        .where(Document.id.in_(body.document_ids))
        .values(collection_id=body.collection_id)
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_many_documents(
    body: DocumentIds, session: AsyncSession = Depends(get_session)
):
    """Deletes several documents at once, the same way as one (POST, since a
    DELETE request doesn't normally carry a list). Ids that don't exist are
    skipped."""
    await delete_documents(session, body.document_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=list[LibraryItem])
async def list_documents(
    collection_id: int | None = None,
    unsorted: bool = False,
    session: AsyncSession = Depends(get_session),
):
    """The documents in one collection, or with unsorted=true those in none.
    With neither, every document."""
    query = (
        select(Document)
        .order_by(Document.created_at.desc())
        .options(selectinload(Document.progress))
    )
    if collection_id is not None:
        query = query.where(Document.collection_id == collection_id)
    elif unsorted:
        query = query.where(Document.collection_id.is_(None))
    return await _library_items(session, (await session.scalars(query)).all())


@router.get("/recent", response_model=list[LibraryItem])
async def recent_documents(
    limit: int = Query(default=4, ge=1, le=20),
    session: AsyncSession = Depends(get_session),
):
    """The documents most recently listened to and not finished, from any
    collection, most recent first."""
    documents = (
        await session.scalars(
            select(Document)
            .join(PlaybackProgress)
            .where(PlaybackProgress.finished.is_(False))
            .order_by(PlaybackProgress.updated_at.desc())
            .limit(limit)
            .options(selectinload(Document.progress))
        )
    ).all()
    return await _library_items(session, documents)


async def _library_items(
    session: AsyncSession, documents: list[Document]
) -> list[LibraryItem]:
    """The documents as Library entries, in the same order."""
    ids = [d.id for d in documents]
    # Each document's chunk lengths, in order.
    chunk_chars: dict[int, list[int]] = defaultdict(list)
    for document_id, chars in await session.execute(
        select(Chunk.document_id, Chunk.char_count)
        .where(Chunk.document_id.in_(ids))
        .order_by(Chunk.document_id, Chunk.index)
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
                .where(
                    AudioFile.duration_sec.is_not(None), Chunk.document_id.in_(ids)
                )
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
        has_cover=document.cover_type is not None,
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
    return await _detail(session, document)


@router.get("/{document_id}/cover")
async def get_cover(document_id: int, session: AsyncSession = Depends(get_session)):
    document = await session.get(Document, document_id)
    path = cover_path(document_id)
    if document is None or document.cover_type is None or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No cover image.")
    # nosniff: the browser must treat it as the saved image type and nothing
    # else, even if the file's contents look like something else.
    return FileResponse(
        path,
        media_type=document.cover_type,
        headers={"X-Content-Type-Options": "nosniff"},
    )


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
    if await session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    await delete_documents(session, [document_id])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
