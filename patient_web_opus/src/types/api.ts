/* ── 通用 ─────────────────────── */

export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

/* ── 认证 ─────────────────────── */

export interface PatientProfile {
  id: number
  username: string
  nickname: string | null
  email: string | null
  phone: string | null
  created_at: string
}

export interface UserProfile {
  id: number
  username: string
  nickname: string | null
  email: string | null
  phone: string | null
  gender: 'M' | 'F' | 'U' | string
  birthday: string | null
  age: number | null
  institution: string | null
  profession: string | null
  address: string | null
  avatar: string | null
  is_doctor: boolean
  doctor_apply_status: 'pending' | 'approved' | 'rejected' | string
  doctor_applied_at: string | null
  doctor_reviewed_at: string | null
  doctor_review_note: string | null
  created_at: string
  updated_at: string
}

export interface LoginTokens {
  refresh: string
  access: string
}

export interface PatientCodeSendResult {
  channel: 'sms' | 'email'
  target: string
  expire_seconds: number
}

export interface PatientCodeLoginPayload extends LoginTokens {
  profile: UserProfile
  created: boolean
  login_channel: 'sms' | 'email' | 'google'
  login_target: string
}

export interface RefreshTokenPayload {
  access: string
}

/* ── 医生目录 ─────────────────── */

export interface DoctorInfo {
  id: number
  username: string
  nickname: string | null
  avatar: string | null
  institution: string | null
  profession: string | null
}

export interface DoctorVideo {
  video_id: number
  scene_key: string | null
  scene_name: string | null
  video_url: string | null
  video_oss_url: string
}

export interface DoctorOpening {
  text: string
  default_text?: string
  has_custom_text?: boolean
  audio_url: string | null
  audio_oss_url?: string | null
  audio_content_type?: string | null
  audio_size_bytes?: number | null
  audio_updated_at?: string | null
  updated_at?: string | null
  voice_id?: string | null
  tts_model?: string | null
  voice_name?: string | null
}

export interface DoctorAssets {
  doctor: DoctorInfo
  tts_model: string
  voice_id: string
  voice_name: string
  opening?: DoctorOpening
  video_urls: string[]
  videos: DoctorVideo[]
}

/* ── 问诊会话 ─────────────────── */

export interface PatientSession {
  id: number
  doctor: DoctorInfo
  title: string
  status: 'active' | 'archived' | string
  is_pinned: boolean
  pinned_at: string | null
  summary: string | null
  last_message_at: string | null
  created_at: string
  updated_at?: string
}

export interface PatientMessage {
  id: number
  session: number
  role: string
  turn_index: number
  generation_status: 'generating' | 'succeeded' | 'failed' | string
  review_status: 'pending' | 'approved' | 'approved_edited' | 'rejected' | string
  reviewed_at: string | null
  review_note: string | null
  reply_to: number | null
  content: string
  content_markdown: string | null
  edited_markdown: string | null
  edited_at: string | null
  model_name: string | null
  selected_file_ids: string[]
  selected_file_meta: Array<Record<string, unknown>>
  grounding_answer: string | null
  grounding_sources: Array<Record<string, unknown>>
  search_sources: Array<Record<string, unknown>>
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  error_message: string | null
  meta: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface MessageListPayload {
  session: PatientSession
  messages: PatientMessage[]
}

export interface PatientAsrResult {
  text: string
  model: string
  content_type?: string | null
  size_bytes?: number
}

/* ── SSE 事件 ─────────────────── */

export interface AudioInfo {
  enabled: boolean
  status: 'disabled' | 'streaming' | 'succeeded' | 'failed' | 'stopped'
  voice_id?: string
  voice_name?: string
  tts_model?: string
  audio_format?: string
  sample_rate?: number
  channels?: number
  error?: string | null
  first_audio_delay_ms?: number | null
  audio_chunk_count?: number
  audio_base64_chars?: number
}

export interface SSEStartEvent {
  session_id: number
  question_message_id: number
  answer_message_id: number
  doctor_id?: number
  selected_file_ids: string[]
  selected_file_meta?: Array<Record<string, unknown>>
  grounding_sources?: Array<Record<string, unknown>>
  audio?: AudioInfo
}

export interface SSEDeltaEvent {
  message_id: number
  delta: string
}

export interface SSEAudioDeltaEvent {
  message_id: number
  audio_format: string
  sample_rate: number
  channels: number
  delta: string
}

export interface SSEAudioErrorEvent {
  message_id: number
  message: string
}

export interface SSEDoneEvent {
  message_id: number
  interrupted?: boolean
  usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  search_sources?: Array<Record<string, unknown>>
  selected_file_ids?: string[]
  audio?: AudioInfo
}

export interface SSEErrorEvent {
  message_id?: number
  message: string
}
