import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import type { ApiEnvelope } from '../types/api'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '../utils/storage'

export interface ApiResult<T> {
  code: number
  message: string
  data: T
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
})

const isApiEnvelope = <T>(value: unknown): value is ApiEnvelope<T> => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const maybe = value as Record<string, unknown>
  return typeof maybe.code === 'number' && typeof maybe.message === 'string' && 'data' in maybe
}

const resolveEnvelope = <T>(payload: unknown): ApiResult<T> => {
  if (isApiEnvelope<T>(payload)) {
    return payload
  }
  return {
    code: 200,
    message: '操作成功',
    data: payload as T,
  }
}

const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
})

let refreshing = false
let waitingQueue: Array<{
  resolve: (token: string) => void
  reject: (error: unknown) => void
}> = []

const flushQueue = (token: string | null, error?: unknown): void => {
  waitingQueue.forEach((item) => {
    if (token) {
      item.resolve(token)
    } else {
      item.reject(error)
    }
  })
  waitingQueue = []
}

const requestNewAccessToken = async (): Promise<string> => {
  const refresh = getRefreshToken()
  if (!refresh) {
    throw new Error('登录已失效，请重新登录')
  }

  const response = await refreshClient.post<ApiEnvelope<{ access: string }>>(
    '/auth/token/refresh/',
    { refresh },
  )
  const envelope = resolveEnvelope<{ access: string }>(response.data)
  const accessToken = envelope.data?.access
  if (!accessToken) {
    throw new Error('刷新 token 失败')
  }
  setTokens(accessToken, refresh)
  return accessToken
}

export const forceRefreshAccessToken = async (): Promise<string> => {
  const token = await requestNewAccessToken()
  return token
}

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const access = getAccessToken()
  if (access) {
    config.headers.Authorization = `Bearer ${access}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean }
    const requestUrl = String(originalRequest?.url ?? '')
    const statusCode = error.response?.status
    const skipRefresh =
      requestUrl.includes('/auth/login/') ||
      requestUrl.includes('/auth/token/refresh/') ||
      requestUrl.includes('/auth/doctor/register/')

    if (statusCode !== 401 || !originalRequest || originalRequest._retry || skipRefresh) {
      throw error
    }

    if (refreshing) {
      return await new Promise((resolve, reject) => {
        waitingQueue.push({
          resolve: (token: string) => {
            originalRequest.headers = originalRequest.headers ?? {}
            ;(originalRequest.headers as Record<string, string>).Authorization = `Bearer ${token}`
            resolve(apiClient(originalRequest))
          },
          reject,
        })
      })
    }

    originalRequest._retry = true
    refreshing = true
    try {
      const accessToken = await requestNewAccessToken()
      flushQueue(accessToken)
      originalRequest.headers = originalRequest.headers ?? {}
      ;(originalRequest.headers as Record<string, string>).Authorization = `Bearer ${accessToken}`
      return await apiClient(originalRequest)
    } catch (refreshError) {
      flushQueue(null, refreshError)
      clearTokens()
      throw refreshError
    } finally {
      refreshing = false
    }
  },
)

export const requestApi = async <T>(config: AxiosRequestConfig): Promise<ApiResult<T>> => {
  const response = await apiClient.request<ApiEnvelope<T>>(config)
  return resolveEnvelope<T>(response.data)
}

export const requestData = async <T>(config: AxiosRequestConfig): Promise<T> => {
  const envelope = await requestApi<T>(config)
  return envelope.data
}

export const getApiBaseUrl = (): string => API_BASE_URL
