import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSubjects, createSubject, deleteSubject } from '../api'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function NewSubjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const subject = await createSubject({ name: name.trim(), description: desc.trim() || null })
      onCreate(subject)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">New Subject</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Name</label>
              <input
                id="new-subject-name"
                className="input"
                placeholder="e.g. Contract Law, ML Research"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Description (optional)</label>
              <textarea
                id="new-subject-desc"
                className="input"
                placeholder="What documents will go in this subject?"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
              />
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button id="new-subject-submit" type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              {loading ? <span className="spinner" /> : null}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SubjectCard({ subject, onDelete }) {
  const navigate = useNavigate()
  const branchCount = subject.branches?.length ?? 0

  return (
    <div
      className="card card-clickable"
      id={`subject-card-${subject.id}`}
      onClick={() => navigate(`/subjects/${subject.id}`)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subject.name}
          </h3>
          {subject.description && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {subject.description}
            </p>
          )}
        </div>
        <button
          className="btn btn-ghost btn-sm"
          id={`delete-subject-${subject.id}`}
          onClick={(e) => { e.stopPropagation(); onDelete(subject.id) }}
          title="Delete subject"
          style={{ flexShrink: 0 }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <span className="tag">{branchCount} branch{branchCount !== 1 ? 'es' : ''}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Updated {formatDate(subject.updated_at)}
        </span>
      </div>
    </div>
  )
}

export default function SubjectsDashboard() {
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    try {
      const data = await getSubjects()
      setSubjects(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id) {
    if (!confirm('Delete this subject and all its documents?')) return
    try {
      await deleteSubject(id)
      setSubjects((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Subjects</h1>
          <p className="page-subtitle">Each subject is an independent PDF knowledge base with version control.</p>
        </div>
        <button id="new-subject-btn" className="btn btn-primary" onClick={() => setShowModal(true)}>
          + New Subject
        </button>
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <span className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      )}

      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}

      {!loading && subjects.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <p className="empty-state-title">No subjects yet</p>
          <p className="empty-state-sub">Create a subject to start building your first document knowledge base.</p>
        </div>
      )}

      <div className="grid-cards">
        {subjects.map((s) => (
          <SubjectCard key={s.id} subject={s} onDelete={handleDelete} />
        ))}
      </div>

      {showModal && (
        <NewSubjectModal
          onClose={() => setShowModal(false)}
          onCreate={(s) => setSubjects((prev) => [s, ...prev])}
        />
      )}
    </main>
  )
}
