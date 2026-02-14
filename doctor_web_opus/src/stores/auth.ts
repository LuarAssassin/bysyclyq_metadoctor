import { create } from 'zustand'
import { authApi } from '@/lib/api'
import {
  clearTokens,
  getAccessToken,
  getLastUsername,
  getPendingMessage,
  getRefreshToken,
  setLastUsername,
  setPendingMessage as persistPendingMessage,
  setTokens,
} from '@/lib/storage'

interface AuthState {
  accessToken: string
  refreshToken: string
  username: string
  pendingMessage: string
  isAuthenticated: boolean
  syncFromStorage: () => void
  sendCode: (channel: 'sms' | 'email', target: string) => Promise<{ expireSeconds: number; target: string }>
  loginByCode: (payload: { channel: 'sms' | 'email'; target: string; code: string }) => Promise<void>
  registerByCode: (payload: {
    channel: 'sms' | 'email'; target: string; code: string
    nickname: string; institution?: string; profession?: string
  }) => Promise<string>
  logout: () => void
  setPendingMessage: (msg: string) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: getAccessToken(),
  refreshToken: getRefreshToken(),
  username: getLastUsername(),
  pendingMessage: getPendingMessage(),
  isAuthenticated: Boolean(getAccessToken() && getRefreshToken()),

  syncFromStorage: () => {
    const a = getAccessToken()
    const r = getRefreshToken()
    set({
      accessToken: a,
      refreshToken: r,
      username: getLastUsername(),
      pendingMessage: getPendingMessage(),
      isAuthenticated: Boolean(a && r),
    })
  },

  sendCode: async (channel, target) => {
    const res = await authApi.sendCode({ channel, target })
    return {
      expireSeconds: res.data.expire_seconds,
      target: res.data.target,
    }
  },

  loginByCode: async (payload) => {
    const res = await authApi.loginByCode(payload)
    const data = res.data
    setTokens(data.access, data.refresh)
    setLastUsername(data.login_target)
    set({
      accessToken: data.access,
      refreshToken: data.refresh,
      username: data.login_target,
      pendingMessage: '',
      isAuthenticated: true,
    })
    persistPendingMessage('')
  },

  registerByCode: async (payload) => {
    const res = await authApi.registerByCode(payload)
    return res.message
  },

  logout: () => {
    clearTokens()
    persistPendingMessage('')
    set({ accessToken: '', refreshToken: '', pendingMessage: '', isAuthenticated: false })
  },

  setPendingMessage: (msg) => {
    persistPendingMessage(msg)
    set({ pendingMessage: msg })
  },
}))
