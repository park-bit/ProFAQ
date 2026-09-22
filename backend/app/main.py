import os
import pathlib

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import init_db
from app.routers import subjects, documents, query, versions, eval as eval_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure upload directory exists
    pathlib.Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    # Initialize database tables
    await init_db()
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
