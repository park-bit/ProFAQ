# ProFAQ

Grounded multi-PDF Q&A with subject-scoped knowledge bases, hybrid retrieval, NLI-based hallucination measurement, and git-style version control.

## What makes this different from a tutorial RAG

- **Hybrid retrieval**: BM25 (sparse) + dense embeddings, merged and reranked by a cross-encoder. Better precision than dense-only.
- **Measured grounding**: NLI model checks each answer sentence against retrieved chunks. Outputs a grounding score, not a vibe.
- **Subject-scoped knowledge bases**: Documents are organized into subjects. Each subject is its own retrieval space.
- **Version control**: Commits, branches, checkout, and diff. Treat your knowledge base like code: experiment on a branch, compare accuracy before/after.
- **Eval dashboard**: Automated answer accuracy, citation precision, correct-refusal rate, and grounding score across commits. You can show a real improvement number.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.11) |
| PDF parsing | PyMuPDF + pdfplumber |
| Embeddings | BGE-small-en-v1.5 (sentence-transformers) |
| Sparse retrieval | bm25s |
| Reranker | cross-encoder/ms-marco-MiniLM-L-6-v2 |
| Vector store | Qdrant (local) |
| LLM | Qwen2.5:7b via Ollama |
| Grounding | cross-encoder/nli-deberta-v3-small |
| Database | SQLite (aiosqlite) |
| Frontend | React + Vite |
| Charts | Recharts |

## Requirements

- Python 3.11+
- Node 22+
- [Ollama](https://ollama.ai) with `qwen2.5:7b` pulled (`ollama pull qwen2.5:7b`)
- Docker + Docker Compose (for Qdrant, or run Qdrant standalone)

**All Python dependencies, model weights, and data files are stored inside the project folder. Nothing is written to `C:\Users\...\.cache`.**

## Setup (local dev)

```powershell
# 1. Clone and enter the repo
cd d:\Contributions\ProFAQ

# 2. Copy env file and review defaults
cp .env.example .env

# 3. Run the setup script (creates .venv and data dirs inside the project)
.\scripts\setup_dev.ps1

# 4. Start Qdrant
docker run -d -p 6333:6333 -v "${PWD}/data/qdrant:/qdrant/storage" qdrant/qdrant

# 5. Start Ollama (separate terminal)
ollama serve

# 6. Start the backend
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn app.main:app --reload

# 7. Start the frontend (separate terminal)
cd frontend
npm run dev
```

Open http://localhost:3000.

## Docker Compose (full stack)

```powershell
cp .env.example .env
docker compose up --build
```

Frontend: http://localhost:3000  
API docs: http://localhost:8000/docs

Ollama must be running on the host. The compose file sets `OLLAMA_BASE_URL=http://host.docker.internal:11434`.

## Project structure

```
ProFAQ/
├── backend/
│   └── app/
│       ├── main.py          # FastAPI entry point
│       ├── models.py        # SQLAlchemy ORM models
│       ├── schemas.py       # Pydantic schemas
│       ├── config.py        # Settings (pydantic-settings)
│       ├── db.py            # Async DB engine
│       ├── routers/
│       │   ├── subjects.py  # Subject CRUD
│       │   ├── documents.py # PDF upload + indexing
│       │   ├── query.py     # Q&A endpoint
│       │   ├── versions.py  # Branch/commit/checkout/diff
│       │   └── eval.py      # Eval run reads
│       └── services/
│           ├── ingest.py      # PDF parse → chunk → embed → Qdrant
│           ├── vector_store.py # Qdrant wrapper
│           ├── retrieval.py   # BM25 + dense + rerank
│           ├── generator.py   # Ollama LLM call
│           ├── grounding.py   # NLI grounding check
│           └── versioning.py  # Commit/branch/diff logic
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── SubjectsDashboard.jsx
│       │   ├── Workspace.jsx        # 3-panel: PDFs | Chat | Versions
│       │   ├── VersionHistory.jsx   # Commit timeline, diff, branch
│       │   └── EvalDashboard.jsx    # Metrics charts + runs table
│       ├── api.js   # Typed API client
│       └── index.css # Design system
├── eval/
│   ├── questions/sample_set.json  # Q&A eval set template
│   └── run_eval.py                # Eval runner script
├── data/                          # Runtime data (gitignored)
│   ├── qdrant/                    # Qdrant vector storage
│   ├── hf_cache/                  # HuggingFace model weights
│   ├── uploads/                   # Uploaded PDFs
│   └── db/                        # SQLite database
├── scripts/
│   └── setup_dev.ps1  # Local dev setup
├── docker-compose.yml
└── .env.example
```

## Running the eval suite

1. Create a subject and upload test PDFs through the UI.
2. Edit `eval/questions/sample_set.json` with real questions from your PDFs.
3. Run:

```powershell
.\.venv\Scripts\Activate.ps1
python eval/run_eval.py --subject-id <id> --label "baseline"
```

4. Change something (e.g. chunk size in `.env`, re-upload), run again with a different label.
5. The Eval Dashboard at `/eval` shows the comparison automatically.

## Known limitations

- Table-heavy PDFs: pdfplumber extracts table structure, but complex multi-column layouts may lose formatting.
- Very long documents: chunking at 400 tokens means very long documents produce many chunks. BM25 index is rebuilt in-memory per query; this is fine up to ~10k chunks per subject.
- LLM dependency: generation requires Ollama running locally. The retrieval and grounding checks work without it.
- SQLite: fine for development and demos. For production with concurrent writes, replace with Postgres (`asyncpg` driver).
