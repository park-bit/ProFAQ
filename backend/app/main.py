import os
import pathlib

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import ROOT_DIR, settings
from app.db import init_db
from app.routers import subjects, documents, query, versions, eval as eval_router


async def _background_prewarm():
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        from app.services.vector_store import get_client
        from app.services.ingest import get_embedder
        from app.services.retrieval import get_reranker
        await loop.run_in_executor(None, get_client)
        await loop.run_in_executor(None, get_embedder)
        await loop.run_in_executor(None, get_reranker)
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure upload directory exists
    pathlib.Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    # Initialize database tables
    await init_db()
    # Pre-warm models in background so GUI opens instantly
    import asyncio
    asyncio.create_task(_background_prewarm())
    yield


app = FastAPI(
    title="ProFAQ API",
    description="Grounded multi-PDF Q&A with subjects and version control.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(subjects.router, prefix="/subjects", tags=["subjects"])
app.include_router(documents.router, prefix="/subjects", tags=["documents"])
app.include_router(query.router, prefix="/subjects", tags=["query"])
app.include_router(versions.router, prefix="/subjects", tags=["versions"])
app.include_router(eval_router.router, prefix="/eval", tags=["eval"])


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve static frontend production build if available
FRONTEND_DIST = (ROOT_DIR / "frontend" / "dist").resolve()
if FRONTEND_DIST.exists():
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        target_file = FRONTEND_DIST / full_path
        if full_path and target_file.is_file():
            return FileResponse(str(target_file))
        return FileResponse(str(FRONTEND_DIST / "index.html"))

