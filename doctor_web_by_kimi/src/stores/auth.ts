import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { login as loginApi, register as registerApi, refreshToken } from '@/api/auth'
import type { LoginForm, RegisterForm, DoctorInfo, TokenPair } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  // State
  const token = ref<string>(localStorage.getItem('access_token') || '')
  const refreshTokenValue = ref<string>(localStorage.getItem('refresh_token') || '')
  const userInfo = ref<DoctorInfo | null>(null)
  const isPendingReview = ref(false)

  // Getters
  const isLoggedIn = computed(() => !!token.value)
  const isApproved = computed(() => userInfo.value?.doctor_apply_status === 'approved')

  // Actions
  const setTokens = (tokens: TokenPair) => {
    token.value = tokens.access
    refreshTokenValue.value = tokens.refresh
    localStorage.setItem('access_token', tokens.access)
    localStorage.setItem('refresh_token', tokens.refresh)
  }

  const clearTokens = () => {
    token.value = ''
    refreshTokenValue.value = ''
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  }

  const login = async (form: LoginForm) => {
    try {
      isPendingReview.value = false
      const response = await loginApi(form)
      setTokens(response)
      // Fetch user info after login
      await fetchUserInfo()
      return true
    } catch (error: any) {
      if (error.isPendingReview) {
        isPendingReview.value = true
      }
      throw error
    }
  }

  const register = async (form: RegisterForm) => {
    const response = await registerApi(form)
    return response
  }

  const fetchUserInfo = async () => {
    try {
      // User info is returned in login response or can be fetched separately
      // For now, we'll decode from token or fetch from a separate endpoint if needed
      // This is a placeholder - actual implementation depends on backend
      return userInfo.value
    } catch {
      logout()
      throw new Error('获取用户信息失败')
    }
  }

  const refreshAccessToken = async () => {
    try {
      const response = await refreshToken(refreshTokenValue.value)
      setTokens(response)
      return response
    } catch {
      logout()
      throw new Error('刷新令牌失败')
    }
  }

  const logout = () => {
    clearTokens()
    userInfo.value = null
    isPendingReview.value = false
  }

  const init = () => {
    // Restore from localStorage
    const access = localStorage.getItem('access_token')
    const refresh = localStorage.getItem('refresh_token')
    if (access && refresh) {
      token.value = access
      refreshTokenValue.value = refresh
    }
  }

  return {
    token,
    refreshTokenValue,
    userInfo,
    isPendingReview,
    isLoggedIn,
    isApproved,
    login,
    register,
    logout,
    refreshAccessToken,
    init,
    setTokens,
  }
})
