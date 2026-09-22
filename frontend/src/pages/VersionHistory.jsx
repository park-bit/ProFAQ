import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSubject, getBranches, getCommits, createBranch, checkout, getDiff } from '../api'

function DiffModal({ subjectId, fromCommit, toCommit, onClose }) {
  const [diff, setDiff] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDiff(subjectId, fromCommit.id, toCommit.id)
      .then(setDiff)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <h2 className="modal-title">Diff</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16, fontFamily: 'var(--mono)' }}>
          {fromCommit.id.slice(0, 8)} → {toCommit.id.slice(0, 8)}
        </p>
        {loading && <span className="spinner" />}
        {diff && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {diff.added.map((f) => (
              <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge badge-green">+ added</span>
                <span style={{ fontSize: '0.875rem', fontFamily: 'var(--mono)' }}>{f}</span>
              </div>
            ))}
            {diff.removed.map((f) => (
              <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge badge-red">- removed</span>
                <span style={{ fontSize: '0.875rem', fontFamily: 'var(--mono)' }}>{f}</span>
              </div>
            ))}
            {diff.unchanged.map((f) => (
              <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>unchanged</span>
                <span style={{ fontSize: '0.875rem', fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>{f}</span>
              </div>
            ))}
            {diff.config_changed && diff.config_diff && (
              <div style={{ marginTop: 8, padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>
                <p style={{ color: 'var(--amber)', marginBottom: 8 }}>Config changed:</p>
                {Object.entries(diff.config_diff).map(([k, v]) => (
                  <p key={k} style={{ color: 'var(--text-secondary)' }}>
                    {k}: <span style={{ color: 'var(--red)' }}>{String(v.from)}</span> → <span style={{ color: 'var(--green)' }}>{String(v.to)}</span>
                  </p>
                ))}
              </div>
            )}
            {!diff.added.length && !diff.removed.length && !diff.config_changed && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No differences between these commits.</p>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function NewBranchModal({ subjectId, fromCommit, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      const branch = await createBranch(subjectId, { name: name.trim(), from_commit_id: fromCommit?.id })
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
      <div className="modal">
        <h2 className="modal-title">New Branch</h2>
        {fromCommit && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Branching from: <span style={{ fontFamily: 'var(--mono)' }}>{fromCommit.id.slice(0, 8)}</span> - {fromCommit.message}
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <input
            id="new-branch-name"
            className="input"
            placeholder="e.g. experiment-smaller-chunks"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem', marginTop: 8 }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button id="create-branch-submit" type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              {loading ? <span className="spinner" /> : null}
              Create branch
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function VersionHistory() {
  const { id: subjectId } = useParams()
  const [subject, setSubject] = useState(null)
  const [branches, setBranches] = useState([])
  const [activeBranchId, setActiveBranchId] = useState(null)
  const [commits, setCommits] = useState([])
  const [selectedCommits, setSelectedCommits] = useState([])
  const [showDiff, setShowDiff] = useState(false)
  const [showNewBranch, setShowNewBranch] = useState(null) // commit to branch from
  const [loading, setLoading] = useState(true)

  async function loadBranchCommits(branchId) {
    const cms = await getCommits(subjectId, branchId)
    setCommits(cms)
  }

  useEffect(() => {
    async function load() {
      const [sub, brs] = await Promise.all([getSubject(subjectId), getBranches(subjectId)])
      setSubject(sub)
      setBranches(brs)
      const bid = sub.current_branch_id
      setActiveBranchId(bid)
      if (bid) await loadBranchCommits(bid)
      setLoading(false)
    }
    load()
  }, [subjectId])

  async function handleBranchChange(branchId) {
    setActiveBranchId(branchId)
    await loadBranchCommits(branchId)
    setSelectedCommits([])
  }

  async function handleCheckout(commit) {
    try {
      await checkout(subjectId, { commit_id: commit.id, branch_id: commit.branch_id })
      alert(`Checked out ${commit.id.slice(0, 8)}`)
    } catch (err) {
      alert(err.message)
    }
  }

  function toggleSelect(commit) {
    setSelectedCommits((prev) => {
      if (prev.find((c) => c.id === commit.id)) return prev.filter((c) => c.id !== commit.id)
      if (prev.length >= 2) return [prev[1], commit]
      return [...prev, commit]
    })
  }

  if (loading) return <div className="page" style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div>

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <Link to={`/subjects/${subjectId}`} style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            ← {subject?.name}
          </Link>
          <h1 className="page-title">Version History</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedCommits.length === 2 && (
            <button id="diff-commits-btn" className="btn btn-secondary" onClick={() => setShowDiff(true)}>
              Diff selected
            </button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Branch</label>
        <select
          id="history-branch-select"
          className="input"
          value={activeBranchId || ''}
          onChange={(e) => handleBranchChange(e.target.value)}
          style={{ maxWidth: 300, fontSize: '0.875rem' }}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {commits.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🌱</div>
          <p className="empty-state-title">No commits yet</p>
          <p className="empty-state-sub">Upload a PDF to create the first commit.</p>
        </div>
      )}

      {selectedCommits.length > 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          {selectedCommits.length}/2 commits selected for diff. {selectedCommits.length < 2 ? 'Select one more.' : ''}
        </p>
      )}

      <div className="commit-timeline" style={{ paddingLeft: 24 }}>
        {commits.map((commit, i) => {
          const isSelected = selectedCommits.find((c) => c.id === commit.id)
          return (
            <div
              key={commit.id}
              id={`commit-${commit.id}`}
              className={`commit-node ${i === 0 ? 'active' : ''}`}
              style={{ padding: '12px 0', borderBottom: i < commits.length - 1 ? '1px solid var(--border)' : 'none' }}
            >
              <div
                className="commit-dot"
                style={{ borderColor: isSelected ? 'var(--green)' : undefined, background: isSelected ? 'var(--green)' : undefined }}
              />
              <div className="commit-info" style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="commit-message">{commit.message}</span>
                  {i === 0 && <span className="badge badge-blue">HEAD</span>}
                </div>
                <div className="commit-meta">
                  <span style={{ fontFamily: 'var(--mono)' }}>{commit.id.slice(0, 8)}</span>
                  {' · '}
                  {commit.document_count} doc{commit.document_count !== 1 ? 's' : ''}
                  {' · '}
                  {new Date(commit.created_at).toLocaleString()}
                </div>
              </div>
              <div className="commit-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => toggleSelect(commit)}>
                  {isSelected ? '☑ Selected' : '☐ Select'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleCheckout(commit)}>Checkout</button>
                <button id={`new-branch-from-${commit.id}`} className="btn btn-ghost btn-sm" onClick={() => setShowNewBranch(commit)}>
                  Branch
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {showDiff && selectedCommits.length === 2 && (
        <DiffModal
          subjectId={subjectId}
          fromCommit={selectedCommits[0]}
          toCommit={selectedCommits[1]}
          onClose={() => setShowDiff(false)}
        />
      )}

      {showNewBranch && (
        <NewBranchModal
          subjectId={subjectId}
          fromCommit={showNewBranch}
          onClose={() => setShowNewBranch(null)}
          onCreated={(branch) => setBranches((prev) => [...prev, branch])}
        />
      )}
    </main>
  )
}
