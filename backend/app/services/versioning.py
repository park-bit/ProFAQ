"""
Version control logic: commits, branches, checkout, diff, merge, and cross-subject document import.
"""
from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Subject, Branch, Commit, DocumentVersion


async def get_commit_history(branch_id: str, db: AsyncSession) -> list[Commit]:
    """Walk parent pointers to build commit history for a branch."""
    branch = (await db.execute(select(Branch).where(Branch.id == branch_id))).scalar_one_or_none()
    if not branch or not branch.head_commit_id:
        return []

    history = []
    current_id = branch.head_commit_id
    visited: set[str] = set()

    while current_id and current_id not in visited:
        visited.add(current_id)
        commit = (await db.execute(select(Commit).where(Commit.id == current_id))).scalar_one_or_none()
        if not commit:
            break
        history.append(commit)
        current_id = commit.parent_commit_id

    return history


async def create_branch(
    subject_id: str,
    name: str,
    from_commit_id: str | None,
    db: AsyncSession,
) -> Branch:
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one()
    current_branch = (await db.execute(select(Branch).where(Branch.id == subject.current_branch_id))).scalar_one()

    base_commit_id = from_commit_id or subject.active_commit_id or current_branch.head_commit_id

    new_branch = Branch(
        subject_id=subject_id,
        name=name,
        parent_branch_id=current_branch.id,
        created_from_commit_id=base_commit_id,
        head_commit_id=base_commit_id,
    )
    db.add(new_branch)
    await db.flush()

    # Automatically switch to new branch
    subject.current_branch_id = new_branch.id
    subject.active_commit_id = None
    return new_branch


async def checkout(
    subject_id: str,
    branch_id: str | None,
    commit_id: str | None,
    db: AsyncSession,
) -> Subject:
    """
    Non-destructive checkout.
    - If branch_id is provided, sets current branch and resets active_commit to HEAD.
    - If commit_id is provided (detached HEAD state), sets active_commit without mutating branch head.
    - If commit_id is "HEAD", clears detached state and rejoins current branch head.
    """
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
    if not subject:
        raise ValueError("Subject not found")

    if branch_id:
        branch = (await db.execute(select(Branch).where(Branch.id == branch_id, Branch.subject_id == subject_id))).scalar_one_or_none()
        if not branch:
            raise ValueError("Branch not found")
        subject.current_branch_id = branch_id

        if commit_id:
            if commit_id == "HEAD":
                subject.active_commit_id = None
            else:
                commit = (await db.execute(select(Commit).where(Commit.id == commit_id, Commit.subject_id == subject_id))).scalar_one_or_none()
                if not commit:
                    raise ValueError("Commit not found in this subject")
                subject.active_commit_id = commit_id
        else:
            subject.active_commit_id = None

    elif commit_id:
        if commit_id == "HEAD":
            subject.active_commit_id = None
        else:
            commit = (await db.execute(select(Commit).where(Commit.id == commit_id, Commit.subject_id == subject_id))).scalar_one_or_none()
            if not commit:
                raise ValueError("Commit not found")
            subject.active_commit_id = commit_id

    return subject


async def diff_commits(from_commit_id: str, to_commit_id: str, db: AsyncSession) -> dict:
    """Compare document sets between two commits."""

    async def get_docs(cid: str) -> dict[str, DocumentVersion]:
        docs = (await db.execute(select(DocumentVersion).where(
            DocumentVersion.commit_id == cid,
            DocumentVersion.status != "removed",
        ))).scalars().all()
        return {d.filename: d for d in docs}

    from_docs = await get_docs(from_commit_id)
    to_docs = await get_docs(to_commit_id)

    from_names = set(from_docs.keys())
    to_names = set(to_docs.keys())

    added = sorted(to_names - from_names)
    removed = sorted(from_names - to_names)
    unchanged = sorted(from_names & to_names)

    # Config diff
    from_commit = (await db.execute(select(Commit).where(Commit.id == from_commit_id))).scalar_one_or_none()
    to_commit = (await db.execute(select(Commit).where(Commit.id == to_commit_id))).scalar_one_or_none()

    from_cfg = from_commit.config_snapshot or {} if from_commit else {}
    to_cfg = to_commit.config_snapshot or {} if to_commit else {}
    config_changed = from_cfg != to_cfg

    config_diff = {}
    if config_changed:
        all_keys = set(from_cfg) | set(to_cfg)
        for k in all_keys:
            if from_cfg.get(k) != to_cfg.get(k):
                config_diff[k] = {"from": from_cfg.get(k), "to": to_cfg.get(k)}

    return {
        "from_commit_id": from_commit_id,
        "to_commit_id": to_commit_id,
        "added": added,
        "removed": removed,
        "unchanged": unchanged,
        "config_changed": config_changed,
        "config_diff": config_diff if config_changed else None,
    }


