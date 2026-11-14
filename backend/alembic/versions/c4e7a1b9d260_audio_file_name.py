"""audio file name instead of path

Revision ID: c4e7a1b9d260
Revises: a3d8e5f1c629
Create Date: 2026-11-12 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4e7a1b9d260'
down_revision: Union[str, Sequence[str], None] = 'a3d8e5f1c629'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Paths were saved as written on the computer that made them, such as
    # "storage\audio\12_3_kokoro-v1.0.mp3" on Windows, which doesn't work on
    # Linux (e.g. in Docker). Only the name is kept now; the folder comes
    # from the audio_dir setting.
    op.alter_column('audio_files', 'file_path', new_column_name='file_name')
    # Backslashes (chr(92)) become slashes, then everything up to the last
    # slash is removed.
    op.execute(
        "UPDATE audio_files"
        " SET file_name = regexp_replace(replace(file_name, chr(92), '/'), '^.*/', '')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(r"UPDATE audio_files SET file_name = 'storage/audio/' || file_name")
    op.alter_column('audio_files', 'file_name', new_column_name='file_path')
