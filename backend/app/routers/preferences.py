from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Preference
from app.schemas import Preferences
from app.services.preferences import ROW_ID, load_preferences

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


@router.get("", response_model=Preferences)
async def get_preferences(session: AsyncSession = Depends(get_session)):
    return await load_preferences(session)


@router.put("", response_model=Preferences)
async def save_preferences(body: Preferences, session: AsyncSession = Depends(get_session)):
    row = await session.get(Preference, ROW_ID)
    if row is None:
        row = Preference(id=ROW_ID)
        session.add(row)
    row.settings = body.model_dump()
    await session.commit()
    return body
