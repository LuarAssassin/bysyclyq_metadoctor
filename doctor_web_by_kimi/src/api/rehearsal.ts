import request from '@/utils/request'
import type { 
  RehearsalSession, 
  RehearsalMessage, 
  PlaybackAssets, 
  FeedbackForm,
  PaginatedData 
} from '@/types'

export const createSession = (data?: { title?: string }): Promise<RehearsalSession> => {
  return request.post('/doctor/rehearsal/sessions/', data)
}

export const getSessions = (): Promise<RehearsalSession[]> => {
  return request.get('/doctor/rehearsal/sessions/')
}

export const getSessionMessages = (sessionId: number, params?: { limit?: number }): Promise<RehearsalMessage[]> => {
  return request.get(`/doctor/rehearsal/sessions/${sessionId}/messages/`, { params })
}

export const askStream = (
  sessionId: number, 
  data: { question: string; forced_search?: boolean }
): Promise<Response> => {
  return fetch(`${import.meta.env.VITE_API_BASE_URL}/doctor/rehearsal/sessions/${sessionId}/ask/stream/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
    },
    body: JSON.stringify(data),
  })
}

export const getPlaybackAssets = (): Promise<PlaybackAssets> => {
  return request.get('/doctor/rehearsal/playback-assets/')
}

export const updateMessageMarkdown = (messageId: number, markdown: string): Promise<void> => {
  return request.patch(`/doctor/rehearsal/messages/${messageId}/markdown/`, { markdown })
}

export const submitFeedback = (messageId: number, data: FeedbackForm): Promise<void> => {
  return request.post(`/doctor/rehearsal/messages/${messageId}/feedback/`, data)
}
