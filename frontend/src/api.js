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

export const uploadPdf = (subjectId, file, options = {}, onProgress) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append('file', file)
    if (options.chunk_size) form.append('chunk_size', options.chunk_size)
    if (options.chunk_overlap) form.append('chunk_overlap', options.chunk_overlap)

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

// LLM Settings Management
const LLM_STORAGE_KEY = 'profaq_custom_llm_config'

export const getStoredLLMConfig = () => {
  try {
    const raw = localStorage.getItem(LLM_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const saveStoredLLMConfig = (config) => {
  try {
    if (!config) {
      localStorage.removeItem(LLM_STORAGE_KEY)
    } else {
      localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(config))
    }
  } catch (e) {
    console.error('Failed to save LLM settings to localStorage', e)
  }
}

export const getBackendLLMConfig = () => req(`${BASE}/llm/config`)

export const saveBackendLLMConfig = (data) =>
  req(`${BASE}/llm/config`, { method: 'POST', body: JSON.stringify(data) })

export const testLLMConnection = (data) =>
  req(`${BASE}/llm/test`, { method: 'POST', body: JSON.stringify(data) })

// Query
export const querySubject = (subjectId, data) => {
  const customLLM = getStoredLLMConfig()
  const payload = {
    ...data,
    ...(customLLM?.enabled ? {
      llm_provider: customLLM.provider,
      api_key: customLLM.api_key || undefined,
      model_name: customLLM.model_name || undefined,
      base_url: customLLM.base_url || undefined,
    } : {}),
  }
  return req(`${BASE}/${subjectId}/query`, { method: 'POST', body: JSON.stringify(payload) })
}

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
export const mergeBranches = (subjectId, data) =>
  req(`${BASE}/${subjectId}/merge`, { method: 'POST', body: JSON.stringify(data) })
export const importDocument = (subjectId, data) =>
  req(`${BASE}/${subjectId}/import-document`, { method: 'POST', body: JSON.stringify(data) })
export const getAvailableExternalDocuments = (subjectId) =>
  req(`${BASE}/${subjectId}/available-external-documents`)

// Eval
export const getEvalRuns = (subjectId) =>
  req(`${EVAL_BASE}/runs${subjectId ? `?subject_id=${subjectId}` : ''}`)

// Chat Sessions & Multi-Chat
export const getChats = (subjectId) =>
  req(`${BASE}/${subjectId}/chats`)
export const createChat = (subjectId, data = {}) =>
  req(`${BASE}/${subjectId}/chats`, { method: 'POST', body: JSON.stringify(data) })
export const renameChat = (subjectId, chatId, data) =>
  req(`${BASE}/${subjectId}/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deleteChat = (subjectId, chatId) =>
  req(`${BASE}/${subjectId}/chats/${chatId}`, { method: 'DELETE' })

// Chat History
export const getChatHistory = (subjectId, sessionId = null, branchId = null) => {
  const params = new URLSearchParams()
  if (sessionId) params.append('session_id', sessionId)
  else if (branchId) params.append('branch_id', branchId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return req(`${BASE}/${subjectId}/chat-history${qs}`)
}
export const clearChatHistory = (subjectId, sessionId = null, branchId = null) => {
  const params = new URLSearchParams()
  if (sessionId) params.append('session_id', sessionId)
  else if (branchId) params.append('branch_id', branchId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return req(`${BASE}/${subjectId}/chat-history${qs}`, { method: 'DELETE' })
}