async def merge_branches(
    subject_id: str,
    source_branch_id: str,
    target_branch_id: str | None,
    db: AsyncSession,
) -> Commit:
    """
    Merges source branch into target branch (defaults to subject.current_branch_id).
    Combines documents from both branches into a new merge commit on target branch.
    """
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
    if not subject:
        raise ValueError("Subject not found")

    target_id = target_branch_id or subject.current_branch_id
    if source_branch_id == target_id:
        raise ValueError("Cannot merge a branch into itself")

    source_branch = (await db.execute(select(Branch).where(Branch.id == source_branch_id, Branch.subject_id == subject_id))).scalar_one_or_none()
    target_branch = (await db.execute(select(Branch).where(Branch.id == target_id, Branch.subject_id == subject_id))).scalar_one_or_none()
    if not source_branch or not target_branch:
        raise ValueError("Source or target branch not found")

    if not source_branch.head_commit_id:
        raise ValueError(f"Source branch '{source_branch.name}' has no commits to merge")

    # Get active documents from source branch
    source_docs = (await db.execute(select(DocumentVersion).where(
        DocumentVersion.commit_id == source_branch.head_commit_id,
        DocumentVersion.status != "removed",
    ))).scalars().all()

    # Get active documents from target branch (if any commits exist)
    target_docs = []
    if target_branch.head_commit_id:
        target_docs = (await db.execute(select(DocumentVersion).where(
            DocumentVersion.commit_id == target_branch.head_commit_id,
            DocumentVersion.status != "removed",
        ))).scalars().all()

    # Merge document maps by filename
    merged_docs_by_name: dict[str, DocumentVersion] = {d.filename: d for d in target_docs}
    for doc in source_docs:
        if doc.filename not in merged_docs_by_name:
            merged_docs_by_name[doc.filename] = doc

    # Fetch snapshot from target head or source head
    target_head = (await db.execute(select(Commit).where(Commit.id == target_branch.head_commit_id))).scalar_one_or_none() if target_branch.head_commit_id else None
    source_head = (await db.execute(select(Commit).where(Commit.id == source_branch.head_commit_id))).scalar_one()

    # Create merge commit
    merge_commit = Commit(
        branch_id=target_branch.id,
        subject_id=subject_id,
        message=f"Merge branch '{source_branch.name}' into '{target_branch.name}'",
        parent_commit_id=target_branch.head_commit_id or source_branch.head_commit_id,
        config_snapshot=(target_head.config_snapshot if target_head else source_head.config_snapshot) or {},
    )
    db.add(merge_commit)
    await db.flush()

    # Add all merged document versions pointing to their indexed chunk sources
    for doc in merged_docs_by_name.values():
        dv = DocumentVersion(
            commit_id=merge_commit.id,
            subject_id=subject_id,
            branch_id=target_branch.id,
            filename=doc.filename,
            file_path=doc.file_path,
            page_count=doc.page_count,
            chunk_count=doc.chunk_count,
            status="unchanged" if (target_head and doc.filename in [d.filename for d in target_docs]) else "added",
            source_version_id=doc.source_version_id or doc.id,
            indexed_at=doc.indexed_at or datetime.now(timezone.utc),
        )
        db.add(dv)

    target_branch.head_commit_id = merge_commit.id
    subject.active_commit_id = None

    return merge_commit


