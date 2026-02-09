const ACCESS_KEY = 'md_access_token'
const REFRESH_KEY = 'md_refresh_token'
const USERNAME_KEY = 'md_last_username'

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

export const clearTokens = () => {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}
