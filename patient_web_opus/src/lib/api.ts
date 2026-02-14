import { requestApi, requestData } from './http'
import type {
  DoctorAssets,
  DoctorInfo,
  LoginTokens,
  MessageListPayload,
  PatientCodeLoginPayload,
  PatientCodeSendResult,
  PatientAsrResult,
  PatientProfile,
  PatientSession,
  RefreshTokenPayload,
  UserProfile,
} from '@/types/api'

/* ── 认证 ─────────────────────── */

export const authApi = {
  register: (p: { username: string; password: string; email?: string; phone?: string; nickname?: string }) =>
    requestApi<PatientProfile>({ method: 'POST', url: '/auth/patient/register/', data: p }),

  login: (p: { username: string; password: string }) =>
    requestApi<LoginTokens>({ method: 'POST', url: '/auth/login/', data: p }),

  sendCode: (p: { channel: 'sms' | 'email'; target: string }) =>
    requestApi<PatientCodeSendResult>({
      method: 'POST',
      url: '/auth/patient/code/send/',
      data: p,
    }),

  loginByCode: (p: { channel: 'sms' | 'email'; target: string; code: string; nickname?: string }) =>
    requestApi<PatientCodeLoginPayload>({
      method: 'POST',
      url: '/auth/patient/code/login/',
      data: p,
    }),

  refreshToken: (refresh: string) =>
    requestData<RefreshTokenPayload>({ method: 'POST', url: '/auth/token/refresh/', data: { refresh } }),
}

export const userApi = {
  getMe: () =>
    requestData<UserProfile>({ method: 'GET', url: '/auth/me/' }),

  uploadAvatar: (image: File) => {
    const fd = new FormData()
    fd.append('image', image)
    return requestApi<UserProfile>({ method: 'POST', url: '/auth/me/avatar/', data: fd })
  },

  updateMe: (payload: Partial<Pick<
    UserProfile,
    'nickname' | 'email' | 'phone' | 'gender' | 'birthday' | 'institution' | 'profession' | 'address'
  >>) =>
    requestApi<UserProfile>({ method: 'PATCH', url: '/auth/me/', data: payload }),
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

  setPinned: (sessionId: number, isPinned: boolean) =>
    requestApi<PatientSession>({
      method: 'PATCH',
      url: `/patient/sessions/${sessionId}/`,
      data: { is_pinned: isPinned },
    }),

  remove: (sessionId: number) =>
    requestApi<null>({ method: 'DELETE', url: `/patient/sessions/${sessionId}/` }),

  interruptMessage: (sessionId: number, messageId: number, partialContent: string) =>
    requestApi({
      method: 'POST',
      url: `/patient/sessions/${sessionId}/messages/${messageId}/interrupt/`,
      data: { partial_content: partialContent },
    }),

  transcribeAudio: (audio: Blob, fileName: string) => {
    const fd = new FormData()
    fd.append('audio', audio, fileName)
    return requestData<PatientAsrResult>({
      method: 'POST',
      url: '/patient/asr/transcribe/',
      data: fd,
    })
  },

  messages: (sessionId: number, limit = 100) =>
    requestData<MessageListPayload>({ method: 'GET', url: `/patient/sessions/${sessionId}/messages/`, params: { limit } }),
}
