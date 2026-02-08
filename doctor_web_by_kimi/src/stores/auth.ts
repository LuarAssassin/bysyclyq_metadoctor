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
  // 如果 userInfo 为 null，默认认为是已审核（向后兼容）
  // 后续可以通过 /auth/me/ 接口获取用户信息
  const isApproved = computed(() => {
    if (!userInfo.value) return true // 默认允许，避免误判
    return userInfo.value.doctor_apply_status === 'approved'
  })

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
      // 尝试从 /auth/me/ 获取用户信息
      const { getCurrentUser } = await import('@/api/auth')
      const user = await getCurrentUser()
      userInfo.value = user
      return user
    } catch {
      // 如果接口不存在或失败，静默处理，不阻塞登录
      // isApproved 会默认返回 true
      return null
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
