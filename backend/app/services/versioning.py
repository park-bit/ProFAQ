"""
Version control logic: commits, branches, checkout, diff.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Subject, Branch, Commit, DocumentVersion, Chunk


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

    base_commit_id = from_commit_id or current_branch.head_commit_id

    new_branch = Branch(
        subject_id=subject_id,
        name=name,
        parent_branch_id=current_branch.id,
        created_from_commit_id=base_commit_id,
        head_commit_id=base_commit_id,
    )
    db.add(new_branch)
    await db.flush()
    return new_branch


async def checkout(
    subject_id: str,
    branch_id: str | None,
    commit_id: str | None,
    db: AsyncSession,
) -> Subject:
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
    if not subject:
        raise ValueError("Subject not found")

    if branch_id:
        branch = (await db.execute(select(Branch).where(Branch.id == branch_id, Branch.subject_id == subject_id))).scalar_one_or_none()
        if not branch:
            raise ValueError("Branch not found")
        subject.current_branch_id = branch_id

        if commit_id:
            # Validate commit belongs to this branch
            commit = (await db.execute(select(Commit).where(Commit.id == commit_id, Commit.branch_id == branch_id))).scalar_one_or_none()
            if not commit:
                raise ValueError("Commit not found on this branch")
            branch.head_commit_id = commit_id

    elif commit_id:
        # checkout a commit on current branch
        commit = (await db.execute(select(Commit).where(Commit.id == commit_id, Commit.subject_id == subject_id))).scalar_one_or_none()
        if not commit:
            raise ValueError("Commit not found")
        branch = (await db.execute(select(Branch).where(Branch.id == commit.branch_id))).scalar_one()
        subject.current_branch_id = branch.id
        branch.head_commit_id = commit_id

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
