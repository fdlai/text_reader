from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AudioFile, Chunk, Document
from app.services.covers import cover_path
from app.services.generation import cancel_generation, remove_files


async def delete_documents(session: AsyncSession, document_ids: list[int]) -> None:
    """Deletes documents with everything that belongs to them: their chunks,
    audio and listening position (by cascade), any audio still being
    generated for them, and their audio and cover files. Commits.

    Every way of deleting documents should go through here. Rows are removed
    by the database's ON DELETE CASCADE, so a new table that points at
    documents (or chunks) needs one too, and new files need removing below.
    """
    # Otherwise a running job would keep generating audio for deleted chunks.
    for document_id in document_ids:
        await cancel_generation(document_id=document_id)
    audio_paths = (
        await session.scalars(
            select(AudioFile.file_path)
            .join(Chunk, Chunk.id == AudioFile.chunk_id)
            .where(Chunk.document_id.in_(document_ids))
        )
    ).all()
    await session.execute(delete(Document).where(Document.id.in_(document_ids)))
    await session.commit()
    # Only once the rows are gone, so a failed delete doesn't lose the files.
    remove_files([*audio_paths, *(str(cover_path(i)) for i in document_ids)])
