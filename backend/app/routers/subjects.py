from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.models import Subject, Branch, Commit
from app.schemas import SubjectCreate, SubjectUpdate, SubjectOut, SubjectSummary

router = APIRouter()


@router.get("", response_model=list[SubjectSummary])
async def list_subjects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subject).order_by(Subject.updated_at.desc()))
    return result.scalars().all()


@router.post("", response_model=SubjectOut, status_code=201)
async def create_subject(body: SubjectCreate, db: AsyncSession = Depends(get_db)):
    subject = Subject(name=body.name, description=body.description)
    db.add(subject)
    await db.flush()

    # Create default "main" branch and initial empty commit
    branch = Branch(subject_id=subject.id, name="main")
    db.add(branch)
    await db.flush()

    commit = Commit(
        branch_id=branch.id,
        subject_id=subject.id,
        message="Initial commit",
        config_snapshot={},
    )
    db.add(commit)
    await db.flush()

    branch.head_commit_id = commit.id
    subject.current_branch_id = branch.id

    await db.commit()
    await db.refresh(subject)

    result = await db.execute(
        select(Subject).where(Subject.id == subject.id).options(selectinload(Subject.branches))
    )
    return result.scalar_one()


@router.get("/{subject_id}", response_model=SubjectOut)
async def get_subject(subject_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Subject).where(Subject.id == subject_id).options(selectinload(Subject.branches))
    )
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    return subject


@router.patch("/{subject_id}", response_model=SubjectOut)
async def update_subject(subject_id: str, body: SubjectUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Subject).where(Subject.id == subject_id).options(selectinload(Subject.branches))
    )
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    if body.name is not None:
        subject.name = body.name
    if body.description is not None:
        subject.description = body.description
    await db.commit()
    await db.refresh(subject)
    return subject


@router.delete("/{subject_id}", status_code=204)
async def delete_subject(subject_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Subject).where(Subject.id == subject_id))
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    await db.delete(subject)
    await db.commit()
