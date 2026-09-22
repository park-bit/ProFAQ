/**
 * Export helpers for saving answers and exam revision sheets as Markdown (.md)
 */

export function downloadMarkdown(filename, content) {
  const cleanName = filename.endsWith('.md') ? filename : `${filename}.md`
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', cleanName)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function buildExamRevisionSheet({
  subjectName,
  subjectDescription,
  chatTitle,
  chatType,
  targetLength,
  formatStyle,
  messages,
}) {
  const timestamp = new Date().toLocaleString()
  const headerLines = [
    `# Exam Revision Sheet: ${subjectName || 'Study Guide'}`,
    `> **Topic / Thread**: ${chatTitle || 'Exam Solutions'}`,
    `> **Mode**: ${chatType === 'exam' ? 'Academic Exam Mode' : 'General Q&A'} | **Length**: ${targetLength || 'Standard'} | **Style**: ${formatStyle || 'Structured'}`,
    `> **Generated**: ${timestamp}`,
  ]

  if (subjectDescription) {
    headerLines.push(`> **Subject Details**: ${subjectDescription}`)
  }

  headerLines.push('', '---', '', '## Table of Questions')

  // Collect Q&A pairs
  const qas = []
  let currentQ = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      currentQ = msg.content
    } else if (msg.role === 'assistant' && currentQ) {
      qas.push({
        question: currentQ,
        answer: msg.answer || '',
        citations: msg.citations || [],
        confidence: msg.confidence,
        latency_ms: msg.latency_ms,
      })
      currentQ = null
    }
  }

  qas.forEach((qa, idx) => {
    headerLines.push(`${idx + 1}. [${qa.question.replace(/\n/g, ' ').slice(0, 80)}](#question-${idx + 1})`)
  })

  headerLines.push('', '---', '')

  qas.forEach((qa, idx) => {
    headerLines.push(`### Question ${idx + 1}`)
    headerLines.push(`**Q: ${qa.question}**`)
    headerLines.push('')
    headerLines.push(qa.answer)
    headerLines.push('')

    if (qa.citations && qa.citations.length > 0) {
      headerLines.push('#### Verified Document Citations:')
      qa.citations.forEach((c, cIdx) => {
        headerLines.push(`- **[${cIdx + 1}]** *${c.filename}* (Page ${c.page_no}): "${c.excerpt?.replace(/\n/g, ' ')}"`)
      })
      headerLines.push('')
    }

    headerLines.push('---', '')
  })

  return headerLines.join('\n')
}
