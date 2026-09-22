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

export default function MarkdownView({ content, onCitationClick }) {
  const containerRef = useRef(null)

  // Split markdown into markdown segments and mermaid blocks
  const parts = []
  if (typeof content === 'string') {
    const regex = /```mermaid\s*\n([\s\S]*?)```/g
    let lastIndex = 0
    let match

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'markdown', text: content.slice(lastIndex, match.index) })
      }
      parts.push({ type: 'mermaid', code: match[1].trim() })
      lastIndex = regex.lastIndex
    }

    if (lastIndex < content.length) {
      parts.push({ type: 'markdown', text: content.slice(lastIndex) })
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
