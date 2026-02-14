import axios, {
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { ApiEnvelope } from '@/types/api'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './storage'

export interface ApiResult<T> {
  code: number
  message: string
  data: T
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60_000,
})

/* ── helpers ────────────────────────────────────── */

const isEnvelope = <T>(v: unknown): v is ApiEnvelope<T> => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.code === 'number' && typeof o.message === 'string' && 'data' in o
}

const resolveEnvelope = <T>(payload: unknown): ApiResult<T> => {
  if (isEnvelope<T>(payload)) return payload
  return { code: 200, message: '操作成功', data: payload as T }
}

/* ── silent-refresh ─────────────────────────────── */

const refreshAxios = axios.create({ baseURL: API_BASE_URL, timeout: 30_000 })

let refreshing = false
let queue: Array<{
  resolve: (t: string) => void
  reject: (e: unknown) => void
}> = []

const flushQueue = (token: string | null, error?: unknown) => {
  queue.forEach((p) => (token ? p.resolve(token) : p.reject(error)))
  queue = []
}

const doRefresh = async (): Promise<string> => {
  const refresh = getRefreshToken()
  if (!refresh) throw new Error('登录已失效，请重新登录')
  const res = await refreshAxios.post<ApiEnvelope<{ access: string }>>(
    '/auth/token/refresh/',
    { refresh },
  )
  const env = resolveEnvelope<{ access: string }>(res.data)
  const access = env.data?.access
  if (!access) throw new Error('刷新 token 失败')
  setTokens(access, refresh)
  return access
}

export const forceRefreshAccessToken = () => doRefresh()

/* ── interceptors ───────────────────────────────── */

apiClient.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

apiClient.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean }
    const url = String(original?.url ?? '')
    const skip =
      url.includes('/auth/login/') ||
      url.includes('/auth/token/refresh/') ||
      url.includes('/auth/doctor/register/') ||
      url.includes('/auth/doctor/code/send/') ||
      url.includes('/auth/doctor/code/register/') ||
      url.includes('/auth/doctor/code/login/')
    if (error.response?.status !== 401 || !original || original._retry || skip)
      throw error

    if (refreshing) {
      return new Promise((resolve, reject) => {
        queue.push({
          resolve: (token) => {
            original.headers = original.headers ?? {}
            ;(original.headers as Record<string, string>).Authorization = `Bearer ${token}`
            resolve(apiClient(original))
          },
          reject,
        })
      })
    }

    original._retry = true
    refreshing = true
    try {
      const token = await doRefresh()
      flushQueue(token)
      original.headers = original.headers ?? {}
      ;(original.headers as Record<string, string>).Authorization = `Bearer ${token}`
      return apiClient(original)
    } catch (e) {
      flushQueue(null, e)
      clearTokens()
      throw e
    } finally {
      refreshing = false
    }
  },
)

/* ── public helpers ─────────────────────────────── */

export const requestApi = async <T>(cfg: AxiosRequestConfig): Promise<ApiResult<T>> => {
  const res = await apiClient.request<ApiEnvelope<T>>(cfg)
  return resolveEnvelope<T>(res.data)
}

export const requestData = async <T>(cfg: AxiosRequestConfig): Promise<T> => {
  const env = await requestApi<T>(cfg)
  return env.data
}

export const getApiBaseUrl = (): string => API_BASE_URL

/* ── error extractor ────────────────────────────── */

export const toErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data
    if (data && typeof data === 'object' && 'message' in data) {
      return String((data as { message: string }).message)
    }
    if (typeof data === 'string' && data.length < 300) return data
    return error.message || '请求失败'
  }
  if (error instanceof Error) return error.message
  return String(error)
}
