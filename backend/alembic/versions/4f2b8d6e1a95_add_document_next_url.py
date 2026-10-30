"""add document next_url, unique source_url

Revision ID: 4f2b8d6e1a95
Revises: 9c1e4a7b2d30
Create Date: 2026-10-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4f2b8d6e1a95'
down_revision: Union[str, Sequence[str], None] = '9c1e4a7b2d30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing documents start without one; app.backfill_next_urls adds them.
    op.add_column('documents', sa.Column('next_url', sa.Text(), nullable=True))
    # A unique constraint comes with an index, so looking a URL up is fast.
    op.create_unique_constraint('documents_source_url_key', 'documents', ['source_url'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('documents_source_url_key', 'documents', type_='unique')
    op.drop_column('documents', 'next_url')
