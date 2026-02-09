import { requestApi, requestData } from './http'
import type {
  DoctorAssets,
  DoctorInfo,
  LoginTokens,
  MessageListPayload,
  PatientProfile,
  PatientSession,
  RefreshTokenPayload,
} from '@/types/api'

/* ── 认证 ─────────────────────── */

export const authApi = {
  register: (p: { username: string; password: string; email?: string; phone?: string; nickname?: string }) =>
    requestApi<PatientProfile>({ method: 'POST', url: '/auth/patient/register/', data: p }),

  login: (p: { username: string; password: string }) =>
    requestApi<LoginTokens>({ method: 'POST', url: '/auth/login/', data: p }),

  refreshToken: (refresh: string) =>
    requestData<RefreshTokenPayload>({ method: 'POST', url: '/auth/token/refresh/', data: { refresh } }),
}

/* ── 医生目录 ─────────────────── */

export const doctorApi = {
  list: () =>
    requestData<DoctorInfo[]>({ method: 'GET', url: '/patient/doctors/' }),

  getAssets: (doctorId: number) =>
    requestData<DoctorAssets>({ method: 'GET', url: `/patient/doctors/${doctorId}/assets/` }),
}

/* ── 问诊会话 ─────────────────── */

export const sessionApi = {
  create: (doctorId: number, title?: string) =>
    requestApi<PatientSession>({ method: 'POST', url: '/patient/sessions/', data: { doctor_id: doctorId, title } }),

  list: () =>
    requestData<PatientSession[]>({ method: 'GET', url: '/patient/sessions/' }),

  messages: (sessionId: number, limit = 100) =>
    requestData<MessageListPayload>({ method: 'GET', url: `/patient/sessions/${sessionId}/messages/`, params: { limit } }),
}
