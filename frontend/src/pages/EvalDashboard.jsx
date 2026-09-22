import { useState, useEffect } from 'react'
import { getEvalRuns, getSubjects } from '../api'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts'

function MetricCard({ label, value, color }) {
  const display = value != null ? (value * 100).toFixed(1) + '%' : '--'
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value" style={{ color: color || 'var(--text-primary)' }}>{display}</p>
    </div>
  )
}

function RunRow({ run }) {
  const fmt = (v) => v != null ? (v * 100).toFixed(1) + '%' : '--'
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '10px 12px', fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        {run.id.slice(0, 8)}
      </td>
      <td style={{ padding: '10px 12px', fontSize: '0.875rem' }}>
        {run.label || '--'}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{fmt(run.answer_accuracy)}</td>
      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{fmt(run.citation_precision)}</td>
      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{fmt(run.refusal_rate)}</td>
      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{fmt(run.mean_grounding_score)}</td>
      <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        {run.total_questions}
      </td>
      <td style={{ padding: '10px 12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {new Date(run.created_at).toLocaleDateString()}
      </td>
    </tr>
  )
}

export default function EvalDashboard() {
  const [runs, setRuns] = useState([])
  const [subjects, setSubjects] = useState([])
  const [filterSubject, setFilterSubject] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getEvalRuns(), getSubjects()])
      .then(([r, s]) => { setRuns(r); setSubjects(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleFilterChange(subjectId) {
    setFilterSubject(subjectId)
    setLoading(true)
    try {
      const r = await getEvalRuns(subjectId || null)
      setRuns(r)
    } finally {
      setLoading(false)
    }
  }

  const latest = runs[0]
  const chartData = [...runs].reverse().map((r, i) => ({
    name: r.label || r.id.slice(0, 6),
    accuracy: r.answer_accuracy != null ? +(r.answer_accuracy * 100).toFixed(1) : null,
    grounding: r.mean_grounding_score != null ? +(r.mean_grounding_score * 100).toFixed(1) : null,
    refusal: r.refusal_rate != null ? +(r.refusal_rate * 100).toFixed(1) : null,
    citation: r.citation_precision != null ? +(r.citation_precision * 100).toFixed(1) : null,
  }))

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Eval Dashboard</h1>
          <p className="page-subtitle">Automated accuracy metrics across commits. Run <code style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>python eval/run_eval.py</code> to add data.</p>
        </div>
        <select
          id="eval-subject-filter"
          className="input"
          value={filterSubject}
          onChange={(e) => handleFilterChange(e.target.value)}
          style={{ maxWidth: 220, fontSize: '0.875rem' }}
        >
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div>}

      {!loading && runs.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <p className="empty-state-title">No eval runs yet</p>
          <p className="empty-state-sub">Run the eval script to populate this dashboard.</p>
        </div>
      )}

      {!loading && runs.length > 0 && (
        <>
          <div className="metrics-grid">
            <MetricCard label="Answer Accuracy" value={latest?.answer_accuracy} color="var(--accent)" />
            <MetricCard label="Citation Precision" value={latest?.citation_precision} color="var(--green)" />
            <MetricCard label="Correct Refusal Rate" value={latest?.refusal_rate} color="var(--amber)" />
            <MetricCard label="Mean Grounding Score" value={latest?.mean_grounding_score} color="var(--text-primary)" />
            <div className="metric-card">
              <p className="metric-label">Total Questions</p>
              <p className="metric-value">{latest?.total_questions ?? '--'}</p>
              <p className="metric-sub">in latest run</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Total Runs</p>
              <p className="metric-value">{runs.length}</p>
              <p className="metric-sub">eval runs logged</p>
            </div>
          </div>

          {chartData.length > 1 && (
            <div className="card" style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 20, color: 'var(--text-secondary)' }}>Metrics over commits</h2>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
                    formatter={(v) => `${v}%`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                  <Line type="monotone" dataKey="accuracy" name="Answer accuracy" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="grounding" name="Grounding" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="refusal" name="Refusal rate" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="citation" name="Citation precision" stroke="#38bdf8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card">
            <h2 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 16, color: 'var(--text-secondary)' }}>All runs</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Run', 'Label', 'Accuracy', 'Citation', 'Refusal', 'Grounding', 'Questions', 'Date'].map((h) => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Run' || h === 'Label' || h === 'Date' ? 'left' : 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => <RunRow key={r.id} run={r} />)}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
