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
  RehearsalMessageListPayload,
  RehearsalPlaybackAssets,
  RehearsalSession,
  RefreshTokenPayload,
  RehearsalFeedback,
  VoiceProfile,
} from '../types/api'

export interface RegisterDoctorPayload {
  username: string
  password: string
  email: string
  phone: string
  nickname: string
  institution: string
  profession: string
}

export interface LoginPayload {
  username: string
  password: string
}

export interface KnowledgeListParams {
  page?: number
  page_size?: number
}

export interface VideoCreatePayload {
  image: File
  prompt?: string
  negative_prompt?: string
  duration?: number
  resolution?: string
  model?: string
  generate_count?: number
  prompt_extend?: boolean
  watermark?: boolean
  seed?: number
}

export interface VoiceCreatePayload {
  audio: File
  name?: string
  preferred_name?: string
  target_model?: string
  set_active?: boolean
}

export interface AskStreamPayload {
  question: string
  forced_search?: boolean
}

export const authApi = {
  register: (payload: RegisterDoctorPayload) =>
    requestApi<DoctorApplication>({
      method: 'POST',
      url: '/auth/doctor/register/',
      data: payload,
    }),

  login: (payload: LoginPayload) =>
    requestApi<LoginTokens>({
      method: 'POST',
      url: '/auth/login/',
      data: payload,
    }),

  refreshToken: (refresh: string) =>
    requestData<RefreshTokenPayload>({
      method: 'POST',
      url: '/auth/token/refresh/',
      data: { refresh },
    }),
}

export const knowledgeApi = {
  upload: (files: File[]) => {
    const form = new FormData()
    const firstFile = files[0]
    if (files.length === 1 && firstFile) {
      form.append('file', firstFile)
    } else {
      files.forEach((file) => form.append('files', file))
    }

    return requestApi<KnowledgeUploadResult>({
      method: 'POST',
      url: '/doctor/knowledge/',
      data: form,
    })
  },

  list: (params: KnowledgeListParams) =>
    requestData<PageResult<KnowledgeItem>>({
      method: 'GET',
      url: '/doctor/knowledge/',
      params,
    }),

  indexes: () =>
    requestData<KnowledgeIndexItem[]>({
      method: 'GET',
      url: '/doctor/knowledge/indexes/',
    }),

  tags: () =>
    requestData<KnowledgeTagSummary[]>({
      method: 'GET',
      url: '/doctor/knowledge/tags/',
    }),

  extract: (knowledgeId: number) =>
    requestApi<KnowledgeItem>({
      method: 'POST',
      url: `/doctor/knowledge/${knowledgeId}/extract/`,
    }),

  remove: (knowledgeId: number) =>
    requestApi<null>({
      method: 'DELETE',
      url: `/doctor/knowledge/${knowledgeId}/`,
    }),
}

export const digitalHumanApi = {
  createVoice: (payload: VoiceCreatePayload) => {
    const form = new FormData()
    form.append('audio', payload.audio)
    if (payload.name) form.append('name', payload.name)
    if (payload.preferred_name) form.append('preferred_name', payload.preferred_name)
    if (payload.target_model) form.append('target_model', payload.target_model)
    if (payload.set_active !== undefined) form.append('set_active', String(payload.set_active))

    return requestApi<VoiceProfile>({
      method: 'POST',
      url: '/doctor/digital-human/voice/',
      data: form,
    })
  },

  listVoice: () =>
    requestData<VoiceProfile[]>({
      method: 'GET',
      url: '/doctor/digital-human/voice/',
    }),

  createVideos: (payload: VideoCreatePayload) => {
    const form = new FormData()
    form.append('image', payload.image)
    if (payload.prompt) form.append('prompt', payload.prompt)
    if (payload.negative_prompt) form.append('negative_prompt', payload.negative_prompt)
    if (payload.duration !== undefined) form.append('duration', String(payload.duration))
    if (payload.resolution) form.append('resolution', payload.resolution)
    if (payload.model) form.append('model', payload.model)
    if (payload.generate_count !== undefined) form.append('generate_count', String(payload.generate_count))
    if (payload.prompt_extend !== undefined) form.append('prompt_extend', String(payload.prompt_extend))
    if (payload.watermark !== undefined) form.append('watermark', String(payload.watermark))
    if (payload.seed !== undefined) form.append('seed', String(payload.seed))

    return requestApi<AvatarVideoBatchResult>({
      method: 'POST',
      url: '/doctor/digital-human/videos/',
      data: form,
    })
  },

  listVideos: () =>
    requestData<AvatarVideo[]>({
      method: 'GET',
      url: '/doctor/digital-human/videos/',
    }),

  refreshVideo: (videoId: number) =>
    requestApi<AvatarVideo>({
      method: 'POST',
      url: `/doctor/digital-human/videos/${videoId}/refresh/`,
    }),
}

