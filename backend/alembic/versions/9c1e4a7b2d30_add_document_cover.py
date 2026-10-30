"""add document cover

Revision ID: 9c1e4a7b2d30
Revises: 376cb6c9fa21
Create Date: 2026-10-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c1e4a7b2d30'
down_revision: Union[str, Sequence[str], None] = '376cb6c9fa21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing documents start without a cover; app.backfill_covers adds them.
    op.add_column('documents', sa.Column('cover_type', sa.String(length=50), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('documents', 'cover_type')
