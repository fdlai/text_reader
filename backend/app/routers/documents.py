from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import AudioFile, Chunk, Collection, Document, PlaybackProgress, VoicePreset
from app.schemas import (
    MAX_PAGE_SIZE,
    MAX_TEXT_CHARS,
    DocumentCover,
    DocumentCreate,
    DocumentDetail,
    DocumentIds,
    DocumentText,
    DocumentTextCreate,
    DocumentTextUpdate,
    DocumentTextUpdated,
    DocumentsMove,
    DocumentVoice,
    LibraryItem,
    LibraryPage,
    Progress,
)
from app.services.chunker import chunk_rows, chunk_text
from app.services.covers import cover_path, save_cover, set_cover
from app.services.editing import only_removed, plan_edit
from app.services.extractor import ExtractionError, extract_article
from app.services.fetcher import FetchError, fetch_html
from app.services.deletion import delete_documents
from app.services.generation import audio_counts, remove_files, skip_chunks
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


@router.post("/text", response_model=DocumentDetail, status_code=status.HTTP_201_CREATED)
async def create_text_document(
    body: DocumentTextCreate, session: AsyncSession = Depends(get_session)
):
    """A document from text typed or pasted in. It has no page, so no
    source_url, next part or cover."""
    _check_text(body.text)
    if body.collection_id is not None and not await session.get(
        Collection, body.collection_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found.")

    document = Document(
        collection_id=body.collection_id,
        title=body.title or _title_from(body.text),
        text=body.text,
        chunks=[Chunk(**c) for c in chunk_text(body.text)],
    )
    session.add(document)
    await session.commit()
    return await _detail(session, document)


def _check_text(text: str) -> None:
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "There's no text to save.")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"That's more than {MAX_TEXT_CHARS:,} characters. "
            "Try splitting it into several articles.",
        )


def _title_from(text: str, max_chars: int = 60) -> str:
    """The text's first words, up to about max_chars, for an untitled
    document."""
    words = text.split()
    title = ""
    for word in words:
        if title and len(title) + 1 + len(word) > max_chars:
            return f"{title}…"
        title = f"{title} {word}".strip()
    return title


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
    detail.has_cover = document.cover_type is not None
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
    # Not played or generated since this was added (or its audio was
    # deleted): the voice with the most audio for it, if any.
    if detail.voice_preset_id is None:
        counts = await audio_counts(session, document.id)
        if counts:
            detail.voice_preset_id = max(counts, key=counts.get)
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


@router.get("", response_model=LibraryPage)
async def list_documents(
    collection_id: int | None = None,
    unsorted: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=MAX_PAGE_SIZE),
    q: str = "",
    sort: Literal["newest", "oldest", "listened"] = "newest",
    progress: Literal["all", "not-started", "in-progress", "finished"] = "all",
    session: AsyncSession = Depends(get_session),
):
    """One page of the documents in one collection, or with unsorted=true
    those in none. With neither, every document.

    q: only those whose title contains it (ignoring capitals).
    sort: newest or oldest added first, or most recently listened to first
    (then those never played, newest first).
    progress: only those not started, started but not finished, or finished.
    counts: how many match q with each progress, whichever one is chosen.
    """
    not_started = PlaybackProgress.document_id.is_(None)
    in_progress = PlaybackProgress.finished.is_(False)
    finished = PlaybackProgress.finished.is_(True)

    # Every document, with its listening progress if it has any.
    query = select(Document).outerjoin(PlaybackProgress)
    if collection_id is not None:
        query = query.where(Document.collection_id == collection_id)
    elif unsorted:
        query = query.where(Document.collection_id.is_(None))
    if q.strip():
        query = query.where(Document.title.icontains(q.strip(), autoescape=True))

    # Counted in one go, before leaving out any progress, so each filter can
    # show its number.
    row = (
        await session.execute(
            query.with_only_columns(
                func.count(),
                func.count().filter(not_started),
                func.count().filter(in_progress),
                func.count().filter(finished),
            )
        )
    ).one()
    counts = dict(zip(["all", "not-started", "in-progress", "finished"], row))
    total = counts[progress]

    if progress == "not-started":
        query = query.where(not_started)
    elif progress == "in-progress":
        query = query.where(in_progress)
    elif progress == "finished":
        query = query.where(finished)

    # The id last decides between documents added (or listened to) at the
    # same moment, so the order, and so each page, is always the same.
    order = {
        "newest": [Document.created_at.desc(), Document.id.desc()],
        "oldest": [Document.created_at, Document.id],
        "listened": [
            PlaybackProgress.updated_at.desc().nulls_last(),
            Document.created_at.desc(),
            Document.id.desc(),
        ],
    }[sort]
    documents = (
        await session.scalars(
            query.order_by(*order)
            .offset((page - 1) * page_size)
            .limit(page_size)
            .options(selectinload(Document.progress))
        )
    ).all()
    return LibraryPage(
        items=await _library_items(session, documents), total=total, counts=counts
    )


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
    # else, even if the file's contents look like something else. no-cache:
    # the browser checks each time whether its copy is still current (a
    # quick "not modified" if so), since a cover can be changed.
    return FileResponse(
        path,
        media_type=document.cover_type,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"},
    )


