import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './storage'
import type { ApiEnvelope, RefreshTokenPayload } from '@/types/api'

export const getApiBaseUrl = (): string => import.meta.env.VITE_API_BASE_URL || '/api'

const apiClient = axios.create({ baseURL: getApiBaseUrl(), timeout: 120_000 })

/* ── JWT refresh ────────────────── */

let refreshing: Promise<string> | null = null

export const forceRefreshAccessToken = async (): Promise<string> => {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const rt = getRefreshToken()
    if (!rt) throw new Error('refresh token 不存在')
    const { data } = await axios.post<RefreshTokenPayload>(`${getApiBaseUrl()}/auth/token/refresh/`, { refresh: rt })
    setTokens(data.access, rt)
    return data.access
  })()
  try { return await refreshing } finally { refreshing = null }
}

/* ── Interceptors ───────────────── */

apiClient.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const t = getAccessToken()
  if (t && cfg.headers) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

let pendingQueue: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void; cfg: AxiosRequestConfig }> = []
let isRefreshing = false

apiClient.interceptors.response.use(
  (r) => r,
  async (err) => {
    const orig = err.config as AxiosRequestConfig & { _retry?: boolean }
    if (err.response?.status !== 401 || orig._retry) return Promise.reject(err)
    if (isRefreshing) {
      return new Promise((resolve, reject) => { pendingQueue.push({ resolve, reject, cfg: orig }) })
    }
    orig._retry = true
    isRefreshing = true
    try {
      const newToken = await forceRefreshAccessToken()
      pendingQueue.forEach((p) => {
        if (p.cfg.headers) (p.cfg.headers as Record<string, string>).Authorization = `Bearer ${newToken}`
        p.resolve(apiClient(p.cfg))
      })
      pendingQueue = []
      if (orig.headers) (orig.headers as Record<string, string>).Authorization = `Bearer ${newToken}`
      return apiClient(orig)
    } catch (e) {
      pendingQueue.forEach((p) => p.reject(e)); pendingQueue = []
      clearTokens()
      const base = import.meta.env.BASE_URL?.replace(/\/+$/, '') || ''
      window.location.href = `${base}/auth/login`
      return Promise.reject(e)
    } finally { isRefreshing = false }
  },
)

/* ── Helpers ────────────────────── */

export const toErrorMessage = (e: unknown): string => {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as Record<string, unknown> | undefined
    if (d?.message && typeof d.message === 'string') return d.message
    if (d?.detail && typeof d.detail === 'string') return d.detail
    return e.message
  }
  if (e instanceof Error) return e.message
  return String(e)
}

export async function requestApi<T>(cfg: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await apiClient(cfg)
  return data as ApiEnvelope<T>
}

export async function requestData<T>(cfg: AxiosRequestConfig): Promise<T> {
  const { data } = await apiClient(cfg)
  const env = data as ApiEnvelope<T>
  return env.data !== undefined ? env.data : (data as T)
}

export default apiClient
