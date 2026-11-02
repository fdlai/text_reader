"""add document voice

Revision ID: f1c7d3a2b904
Revises: e4a9c2f7b813
Create Date: 2026-11-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1c7d3a2b904'
down_revision: Union[str, Sequence[str], None] = 'e4a9c2f7b813'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing documents start without one; until they're played or
    # generated again, they open with the voice that has the most audio.
    op.add_column('documents', sa.Column('voice_preset_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'documents_voice_preset_id_fkey', 'documents', 'voice_presets',
        ['voice_preset_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('documents_voice_preset_id_fkey', 'documents', type_='foreignkey')
    op.drop_column('documents', 'voice_preset_id')
