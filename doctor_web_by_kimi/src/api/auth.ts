import request from '@/utils/request'
import type { LoginForm, RegisterForm, TokenPair, DoctorInfo } from '@/types'

export const login = (data: LoginForm): Promise<TokenPair> => {
  return request.post('/auth/login/', data)
}

export const register = (data: RegisterForm): Promise<DoctorInfo> => {
  return request.post('/auth/doctor/register/', data)
}

export const refreshToken = (refresh: string): Promise<TokenPair> => {
  return request.post('/auth/token/refresh/', { refresh })
}
