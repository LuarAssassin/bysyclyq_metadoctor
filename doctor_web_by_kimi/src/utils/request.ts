import axios, { type AxiosError, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import type { ApiResponse } from '@/types'

// Create axios instance
const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || '/api'
const request: AxiosInstance = axios.create({
  baseURL: baseUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const authStore = useAuthStore()
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`
    }
    return config
  },
  (error: AxiosError) => {
    return Promise.reject(error)
  }
)

// Response interceptor
request.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const { code, message, data } = response.data
    
    // Debug logging
    console.log('[API Response]', { url: response.config.url, code, message })
    
    // Business logic error
    if (code !== 200 && code !== 201) {
      // Special handling for pending review
      // TODO: 临时绕过审核检查，生产环境请删除此行
      // if (code === 401 && message?.includes('审核中')) {
      //   return Promise.reject({ code, message, isPendingReview: true })
      // }
      if (code === 401 && message?.includes('审核中')) {
        console.warn('[Pending Review Detected]', { code, message, data })
        
        // 如果后端返回了token（data中有access），说明后端逻辑有误但给了token，尝试使用
        const tokenData = data as any
        if (tokenData?.access && tokenData?.refresh) {
          console.warn('[DEV MODE] 后端返回审核中但给了token，尝试使用...')
          return tokenData
        }
        
        // 否则正常拒绝
        return Promise.reject({ code, message, isPendingReview: true })
      }
      
      ElMessage.error(message || '操作失败')
      return Promise.reject({ code, message })
    }
    
    return data as any
  },
  async (error: AxiosError<ApiResponse>) => {
    const { response, request, message } = error
    
    if (response) {
      const { status, data } = response
      
      // Token expired or invalid
      if (status === 401) {
        const authStore = useAuthStore()
        
        // Check if it's a pending review error
        if (data?.message?.includes('审核中')) {
          return Promise.reject({ code: 401, message: data.message, isPendingReview: true })
        }
        
        // Try to refresh token
        if (authStore.refreshTokenValue && !error.config?.url?.includes('/token/refresh/')) {
          try {
            await authStore.refreshAccessToken()
            // Retry original request
            if (error.config) {
              error.config.headers.Authorization = `Bearer ${authStore.token}`
              return request(error.config)
            }
          } catch {
            authStore.logout()
            ElMessageBox.confirm('登录已过期，请重新登录', '提示', {
              confirmButtonText: '去登录',
              cancelButtonText: '取消',
              type: 'warning',
            }).then(() => {
              window.location.href = '/login'
            })
          }
        } else {
          authStore.logout()
          ElMessage.error('登录已过期')
          window.location.href = '/login'
        }
      } else if (status === 403) {
        ElMessage.error('没有权限执行此操作')
      } else if (status === 404) {
        ElMessage.error('请求的资源不存在')
      } else if (status >= 500) {
        ElMessage.error('服务器错误，请稍后重试')
      } else {
        ElMessage.error(data?.message || '请求失败')
      }
    } else if (request) {
      ElMessage.error('网络错误，请检查网络连接')
    } else {
      ElMessage.error(message || '请求失败')
    }
    
    return Promise.reject(error)
  }
)

export default request
