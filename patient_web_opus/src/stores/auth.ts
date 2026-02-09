import { create } from 'zustand'
import { authApi } from '@/lib/api'
import { clearTokens, getAccessToken, getRefreshToken, getUsername, setTokens, setUsername } from '@/lib/storage'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  username: string
  isAuthenticated: boolean

  login: (username: string, password: string) => Promise<void>
  register: (p: { username: string; password: string; nickname?: string; phone?: string; email?: string }) => Promise<void>
  logout: () => void
  syncFromStorage: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: getAccessToken(),
  refreshToken: getRefreshToken(),
  username: getUsername(),
  isAuthenticated: !!getAccessToken(),

  login: async (u, p) => {
    const res = await authApi.login({ username: u, password: p })
    const tokens = res.data
    setTokens(tokens.access, tokens.refresh)
    setUsername(u)
    set({ accessToken: tokens.access, refreshToken: tokens.refresh, username: u, isAuthenticated: true })
  },

  register: async (params) => {
    await authApi.register(params)
  },

  logout: () => {
    clearTokens()
    set({ accessToken: null, refreshToken: null, username: '', isAuthenticated: false })
  },

  syncFromStorage: () => {
    const a = getAccessToken()
    set({ accessToken: a, refreshToken: getRefreshToken(), username: getUsername(), isAuthenticated: !!a })
  },
}))
