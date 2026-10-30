from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Collection, Document, PlaybackProgress
from app.schemas import CollectionCreate, CollectionOut, CollectionSummary, CoverItem
# Renamed, since delete_collection's parameter has the same name.
from app.services.deletion import delete_documents as remove_documents

router = APIRouter(prefix="/api/collections", tags=["collections"])

# How many books a collection's card shows, stacked.
STACK_SIZE = 3


@router.get("", response_model=list[CollectionSummary])
async def list_collections(session: AsyncSession = Depends(get_session)):
    """Every collection, by name, then Unsorted if anything is in it."""
    collections = await session.scalars(
        select(Collection).order_by(func.lower(Collection.name))
    )
    # How many documents each collection has (None: Unsorted).
    counts = dict(
        (
            await session.execute(
                select(Document.collection_id, func.count()).group_by(
                    Document.collection_id
                )
            )
        ).all()
    )
    in_progress = dict(
        (
            await session.execute(
                select(Document.collection_id, func.count())
                .join(PlaybackProgress)
                .where(PlaybackProgress.finished.is_(False))
                .group_by(Document.collection_id)
            )
        ).all()
    )
    # The newest few documents of each collection: rows are numbered 1, 2,
    # 3... newest first, starting again for each collection.
    rank = (
        func.row_number()
        .over(
            partition_by=Document.collection_id,
            order_by=Document.created_at.desc(),
        )
        .label("rank")
    )
    newest = (
        select(
            Document.collection_id,
            Document.id,
            Document.title,
            Document.cover_type,
            rank,
        )
    ).subquery()
    stacks: dict[int | None, list[CoverItem]] = defaultdict(list)
    for row in await session.execute(
        select(newest)
        .where(newest.c.rank <= STACK_SIZE)
        .order_by(newest.c.collection_id, newest.c.rank)
    ):
        stacks[row.collection_id].append(
            CoverItem(id=row.id, title=row.title, has_cover=row.cover_type is not None)
        )

    def summary(collection_id: int | None, name: str) -> CollectionSummary:
        return CollectionSummary(
            id=collection_id,
            name=name,
            document_count=counts.get(collection_id, 0),
            in_progress_count=in_progress.get(collection_id, 0),
            stack=stacks[collection_id],
        )

    summaries = [summary(c.id, c.name) for c in collections]
    if counts.get(None):
        summaries.append(summary(None, "Unsorted"))
    return summaries


@router.post("", response_model=CollectionOut, status_code=status.HTTP_201_CREATED)
async def create_collection(
    body: CollectionCreate, session: AsyncSession = Depends(get_session)
):
    # Names differing only in capitals would look like duplicates.
    taken = await session.scalar(
        select(Collection.id).where(func.lower(Collection.name) == body.name.lower())
    )
    if taken is not None:
        raise _name_taken()
    collection = Collection(name=body.name)
    session.add(collection)
    try:
        await session.commit()
    except IntegrityError:
        # The same name created twice at the same moment.
        await session.rollback()
        raise _name_taken()
    return collection


def _name_taken() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT, "You already have a collection with that name."
    )


async def _get_or_404(session: AsyncSession, collection_id: int) -> Collection:
    collection = await session.get(Collection, collection_id)
    if collection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found.")
    return collection


@router.get("/{collection_id}", response_model=CollectionOut)
async def get_collection(
    collection_id: int, session: AsyncSession = Depends(get_session)
):
    return await _get_or_404(session, collection_id)


@router.patch("/{collection_id}", response_model=CollectionOut)
async def rename_collection(
    collection_id: int,
    body: CollectionCreate,
    session: AsyncSession = Depends(get_session),
):
    collection = await _get_or_404(session, collection_id)
    # Another collection with that name; changing only capitals is fine.
    taken = await session.scalar(
        select(Collection.id).where(
            func.lower(Collection.name) == body.name.lower(),
            Collection.id != collection_id,
        )
    )
    if taken is not None:
        raise _name_taken()
    collection.name = body.name
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise _name_taken()
    return collection


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(
    collection_id: int,
    delete_documents: bool = False,
    session: AsyncSession = Depends(get_session),
):
    """Deletes a collection. Its documents become Unsorted (the database
    does that, see Document.collection_id), or with delete_documents=true are
    deleted too."""
    collection = await _get_or_404(session, collection_id)
    if delete_documents:
        document_ids = (
            await session.scalars(
                select(Document.id).where(Document.collection_id == collection_id)
            )
        ).all()
        await remove_documents(session, list(document_ids))
    await session.delete(collection)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