@router.get("/{document_id}/text", response_model=DocumentText)
async def get_text(document_id: int, session: AsyncSession = Depends(get_session)):
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return document


@router.put("/{document_id}/text", response_model=DocumentTextUpdated)
async def update_text(
    document_id: int,
    body: DocumentTextUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Replace a document's title and text. Chunks whose text is unchanged
    keep their audio (see services/editing.py); the others are replaced, and
    any job generating its audio carries on with the new ones.

    The listening position stays where it is if its chunk is unchanged, and
    otherwise moves to the start of the first new chunk. A finished document
    is unfinished if there's anything new in it to hear.
    """
    _check_text(body.text)
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    chunks = (
        await session.scalars(
            select(Chunk).where(Chunk.document_id == document_id).order_by(Chunk.index)
        )
    ).all()

    plan = plan_edit(document.text, [c.text_hash for c in chunks], body.text)
    old_count, front = len(chunks), plan.keep_front
    removed = chunks[front : old_count - plan.keep_back]
    back = chunks[old_count - plan.keep_back :] if plan.keep_back else []
    new_rows = chunk_rows(plan.middle, first_index=front)
    added = len(new_rows)

    removed_ids = {c.id for c in removed}
    audio_paths = (
        await session.scalars(
            select(AudioFile.file_path).where(AudioFile.chunk_id.in_(removed_ids))
        )
    ).all()
    # Their audio goes with them (ON DELETE CASCADE).
    await session.execute(delete(Chunk).where(Chunk.id.in_(removed_ids)))
    # The chunks kept at the end move to after the new ones. Each chunk's
    # index is unique within its document, so they're moved out of the way
    # first.
    for i, chunk in enumerate(back):
        chunk.index = -1 - i
    await session.flush()
    session.add_all(Chunk(document_id=document_id, **row) for row in new_rows)
    await session.flush()
    for i, chunk in enumerate(back):
        chunk.index = front + added + i

    document.title = body.title or _title_from(body.text)
    document.text = body.text

    progress = await session.get(PlaybackProgress, document_id)
    if progress:
        total = front + added + len(back)
        nothing_new = added == 0 or only_removed(
            [c.text for c in removed], [r["text"] for r in new_rows]
        )
        if progress.finished and not nothing_new:
            progress.finished = False
            progress.chunk_index, progress.offset_sec = front, 0
        elif progress.chunk_index >= old_count - len(back):
            # In a chunk kept at the end, which may have moved.
            progress.chunk_index += front + added - (old_count - len(back))
        elif progress.chunk_index >= front:
            # In a chunk that was replaced.
            progress.chunk_index, progress.offset_sec = front, 0
        # Everything from there to the end was deleted: the last chunk.
        if progress.chunk_index >= total:
            progress.chunk_index, progress.offset_sec = total - 1, 0

    await session.commit()
    # Only once the rows are gone, so a failed edit doesn't lose the files.
    await skip_chunks(removed_ids)
    remove_files(list(audio_paths))
    return DocumentTextUpdated(changed=added, first_changed=front if added else None)


@router.put("/{document_id}/cover", status_code=status.HTTP_204_NO_CONTENT)
async def update_cover(
    document_id: int, body: DocumentCover, session: AsyncSession = Depends(get_session)
):
    """Set a document's cover from an image's address (downloaded once and
    saved, like the covers found on pages), or remove it."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    ids = [document_id]
    if body.whole_collection:
        ids = (
            await session.scalars(
                select(Document.id).where(
                    Document.collection_id.is_(None)
                    if document.collection_id is None
                    else Document.collection_id == document.collection_id
                )
            )
        ).all()

    if body.image_url is None:
        cover_type = None
    else:
        try:
            cover_type = await set_cover(ids, str(body.image_url))
        except FetchError as e:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Couldn't use that image: {e}"
            )
    await session.execute(
        update(Document).where(Document.id.in_(ids)).values(cover_type=cover_type)
    )
    await session.commit()
    if cover_type is None:
        remove_files([str(cover_path(i)) for i in ids])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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


@router.put("/{document_id}/voice", status_code=status.HTTP_204_NO_CONTENT)
async def set_voice(
    document_id: int, body: DocumentVoice, session: AsyncSession = Depends(get_session)
):
    """Remembers the voice a document is being played with, so it opens with
    that voice next time. (Generating with a voice does the same.)"""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    if await session.get(VoicePreset, body.voice_preset_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice preset not found.")
    document.voice_preset_id = body.voice_preset_id
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
