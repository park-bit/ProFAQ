from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ── Subject ──────────────────────────────────────────────────────────────────

class SubjectCreate(BaseModel):
    name: str
    description: Optional[str] = None


class SubjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class BranchSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    head_commit_id: Optional[str]
    created_at: datetime


class SubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    current_branch_id: Optional[str]
    active_commit_id: Optional[str] = None
    branches: list[BranchSummary] = []


class SubjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    current_branch_id: Optional[str]
    active_commit_id: Optional[str] = None


# ── Branch ────────────────────────────────────────────────────────────────────

class BranchCreate(BaseModel):
    name: str
    from_commit_id: Optional[str] = None  # branch off a specific commit; defaults to head


class BranchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    subject_id: str
    name: str
    parent_branch_id: Optional[str]
    created_from_commit_id: Optional[str]
    head_commit_id: Optional[str]
    created_at: datetime


# ── Commit ────────────────────────────────────────────────────────────────────

class CommitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    branch_id: str
    subject_id: str
    message: str
    parent_commit_id: Optional[str]
    config_snapshot: Optional[dict]
    created_at: datetime
    document_count: int = 0


# ── Document ──────────────────────────────────────────────────────────────────

class DocumentVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    commit_id: str
    filename: str
    page_count: int
    chunk_count: int
    status: str
    indexed_at: Optional[datetime]


class UploadResponse(BaseModel):
    document_version_id: str
    filename: str
    page_count: int
    chunk_count: int
    commit_id: str
    message: str


class ChatHistoryItem(BaseModel):
    role: str
    content: str


class ChatSessionCreate(BaseModel):
    title: Optional[str] = None
    branch_id: Optional[str] = None
    chat_type: Optional[str] = "general"  # general or exam
    target_length: Optional[str] = "standard"  # short (5 marks), standard (10 marks), comprehensive (20 marks)
    format_style: Optional[str] = "structured"  # structured, bullets, narrative


class ChatSessionUpdate(BaseModel):
    title: Optional[str] = None
    chat_type: Optional[str] = None
    target_length: Optional[str] = None
    format_style: Optional[str] = None


class ChatSessionOut(BaseModel):
    id: str
    subject_id: str
    branch_id: Optional[str] = None
    title: str
    chat_type: str = "general"
    target_length: str = "standard"
    format_style: str = "structured"
    message_count: int = 0
    created_at: datetime
    updated_at: datetime


class QueryRequest(BaseModel):
    question: str
    session_id: Optional[str] = None
    branch_id: Optional[str] = None  # defaults to current_branch
    commit_id: Optional[str] = None  # defaults to branch head
    history: Optional[list[ChatHistoryItem]] = None
    llm_provider: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    base_url: Optional[str] = None
    answer_mode: Optional[str] = "general"  # "general" | "exam"
    target_length: Optional[str] = "standard"  # "short" (5 marks / ~0.5 page), "standard" (10 marks / ~1 page), "comprehensive" (20 marks / ~2 pages)
    format_style: Optional[str] = "structured"  # "structured" (headings + bullets + tables), "bullets", "narrative"
    include_tables: Optional[bool] = True
    include_diagrams: Optional[bool] = True


class LLMTestRequest(BaseModel):
    provider: str
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    base_url: Optional[str] = None


class LLMTestResponse(BaseModel):
    success: bool
    message: str
    reply: Optional[str] = None


class CitationOut(BaseModel):
    chunk_id: str
    document_version_id: str
    filename: str
    page_no: int
    excerpt: str
    full_text: Optional[str] = None


class QueryResponse(BaseModel):
    question: str
    answer: str
    citations: list[CitationOut]
    confidence: float
    grounding_score: float
    refused: bool
    retrieved_chunks: int
    latency_ms: int
    log_id: str
    session_id: Optional[str] = None
    answer_mode: Optional[str] = "general"
    target_length: Optional[str] = "standard"


# ── Versioning ────────────────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    branch_id: Optional[str] = None
    commit_id: Optional[str] = None


class MergeRequest(BaseModel):
    source_branch_id: str
    target_branch_id: Optional[str] = None


class ImportDocumentRequest(BaseModel):
    source_subject_id: str
    document_version_id: str


class ExternalDocumentOut(BaseModel):
    subject_id: str
    subject_name: str
    document_version_id: str
    filename: str
    page_count: int
    chunk_count: int
    indexed_at: Optional[datetime] = None


class DiffResult(BaseModel):
    from_commit_id: str
    to_commit_id: str
    added: list[str]      # filenames added
    removed: list[str]    # filenames removed
    unchanged: list[str]  # filenames unchanged
    config_changed: bool
    config_diff: Optional[dict]


# ── Eval ──────────────────────────────────────────────────────────────────────

class EvalRunCreate(BaseModel):
    subject_id: str
    commit_id: Optional[str] = None
    branch_id: Optional[str] = None
    label: Optional[str] = None
    answer_accuracy: Optional[float] = None
    citation_precision: Optional[float] = None
    refusal_rate: Optional[float] = None
    retrieval_recall_at_5: Optional[float] = None
    mean_grounding_score: Optional[float] = None
    total_questions: int = 0
    results_detail: Optional[list] = None


class EvalRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    subject_id: str
    commit_id: Optional[str]
    branch_id: Optional[str]
    label: Optional[str]
    answer_accuracy: Optional[float]
    citation_precision: Optional[float]
    refusal_rate: Optional[float]
    retrieval_recall_at_5: Optional[float]
    mean_grounding_score: Optional[float]
    total_questions: int
    created_at: datetime


# ── Chunk (for retrieval debug) ───────────────────────────────────────────────

class ChunkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    text: str
    page_no: int
    filename: str
    score: Optional[float] = None
