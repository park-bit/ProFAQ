from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Subject, Branch, Commit, DocumentVersion
from app.schemas import (
    BranchCreate,
    BranchOut,
    CommitOut,
    CheckoutRequest,
    DiffResult,
    MergeRequest,
    ImportDocumentRequest,
    ExternalDocumentOut,
    DocumentVersionOut,
)
from app.services.versioning import (
    get_commit_history,
    create_branch,
    checkout,
    diff_commits,
    merge_branches,
    import_document_to_subject,
    get_available_external_documents,
)

router = APIRouter()


@router.get("/{subject_id}/branches", response_model=list[BranchOut])
async def list_branches(subject_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Branch).where(Branch.subject_id == subject_id))
    return result.scalars().all()


@router.post("/{subject_id}/branches", response_model=BranchOut, status_code=201)
async def new_branch(subject_id: str, body: BranchCreate, db: AsyncSession = Depends(get_db)):
    # Check name uniqueness
    existing = (await db.execute(
        select(Branch).where(Branch.subject_id == subject_id, Branch.name == body.name)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"Branch '{body.name}' already exists")

    branch = await create_branch(subject_id, body.name, body.from_commit_id, db)
    await db.commit()
    await db.refresh(branch)
    return branch


@router.get("/{subject_id}/commits", response_model=list[CommitOut])
async def list_commits(
    subject_id: str,
    branch_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    active_branch_id = branch_id or subject.current_branch_id
    history = await get_commit_history(active_branch_id, db)

    result = []
    for commit in history:
        # Count documents at this commit
        count_result = await db.execute(
            select(func.count()).where(
                DocumentVersion.commit_id == commit.id,
                DocumentVersion.status != "removed",
            )
        )
        doc_count = count_result.scalar_one()
        out = CommitOut(
            id=commit.id,
            branch_id=commit.branch_id,
            subject_id=commit.subject_id,
            message=commit.message,
            parent_commit_id=commit.parent_commit_id,
            config_snapshot=commit.config_snapshot,
            created_at=commit.created_at,
            document_count=doc_count,
        )
        result.append(out)

    return result


@router.post("/{subject_id}/checkout", response_model=dict)
async def checkout_version(
    subject_id: str,
    body: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
):
    if not body.branch_id and not body.commit_id:
        raise HTTPException(status_code=400, detail="Provide branch_id or commit_id")
    try:
        subject = await checkout(subject_id, body.branch_id, body.commit_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await db.commit()
    return {
        "subject_id": subject_id,
        "current_branch_id": subject.current_branch_id,
        "active_commit_id": subject.active_commit_id,
    }


@router.post("/{subject_id}/merge", response_model=CommitOut)
async def merge_branch_view(
    subject_id: str,
    body: MergeRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        merge_commit = await merge_branches(
            subject_id=subject_id,
            source_branch_id=body.source_branch_id,
            target_branch_id=body.target_branch_id,
            db=db,
        )
        await db.commit()
        await db.refresh(merge_commit)

        count_result = await db.execute(
            select(func.count()).where(
                DocumentVersion.commit_id == merge_commit.id,
                DocumentVersion.status != "removed",
            )
        )
        doc_count = count_result.scalar_one()

        return CommitOut(
            id=merge_commit.id,
            branch_id=merge_commit.branch_id,
            subject_id=merge_commit.subject_id,
            message=merge_commit.message,
            parent_commit_id=merge_commit.parent_commit_id,
            config_snapshot=merge_commit.config_snapshot,
            created_at=merge_commit.created_at,
            document_count=doc_count,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{subject_id}/import-document", response_model=DocumentVersionOut)
async def import_document_view(
    subject_id: str,
    body: ImportDocumentRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        imported_dv = await import_document_to_subject(
            target_subject_id=subject_id,
            source_doc_version_id=body.document_version_id,
            db=db,
        )
        await db.commit()
        await db.refresh(imported_dv)
        return imported_dv
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{subject_id}/available-external-documents", response_model=list[ExternalDocumentOut])
async def list_external_documents(
    subject_id: str,
    db: AsyncSession = Depends(get_db),
):
    docs = await get_available_external_documents(subject_id, db)
    return [ExternalDocumentOut(**d) for d in docs]


@router.get("/{subject_id}/diff", response_model=DiffResult)
async def diff_view(
    subject_id: str,
    from_commit: str,
    to_commit: str,
    db: AsyncSession = Depends(get_db),
):
    result = await diff_commits(from_commit, to_commit, db)
    return DiffResult(**result)
