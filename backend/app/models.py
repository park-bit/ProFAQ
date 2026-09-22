import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> str:
    return str(uuid.uuid4())


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    current_branch_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("branches.id", use_alter=True), nullable=True)

    branches: Mapped[list["Branch"]] = relationship("Branch", back_populates="subject", foreign_keys="Branch.subject_id", cascade="all, delete-orphan")
    query_logs: Mapped[list["QueryLog"]] = relationship("QueryLog", back_populates="subject", cascade="all, delete-orphan")


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    subject_id: Mapped[str] = mapped_column(String, ForeignKey("subjects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_branch_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("branches.id"), nullable=True)
    created_from_commit_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("commits.id", use_alter=True), nullable=True)
    head_commit_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("commits.id", use_alter=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    subject: Mapped["Subject"] = relationship("Subject", back_populates="branches", foreign_keys=[subject_id])
    commits: Mapped[list["Commit"]] = relationship("Commit", back_populates="branch", foreign_keys="Commit.branch_id", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("subject_id", "name", name="uq_branch_name_per_subject"),)


class Commit(Base):
    __tablename__ = "commits"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    branch_id: Mapped[str] = mapped_column(String, ForeignKey("branches.id"), nullable=False)
    subject_id: Mapped[str] = mapped_column(String, ForeignKey("subjects.id"), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    parent_commit_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("commits.id"), nullable=True)
    config_snapshot: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    branch: Mapped["Branch"] = relationship("Branch", back_populates="commits", foreign_keys=[branch_id])
    document_versions: Mapped[list["DocumentVersion"]] = relationship("DocumentVersion", back_populates="commit", cascade="all, delete-orphan")


class DocumentVersion(Base):
    """One row per PDF per commit. Tracks which PDFs are 'live' at a given commit."""

    __tablename__ = "document_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    commit_id: Mapped[str] = mapped_column(String, ForeignKey("commits.id"), nullable=False)
    subject_id: Mapped[str] = mapped_column(String, ForeignKey("subjects.id"), nullable=False)
    branch_id: Mapped[str] = mapped_column(String, ForeignKey("branches.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="added")  # added / removed / unchanged
    indexed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    commit: Mapped["Commit"] = relationship("Commit", back_populates="document_versions")
    chunks: Mapped[list["Chunk"]] = relationship("Chunk", back_populates="document_version", cascade="all, delete-orphan")


class Chunk(Base):
    """Text chunk with metadata. Vector is stored in Qdrant; we keep the text here for BM25."""

    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    document_version_id: Mapped[str] = mapped_column(String, ForeignKey("document_versions.id"), nullable=False)
    subject_id: Mapped[str] = mapped_column(String, ForeignKey("subjects.id"), nullable=False)
    branch_id: Mapped[str] = mapped_column(String, ForeignKey("branches.id"), nullable=False)
    commit_id: Mapped[str] = mapped_column(String, ForeignKey("commits.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    page_no: Mapped[int] = mapped_column(Integer, default=1)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    chunk_type: Mapped[str] = mapped_column(String(20), default="text")  # text / table
    qdrant_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # UUID used in Qdrant

    document_version: Mapped["DocumentVersion"] = relationship("DocumentVersion", back_populates="chunks")


class QueryLog(Base):
    __tablename__ = "query_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    subject_id: Mapped[str] = mapped_column(String, ForeignKey("subjects.id"), nullable=False)
    branch_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    commit_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    retrieved_chunk_ids: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    answer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    citations: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    grounding_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    refused: Mapped[bool] = mapped_column(Boolean, default=False)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    subject: Mapped["Subject"] = relationship("Subject", back_populates="query_logs")


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    subject_id: Mapped[str] = mapped_column(String, ForeignKey("subjects.id"), nullable=False)
    commit_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    branch_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    answer_accuracy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    citation_precision: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    refusal_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    retrieval_recall_at_5: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mean_grounding_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_questions: Mapped[int] = mapped_column(Integer, default=0)
    results_detail: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
