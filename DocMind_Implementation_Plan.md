# DocMind  -  Grounded Multi-PDF Q&A with Subjects & Version Control
### Implementation Plan (4-Day Vibecoding Build)

---

## 1. What You're Building

A Q&A system where you upload PDFs into user-defined **Subjects** (e.g. "Contract Law," "ML Research," "Insurance Docs"). Each Subject is its own knowledge base with **git-style version control**  -  you can commit changes (add/remove/re-chunk PDFs), branch a Subject to try a different chunking/retrieval config, and checkout any past version. The chatbot answers **only** from retrieved PDF content, cites the exact page/chunk, and refuses when the answer isn't in the documents. A verification pass measures whether the answer is actually grounded, so you get a real accuracy number instead of a vibe.

**Core differentiators over a tutorial RAG:**
- Hybrid retrieval (BM25 + dense) + cross-encoder reranker
- NLI-based grounding verification (hallucination rate, measured)
- Subject-scoped multi-PDF knowledge bases
- Git-like versioning: commits, branches, checkout, diff between versions
- Structured, cited answers (not freeform chat)

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI (Python) | async, fast to vibecode, good ecosystem |
| PDF parsing | PyMuPDF + pdfplumber (tables) | layout-aware, keeps page numbers |
| Embeddings | BGE-small or GTE-small (sentence-transformers) | small, CPU/GPU-friendly, strong quality |
| Sparse retrieval | BM25 (rank_bm25 or Elasticsearch-lite via `bm25s`) | keyword recall dense models miss |
| Reranker | BGE-reranker-base (cross-encoder) | reorders top-k for precision |
| Vector store | Qdrant (local, Docker) or FAISS | Qdrant gives you filtering by subject/version natively |
| Generator LLM | Qwen2.5-7B-Instruct or Phi-3.5-mini, 4-bit GGUF via llama.cpp/Ollama | fits 6GB VRAM |
| Grounding check | small NLI model (e.g. `cross-encoder/nli-deberta-v3-small`) | verifies each generated claim against retrieved chunks |
| Versioning | Custom lightweight "commit" log in Postgres/SQLite (not real git  -  see §5) | git *semantics*, not literal git internals |
| Frontend | React + Tailwind (or plain HTML/JS if vibecoding fast) | subject switcher, chat, version timeline |
| Deployment | Docker Compose (api, qdrant, frontend) | one-command demo |

---

## 3. Data Model

```
Subject
 ├─ id, name, created_at, current_branch
 └─ Branches[]
      ├─ id, name (e.g. "main", "experiment-smaller-chunks")
      ├─ parent_branch_id, created_from_commit_id
      └─ Commits[]
           ├─ id, message, timestamp, parent_commit_id
           ├─ config_snapshot (chunk_size, embedding_model, retriever_settings)
           └─ DocumentVersions[]
                ├─ pdf_id, filename, page_count
                ├─ chunks[] (text, page_no, chunk_id, embedding_vector_id)
                └─ status (added / removed / modified vs parent commit)

QueryLog
 ├─ subject_id, branch_id, commit_id (which version answered it)
 ├─ question, retrieved_chunk_ids, answer, citations
 └─ grounding_score, refused (bool)
```

**Git-like semantics you actually need (not full git):**
- **Commit** = a snapshot of which PDFs + which chunking/embedding config are "live" for a branch.
- **Branch** = a named pointer to a commit, lets you fork a subject (e.g. try a different chunk size) without touching `main`.
- **Checkout** = switch the active branch/commit that the chat UI queries against.
- **Diff** = show which PDFs/chunks were added, removed, or re-chunked between two commits.
- Store this as rows in Postgres/SQLite with parent pointers  -  do **not** shell out to real git; it adds complexity with zero benefit here.

---

## 4. Pages & What Happens on Each

### Page 1  -  Subjects Dashboard
List of all Subjects as cards (name, PDF count, last updated, current branch). "New Subject" button. Clicking a subject opens Page 2.
*Backend: `GET /subjects`, `POST /subjects`.*

### Page 2  -  Subject Workspace (main screen)
Three panels:
- **Left:** PDF list for the current branch/commit, with per-PDF status (indexed, processing, error), upload button, delete button.
- **Center:** Chat interface. User asks a question → backend retrieves (BM25+dense+rerank) from the chunks belonging to the *currently checked-out* branch/commit → LLM generates a structured, cited answer → NLI pass verifies each claim → answer renders with inline citations (clickable, jump to page 4 preview) and a small "grounding confidence" badge. If nothing relevant is retrieved above a similarity threshold, the bot explicitly says it can't answer from the documents.
- **Right:** Branch/version panel (see Page 3 for full view; a mini version lives here).
*Backend: `POST /subjects/{id}/upload`, `POST /subjects/{id}/query`.*

### Page 3  -  Version History (git-log style)
A vertical commit timeline for the active branch, each node showing message, timestamp, and diff summary ("+2 PDFs, re-chunked at 512 tokens"). Branch selector dropdown (like a git branch switcher). Buttons: **Checkout** (switch active commit/branch for querying), **New Branch from here**, **Diff against another commit**.
*Backend: `GET /subjects/{id}/commits`, `POST /subjects/{id}/branches`, `POST /subjects/{id}/checkout`, `GET /subjects/{id}/diff?from=&to=`.*

