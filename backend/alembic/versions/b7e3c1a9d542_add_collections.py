"""add collections

Revision ID: b7e3c1a9d542
Revises: 4f2b8d6e1a95
Create Date: 2026-10-30 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e3c1a9d542'
down_revision: Union[str, Sequence[str], None] = '4f2b8d6e1a95'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'collections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    # Existing documents start without one, so they're Unsorted.
    op.add_column('documents', sa.Column('collection_id', sa.Integer(), nullable=True))
    op.create_index('ix_documents_collection_id', 'documents', ['collection_id'])
    op.create_foreign_key(
        'documents_collection_id_fkey', 'documents', 'collections',
        ['collection_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('documents_collection_id_fkey', 'documents', type_='foreignkey')
    op.drop_index('ix_documents_collection_id', table_name='documents')
    op.drop_column('documents', 'collection_id')
    op.drop_table('collections')
