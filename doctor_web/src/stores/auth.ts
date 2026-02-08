import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi, type LoginPayload, type RegisterDoctorPayload } from '../services/api'
import {
  clearTokens,
  getAccessToken,
  getLastUsername,
  getRefreshToken,
  setLastUsername,
  setTokens,
} from '../utils/storage'

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref(getAccessToken())
  const refreshToken = ref(getRefreshToken())
  const username = ref(getLastUsername())
  const pendingLoginMessage = ref('')

  const isAuthenticated = computed(() => Boolean(accessToken.value && refreshToken.value))

  const syncFromStorage = () => {
    accessToken.value = getAccessToken()
    refreshToken.value = getRefreshToken()
    username.value = getLastUsername()
  }

  const setAuth = (tokens: { access: string; refresh: string }, currentUsername: string) => {
    accessToken.value = tokens.access
    refreshToken.value = tokens.refresh
    username.value = currentUsername
    setTokens(tokens.access, tokens.refresh)
    setLastUsername(currentUsername)
    pendingLoginMessage.value = ''
  }

  const clearAuth = () => {
    accessToken.value = ''
    refreshToken.value = ''
    pendingLoginMessage.value = ''
    clearTokens()
  }

  const login = async (payload: LoginPayload) => {
    const result = await authApi.login(payload)
    setAuth(result.data, payload.username)
    return result
  }

  const register = (payload: RegisterDoctorPayload) => authApi.register(payload)

  return {
    accessToken,
    refreshToken,
    username,
    pendingLoginMessage,
    isAuthenticated,
    syncFromStorage,
    setAuth,
    clearAuth,
    login,
    register,
  }
})
