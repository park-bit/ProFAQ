import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getSubject, getDocuments, uploadPdf, querySubject, getBranches, getCommits, checkout, getDocumentFileUrl } from '../api'

function GroundingBar({ score }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.7 ? 'var(--green)' : score >= 0.4 ? 'var(--amber)' : 'var(--red)'
  return (
    <div className="grounding-bar">
      <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>grounding</span>
      <div className="grounding-bar-track">
        <div className="grounding-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ color, fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>{pct}%</span>
    </div>
  )
}

function CitationItem({ citation, onSelect }) {
  return (
    <div className="citation-item" title="Click to inspect citation" onClick={() => onSelect?.(citation)}>
      <span className="citation-filename">{citation.filename}</span>
      <span className="citation-page"> · p.{citation.page_no}</span>
      <div className="citation-excerpt">{citation.excerpt}</div>
    </div>
  )
}

function CitationModal({ citation, subjectId, onClose }) {
  const [copied, setCopied] = useState(false)
  if (!citation) return null

  const fileUrl = citation.document_version_id
    ? getDocumentFileUrl(subjectId, citation.document_version_id)
    : null

  const copyText = () => {
    navigator.clipboard.writeText(citation.full_text || citation.excerpt || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Citation Inspector</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <span className="badge badge-blue">Page {citation.page_no}</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{citation.filename}</span>
          {fileUrl && (
            <a
              href={`${fileUrl}#page=${citation.page_no}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 'auto', textDecoration: 'none' }}
            >
              Open PDF ↗
            </a>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Retrieved Chunk Excerpt
            </span>
            <button className="btn btn-ghost btn-sm" onClick={copyText} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div style={{
            background: 'var(--bg)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            fontSize: '0.85rem',
            lineHeight: 1.6,
            maxHeight: 280,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font)',
            color: 'var(--text-primary)',
          }}>
            {citation.full_text || citation.excerpt}
          </div>
        </div>

        {citation.chunk_id && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            Chunk ID: {citation.chunk_id}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function Message({ msg, onSelectCitation }) {
  if (msg.role === 'user') {
    return (
      <div className="message message-user">
        <div className="message-bubble">{msg.content}</div>
      </div>
    )
  }

  const { answer, citations, grounding_score, refused, confidence, latency_ms } = msg

  return (
    <div className="message message-assistant">
      <div className="message-bubble">
        {refused ? (
          <div className="refused-notice">
            ⚠ {answer}
          </div>
        ) : (
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer}</p>
        )}

        {!refused && citations?.length > 0 && (
          <div className="citations-list" style={{ marginTop: 12 }}>
            {citations.map((c, i) => (
              <CitationItem key={i} citation={c} onSelect={onSelectCitation} />
            ))}
          </div>
        )}
      </div>
      {!refused && (
        <div className="message-meta">
          <GroundingBar score={grounding_score ?? 0} />
          <span>·</span>
          <span>{latency_ms}ms</span>
        </div>
      )}
    </div>
  )
}

function PDFPanel({ subjectId, documents, onUpload }) {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState(null)
  const inputRef = useRef()

  async function handleFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted.')
      return
    }
    setUploading(true)
    setError(null)
    setUploadProgress(0)
    try {
      const result = await uploadPdf(subjectId, file, setUploadProgress)
      onUpload(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }

  return (
    <div className="workspace-panel">
      <div className="panel-header">
        Documents
        <button id="upload-pdf-btn" className="btn btn-ghost btn-sm" onClick={() => inputRef.current.click()} disabled={uploading}>
          + Upload
        </button>
        <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files[0])} />
      </div>
      <div className="panel-body">
        {uploading && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
              Indexing...
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${Math.round(uploadProgress * 100)}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.2s' }} />
            </div>
          </div>
        )}
        {error && <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: 8 }}>{error}</p>}

        {documents.length === 0 && !uploading && (
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current.click()}
          >
            <div className="dropzone-icon">📄</div>
            <p className="dropzone-label">Drop a PDF here or click to upload</p>
          </div>
        )}

        {documents.map((doc) => (
          <div key={doc.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, wordBreak: 'break-all' }}>{doc.filename}</span>
              <a
                href={getDocumentFileUrl(subjectId, doc.id)}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '2px 8px', textDecoration: 'none', whiteSpace: 'nowrap' }}
                title="Open PDF in new tab"
              >
                View ↗
              </a>
            </div>
            <div style={{ display: 'flex', gap: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>{doc.page_count} pages</span>
              <span>·</span>
              <span>{doc.chunk_count} chunks</span>
              <span>·</span>
              <span className="badge badge-green" style={{ padding: '1px 6px' }}>indexed</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function VersionMiniPanel({ subjectId, branches, commits, currentBranchId, onBranchChange }) {
  const navigate = useNavigate()

  return (
    <div className="workspace-panel">
      <div className="panel-header">
        Versions
        <Link to={`/subjects/${subjectId}/history`} style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>Full view</Link>
      </div>
      <div className="panel-body">
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Branch</label>
          <select
            id="branch-select"
            className="input"
            value={currentBranchId || ''}
            onChange={(e) => onBranchChange(e.target.value)}
            style={{ fontSize: '0.85rem' }}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div className="divider" />

        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 8 }}>Recent commits</p>
        <div className="commit-timeline" style={{ paddingLeft: 20 }}>
          {commits.slice(0, 5).map((c, i) => (
            <div key={c.id} className={`commit-node ${i === 0 ? 'active' : ''}`}>
              <div className="commit-dot" />
              <div className="commit-info">
                <div className="commit-message">{c.message}</div>
                <div className="commit-meta">
                  {c.document_count} doc{c.document_count !== 1 ? 's' : ''} · {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Workspace() {
  const { id: subjectId } = useParams()
  const [subject, setSubject] = useState(null)
  const [documents, setDocuments] = useState([])
  const [branches, setBranches] = useState([])
  const [commits, setCommits] = useState([])
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [querying, setQuerying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeCitation, setActiveCitation] = useState(null)
  const chatEndRef = useRef()

  async function loadData() {
    try {
      const [sub, docs, brs] = await Promise.all([
        getSubject(subjectId),
        getDocuments(subjectId),
        getBranches(subjectId),
      ])
      setSubject(sub)
      setDocuments(docs)
      setBranches(brs)

      if (sub.current_branch_id) {
        const cms = await getCommits(subjectId, sub.current_branch_id)
        setCommits(cms)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [subjectId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleBranchChange(branchId) {
    try {
      await checkout(subjectId, { branch_id: branchId })
      setSubject((prev) => ({ ...prev, current_branch_id: branchId }))
      const [docs, cms] = await Promise.all([
        getDocuments(subjectId),
        getCommits(subjectId, branchId),
      ])
      setDocuments(docs)
      setCommits(cms)
      setMessages([])
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleQuery(e) {
    e?.preventDefault()
    if (!question.trim() || querying) return
    const q = question.trim()
    setQuestion('')
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    setQuerying(true)
    try {
      const result = await querySubject(subjectId, { question: q })
      setMessages((prev) => [...prev, { role: 'assistant', ...result }])
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', answer: `Error: ${err.message}`, refused: true, citations: [], grounding_score: 0, latency_ms: 0 }])
    } finally {
      setQuerying(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleQuery()
    }
  }

  if (loading) return <div className="page" style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div>

  return (
    <main className="page" style={{ padding: '16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1 className="page-title" style={{ fontSize: '1.2rem' }}>{subject?.name}</h1>
        <span className="badge badge-blue">{branches.find(b => b.id === subject?.current_branch_id)?.name || 'main'}</span>
      </div>

      <div className="workspace">
        {/* Left: PDFs */}
        <PDFPanel
          subjectId={subjectId}
          documents={documents}
          onUpload={(result) => {
            setDocuments((prev) => [...prev, { id: result.document_version_id, filename: result.filename, page_count: result.page_count, chunk_count: result.chunk_count, status: 'added', indexed_at: new Date().toISOString() }])
            loadData()
          }}
        />

        {/* Center: Chat */}
        <div className="workspace-panel">
          <div className="panel-header">Chat</div>
          <div className="chat-messages" id="chat-messages">
            {messages.length === 0 && (
              <div className="empty-state" style={{ paddingTop: 48 }}>
                <div className="empty-state-icon">💬</div>
                <p className="empty-state-title">Ask a question</p>
                <p className="empty-state-sub">Answers are grounded in your uploaded documents with page citations.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <Message key={i} msg={msg} onSelectCitation={setActiveCitation} />
            ))}
            {querying && (
              <div className="message message-assistant">
                <div className="message-bubble">
                  <span className="spinner" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-input-row">
            <textarea
              id="chat-input"
              className="input"
              placeholder="Ask a question about your documents..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={querying}
            />
            <button id="chat-send-btn" className="btn btn-primary" onClick={handleQuery} disabled={querying || !question.trim()}>
              {querying ? <span className="spinner" /> : '↑'}
            </button>
          </div>
        </div>

        {/* Right: Versions */}
        <VersionMiniPanel
          subjectId={subjectId}
          branches={branches}
          commits={commits}
          currentBranchId={subject?.current_branch_id}
          onBranchChange={handleBranchChange}
        />
      </div>

      {activeCitation && (
        <CitationModal
          citation={activeCitation}
          subjectId={subjectId}
          onClose={() => setActiveCitation(null)}
        />
      )}
    </main>
  )
}
