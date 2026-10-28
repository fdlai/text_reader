from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Preference
from app.schemas import Preferences

router = APIRouter(prefix="/api/preferences", tags=["preferences"])

# The single settings row (see models.Preference).
ROW_ID = 1


@router.get("", response_model=Preferences)
async def get_preferences(session: AsyncSession = Depends(get_session)):
    row = await session.get(Preference, ROW_ID)
    return Preferences.model_validate(row.settings if row else {})


@router.put("", response_model=Preferences)
async def save_preferences(body: Preferences, session: AsyncSession = Depends(get_session)):
    row = await session.get(Preference, ROW_ID)
    if row is None:
        row = Preference(id=ROW_ID)
        session.add(row)
    row.settings = body.model_dump()
    await session.commit()
    return body
