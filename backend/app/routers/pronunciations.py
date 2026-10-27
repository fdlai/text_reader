from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Pronunciation
from app.schemas import PronunciationIn, PronunciationOut
from app.services.pronunciation import clear_lexicon_cache, normalize

router = APIRouter(prefix="/api/pronunciations", tags=["pronunciations"])


def _apply(pronunciation: Pronunciation, body: PronunciationIn) -> None:
    key = normalize(body.word)
    if not key:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "The word needs letters or numbers."
        )
    pronunciation.word = body.word.strip()
    pronunciation.key = key
    pronunciation.sounds_like = body.sounds_like.strip()
    pronunciation.enabled = body.enabled


async def _commit(session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That word already has a pronunciation."
        )
    clear_lexicon_cache()


@router.get("", response_model=list[PronunciationOut])
async def list_pronunciations(session: AsyncSession = Depends(get_session)):
    query = select(Pronunciation).order_by(Pronunciation.key)
    return (await session.scalars(query)).all()


@router.post("", response_model=PronunciationOut, status_code=status.HTTP_201_CREATED)
async def create_pronunciation(
    body: PronunciationIn, session: AsyncSession = Depends(get_session)
):
    pronunciation = Pronunciation()
    _apply(pronunciation, body)
    session.add(pronunciation)
    await _commit(session)
    return pronunciation


@router.put("/{pronunciation_id}", response_model=PronunciationOut)
async def update_pronunciation(
    pronunciation_id: int,
    body: PronunciationIn,
    session: AsyncSession = Depends(get_session),
):
    pronunciation = await session.get(Pronunciation, pronunciation_id)
    if pronunciation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pronunciation not found.")
    _apply(pronunciation, body)
    await _commit(session)
    return pronunciation


@router.delete("/{pronunciation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pronunciation(
    pronunciation_id: int, session: AsyncSession = Depends(get_session)
):
    pronunciation = await session.get(Pronunciation, pronunciation_id)
    if pronunciation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pronunciation not found.")
    await session.delete(pronunciation)
    await session.commit()
    clear_lexicon_cache()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
