import { forceRefreshAccessToken, getApiBaseUrl } from './http'
import type {
  AskStreamPayload,
} from './api'
import type {
  RehearsalDeltaEvent,
  RehearsalDoneEvent,
  RehearsalErrorEvent,
  RehearsalStartEvent,
  ApiEnvelope,
} from '../types/api'
import { getAccessToken } from '../utils/storage'

interface StreamHandlers {
  onStart?: (data: RehearsalStartEvent) => void
  onDelta?: (data: RehearsalDeltaEvent) => void
  onDone?: (data: RehearsalDoneEvent) => void
  onError?: (data: RehearsalErrorEvent) => void
}

const parseErrorMessage = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw) as ApiEnvelope<unknown>
    if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      return parsed.message
    }
  } catch {
    // no-op
  }
  return raw || '流式问答失败'
}

const resolveAbsoluteUrl = (path: string): string => {
  const base = getApiBaseUrl()
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${base}${path}`
  }
  return `${window.location.origin}${base}${path}`
}

const safeJsonParse = (input: string): unknown => {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

export const askRehearsalStream = async (
  sessionId: number,
  payload: AskStreamPayload,
  handlers: StreamHandlers,
): Promise<void> => {
  const requestStream = async (token: string) => {
    return await fetch(
      resolveAbsoluteUrl(`/doctor/rehearsal/sessions/${sessionId}/ask/stream/`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    )
  }

  const access = getAccessToken()
  if (!access) {
    throw new Error('登录已失效，请重新登录')
  }

  let response = await requestStream(access)
  if (response.status === 401) {
    const refreshed = await forceRefreshAccessToken()
    response = await requestStream(refreshed)
  }

  const contentType = response.headers.get('content-type') || ''

  if (!response.ok || contentType.includes('application/json')) {
    const raw = await response.text()
    throw new Error(parseErrorMessage(raw))
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('未获取到流式响应')
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const emitEvent = () => {
    if (!dataLines.length) {
      return
    }

    const rawData = dataLines.join('\n')
    const parsed = safeJsonParse(rawData)

    if (!parsed || typeof parsed !== 'object') {
      dataLines = []
      eventName = 'message'
      return
    }

    if (eventName === 'start') {
      handlers.onStart?.(parsed as RehearsalStartEvent)
    } else if (eventName === 'delta') {
      handlers.onDelta?.(parsed as RehearsalDeltaEvent)
    } else if (eventName === 'done') {
      handlers.onDone?.(parsed as RehearsalDoneEvent)
    } else if (eventName === 'error') {
      handlers.onError?.(parsed as RehearsalErrorEvent)
    }

    dataLines = []
    eventName = 'message'
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const lineBreakIndex = buffer.indexOf('\n')
      if (lineBreakIndex < 0) {
        break
      }

      const rawLine = buffer.slice(0, lineBreakIndex)
      buffer = buffer.slice(lineBreakIndex + 1)
      const line = rawLine.trimEnd()

      if (!line) {
        emitEvent()
        continue
      }

      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }
  }

  if (buffer.trim()) {
    const trailing = buffer.trimEnd()
    if (trailing.startsWith('data:')) {
      dataLines.push(trailing.slice(5).trim())
    }
  }

  emitEvent()
}
