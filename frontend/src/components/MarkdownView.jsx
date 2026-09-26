import React, { useEffect, useRef, useState, useId } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'

// Configure marked with GitHub-flavored markdown
marked.setOptions({
  gfm: true,
  breaks: true,
})

// Initialize mermaid with dark theme
try {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    themeVariables: {
      darkMode: true,
      background: '#0a0a0c',
      primaryColor: '#3b82f6',
      primaryTextColor: '#f8fafc',
      primaryBorderColor: '#60a5fa',
      lineColor: '#93c5fd',
      secondaryColor: '#18181b',
      tertiaryColor: '#27272a',
      edgeLabelBackground: '#18181b',
      nodeTextColor: '#f8fafc',
    },
  })
} catch (e) {
  console.warn('Mermaid init warning:', e)
}

function MermaidBlock({ code, index }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(false)
  const blockId = useId().replace(/:/g, '_')

  useEffect(() => {
    let isMounted = true
    const render = async () => {
      try {
        const uniqueId = `mermaid_${blockId}_${index}`
        const { svg: renderedSvg } = await mermaid.render(uniqueId, code)
        if (isMounted) {
          setSvg(renderedSvg)
          setError(false)
        }
      } catch (err) {
        console.warn('Mermaid rendering syntax fallback:', err)
        if (isMounted) setError(true)
      }
    }
    render()
    return () => { isMounted = false }
  }, [code, blockId, index])

  if (error || !svg) {
    return (
      <div className="diagram-card fallback">
        <div className="diagram-card-bar">
          <span className="diagram-badge">Diagram (Synthesized Flow)</span>
          <span className="diagram-type">Mermaid / ASCII</span>
        </div>
        <pre className="diagram-pre"><code>{code}</code></pre>
      </div>
    )
  }

  return (
    <div className="diagram-card">
      <div className="diagram-card-bar">
        <span className="diagram-badge">Diagram (Synthesized Flow)</span>
        <span className="diagram-type">Flowchart / Architecture</span>
      </div>
      <div className="diagram-svg-wrap" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

export function formatMarkdownContent(raw) {
  if (!raw || typeof raw !== 'string') return ''
  let text = raw.trim()

  // 1. If wrapped in JSON string like {"answer": "...", ...}
  if (text.startsWith('{') && text.includes('"answer"')) {
    try {
      const parsed = JSON.parse(text)
      if (parsed.answer) {
        text = String(parsed.answer)
      }
    } catch {
      // Regex extraction fallback for truncated or invalid JSON
      const match = text.match(/"answer"\s*:\s*"([\s\S]*)/)
      if (match) {
        const inner = match[1]
        const endMatch = inner.match(/([\s\S]*?)(?:"\s*,\s*"citations"|"\s*,\s*"confidence"|"\s*\}\s*$|"\s*$)/)
        text = endMatch ? endMatch[1] : inner.replace(/["}\s]+$/, '')
      }
    }
  }

  // 2. Unescape escaped characters if present
  if (text.includes('\\n')) {
    text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
  }

  // 3. Strip leading answer counters like "#1\n", "1. ", "Answer:\n", etc.
  text = text.replace(/^(?:#\d+|\bAnswer\b:?|\bQuestion\b:?|\d+\.)\s*\n*/, '')

  // 4. Ensure bullet points (•, ●) start on new lines as Markdown lists
  text = text.replace(/([^\n])\s*[•●]\s*/g, '$1\n- ')

  // 5. Ensure "Step X:" or "Phase X:" gets its own subheader
  text = text.replace(/([^\n])\s+(Step\s+\d+:|Phase\s+\d+:)\s*/g, '$1\n\n### $2\n\n')

  // 6. Ensure Markdown headings (##, ###) have double newlines before them, without splitting hashes
  text = text.replace(/([^\n#])\n*(#{1,4}\s+)/g, '$1\n\n$2')

  // 7. Ensure section questions have proper subheadings
  text = text.replace(/([a-z0-9.)\]])\s+(Why|What|How|When|Where)\s+([A-Z][a-zA-Z\s]+)\?\s+/g, '$1\n\n### $2 $3?\n\n')

  // 8. Collapse 3+ newlines into 2 for clean paragraph spacing
  text = text.replace(/\n{3,}/g, '\n\n')

  return text.trim()
}

export default function MarkdownView({ content, onCitationClick }) {
  const containerRef = useRef(null)
  const cleanContent = formatMarkdownContent(content)

  // Split markdown into markdown segments and mermaid blocks
  const parts = []
  if (cleanContent) {
    const regex = /```mermaid\s*\n([\s\S]*?)```/g
    let lastIndex = 0
    let match

    while ((match = regex.exec(cleanContent)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'markdown', text: cleanContent.slice(lastIndex, match.index) })
      }
      parts.push({ type: 'mermaid', code: match[1].trim() })
      lastIndex = regex.lastIndex
    }

    if (lastIndex < cleanContent.length) {
      parts.push({ type: 'markdown', text: cleanContent.slice(lastIndex) })
    }
  }

  // Handle citation clicks inside the rendered HTML
  const handleContainerClick = (e) => {
    const citationBtn = e.target.closest('.inline-citation-badge')
    if (citationBtn && onCitationClick) {
      e.preventDefault()
      e.stopPropagation()
      const citNum = parseInt(citationBtn.dataset.citation, 10)
      if (!isNaN(citNum)) {
        onCitationClick(citNum)
      }
    }
  }

  const parseHtml = (markdownText) => {
    try {
      let rawHtml = marked.parse(markdownText || '')
      // Transform [N] into interactive badges
      rawHtml = rawHtml.replace(/\[(\d+)\]/g, (m, p1) => {
        return `<button type="button" class="inline-citation-badge" data-citation="${p1}" title="View source citation [${p1}]">[${p1}]</button>`
      })
      return rawHtml
    } catch (e) {
      return markdownText
    }
  }

  if (!content) return null

  return (
    <div
      ref={containerRef}
      className="markdown-prose"
      onClick={handleContainerClick}
    >
      {parts.map((part, idx) => {
        if (part.type === 'mermaid') {
          return <MermaidBlock key={idx} code={part.code} index={idx} />
        }
        return (
          <div
            key={idx}
            className="markdown-chunk"
            dangerouslySetInnerHTML={{ __html: parseHtml(part.text) }}
          />
        )
      })}
    </div>
  )
}
