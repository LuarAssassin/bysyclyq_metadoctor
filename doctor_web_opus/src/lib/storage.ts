const ACCESS_KEY = 'md_access_token'
const REFRESH_KEY = 'md_refresh_token'
const USERNAME_KEY = 'md_last_username'
const PENDING_MESSAGE_KEY = 'md_doctor_pending_message'

export const getAccessToken = (): string => localStorage.getItem(ACCESS_KEY) ?? ''
export const getRefreshToken = (): string => localStorage.getItem(REFRESH_KEY) ?? ''
export const getLastUsername = (): string => localStorage.getItem(USERNAME_KEY) ?? ''

export const setTokens = (access: string, refresh: string) => {
  localStorage.setItem(ACCESS_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}

export const setLastUsername = (username: string) => {
  localStorage.setItem(USERNAME_KEY, username)
}

export const getPendingMessage = (): string => sessionStorage.getItem(PENDING_MESSAGE_KEY) ?? ''

export const setPendingMessage = (message: string) => {
  const normalized = String(message || '').trim()
  if (normalized) {
    sessionStorage.setItem(PENDING_MESSAGE_KEY, normalized)
    return
  }
  sessionStorage.removeItem(PENDING_MESSAGE_KEY)
}

export const clearTokens = () => {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}
