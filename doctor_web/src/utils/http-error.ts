import type { AxiosError } from 'axios'
import type { ApiEnvelope } from '../types/api'

const DEFAULT_MESSAGE = '请求失败，请稍后重试'

export const toErrorMessage = (error: unknown): string => {
  const axiosError = error as AxiosError<ApiEnvelope<unknown>>
  const maybeMessage = axiosError?.response?.data?.message
  if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
    return maybeMessage
  }

  if (axiosError?.message) {
    return axiosError.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return DEFAULT_MESSAGE
}
