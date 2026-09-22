import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getSubject,
  getDocuments,
  uploadPdf,
  querySubject,
  getBranches,
  createBranch,
  getCommits,
  checkout,
  getDocumentFileUrl,
  mergeBranches,
  importDocument,
  getAvailableExternalDocuments,
  testLLMConnection,
  getStoredLLMConfig,
  saveStoredLLMConfig,
  getChatHistory,
  clearChatHistory,
  getChats,
  createChat,
  renameChat,
  deleteChat,
} from '../api'
import MarkdownView from '../components/MarkdownView'
import NewChatModal from '../components/NewChatModal'
import { downloadMarkdown, buildExamRevisionSheet } from '../utils/exportMarkdown'

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

function LLMSettingsModal({ onClose, onSaved }) {
  const current = getStoredLLMConfig() || {
    enabled: true,
    provider: 'groq',
    model_name: 'llama-3.3-70b-versatile',
    api_key: '',
    base_url: '',
  }

  const [enabled, setEnabled] = useState(current.enabled ?? true)
  const [provider, setProvider] = useState(current.provider || 'groq')
  const [modelName, setModelName] = useState(current.model_name || 'llama-3.3-70b-versatile')
  const [apiKey, setApiKey] = useState(current.api_key || '')
  const [baseUrl, setBaseUrl] = useState(current.base_url || '')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const presets = {
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    ollama: ['qwen2.5:7b', 'llama3.1:8b', 'mistral:7b'],
    custom: ['deepseek-chat', 'meta-llama/Llama-3-70b-instruct'],
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testLLMConnection({
        provider,
        api_key: apiKey.trim() || undefined,
        model_name: modelName.trim() || undefined,
        base_url: baseUrl.trim() || undefined,
      })
      setTestResult(res)
    } catch (err) {
      setTestResult({ success: false, message: err.message })
    } finally {
      setTesting(false)
    }
  }

  function handleSave() {
    const isLocal = provider === 'ollama'
    const trimmedKey = apiKey.trim()
    const cfg = {
      enabled: isLocal || Boolean(trimmedKey),
      provider,
      model_name: modelName.trim() || presets[provider]?.[0] || 'default',
      api_key: trimmedKey,
      base_url: baseUrl.trim(),
    }
    saveStoredLLMConfig(cfg)
    onSaved?.(cfg)
    onClose()
  }

  function handleReset() {
    saveStoredLLMConfig(null)
    onSaved?.(null)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Configure LLM Provider</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            ProFAQ requires your own personal API key (stored in local browser only) or a local model (Ollama). No shared server key is used.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: enabled ? 1 : 0.6 }}>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Provider</label>
            <select
              className="input"
              value={provider}
              onChange={(e) => {
                const p = e.target.value
                setProvider(p)
                if (presets[p]?.[0]) setModelName(presets[p][0])
              }}
              disabled={!enabled}
            >
              <option value="groq">Groq (Fast Cloud)</option>
              <option value="openai">OpenAI (Official)</option>
              <option value="gemini">Google Gemini</option>
              <option value="ollama">Ollama (Local)</option>
              <option value="custom">Custom (OpenAI-Compatible Endpoint)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Model Name</label>
            <input
              className="input"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. llama-3.3-70b-versatile or gpt-4o-mini"
              disabled={!enabled}
            />
            {presets[provider] && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {presets[provider].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    onClick={() => setModelName(m)}
                    disabled={!enabled}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>API Key</label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              type={showKey ? 'text' : 'password'}
              className="input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'ollama' ? 'Optional for local Ollama' : 'Enter API Key (stored in browser only)'}
              disabled={!enabled}
            />
          </div>

          {(provider === 'ollama' || provider === 'custom' || provider === 'openai') && (
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Base URL {provider === 'custom' ? '(Required)' : '(Optional)'}
              </label>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
                disabled={!enabled}
              />
            </div>
          )}

          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleTest}
              disabled={testing || !enabled}
            >
              {testing ? <span className="spinner spinner-sm" /> : null}
              Test Connection
            </button>
            {testResult && (
              <div style={{
                marginTop: 8,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                background: testResult.success ? 'var(--green-dim)' : 'var(--red-dim)',
                border: `1px solid ${testResult.success ? 'var(--green-border)' : 'var(--red-border)'}`,
                color: testResult.success ? 'var(--green)' : 'var(--red)',
              }}>
                {testResult.success ? '✓ ' : '✕ '} {testResult.message}
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 22 }}>
          <button type="button" className="btn btn-secondary" onClick={handleReset}>Reset to Default</button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </div>
  )
}

