import { requestApi, requestData } from './http'
import type {
  AvatarVideo,
  AvatarVideoBatchResult,
  DoctorApplication,
  FeedbackApplyResult,
  KnowledgeIndexItem,
  KnowledgeItem,
  KnowledgeTagSummary,
  KnowledgeUploadResult,
  LoginTokens,
  MarkdownSaveResult,
  NarrativeAnnotation,
  NarrativeAnnotationCreateResult,
  NarrativeKernel,
  NarrativeRedlineMutationResult,
  NarrativeRedlines,
  PageResult,
  RehearsalFeedback,
  RehearsalMessageListPayload,
  RehearsalPlaybackAssets,
  RehearsalSession,
  RefreshTokenPayload,
  VoiceProfile,
} from '@/types/api'

/* ============================
   认证
   ============================ */

export const authApi = {
  register: (p: {
    username: string
    password: string
    email: string
    phone: string
    nickname: string
    institution: string
    profession: string
  }) => requestApi<DoctorApplication>({ method: 'POST', url: '/auth/doctor/register/', data: p }),

  login: (p: { username: string; password: string }) =>
    requestApi<LoginTokens>({ method: 'POST', url: '/auth/login/', data: p }),

  refreshToken: (refresh: string) =>
    requestData<RefreshTokenPayload>({ method: 'POST', url: '/auth/token/refresh/', data: { refresh } }),
}

/* ============================
   知识库
   ============================ */

export const knowledgeApi = {
  upload: (files: File[]) => {
    const fd = new FormData()
    if (files.length === 1) fd.append('file', files[0]!)
    else files.forEach((f) => fd.append('files', f))
    return requestApi<KnowledgeUploadResult>({ method: 'POST', url: '/doctor/knowledge/', data: fd })
  },

  list: (params: { page?: number; page_size?: number }) =>
    requestData<PageResult<KnowledgeItem>>({ method: 'GET', url: '/doctor/knowledge/', params }),

  indexes: () =>
    requestData<KnowledgeIndexItem[]>({ method: 'GET', url: '/doctor/knowledge/indexes/' }),

  tags: () =>
    requestData<KnowledgeTagSummary[]>({ method: 'GET', url: '/doctor/knowledge/tags/' }),

  extract: (id: number) =>
    requestApi<KnowledgeItem>({ method: 'POST', url: `/doctor/knowledge/${id}/extract/` }),

  remove: (id: number) =>
    requestApi<null>({ method: 'DELETE', url: `/doctor/knowledge/${id}/` }),
}

/* ============================
   数字人素材
   ============================ */

export const digitalHumanApi = {
  createVoice: (p: { audio: File; name?: string; preferred_name?: string; target_model?: string; set_active?: boolean }) => {
    const fd = new FormData()
    fd.append('audio', p.audio)
    if (p.name) fd.append('name', p.name)
    if (p.preferred_name) fd.append('preferred_name', p.preferred_name)
    if (p.target_model) fd.append('target_model', p.target_model)
    if (p.set_active !== undefined) fd.append('set_active', String(p.set_active))
    return requestApi<VoiceProfile>({ method: 'POST', url: '/doctor/digital-human/voice/', data: fd })
  },

  listVoice: () =>
    requestData<VoiceProfile[]>({ method: 'GET', url: '/doctor/digital-human/voice/' }),

  createVideos: (p: {
    image: File; prompt?: string; negative_prompt?: string; duration?: number
    resolution?: string; model?: string; generate_count?: number
    prompt_extend?: boolean; watermark?: boolean; seed?: number
  }) => {
    const fd = new FormData()
    fd.append('image', p.image)
    if (p.prompt) fd.append('prompt', p.prompt)
    if (p.negative_prompt) fd.append('negative_prompt', p.negative_prompt)
    if (p.duration !== undefined) fd.append('duration', String(p.duration))
    if (p.resolution) fd.append('resolution', p.resolution)
    if (p.model) fd.append('model', p.model)
    if (p.generate_count !== undefined) fd.append('generate_count', String(p.generate_count))
    if (p.prompt_extend !== undefined) fd.append('prompt_extend', String(p.prompt_extend))
    if (p.watermark !== undefined) fd.append('watermark', String(p.watermark))
    if (p.seed !== undefined) fd.append('seed', String(p.seed))
    return requestApi<AvatarVideoBatchResult>({ method: 'POST', url: '/doctor/digital-human/videos/', data: fd })
  },

  listVideos: () =>
    requestData<AvatarVideo[]>({ method: 'GET', url: '/doctor/digital-human/videos/' }),

  refreshVideo: (id: number) =>
    requestApi<AvatarVideo>({ method: 'POST', url: `/doctor/digital-human/videos/${id}/refresh/` }),
}

