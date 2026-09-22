const BASE = '/subjects'
const EVAL_BASE = '/eval'

async function req(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

// Subjects
export const getSubjects = () => req(BASE)
export const createSubject = (data) => req(BASE, { method: 'POST', body: JSON.stringify(data) })
export const getSubject = (id) => req(`${BASE}/${id}`)
export const deleteSubject = (id) => req(`${BASE}/${id}`, { method: 'DELETE' })

// Documents
export const getDocuments = (subjectId, commitId) =>
  req(`${BASE}/${subjectId}/documents${commitId ? `?commit_id=${commitId}` : ''}`)

export const getDocumentFileUrl = (subjectId, docId) =>
  `${BASE}/${subjectId}/documents/${docId}/file`

export const uploadPdf = (subjectId, file, onProgress) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append('file', file)
    xhr.open('POST', `${BASE}/${subjectId}/upload`)
    if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded / e.total)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error(JSON.parse(xhr.responseText)?.detail || 'Upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}

// Query
export const querySubject = (subjectId, data) =>
  req(`${BASE}/${subjectId}/query`, { method: 'POST', body: JSON.stringify(data) })

// Versions
export const getBranches = (subjectId) => req(`${BASE}/${subjectId}/branches`)
export const createBranch = (subjectId, data) =>
  req(`${BASE}/${subjectId}/branches`, { method: 'POST', body: JSON.stringify(data) })
export const getCommits = (subjectId, branchId) =>
  req(`${BASE}/${subjectId}/commits${branchId ? `?branch_id=${branchId}` : ''}`)
export const checkout = (subjectId, data) =>
  req(`${BASE}/${subjectId}/checkout`, { method: 'POST', body: JSON.stringify(data) })
export const getDiff = (subjectId, fromCommit, toCommit) =>
  req(`${BASE}/${subjectId}/diff?from_commit=${fromCommit}&to_commit=${toCommit}`)

// Eval
export const getEvalRuns = (subjectId) =>
  req(`${EVAL_BASE}/runs${subjectId ? `?subject_id=${subjectId}` : ''}`)
