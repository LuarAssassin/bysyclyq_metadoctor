import { forceRefreshAccessToken, getApiBaseUrl } from './http'
import { getAccessToken } from './storage'
import type {
  ApiEnvelope,
  SSEAudioDeltaEvent,
  SSEAudioErrorEvent,
  SSEDeltaEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  SSEStartEvent,
} from '@/types/api'

export interface StreamHandlers {
  onStart?: (data: SSEStartEvent) => void
  onDelta?: (data: SSEDeltaEvent) => void
  onDone?: (data: SSEDoneEvent) => void
  onError?: (data: SSEErrorEvent) => void
  onAudioDelta?: (data: SSEAudioDeltaEvent) => void
  onAudioError?: (data: SSEAudioErrorEvent) => void
}

export interface AskPayload {
  question: string
  forced_search?: boolean
  enable_audio?: boolean
}

const resolveUrl = (path: string): string => {
  const base = getApiBaseUrl()
  if (base.startsWith('http://') || base.startsWith('https://')) return `${base}${path}`
  return `${window.location.origin}${base}${path}`
}

const safeParse = (s: string): unknown => {
  try { return JSON.parse(s) } catch { return null }
}

const parseError = (raw: string): string => {
  try {
    const p = JSON.parse(raw) as ApiEnvelope<unknown>
    if (typeof p?.message === 'string' && p.message.trim()) return p.message
  } catch { /* noop */ }
  return raw || '问诊请求失败'
}

export const askPatientStream = async (
  sessionId: number,
  payload: AskPayload,
  handlers: StreamHandlers,
  options?: { signal?: AbortSignal },
): Promise<void> => {
  const doFetch = (token: string) =>
    fetch(resolveUrl(`/patient/sessions/${sessionId}/ask/stream/`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options?.signal,
    })

  const access = getAccessToken()
  if (!access) throw new Error('登录已失效，请重新登录')

  let res = await doFetch(access)
  if (res.status === 401) {
    const refreshed = await forceRefreshAccessToken()
    res = await doFetch(refreshed)
  }

  const ct = res.headers.get('content-type') || ''
  if (!res.ok || ct.includes('application/json')) {
    throw new Error(parseError(await res.text()))
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('未获取到流式响应')

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const emit = () => {
    if (!dataLines.length) return
    const raw = dataLines.join('\n')
    const parsed = safeParse(raw)
    dataLines = []
    if (!parsed || typeof parsed !== 'object') { eventName = 'message'; return }
    if (eventName === 'start') handlers.onStart?.(parsed as SSEStartEvent)
    else if (eventName === 'delta') handlers.onDelta?.(parsed as SSEDeltaEvent)
    else if (eventName === 'done') handlers.onDone?.(parsed as SSEDoneEvent)
    else if (eventName === 'error') handlers.onError?.(parsed as SSEErrorEvent)
    else if (eventName === 'audio_delta') handlers.onAudioDelta?.(parsed as SSEAudioDeltaEvent)
    else if (eventName === 'audio_error') handlers.onAudioError?.(parsed as SSEAudioErrorEvent)
    eventName = 'message'
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = buffer.indexOf('\n')
      if (idx < 0) break
      const line = buffer.slice(0, idx).trimEnd()
      buffer = buffer.slice(idx + 1)
      if (!line) { emit(); continue }
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue }
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
  }
  if (buffer.trim().startsWith('data:')) dataLines.push(buffer.trim().slice(5).trim())
  emit()
}
