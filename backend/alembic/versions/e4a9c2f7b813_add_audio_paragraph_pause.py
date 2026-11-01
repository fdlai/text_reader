"""add audio paragraph pause

Revision ID: e4a9c2f7b813
Revises: b7e3c1a9d542
Create Date: 2026-11-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4a9c2f7b813'
down_revision: Union[str, Sequence[str], None] = 'b7e3c1a9d542'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('audio_files', sa.Column('paragraph_pause', sa.Float(), nullable=True))
    # Existing audio gets the pause it was actually made with: Qwen always
    # paused 0.35 s after each paragraph, Kokoro read each chunk in one go.
    # OpenAI audio stays NULL, since it never gets these pauses.
    op.execute(
        """
        UPDATE audio_files
        SET paragraph_pause = CASE voice_presets.engine
            WHEN 'qwen' THEN 0.35 ELSE 0.0 END
        FROM voice_presets
        WHERE voice_presets.id = audio_files.voice_preset_id
          AND voice_presets.engine IN ('qwen', 'kokoro')
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('audio_files', 'paragraph_pause')
