import { create } from 'zustand'
import { authApi } from '@/lib/api'
import {
  clearTokens,
  getAccessToken,
  getLastUsername,
  getRefreshToken,
  setLastUsername,
  setTokens,
} from '@/lib/storage'

interface AuthState {
  accessToken: string
  refreshToken: string
  username: string
  pendingMessage: string
  isAuthenticated: boolean
  syncFromStorage: () => void
  login: (username: string, password: string) => Promise<void>
  register: (payload: {
    username: string; password: string; email: string; phone: string
    nickname: string; institution: string; profession: string
  }) => Promise<string>
  logout: () => void
  setPendingMessage: (msg: string) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: getAccessToken(),
  refreshToken: getRefreshToken(),
  username: getLastUsername(),
  pendingMessage: '',
  isAuthenticated: Boolean(getAccessToken() && getRefreshToken()),

  syncFromStorage: () => {
    const a = getAccessToken()
    const r = getRefreshToken()
    set({ accessToken: a, refreshToken: r, username: getLastUsername(), isAuthenticated: Boolean(a && r) })
  },

  login: async (username, password) => {
    const res = await authApi.login({ username, password })
    setTokens(res.data.access, res.data.refresh)
    setLastUsername(username)
    set({
      accessToken: res.data.access,
      refreshToken: res.data.refresh,
      username,
      pendingMessage: '',
      isAuthenticated: true,
    })
  },

  register: async (payload) => {
    const res = await authApi.register(payload)
    return res.message
  },

  logout: () => {
    clearTokens()
    set({ accessToken: '', refreshToken: '', pendingMessage: '', isAuthenticated: false })
  },

  setPendingMessage: (msg) => set({ pendingMessage: msg }),
}))