async def import_document_to_subject(
    target_subject_id: str,
    source_doc_version_id: str,
    db: AsyncSession,
) -> DocumentVersion:
    """
    Imports an existing document from another subject into the current branch of target_subject.
    Reuses existing chunk embeddings with zero re-processing overhead.
    """
    source_doc = (await db.execute(select(DocumentVersion).where(DocumentVersion.id == source_doc_version_id))).scalar_one_or_none()
    if not source_doc:
        raise ValueError("Source document not found")

    source_sub = (await db.execute(select(Subject).where(Subject.id == source_doc.subject_id))).scalar_one_or_none()
    source_sub_name = source_sub.name if source_sub else "other subject"

    target_sub = (await db.execute(select(Subject).where(Subject.id == target_subject_id))).scalar_one_or_none()
    if not target_sub:
        raise ValueError("Target subject not found")

    target_branch = (await db.execute(select(Branch).where(Branch.id == target_sub.current_branch_id))).scalar_one_or_none()
    if not target_branch:
        raise ValueError("Target subject has no active branch")

    # Create new commit on target branch
    new_commit = Commit(
        branch_id=target_branch.id,
        subject_id=target_subject_id,
        message=f"Import {source_doc.filename} from {source_sub_name}",
        parent_commit_id=target_branch.head_commit_id,
        config_snapshot={
            "embedding_model": "BAAI/bge-small-en-v1.5",
            "imported_from_subject": source_sub_name,
        },
    )
    db.add(new_commit)
    await db.flush()

    # Carry forward existing active documents in target branch
    if target_branch.head_commit_id:
        existing_docs = (await db.execute(select(DocumentVersion).where(
            DocumentVersion.commit_id == target_branch.head_commit_id,
            DocumentVersion.status != "removed",
        ))).scalars().all()
        for ed in existing_docs:
            if ed.filename != source_doc.filename:
                carried = DocumentVersion(
                    commit_id=new_commit.id,
                    subject_id=target_subject_id,
                    branch_id=target_branch.id,
                    filename=ed.filename,
                    file_path=ed.file_path,
                    page_count=ed.page_count,
                    chunk_count=ed.chunk_count,
                    status="unchanged",
                    source_version_id=ed.source_version_id or ed.id,
                    indexed_at=ed.indexed_at,
                )
                db.add(carried)

    # Add the imported document pointing to the original chunk source
    imported_dv = DocumentVersion(
        commit_id=new_commit.id,
        subject_id=target_subject_id,
        branch_id=target_branch.id,
        filename=source_doc.filename,
        file_path=source_doc.file_path,
        page_count=source_doc.page_count,
        chunk_count=source_doc.chunk_count,
        status="added",
        source_version_id=source_doc.source_version_id or source_doc.id,
        indexed_at=source_doc.indexed_at or datetime.now(timezone.utc),
    )
    db.add(imported_dv)

    target_branch.head_commit_id = new_commit.id
    target_sub.active_commit_id = None

    return imported_dv


async def get_available_external_documents(
    current_subject_id: str,
    db: AsyncSession,
) -> list[dict]:
    """Finds active documents from all other subjects available to import."""
    subjects = (await db.execute(select(Subject).where(Subject.id != current_subject_id))).scalars().all()
    results = []

    for sub in subjects:
        if not sub.current_branch_id:
            continue
        branch = (await db.execute(select(Branch).where(Branch.id == sub.current_branch_id))).scalar_one_or_none()
        if not branch or not branch.head_commit_id:
            continue
        docs = (await db.execute(select(DocumentVersion).where(
            DocumentVersion.commit_id == branch.head_commit_id,
            DocumentVersion.status != "removed",
        ))).scalars().all()
        for d in docs:
            results.append({
                "subject_id": sub.id,
                "subject_name": sub.name,
                "document_version_id": d.id,
                "filename": d.filename,
                "page_count": d.page_count,
                "chunk_count": d.chunk_count,
                "indexed_at": d.indexed_at,
            })

    return results
