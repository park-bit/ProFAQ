import React, { useState } from 'react'

export default function NewChatModal({ onClose, onCreate, defaultMode = 'general' }) {
  const [title, setTitle] = useState('')
  const [chatType, setChatType] = useState(defaultMode)
  const [targetLength, setTargetLength] = useState('standard')
  const [formatStyle, setFormatStyle] = useState('structured')
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setLoading(true)
    const finalTitle = title.trim() || (chatType === 'exam' ? 'Exam Structured' : 'New Chat')
    onCreate({
      title: finalTitle,
      chat_type: chatType,
      target_length: targetLength,
      format_style: formatStyle,
    })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Create Chat Thread</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Thread Title (Optional)
            </label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={chatType === 'exam' ? 'e.g. Unit 3 Architecture & Verification' : 'e.g. System Overview'}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              Thread Purpose
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div
                className={`type-card ${chatType === 'general' ? 'selected' : ''}`}
                onClick={() => setChatType('general')}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>
                  General Q&A
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                  Direct conversational answers with grounded citations.
                </div>
              </div>

              <div
                className={`type-card ${chatType === 'exam' ? 'selected' : ''}`}
                onClick={() => setChatType('exam')}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>
                  Exam Structured
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                  Structured model exam answers with tables, diagrams, and marks sizing.
                </div>
              </div>
            </div>
          </div>

          {chatType === 'exam' && (
            <div className="exam-preset-box">
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Target Sizing (Marks / Pages)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  <button
                    type="button"
                    className={`pill-btn ${targetLength === 'short' ? 'active' : ''}`}
                    onClick={() => setTargetLength('short')}
                  >
                    5M (~0.5p)
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${targetLength === 'standard' ? 'active' : ''}`}
                    onClick={() => setTargetLength('standard')}
                  >
                    10M (~1p)
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${targetLength === 'comprehensive' ? 'active' : ''}`}
                    onClick={() => setTargetLength('comprehensive')}
                  >
                    20M (~2p)
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${targetLength === 'assignment' ? 'active' : ''}`}
                    onClick={() => setTargetLength('assignment')}
                  >
                    Assign (~3p)
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Exposition Style
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  <button
                    type="button"
                    className={`pill-btn ${formatStyle === 'structured' ? 'active' : ''}`}
                    onClick={() => setFormatStyle('structured')}
                  >
                    Structured
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${formatStyle === 'bullets' ? 'active' : ''}`}
                    onClick={() => setFormatStyle('bullets')}
                  >
                    Bullets
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${formatStyle === 'narrative' ? 'active' : ''}`}
                    onClick={() => setFormatStyle('narrative')}
                  >
                    Essay / Narrative
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="modal-actions" style={{ marginTop: 22 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Start Thread'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
