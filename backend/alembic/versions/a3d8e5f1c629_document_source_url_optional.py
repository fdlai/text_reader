"""document source_url optional

Revision ID: a3d8e5f1c629
Revises: f1c7d3a2b904
Create Date: 2026-11-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3d8e5f1c629'
down_revision: Union[str, Sequence[str], None] = 'f1c7d3a2b904'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Text typed or pasted in has no page. The unique index stays: Postgres
    # allows any number of NULLs in a unique column.
    op.alter_column('documents', 'source_url', existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    # Fails if any typed-in documents exist; delete them first.
    op.alter_column('documents', 'source_url', existing_type=sa.Text(), nullable=False)
