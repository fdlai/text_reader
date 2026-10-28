from fastapi import APIRouter

from app.services.tts import unavailable_reasons

router = APIRouter(prefix="/api/engines", tags=["engines"])


# Lets pages explain why an engine can't generate (e.g. Docker Desktop isn't
# running) before the user tries. Audio that's already generated still plays.
@router.get("")
async def engine_status() -> dict[str, dict]:
    return {
        engine: {"available": reason is None, "reason": reason}
        for engine, reason in (await unavailable_reasons()).items()
    }
