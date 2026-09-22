from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings, DATA_DIR

db_url = settings.database_url
if db_url.startswith("sqlite") and ("./data/" in db_url or "profaq.db" in db_url):
    db_url = f"sqlite+aiosqlite:///{str(DATA_DIR / 'profaq.db').replace(chr(92), '/')}"

engine = create_async_engine(db_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Check and add missing columns for existing SQLite databases
        def migrate_columns(sync_conn):
            from sqlalchemy import text
            try:
                cols_sub = [row[1] for row in sync_conn.execute(text("PRAGMA table_info(subjects)")).fetchall()]
                if cols_sub and "active_commit_id" not in cols_sub:
                    sync_conn.execute(text("ALTER TABLE subjects ADD COLUMN active_commit_id VARCHAR"))

                cols_doc = [row[1] for row in sync_conn.execute(text("PRAGMA table_info(document_versions)")).fetchall()]
                if cols_doc and "source_version_id" not in cols_doc:
                    sync_conn.execute(text("ALTER TABLE document_versions ADD COLUMN source_version_id VARCHAR"))

                cols_log = [row[1] for row in sync_conn.execute(text("PRAGMA table_info(query_logs)")).fetchall()]
                if cols_log and "session_id" not in cols_log:
                    sync_conn.execute(text("ALTER TABLE query_logs ADD COLUMN session_id VARCHAR"))

                cols_chat = [row[1] for row in sync_conn.execute(text("PRAGMA table_info(chat_sessions)")).fetchall()]
                if cols_chat:
                    if "chat_type" not in cols_chat:
                        sync_conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN chat_type VARCHAR DEFAULT 'general'"))
                    if "target_length" not in cols_chat:
                        sync_conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN target_length VARCHAR DEFAULT 'standard'"))
                    if "format_style" not in cols_chat:
                        sync_conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN format_style VARCHAR DEFAULT 'structured'"))
            except Exception:
                pass

        await conn.run_sync(migrate_columns)