### Page 4  -  PDF Viewer / Citation Inspector
Opens when a user clicks a citation from the chat. Renders the actual PDF page (via PDF.js) with the cited chunk highlighted, so the user can verify the answer against the source directly  -  this is the trust layer.
*Backend: `GET /pdfs/{id}/page/{n}`.*

### Page 5  -  Eval Dashboard (your interview-selling page)
Shows the results of your automated eval suite: answer accuracy, citation accuracy, correct-refusal rate on unanswerable questions, retrieval recall@k, average grounding score, and a small chart of these metrics across your last few commits (so you can literally show "reranking improved precision from X% to Y%").
*Backend: reads from a `eval_runs` table populated by a script in CI.*

---

## 5. Retrieval + Grounding Pipeline (the core engineering)

1. **Ingest:** parse PDF → layout-aware chunks (~300-500 tokens, keep tables as separate chunk type) → embed with BGE-small → store in Qdrant with metadata `{subject_id, branch_id, commit_id, page_no}`.
2. **Retrieve:** BM25 top-20 + dense top-20 → merge/dedupe → cross-encoder reranker → top-5.
3. **Generate:** strict system prompt: "Answer only using the context below. Cite page numbers. If the answer isn't present, say so explicitly." Structured output schema: `{answer, citations: [{page, chunk_id}], confidence}`.
4. **Verify:** NLI model checks each sentence of the answer against the top-5 chunks  -  entailed / not entailed. If a sentence is unsupported, strip it or flag it and lower the confidence badge.
5. **Log:** every query, retrieval set, answer, and grounding score goes into `QueryLog` for the eval dashboard.

---

## 6. Eval Suite (build this on Day 2, not last)

Create 30-40 hand-written Q&A pairs per test subject:
- ~20 answerable directly from the PDFs (check exact-match/semantic-match against gold answer)
- ~10-15 deliberately unanswerable (correct behavior = explicit refusal)
- A few requiring synthesis across 2+ PDFs in the same subject

Metrics to compute and store: answer accuracy, citation precision (cited page actually supports the claim), correct-refusal rate, retrieval recall@5, mean grounding score. Run this suite via a script (`eval/run_eval.py`) any time you change chunking/retrieval  -  this becomes your "commit" trigger for the version system too (new config = new commit = new eval score).

---

## 7. 4-Day Build Schedule

**Day 1  -  Ingestion + basic retrieval**
Set up FastAPI + Postgres/SQLite + Qdrant via Docker Compose. Build PDF parsing/chunking. Build Subject/Branch/Commit data model and basic CRUD. Get plain dense retrieval working end-to-end (upload → embed → retrieve top-k, no LLM yet). *Checkpoint: you can upload a PDF and get relevant chunks back for a query.*

**Day 2  -  Generation + grounding + eval harness**
Wire in the LLM (start with prompt-only, no fine-tuning needed here) for structured, cited answers. Add BM25 + reranker to the retrieval pipeline. Add the NLI grounding check. Write the 30-40 question eval set and the eval script. *Checkpoint: full question → grounded, cited answer → measured accuracy pipeline works for one subject.*

**Day 3  -  Versioning + multi-subject + frontend**
Implement commit/branch/checkout/diff logic (this is mostly backend bookkeeping, not exotic ML). Build the React frontend: Pages 1-4. Wire subject switching and version checkout into the query pipeline (queries must respect the active branch/commit). *Checkpoint: you can create two subjects, branch one, switch between branches, and see different answers/PDFs per branch.*

**Day 4  -  Eval dashboard, polish, Docker, README, demo**
Build Page 5 (eval dashboard) reading from logged eval runs across at least 2 different commits (e.g. before/after reranker) so you can show a real improvement number. Dockerize everything (`docker compose up` should run the whole stack). Write README with architecture diagram, the eval numbers, and known limitations (e.g. table-heavy PDFs, very long documents). Record a 60-90 second demo: upload 2 PDFs into a subject, ask an answerable question, ask an unanswerable one (show refusal), branch the subject, show the diff, show the eval dashboard.

---

## 8. What to Say to the Recruiter

Lead with the eval dashboard, not the chat demo  -  most people show a chat window; almost nobody shows "here's the measured hallucination rate and here's how reranking improved it by X points." Then show the version control angle as an engineering-maturity signal: you treated a knowledge base like a versioned artifact, not a static blob, which is exactly how production RAG systems evolve in practice.

## 9. If You Fall Behind (cut order)

1. Diff view between commits (nice-to-have, not core)
2. Multi-PDF synthesis eval questions
3. Table-aware chunking (fall back to plain text chunking, note it as a limitation)
4. Branch feature entirely  -  fall back to just commits on `main` (still shows versioning, loses the "experiment safely" story)

Never cut: the grounding/refusal behavior and the eval dashboard  -  those two are what make this different from every other RAG tutorial project.
