from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Preference
from app.schemas import Preferences

# The single settings row (see models.Preference).
ROW_ID = 1


async def load_preferences(session: AsyncSession) -> Preferences:
    row = await session.get(Preference, ROW_ID)
    return Preferences.model_validate(row.settings if row else {})