/* ============================
   叙事底座
   ============================ */

export const narrativeApi = {
  getKernel: () =>
    requestApi<NarrativeKernel>({ method: 'GET', url: '/doctor/narrative-kernel/' }),

  replaceKernel: (payload: Record<string, unknown>, note = '') =>
    requestApi<NarrativeKernel>({ method: 'PUT', url: '/doctor/narrative-kernel/', data: { payload, note } }),

  patchKernel: (changes: Record<string, unknown>, note = '') =>
    requestApi<NarrativeKernel>({ method: 'PATCH', url: '/doctor/narrative-kernel/', data: { changes, note } }),

  createAnnotation: (p: {
    source?: string; question?: string; answer?: string; comment: string
    negative_rules?: string[]; delta?: Record<string, unknown>
  }) => requestApi<NarrativeAnnotationCreateResult>({ method: 'POST', url: '/doctor/narrative-kernel/annotations/', data: p }),

  listAnnotations: (limit = 20) =>
    requestData<NarrativeAnnotation[]>({ method: 'GET', url: '/doctor/narrative-kernel/annotations/', params: { limit } }),

  getRedlines: () =>
    requestData<NarrativeRedlines>({ method: 'GET', url: '/doctor/narrative-kernel/redlines/' }),

  addRedlines: (rules: string[], comment = '') =>
    requestApi<NarrativeRedlineMutationResult>({ method: 'POST', url: '/doctor/narrative-kernel/redlines/', data: { rules, comment } }),

  removeRedlines: (rules: string[]) =>
    requestApi<NarrativeRedlineMutationResult>({ method: 'DELETE', url: '/doctor/narrative-kernel/redlines/', data: { rules } }),
}

/* ============================
   AI 问诊演练
   ============================ */

export const rehearsalApi = {
  createSession: (title = '') =>
    requestApi<RehearsalSession>({ method: 'POST', url: '/doctor/rehearsal/sessions/', data: { title } }),

  listSessions: () =>
    requestData<RehearsalSession[]>({ method: 'GET', url: '/doctor/rehearsal/sessions/' }),

  listMessages: (sessionId: number, limit = 100) =>
    requestData<RehearsalMessageListPayload>({
      method: 'GET',
      url: `/doctor/rehearsal/sessions/${sessionId}/messages/`,
      params: { limit },
    }),

  getPlaybackAssets: () =>
    requestData<RehearsalPlaybackAssets>({ method: 'GET', url: '/doctor/rehearsal/playback-assets/' }),

  saveMarkdown: (messageId: number, markdown: string) =>
    requestApi<MarkdownSaveResult>({
      method: 'PATCH',
      url: `/doctor/rehearsal/messages/${messageId}/markdown/`,
      data: { markdown },
    }),

  submitFeedback: (messageId: number, p: { comment: string; edited_markdown?: string; apply_to_kernel?: boolean }) =>
    requestApi<FeedbackApplyResult | RehearsalFeedback>({
      method: 'POST',
      url: `/doctor/rehearsal/messages/${messageId}/feedback/`,
      data: p,
    }),
}