function UploadModal({ subjectId, onClose, onUploaded }) {
  const [file, setFile] = useState(null)
  const [showChunkConfig, setShowChunkConfig] = useState(false)
  const [chunkSize, setChunkSize] = useState(400)
  const [chunkOverlap, setChunkOverlap] = useState(50)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const fileInputRef = useRef()

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!file) {
      setError('Please choose a PDF file.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const result = await uploadPdf(
        subjectId,
        file,
        showChunkConfig ? { chunk_size: chunkSize, chunk_overlap: chunkOverlap } : {},
        setProgress
      )
      onUploaded(result)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !uploading && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Upload PDF Document</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={uploading}>✕</button>
        </div>

        <div
          className="dropzone"
          style={{ marginBottom: 16, cursor: uploading ? 'default' : 'pointer' }}
          onClick={() => !uploading && fileInputRef.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const dropped = e.dataTransfer.files[0]
            if (dropped?.name.toLowerCase().endsWith('.pdf')) setFile(dropped)
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files[0])}
            disabled={uploading}
          />
          <p className="dropzone-label" style={{ fontWeight: 500 }}>
            {file ? file.name : 'Click to select or drag and drop a PDF'}
          </p>
          {file && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              {(file.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          )}
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, marginBottom: 16 }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setShowChunkConfig(!showChunkConfig)}
          >
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
              {showChunkConfig ? '▾ Custom Chunking Settings' : '▸ Custom Chunking Settings (Optional)'}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {showChunkConfig ? 'Active' : 'Default: 400 / 50'}
            </span>
          </div>

          {showChunkConfig && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Chunk Size (tokens)</label>
                  <span style={{ fontSize: '0.75rem', fontFamily: 'var(--mono)', color: 'var(--text-primary)' }}>{chunkSize}</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={1500}
                  step={50}
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                  className="range-slider"
                />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Smaller for factual precision, larger for broader context</span>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Chunk Overlap (tokens)</label>
                  <span style={{ fontSize: '0.75rem', fontFamily: 'var(--mono)', color: 'var(--text-primary)' }}>{chunkOverlap}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={250}
                  step={10}
                  value={chunkOverlap}
                  onChange={(e) => setChunkOverlap(Number(e.target.value))}
                  className="range-slider"
                />
              </div>
            </div>
          )}
        </div>

        {uploading && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>Parsing, chunking, and indexing...</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: '#ffffff', transition: 'width 0.2s' }} />
            </div>
          </div>
        )}

        {error && <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: 12 }}>{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={uploading || !file}>
            {uploading ? <span className="spinner spinner-sm" /> : null}
            Upload & Index
          </button>
        </div>
      </div>
    </div>
  )
}