export const narrativeApi = {
  getKernel: () =>
    requestApi<NarrativeKernel>({
      method: 'GET',
      url: '/doctor/narrative-kernel/',
    }),

  replaceKernel: (payload: Record<string, unknown>, note = '') =>
    requestApi<NarrativeKernel>({
      method: 'PUT',
      url: '/doctor/narrative-kernel/',
      data: { payload, note },
    }),

  patchKernel: (changes: Record<string, unknown>, note = '') =>
    requestApi<NarrativeKernel>({
      method: 'PATCH',
      url: '/doctor/narrative-kernel/',
      data: { changes, note },
    }),

  createAnnotation: (payload: {
    source?: string
    question?: string
    answer?: string
    comment: string
    negative_rules?: string[]
    delta?: Record<string, unknown>
  }) =>
    requestApi<NarrativeAnnotationCreateResult>({
      method: 'POST',
      url: '/doctor/narrative-kernel/annotations/',
      data: payload,
    }),

  listAnnotations: (limit = 20) =>
    requestData<NarrativeAnnotation[]>({
      method: 'GET',
      url: '/doctor/narrative-kernel/annotations/',
      params: { limit },
    }),

  getRedlines: () =>
    requestData<NarrativeRedlines>({
      method: 'GET',
      url: '/doctor/narrative-kernel/redlines/',
    }),

  addRedlines: (rules: string[], comment = '') =>
    requestApi<NarrativeRedlineMutationResult>({
      method: 'POST',
      url: '/doctor/narrative-kernel/redlines/',
      data: { rules, comment },
    }),

  removeRedlines: (rules: string[]) =>
    requestApi<NarrativeRedlineMutationResult>({
      method: 'DELETE',
      url: '/doctor/narrative-kernel/redlines/',
      data: { rules },
    }),
}

export const rehearsalApi = {
  createSession: (title = '') =>
    requestApi<RehearsalSession>({
      method: 'POST',
      url: '/doctor/rehearsal/sessions/',
      data: { title },
    }),

  listSessions: () =>
    requestData<RehearsalSession[]>({
      method: 'GET',
      url: '/doctor/rehearsal/sessions/',
    }),

  listMessages: (sessionId: number, limit = 100) =>
    requestData<RehearsalMessageListPayload>({
      method: 'GET',
      url: `/doctor/rehearsal/sessions/${sessionId}/messages/`,
      params: { limit },
    }),

  getPlaybackAssets: () =>
    requestData<RehearsalPlaybackAssets>({
      method: 'GET',
      url: '/doctor/rehearsal/playback-assets/',
    }),

  saveMarkdown: (messageId: number, markdown: string) =>
    requestApi<MarkdownSaveResult>({
      method: 'PATCH',
      url: `/doctor/rehearsal/messages/${messageId}/markdown/`,
      data: { markdown },
    }),

  submitFeedback: (messageId: number, payload: {
    comment: string
    edited_markdown?: string
    apply_to_kernel?: boolean
  }) =>
    requestApi<FeedbackApplyResult | RehearsalFeedback>({
      method: 'POST',
      url: `/doctor/rehearsal/messages/${messageId}/feedback/`,
      data: payload,
    }),
}
