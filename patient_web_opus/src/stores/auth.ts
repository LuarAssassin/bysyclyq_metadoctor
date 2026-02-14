import { create } from 'zustand'
import { authApi } from '@/lib/api'
import { clearTokens, getAccessToken, getRefreshToken, getUsername, setTokens, setUsername } from '@/lib/storage'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  username: string
  isAuthenticated: boolean

  sendCode: (channel: 'sms' | 'email', target: string) => Promise<{ expireSeconds: number; target: string }>
  loginByCode: (p: { channel: 'sms' | 'email'; target: string; code: string; nickname?: string }) => Promise<void>
  loginByGoogle: (credential: string) => Promise<void>
  logout: () => void
  syncFromStorage: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: getAccessToken(),
  refreshToken: getRefreshToken(),
  username: getUsername(),
  isAuthenticated: !!getAccessToken(),

  sendCode: async (channel, target) => {
    const res = await authApi.sendCode({ channel, target })
    return {
      expireSeconds: res.data.expire_seconds,
      target: res.data.target,
    }
  },

  loginByCode: async (params) => {
    const res = await authApi.loginByCode(params)
    const data = res.data
    setTokens(data.access, data.refresh)
    setUsername(data.login_target)
    set({
      accessToken: data.access,
      refreshToken: data.refresh,
      username: data.login_target,
      isAuthenticated: true,
    })
  },

  loginByGoogle: async (credential) => {
    const res = await authApi.googleLogin(credential)
    const data = res.data
    setTokens(data.access, data.refresh)
    setUsername(data.login_target)
    set({
      accessToken: data.access,
      refreshToken: data.refresh,
      username: data.login_target,
      isAuthenticated: true,
    })
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
