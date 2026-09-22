import os
import pathlib
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models import Subject, Branch, Commit, DocumentVersion
from app.schemas import UploadResponse, DocumentVersionOut
from app.services.ingest import ingest_pdf

router = APIRouter()


async def _resolve_branch_and_commit(subject_id: str, db: AsyncSession) -> tuple[Branch, Commit]:
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    branch = (await db.execute(select(Branch).where(Branch.id == subject.current_branch_id))).scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=400, detail="Subject has no active branch")

    return subject, branch


@router.post("/{subject_id}/upload", response_model=UploadResponse, status_code=201)
async def upload_pdf(
    subject_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    subject, branch = await _resolve_branch_and_commit(subject_id, db)

    # Save file to disk
    upload_path = pathlib.Path(settings.upload_dir) / subject_id
    upload_path.mkdir(parents=True, exist_ok=True)
    file_path = upload_path / file.filename

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Create a new commit for this upload
    parent_branch = (await db.execute(select(Branch).where(Branch.id == subject.current_branch_id))).scalar_one()
    new_commit = Commit(
        branch_id=branch.id,
        subject_id=subject_id,
        message=f"Add {file.filename}",
        parent_commit_id=parent_branch.head_commit_id,
        config_snapshot={
            "chunk_size": settings.chunk_size,
            "chunk_overlap": settings.chunk_overlap,
            "embedding_model": settings.embedding_model,
        },
    )
    db.add(new_commit)
    await db.flush()

    # Carry forward existing document versions from the parent commit
    if parent_branch.head_commit_id:
        old_docs = (
            await db.execute(
                select(DocumentVersion).where(
                    DocumentVersion.commit_id == parent_branch.head_commit_id,
                    DocumentVersion.status != "removed",
                )
            )
        ).scalars().all()
        for old_doc in old_docs:
            carried = DocumentVersion(
                commit_id=new_commit.id,
                subject_id=subject_id,
                branch_id=branch.id,
                filename=old_doc.filename,
                file_path=old_doc.file_path,
                page_count=old_doc.page_count,
                chunk_count=old_doc.chunk_count,
                status="unchanged",
                indexed_at=old_doc.indexed_at,
            )
            db.add(carried)

    # Create document version entry for the new PDF
    doc_version = DocumentVersion(
        commit_id=new_commit.id,
        subject_id=subject_id,
        branch_id=branch.id,
        filename=file.filename,
        file_path=str(file_path),
        status="added",
    )
    db.add(doc_version)
    await db.flush()

    # Run ingestion: parse PDF, chunk, embed, upsert into Qdrant
    page_count, chunk_count = await ingest_pdf(
        file_path=file_path,
        document_version_id=doc_version.id,
        subject_id=subject_id,
        branch_id=branch.id,
        commit_id=new_commit.id,
        db=db,
    )

    doc_version.page_count = page_count
    doc_version.chunk_count = chunk_count
    doc_version.indexed_at = datetime.now(timezone.utc)

    # Advance branch head
    branch.head_commit_id = new_commit.id

    await db.commit()

    return UploadResponse(
        document_version_id=doc_version.id,
        filename=file.filename,
        page_count=page_count,
        chunk_count=chunk_count,
        commit_id=new_commit.id,
        message=f"Indexed {chunk_count} chunks from {page_count} pages",
    )


@router.get("/{subject_id}/documents", response_model=list[DocumentVersionOut])
async def list_documents(
    subject_id: str,
    commit_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    subject, branch = await _resolve_branch_and_commit(subject_id, db)
    target_commit = commit_id or branch.head_commit_id
    if not target_commit:
        return []

    docs = (
        await db.execute(
            select(DocumentVersion).where(
                DocumentVersion.commit_id == target_commit,
                DocumentVersion.status != "removed",
            )
        )
    ).scalars().all()
    return docs


@router.get("/{subject_id}/documents/{document_version_id}/file")
async def get_document_file(
    subject_id: str,
    document_version_id: str,
    db: AsyncSession = Depends(get_db),
):
    doc = (
        await db.execute(
            select(DocumentVersion).where(
                DocumentVersion.id == document_version_id,
                DocumentVersion.subject_id == subject_id,
            )
        )
    ).scalar_one_or_none()
    if not doc or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="Document file not found")

    return FileResponse(
        path=doc.file_path,
        media_type="application/pdf",
        filename=doc.filename,
    )

