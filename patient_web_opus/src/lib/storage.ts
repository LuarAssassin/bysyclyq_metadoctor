const ACCESS  = 'pt_access_token'
const REFRESH = 'pt_refresh_token'
const USER    = 'pt_username'

export const getAccessToken  = () => localStorage.getItem(ACCESS)
export const getRefreshToken = () => localStorage.getItem(REFRESH)
export const setTokens       = (a: string, r: string) => { localStorage.setItem(ACCESS, a); localStorage.setItem(REFRESH, r) }
export const clearTokens     = () => { localStorage.removeItem(ACCESS); localStorage.removeItem(REFRESH) }
export const getUsername      = () => localStorage.getItem(USER) || ''
export const setUsername      = (u: string) => localStorage.setItem(USER, u)
