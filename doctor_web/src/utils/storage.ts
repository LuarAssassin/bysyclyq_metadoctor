export const ACCESS_TOKEN_KEY = 'doctor_web_access_token'
export const REFRESH_TOKEN_KEY = 'doctor_web_refresh_token'
export const LAST_USERNAME_KEY = 'doctor_web_last_username'

export const getAccessToken = (): string => localStorage.getItem(ACCESS_TOKEN_KEY) ?? ''

export const getRefreshToken = (): string => localStorage.getItem(REFRESH_TOKEN_KEY) ?? ''

export const setTokens = (access: string, refresh: string): void => {
  localStorage.setItem(ACCESS_TOKEN_KEY, access)
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh)
}

export const clearTokens = (): void => {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export const setLastUsername = (username: string): void => {
  localStorage.setItem(LAST_USERNAME_KEY, username)
}

export const getLastUsername = (): string => localStorage.getItem(LAST_USERNAME_KEY) ?? ''