function ImportModal({ subjectId, onClose, onImported }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [importingId, setImportingId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getAvailableExternalDocuments(subjectId)
      .then(setDocs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [subjectId])

  async function handleImport(doc) {
    setImportingId(doc.document_version_id)
    setError(null)
    try {
      const result = await importDocument(subjectId, {
        source_subject_id: doc.subject_id,
        document_version_id: doc.document_version_id,
      })
      onImported(result)
      onClose()
    } catch (err) {
      setError(err.message)
      setImportingId(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Import Document from Other Subject</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
          Reuses pre-computed embeddings and chunks immediately without re-uploading or duplicate storage.
        </p>

        {loading && <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner" /></div>}
        {error && <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: 12 }}>{error}</p>}

        {!loading && docs.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No indexed documents found in other subjects.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, overflowY: 'auto' }}>
          {docs.map((d) => (
            <div
              key={d.document_version_id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{d.filename}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  From: <span style={{ color: 'var(--text-primary)' }}>{d.subject_name}</span> · {d.page_count} pages · {d.chunk_count} chunks
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleImport(d)}
                disabled={importingId === d.document_version_id}
              >
                {importingId === d.document_version_id ? <span className="spinner spinner-sm" /> : 'Import'}
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function NewBranchModal({ subjectId, currentCommitId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const branch = await createBranch(subjectId, {
        name: name.trim(),
        from_commit_id: currentCommitId || undefined,
      })
      onCreated(branch)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <h2 className="modal-title">Create New Branch</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Branch Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. topic-2-testing or exam-prep"
              autoFocus
            />
          </div>
          {error && <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: 12 }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              {loading ? <span className="spinner spinner-sm" /> : null}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function MergeBranchModal({ subjectId, currentBranchId, branches, onClose, onMerged }) {
  const availableBranches = branches.filter((b) => b.id !== currentBranchId)
  const [sourceBranchId, setSourceBranchId] = useState(availableBranches[0]?.id || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleMerge() {
    if (!sourceBranchId) return
    setLoading(true)
    setError(null)
    try {
      const commit = await mergeBranches(subjectId, {
        source_branch_id: sourceBranchId,
        target_branch_id: currentBranchId,
      })
      onMerged(commit)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <h2 className="modal-title">Merge Branch</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
          Merge document snapshots from another branch into your current active branch.
        </p>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Source Branch to Merge</label>
          <select
            className="input"
            value={sourceBranchId}
            onChange={(e) => setSourceBranchId(e.target.value)}
          >
            {availableBranches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        {error && <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: 12 }}>{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleMerge} disabled={loading || !sourceBranchId}>
            {loading ? <span className="spinner spinner-sm" /> : null}
            Merge Branch
          </button>
        </div>
      </div>
    </div>
  )
}

function PDFPanel({ subjectId, documents, onOpenUpload, onOpenImport, onCollapse }) {
  return (
    <div className="workspace-panel">
      <div className="panel-header">
        <span>Documents</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={onOpenImport} title="Import document from another subject">
            + Import
          </button>
          <button id="upload-pdf-btn" className="btn btn-secondary btn-sm" onClick={onOpenUpload}>
            + Upload
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onCollapse} title="Collapse panel" style={{ padding: '2px 6px' }}>
            ◂
          </button>
        </div>
      </div>
      <div className="panel-body">
        {documents.length === 0 && (
          <div className="dropzone" onClick={onOpenUpload}>
            <div className="dropzone-icon" style={{ display: 'flex', justifyContent: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <line x1="9" y1="15" x2="15" y2="15"></line>
              </svg>
            </div>
            <p className="dropzone-label">Click to upload or import a PDF</p>
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

function VersionMiniPanel({
  subjectId,
  branches,
  commits,
  currentBranchId,
  activeCommitId,
  onBranchChange,
  onCheckoutCommit,
  onResetHead,
  onOpenNewBranch,
  onOpenMerge,
  onCollapse,
}) {
  return (
    <div className="workspace-panel">
      <div className="panel-header">
        <span>Versions</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Link to={`/subjects/${subjectId}/history`} style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            Full view
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={onCollapse} title="Collapse panel" style={{ padding: '2px 6px' }}>
            ▸
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Branch</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={onOpenNewBranch} style={{ fontSize: '0.72rem', padding: '2px 6px' }}>
                + Branch
              </button>
              {branches.length > 1 && (
                <button className="btn btn-ghost btn-sm" onClick={onOpenMerge} style={{ fontSize: '0.72rem', padding: '2px 6px' }}>
                  Merge
                </button>
              )}
            </div>
          </div>
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

        {activeCommitId && (
          <div className="detached-head-banner">
            <div>
              <span>Viewing snapshot </span>
              <strong style={{ fontFamily: 'var(--mono)' }}>{activeCommitId.slice(0, 8)}</strong>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onResetHead} style={{ fontSize: '0.72rem', padding: '2px 6px' }}>
              Return to HEAD
            </button>
          </div>
        )}

        <div className="divider" />

        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 8 }}>Recent commits</p>
        <div className="commit-timeline" style={{ paddingLeft: 20 }}>
          {commits.slice(0, 8).map((c, i) => {
            const isHead = i === 0
            const isActive = activeCommitId ? activeCommitId === c.id : isHead
            return (
              <div key={c.id} className={`commit-node ${isActive ? 'active' : ''}`}>
                <div className="commit-dot" style={{ borderColor: isActive ? '#ffffff' : undefined, background: isActive ? '#ffffff' : undefined }} />
                <div className="commit-info">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <div className="commit-message" style={{ fontWeight: isActive ? 600 : 400 }}>{c.message}</div>
                    {!isActive && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                        onClick={() => onCheckoutCommit(c.id)}
                        title="Checkout this commit snapshot"
                      >
                        Checkout
                      </button>
                    )}
                  </div>
                  <div className="commit-meta">
                    <span style={{ fontFamily: 'var(--mono)' }}>{c.id.slice(0, 8)}</span>
                    {' · '}
                    {c.document_count} doc{c.document_count !== 1 ? 's' : ''}
                    {' · '}
                    {new Date(c.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            )
          })}
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
  const [activeCommitId, setActiveCommitId] = useState(null)

  // Multi-chat state
  const [chats, setChats] = useState([])
  const [activeChatId, setActiveChatId] = useState(() => localStorage.getItem(`profaq_active_chat_${subjectId}`) || null)
  const [showChatMenu, setShowChatMenu] = useState(false)
  const [renamingChatId, setRenamingChatId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')

  // Prompt editing state
  const [editingPromptIndex, setEditingPromptIndex] = useState(null)
  const [editPromptDraft, setEditPromptDraft] = useState('')

  // Resizable layout state
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem('profaq_ws_left_width')
    return saved ? Math.max(180, Math.min(480, Number(saved))) : 270
  })
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = localStorage.getItem('profaq_ws_right_width')
    return saved ? Math.max(200, Math.min(500, Number(saved))) : 300
  })
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [isResizingLeft, setIsResizingLeft] = useState(false)
  const [isResizingRight, setIsResizingRight] = useState(false)

  // Exam Studio configuration for active thread
  const [answerMode, setAnswerMode] = useState('general')
  const [targetLength, setTargetLength] = useState('standard')
  const [formatStyle, setFormatStyle] = useState('structured')
  const [includeTables, setIncludeTables] = useState(true)
  const [includeDiagrams, setIncludeDiagrams] = useState(true)
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null)

  // Modals state
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [newChatDefaultMode, setNewChatDefaultMode] = useState('general')
  const [showLLMSettings, setShowLLMSettings] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showNewBranchModal, setShowNewBranchModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)

  const [llmConfig, setLLMConfig] = useState(() => getStoredLLMConfig())
  const chatEndRef = useRef()

  const loadData = useCallback(async (commitOverride, branchOverride) => {
    try {
      const [sub, brs] = await Promise.all([
        getSubject(subjectId),
        getBranches(subjectId),
      ])
      setSubject(sub)
      setBranches(brs)

      const effBranchId = branchOverride || sub.current_branch_id
      const effCommitId = commitOverride !== undefined ? commitOverride : sub.active_commit_id
      setActiveCommitId(effCommitId)

      const [docs, cms, chatList] = await Promise.all([
        getDocuments(subjectId, effCommitId || undefined),
        effBranchId ? getCommits(subjectId, effBranchId) : Promise.resolve([]),
        getChats(subjectId).catch(() => []),
      ])
      setDocuments(docs)
      setCommits(cms)

      let currentChatList = chatList || []
      if (currentChatList.length === 0) {
        try {
          const initChat = await createChat(subjectId, { title: 'General Q&A', branch_id: effBranchId || undefined })
          currentChatList = [initChat]
        } catch {
          currentChatList = []
        }
      }
      setChats(currentChatList)

      let targetChatId = localStorage.getItem(`profaq_active_chat_${subjectId}`)
      if (!targetChatId || !currentChatList.some((c) => c.id === targetChatId)) {
        targetChatId = currentChatList[0]?.id || null
      }
      setActiveChatId(targetChatId)
      if (targetChatId) {
        localStorage.setItem(`profaq_active_chat_${subjectId}`, targetChatId)
        const activeChatObj = currentChatList.find((c) => c.id === targetChatId)
        if (activeChatObj) {
          setAnswerMode(activeChatObj.chat_type || 'general')
          setTargetLength(activeChatObj.target_length || 'standard')
          setFormatStyle(activeChatObj.format_style || 'structured')
        }
      }

      const hist = targetChatId
        ? await getChatHistory(subjectId, targetChatId).catch(() => [])
        : await getChatHistory(subjectId, null, effBranchId || undefined).catch(() => [])

      if (hist && hist.length > 0) {
        const msgs = []
        for (const item of hist) {
          msgs.push({ role: 'user', content: item.question, created_at: item.created_at })
          msgs.push({
            role: 'assistant',
            answer: item.answer,
            citations: item.citations || [],
            confidence: item.confidence,
            grounding_score: item.grounding_score,
            refused: item.refused,
            latency_ms: item.latency_ms,
            created_at: item.created_at,
          })
        }
        setMessages(msgs)
      } else {
        setMessages([])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [subjectId])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Drag handlers for resizable panels
  const startLeftResize = () => setIsResizingLeft(true)
  const startRightResize = () => setIsResizingRight(true)

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (isResizingLeft) {
        const newWidth = Math.max(180, Math.min(480, e.clientX - 28))
        setLeftWidth(newWidth)
        localStorage.setItem('profaq_ws_left_width', newWidth)
      } else if (isResizingRight) {
        const newWidth = Math.max(200, Math.min(500, window.innerWidth - e.clientX - 28))
        setRightWidth(newWidth)
        localStorage.setItem('profaq_ws_right_width', newWidth)
      }
    }

    const handlePointerUp = () => {
      setIsResizingLeft(false)
      setIsResizingRight(false)
    }

    if (isResizingLeft || isResizingRight) {
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.userSelect = ''
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.userSelect = ''
    }
  }, [isResizingLeft, isResizingRight])

  async function handleBranchChange(branchId) {
    try {
      await checkout(subjectId, { branch_id: branchId })
      await loadData(null, branchId)
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleCheckoutCommit(commitId) {
    try {
      await checkout(subjectId, { commit_id: commitId })
      await loadData(commitId)
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleResetHead() {
    try {
      await checkout(subjectId, { commit_id: 'HEAD' })
      await loadData(null)
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleSwitchChat(chatId) {
    setActiveChatId(chatId)
    localStorage.setItem(`profaq_active_chat_${subjectId}`, chatId)
    setShowChatMenu(false)
    setEditingPromptIndex(null)
    const activeChatObj = chats.find((c) => c.id === chatId)
    if (activeChatObj) {
      setAnswerMode(activeChatObj.chat_type || 'general')
      setTargetLength(activeChatObj.target_length || 'standard')
      setFormatStyle(activeChatObj.format_style || 'structured')
    }
    try {
      const hist = await getChatHistory(subjectId, chatId)
      const msgs = []
      for (const item of hist) {
        msgs.push({ role: 'user', content: item.question, created_at: item.created_at })
        msgs.push({
          role: 'assistant',
          answer: item.answer,
          citations: item.citations || [],
          confidence: item.confidence,
          grounding_score: item.grounding_score,
          refused: item.refused,
          latency_ms: item.latency_ms,
          created_at: item.created_at,
          answer_mode: activeChatObj?.chat_type || 'general',
          target_length: activeChatObj?.target_length || 'standard',
        })
      }
      setMessages(msgs)
    } catch (err) {
      console.error('Failed to load chat history', err)
      setMessages([])
    }
  }

  async function updateActiveChatConfig(updates) {
    const nextAnswerMode = updates.answerMode ?? answerMode
    const nextTargetLength = updates.targetLength ?? targetLength
    const nextFormatStyle = updates.formatStyle ?? formatStyle
    if (updates.answerMode !== undefined) setAnswerMode(updates.answerMode)
    if (updates.targetLength !== undefined) setTargetLength(updates.targetLength)
    if (updates.formatStyle !== undefined) setFormatStyle(updates.formatStyle)
    if (updates.includeTables !== undefined) setIncludeTables(updates.includeTables)
    if (updates.includeDiagrams !== undefined) setIncludeDiagrams(updates.includeDiagrams)

    if (activeChatId) {
      try {
        await renameChat(subjectId, activeChatId, {
          chat_type: nextAnswerMode,
          target_length: nextTargetLength,
          format_style: nextFormatStyle,
        })
        setChats((prev) => prev.map((c) => (c.id === activeChatId ? {
          ...c,
          chat_type: nextAnswerMode,
          target_length: nextTargetLength,
          format_style: nextFormatStyle,
        } : c)))
      } catch (err) {
        console.warn('Failed to update chat settings', err)
      }
    }
  }

  async function handleCreateNewChatWithConfig(cfg) {
    try {
      const newChat = await createChat(subjectId, {
        title: cfg.title,
        chat_type: cfg.chat_type,
        target_length: cfg.target_length,
        format_style: cfg.format_style,
        branch_id: subject?.current_branch_id || undefined,
      })
      setChats((prev) => [newChat, ...prev])
      setActiveChatId(newChat.id)
      localStorage.setItem(`profaq_active_chat_${subjectId}`, newChat.id)
      setAnswerMode(newChat.chat_type || 'general')
      setTargetLength(newChat.target_length || 'standard')
      setFormatStyle(newChat.format_style || 'structured')
      setMessages([])
      setShowChatMenu(false)
      setEditingPromptIndex(null)
    } catch (err) {
      alert(err.message)
    }
  }

  function handleOpenNewChatModal(defaultMode = 'general') {
    setNewChatDefaultMode(defaultMode)
    setShowNewChatModal(true)
    setShowChatMenu(false)
  }

  function handleCitationNumClick(msg, citNum) {
    if (msg.citations && msg.citations.length >= citNum && citNum > 0) {
      setActiveCitation(msg.citations[citNum - 1])
    }
  }

  function handleDownloadAnswerMd(msg, index) {
    const cleanTitle = (msg.question || `answer-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
    const content = `# Exam Model Solution: ${msg.question || 'Document Q&A'}\n\n${msg.answer}\n\n---\n*Verified with ProFAQ*`
    downloadMarkdown(`${cleanTitle}.md`, content)
  }

  function handleCopyAnswerMd(msg, index) {
    navigator.clipboard.writeText(msg.answer || '')
    setCopiedMsgIdx(index)
    setTimeout(() => setCopiedMsgIdx(null), 2000)
  }

  function handleExportRevisionSheet() {
    const activeChat = chats.find((c) => c.id === activeChatId)
    const sheet = buildExamRevisionSheet({
      subjectName: subject?.name,
      subjectDescription: subject?.description,
      chatTitle: activeChat?.title || 'Exam Study Guide',
      chatType: answerMode,
      targetLength,
      formatStyle,
      messages,
    })
    const filename = `${(subject?.name || 'profaq').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-exam-sheet.md`
    downloadMarkdown(filename, sheet)
  }

  async function handleRenameSubmit(chatId) {
    if (!renameDraft.trim()) {
      setRenamingChatId(null)
      return
    }
    try {
      const updated = await renameChat(subjectId, chatId, { title: renameDraft.trim() })
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: updated.title } : c)))
      setRenamingChatId(null)
      setRenameDraft('')
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleDeleteChat(chatId) {
    if (!window.confirm('Delete this chat thread and its history?')) return
    try {
      await deleteChat(subjectId, chatId)
      const remaining = chats.filter((c) => c.id !== chatId)
      setChats(remaining)
      if (activeChatId === chatId) {
        if (remaining.length > 0) {
          handleSwitchChat(remaining[0].id)
        } else {
          handleOpenNewChatModal('general')
        }
      }
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleClearChat() {
    if (!window.confirm('Clear all stored chat history for this thread?')) return
    try {
      await clearChatHistory(subjectId, activeChatId || undefined, subject?.current_branch_id)
      setMessages([])
      getChats(subjectId).then(setChats).catch(() => {})
    } catch (err) {
      console.error('Failed to clear chat', err)
      setMessages([])
    }
  }

  async function handleQuery(e) {
    e?.preventDefault()
    if (!question.trim() || querying) return
    const cfg = getStoredLLMConfig()
    const configured = Boolean(cfg?.enabled && (cfg.provider === 'ollama' || cfg.api_key?.trim()))
    if (!configured) {
      setShowLLMSettings(true)
      return
    }
    const q = question.trim()
    setQuestion('')
    const prior = [...messages]
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    setQuerying(true)
    try {
      const historyPayload = prior.slice(-8).map((m) => ({
        role: m.role,
        content: m.role === 'user' ? m.content : (m.answer || ''),
      }))

      const result = await querySubject(subjectId, {
        question: q,
        session_id: activeChatId || undefined,
        commit_id: activeCommitId || undefined,
        history: historyPayload,
        answer_mode: answerMode,
        target_length: targetLength,
        format_style: formatStyle,
        include_tables: includeTables,
        include_diagrams: includeDiagrams,
      })
      setMessages((prev) => [...prev, { role: 'assistant', ...result }])
      if (result.session_id && result.session_id !== activeChatId) {
        setActiveChatId(result.session_id)
        localStorage.setItem(`profaq_active_chat_${subjectId}`, result.session_id)
      }
      getChats(subjectId).then(setChats).catch(() => {})
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', answer: `Error: ${err.message}`, refused: true, citations: [], grounding_score: 0, latency_ms: 0 }])
    } finally {
      setQuerying(false)
    }
  }

  async function handleEditPromptSubmit(index) {
    if (!editPromptDraft.trim() || querying) return
    const cfg = getStoredLLMConfig()
    const configured = Boolean(cfg?.enabled && (cfg.provider === 'ollama' || cfg.api_key?.trim()))
    if (!configured) {
      setShowLLMSettings(true)
      return
    }
    const newPrompt = editPromptDraft.trim()
    setEditingPromptIndex(null)
    setEditPromptDraft('')
    setQuerying(true)

    const prior = messages.slice(0, index)
    const historyPayload = prior.slice(-8).map((m) => ({
      role: m.role,
      content: m.role === 'user' ? m.content : (m.answer || ''),
    }))

    setMessages([...prior, { role: 'user', content: newPrompt }])

    try {
      const result = await querySubject(subjectId, {
        question: newPrompt,
        session_id: activeChatId || undefined,
        commit_id: activeCommitId || undefined,
        history: historyPayload,
        answer_mode: answerMode,
        target_length: targetLength,
        format_style: formatStyle,
        include_tables: includeTables,
        include_diagrams: includeDiagrams,
      })
      setMessages([...prior, { role: 'user', content: newPrompt }, { role: 'assistant', ...result }])
      getChats(subjectId).then(setChats).catch(() => {})
    } catch (err) {
      setMessages([
        ...prior,
        { role: 'user', content: newPrompt },
        { role: 'assistant', answer: `Error: ${err.message}`, refused: true, citations: [], grounding_score: 0, latency_ms: 0 },
      ])
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

  const activeBranchName = branches.find((b) => b.id === subject?.current_branch_id)?.name || 'main'
  const isLLMConfigured = Boolean(llmConfig?.enabled && (llmConfig.provider === 'ollama' || llmConfig.api_key?.trim()))

  return (
    <main className="page" style={{ padding: '16px 24px', maxWidth: '100%' }}>
      {/* Top Workspace Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 className="page-title" style={{ fontSize: '1.2rem', margin: 0 }}>{subject?.name}</h1>
          <span className="badge badge-blue">{activeBranchName}</span>
          {activeCommitId && <span className="badge badge-amber">detached: {activeCommitId.slice(0, 8)}</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLLMConfigured ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowLLMSettings(true)}
              style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}
              title="Click to modify LLM settings"
            >
              <span>⚙</span>
              <span>{llmConfig.provider}: {llmConfig.model_name || 'default'}</span>
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => setShowLLMSettings(true)}
              style={{
                fontSize: '0.78rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                fontWeight: 500,
                cursor: 'pointer',
              }}
              title="Click to configure personal API key or local LLM"
            >
              <span>⚠️</span>
              <span>Configure LLM (Required)</span>
            </button>
          )}
        </div>
      </div>

      <div className="workspace">
        {/* Left: PDFs / Documents */}
        {leftCollapsed ? (
          <div className="workspace-collapsed-bar" onClick={() => setLeftCollapsed(false)} title="Expand Documents Panel">
            <span>▸</span>
            <span className="workspace-collapsed-label">Documents</span>
          </div>
        ) : (
          <div style={{ width: leftWidth, flexShrink: 0, height: '100%' }}>
            <PDFPanel
              subjectId={subjectId}
              documents={documents}
              onOpenUpload={() => setShowUploadModal(true)}
              onOpenImport={() => setShowImportModal(true)}
              onCollapse={() => setLeftCollapsed(true)}
            />
          </div>
        )}

        {/* Left Divider Resizer */}
        {!leftCollapsed && (
          <div
            className={`workspace-resizer ${isResizingLeft ? 'is-resizing' : ''}`}
            onPointerDown={startLeftResize}
            title="Drag to resize Documents panel"
          />
        )}

        {/* Center: Chat */}
        <div className="workspace-panel" style={{ flex: 1, minWidth: 320, height: '100%' }}>
          <div className="panel-header" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="chat-thread-btn"
                  onClick={() => setShowChatMenu(!showChatMenu)}
                  title="Switch conversation thread"
                >
                  <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chats.find((c) => c.id === activeChatId)?.title || 'Chat'}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>▼</span>
                </button>

                {showChatMenu && (
                  <div className="chat-dropdown-panel" onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 8px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Chat Threads</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleOpenNewChatModal('general')}
                          style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                          title="New general Q&A thread"
                        >
                          + Q&A
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleOpenNewChatModal('exam')}
                          style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#2563eb' }}
                          title="New Exam Structured thread"
                        >
                          + Exam
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                      {chats.map((c) => {
                        const isActive = c.id === activeChatId
                        const isRenaming = renamingChatId === c.id
                        const isExam = c.chat_type === 'exam'
                        return (
                          <div
                            key={c.id}
                            className={`chat-item-row ${isActive ? 'active' : ''}`}
                            onClick={() => !isRenaming && handleSwitchChat(c.id)}
                          >
                            {isRenaming ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault()
                                  handleRenameSubmit(c.id)
                                }}
                                style={{ display: 'flex', gap: 4, width: '100%' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  className="input"
                                  value={renameDraft}
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  autoFocus
                                  style={{ padding: '2px 6px', fontSize: '0.78rem' }}
                                />
                                <button type="submit" className="btn btn-primary btn-sm" style={{ padding: '2px 6px', fontSize: '0.7rem' }}>✓</button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenamingChatId(null)} style={{ padding: '2px 6px', fontSize: '0.7rem' }}>✕</button>
                              </form>
                            ) : (
                              <>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, paddingRight: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: '0.82rem', fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {c.title}
                                    </span>
                                    {isExam ? (
                                      <span className="exam-badge">EXAM</span>
                                    ) : (
                                      <span className="general-badge">Q&A</span>
                                    )}
                                  </div>
                                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                    {c.message_count} msg{c.message_count !== 1 ? 's' : ''} {isExam && `· ${c.target_length || 'standard'}`}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => {
                                      setRenamingChatId(c.id)
                                      setRenameDraft(c.title)
                                    }}
                                    title="Rename chat"
                                    style={{ padding: '2px 4px', fontSize: '0.7rem' }}
                                  >
                                    ✎
                                  </button>
                                  {chats.length > 1 && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => handleDeleteChat(c.id)}
                                      title="Delete chat thread"
                                      style={{ padding: '2px 4px', fontSize: '0.7rem', color: 'var(--red)' }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleOpenNewChatModal('general')}
                style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                title="Start a new chat thread"
              >
                + New
              </button>

              <button
                type="button"
                className="btn btn-sm"
                onClick={() => handleOpenNewChatModal('exam')}
                style={{
                  fontSize: '0.72rem',
                  padding: '3px 8px',
                  background: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  color: '#93c5fd',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title="Create Exam Structured thread"
              >
                + Exam Structured
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {activeCommitId && (
                <span style={{ fontSize: '0.72rem', color: 'var(--amber)' }}>
                  commit {activeCommitId.slice(0, 8)}
                </span>
              )}
              {messages.length > 0 && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleExportRevisionSheet}
                    style={{ fontSize: '0.72rem', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4, color: '#38bdf8' }}
                    title="Export complete thread as Markdown exam revision sheet (.md)"
                  >
                    <span>⬇</span>
                    <span>Export .md Sheet</span>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleClearChat}
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    title="Clear conversation"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="chat-messages" id="chat-messages" onClick={() => showChatMenu && setShowChatMenu(false)}>
            {!isLLMConfigured && (
              <div style={{
                margin: '12px 16px',
                padding: '12px 16px',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}>
                <div style={{ fontSize: '0.82rem', color: '#fbbf24', lineHeight: 1.4 }}>
                  <strong>API Key or Local LLM Required:</strong> Please configure your personal Groq, OpenAI, Gemini key or local Ollama to ask questions.
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowLLMSettings(true)}
                  style={{
                    background: '#fbbf24',
                    color: '#000000',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    border: 'none',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  Configure
                </button>
              </div>
            )}

            {messages.length === 0 && (
              <div className="empty-state-chat">
                <div className="empty-state-noir-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <h3 className="empty-state-heading">How can I help you today?</h3>
                <p className="empty-state-subheading">
                  Ask any question about your indexed documents. Multi-turn continuity and grounded citations are active.
                </p>
                {documents.length > 0 && (
                  <div className="quick-prompts">
                    <button
                      type="button"
                      className="quick-prompt-chip"
                      onClick={() => setQuestion(`Summarize key insights from ${documents[0]?.filename || 'the document'}`)}
                    >
                      Summarize key insights
                    </button>
                    <button
                      type="button"
                      className="quick-prompt-chip"
                      onClick={() => setQuestion('What are the key terms, constraints, and requirements?')}
                    >
                      Key terms and requirements
                    </button>
                  </div>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role === 'user' ? 'message-user' : 'message-assistant'}`}>
                {msg.role === 'user' ? (
                  editingPromptIndex === i ? (
                    <div className="message-edit-card">
                      <textarea
                        value={editPromptDraft}
                        onChange={(e) => setEditPromptDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleEditPromptSubmit(i)
                          } else if (e.key === 'Escape') {
                            setEditingPromptIndex(null)
                          }
                        }}
                        rows={3}
                        autoFocus
                      />
                      <div className="message-edit-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditingPromptIndex(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleEditPromptSubmit(i)}
                          disabled={!editPromptDraft.trim()}
                        >
                          Save & Submit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="message-user-wrap">
                      <div className="message-bubble">{msg.content}</div>
                      <button
                        type="button"
                        className="message-edit-trigger"
                        onClick={() => {
                          setEditingPromptIndex(i)
                          setEditPromptDraft(msg.content)
                        }}
                        title="Edit prompt"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        <span>Edit</span>
                      </button>
                    </div>
                  )
                ) : (
                  <>
                    <div className="message-bubble">
                      {msg.refused ? (
                        <div className="refused-notice">⚠ {msg.answer}</div>
                      ) : (
                        <MarkdownView
                          content={msg.answer}
                          onCitationClick={(num) => handleCitationNumClick(msg, num)}
                        />
                      )}

                      {!msg.refused && (
                        <div className="message-actions-bar">
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="msg-action-btn"
                              onClick={() => handleDownloadAnswerMd(msg, i)}
                              title="Download this answer as a Markdown (.md) file"
                            >
                              <span>⬇</span> .md
                            </button>
                            <button
                              type="button"
                              className="msg-action-btn"
                              onClick={() => handleCopyAnswerMd(msg, i)}
                              title="Copy raw Markdown to clipboard"
                            >
                              <span>{copiedMsgIdx === i ? '✓ Copied' : '⧉ Copy'}</span>
                            </button>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {msg.answer_mode === 'exam' && (
                              <span className="exam-badge">{msg.target_length || 'exam'}</span>
                            )}
                            <GroundingBar score={msg.grounding_score ?? 0} />
                            <span>·</span>
                            <span>{msg.latency_ms}ms</span>
                          </div>
                        </div>
                      )}

                      {!msg.refused && msg.citations?.length > 0 && (
                        <div className="citations-list" style={{ marginTop: 12 }}>
                          {msg.citations.map((c, idx) => (
                            <CitationItem key={idx} citation={c} onSelect={setActiveCitation} />
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {querying && (
              <div className="message message-assistant">
                <div className="message-bubble" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner spinner-sm" />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Searching documents...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Exam Mode Controls Bar */}
          <div className="exam-toolbar">
            <div className="exam-toolbar-group">
              <button
                type="button"
                className={`exam-toggle-btn ${answerMode === 'exam' ? 'active' : ''}`}
                onClick={() => updateActiveChatConfig({ answerMode: answerMode === 'exam' ? 'general' : 'exam' })}
                title="Toggle between Academic Exam Answer Mode and General Q&A"
              >
                <span>{answerMode === 'exam' ? 'Exam Structured: ON' : 'General Q&A'}</span>
              </button>
            </div>

            {answerMode === 'exam' && (
              <>
                <div className="exam-toolbar-group">
                  <span className="exam-toolbar-label">Size:</span>
                  <button
                    type="button"
                    className={`exam-pill ${targetLength === 'short' ? 'active' : ''}`}
                    onClick={() => updateActiveChatConfig({ targetLength: 'short' })}
                    title="Short answer: 5 Marks / ~0.5 Page"
                  >
                    5M (~0.5p)
                  </button>
                  <button
                    type="button"
                    className={`exam-pill ${targetLength === 'standard' ? 'active' : ''}`}
                    onClick={() => updateActiveChatConfig({ targetLength: 'standard' })}
                    title="Standard university answer: 10 Marks / ~1 Page"
                  >
                    10M (~1p)
                  </button>
                  <button
                    type="button"
                    className={`exam-pill ${targetLength === 'comprehensive' ? 'active' : ''}`}
                    onClick={() => updateActiveChatConfig({ targetLength: 'comprehensive' })}
                    title="Comprehensive thesis: 20 Marks / ~2 Pages"
                  >
                    20M (~2p)
                  </button>
                </div>

                <div className="exam-toolbar-group">
                  <span className="exam-toolbar-label">Format:</span>
                  <button
                    type="button"
                    className={`exam-pill ${formatStyle === 'structured' ? 'active' : ''}`}
                    onClick={() => updateActiveChatConfig({ formatStyle: 'structured' })}
                    title="Model exam solution: Headings, bullets, tables, diagrams"
                  >
                    Structured
                  </button>
                  <button
                    type="button"
                    className={`exam-pill ${formatStyle === 'bullets' ? 'active' : ''}`}
                    onClick={() => updateActiveChatConfig({ formatStyle: 'bullets' })}
                    title="High-density bullet points for quick revision"
                  >
                    Bullets
                  </button>
                  <button
                    type="button"
                    className={`exam-pill ${formatStyle === 'narrative' ? 'active' : ''}`}
                    onClick={() => updateActiveChatConfig({ formatStyle: 'narrative' })}
                    title="Formal academic essay exposition"
                  >
                    Essay
                  </button>
                </div>

                <div className="exam-toolbar-group">
                  <button
                    type="button"
                    className={`exam-toggle-btn ${includeTables ? 'active' : ''}`}
                    onClick={() => updateActiveChatConfig({ includeTables: !includeTables })}
                    title="Toggle synthesizing Markdown comparison tables"
                  >
                    <span>{includeTables ? '✓ Tables' : '✕ Tables'}</span>
                  </button>
                  <button
                    type="button"
                    className={`exam-toggle-btn ${includeDiagrams ? 'active' : ''}`}
                    onClick={() => updateActiveChatConfig({ includeDiagrams: !includeDiagrams })}
                    title="Toggle synthesizing diagrams & flowcharts"
                  >
                    <span>{includeDiagrams ? '✓ Diagrams' : '✕ Diagrams'}</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="chat-composer-wrap">
            <div className="chat-composer-box">
              <textarea
                id="chat-input"
                className="chat-composer-textarea"
                placeholder="Ask a question about your documents..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={querying}
                rows={1}
              />
              <button
                id="chat-send-btn"
                className={`chat-send-circle-btn ${question.trim() && !querying ? 'active' : ''}`}
                onClick={handleQuery}
                disabled={querying || !question.trim()}
                title="Send message"
              >
                {querying ? (
                  <span className="spinner spinner-sm" style={{ borderTopColor: '#09090b' }} />
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5"></line>
                    <polyline points="5 12 12 5 19 12"></polyline>
                  </svg>
                )}
              </button>
            </div>
            <div className="chat-disclaimer">
              ProFAQ grounds answers using page-level citations from indexed documents.
            </div>
          </div>
        </div>

        {/* Right Divider Resizer */}
        {!rightCollapsed && (
          <div
            className={`workspace-resizer ${isResizingRight ? 'is-resizing' : ''}`}
            onPointerDown={startRightResize}
            title="Drag to resize Versions panel"
          />
        )}

        {/* Right: Versions */}
        {rightCollapsed ? (
          <div className="workspace-collapsed-bar" onClick={() => setRightCollapsed(false)} title="Expand Versions Panel">
            <span>◂</span>
            <span className="workspace-collapsed-label">Versions</span>
          </div>
        ) : (
          <div style={{ width: rightWidth, flexShrink: 0, height: '100%' }}>
            <VersionMiniPanel
              subjectId={subjectId}
              branches={branches}
              commits={commits}
              currentBranchId={subject?.current_branch_id}
              activeCommitId={activeCommitId}
              onBranchChange={handleBranchChange}
              onCheckoutCommit={handleCheckoutCommit}
              onResetHead={handleResetHead}
              onOpenNewBranch={() => setShowNewBranchModal(true)}
              onOpenMerge={() => setShowMergeModal(true)}
              onCollapse={() => setRightCollapsed(true)}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {activeCitation && (
        <CitationModal
          citation={activeCitation}
          subjectId={subjectId}
          onClose={() => setActiveCitation(null)}
        />
      )}

      {showLLMSettings && (
        <LLMSettingsModal
          onClose={() => setShowLLMSettings(false)}
          onSaved={(cfg) => setLLMConfig(cfg)}
        />
      )}

      {showUploadModal && (
        <UploadModal
          subjectId={subjectId}
          onClose={() => setShowUploadModal(false)}
          onUploaded={() => loadData()}
        />
      )}

      {showImportModal && (
        <ImportModal
          subjectId={subjectId}
          onClose={() => setShowImportModal(false)}
          onImported={() => loadData()}
        />
      )}

      {showNewBranchModal && (
        <NewBranchModal
          subjectId={subjectId}
          currentCommitId={activeCommitId}
          onClose={() => setShowNewBranchModal(false)}
          onCreated={() => loadData()}
        />
      )}

      {showMergeModal && (
        <MergeBranchModal
          subjectId={subjectId}
          currentBranchId={subject?.current_branch_id}
          branches={branches}
          onClose={() => setShowMergeModal(false)}
          onMerged={() => loadData()}
        />
      )}

      {showNewChatModal && (
        <NewChatModal
          defaultMode={newChatDefaultMode}
          onClose={() => setShowNewChatModal(false)}
          onCreate={handleCreateNewChatWithConfig}
        />
      )}
    </main>
  )
}

