// ==================== Auth Types ====================
export interface LoginForm {
  username: string
  password: string
}

export interface RegisterForm {
  username: string
  password: string
  email: string
  phone: string
  nickname: string
  institution: string
  profession: string
}

export interface DoctorInfo {
  id: number
  username: string
  nickname: string
  email: string
  phone: string
  institution: string
  profession: string
  doctor_apply_status: 'pending' | 'approved' | 'rejected'
  doctor_applied_at: string
  doctor_reviewed_at: string | null
  doctor_review_note: string | null
  created_at: string
}

export interface TokenPair {
  access: string
  refresh: string
}

// ==================== API Response Types ====================
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export interface PaginatedData<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
  total_pages: number
  current_page: number
}

// ==================== Knowledge Types ====================
export type ExtractStatus = 'pending' | 'queued' | 'running' | 'success' | 'failed'
export type KnowledgeStatus = 'pending' | 'synced' | 'failed'

export interface KnowledgeFile {
  id: number
  file_name: string
  file_size: number
  file_type: string
  qwen_file_id: string | null
  extract_status: ExtractStatus
  knowledge_status: KnowledgeStatus
  knowledge_description: string | null
  tags: string[]
  extract_error: string | null
  created_at: string
  updated_at: string
}

export interface KnowledgeIndex {
  file_name: string
  file_id: string
  tags: string[]
  description: string
}

export interface TagStat {
  id: number
  name: string
  file_count: number
}

// ==================== Digital Human Types ====================
export interface VoiceAsset {
  id: number
  name: string
  voice_id: string
  preferred_name: string
  target_model: string
  is_active: boolean
  created_at: string
}

export type VideoStatus = 'submitted' | 'running' | 'succeeded' | 'failed'

export interface VideoAsset {
  id: number
  scene_key: string
  scene_name: string
  status: VideoStatus
  video_oss_url: string | null
  video_play_url: string | null
  duration: number
  resolution: string
  created_at: string
  updated_at: string
}

// ==================== Narrative Kernel Types ====================
export interface NarrativeKernel {
  id: number
  revision: number
  payload: KernelPayload
  compiled_prompt: string
  created_at: string
  updated_at: string
}

export interface KernelPayload {
  KERNEL?: {
    IDENTITY?: Record<string, string>
    CLINICAL_STYLE?: Record<string, string>
    SAFETY_RULES?: {
      NEGATIVE_RULES?: string[]
      BAD_RESPONSE_EXAMPLES?: BadResponseExample[]
    }
  }
  DYNAMIC?: {
    STATE?: Record<string, string>
  }
}

export interface BadResponseExample {
  question: string
  bad_answer: string
  reason: string
}

export interface Annotation {
  id: number
  source: string
  question: string
  answer: string
  comment: string
  negative_rules: string[]
  delta: Partial<KernelPayload>
  created_at: string
}

export interface RedlineRules {
  revision: number
  negative_rules: string[]
  bad_response_examples: BadResponseExample[]
}

// ==================== Rehearsal Types ====================
export interface RehearsalSession {
  id: number
  title: string
  created_at: string
  updated_at: string
  message_count?: number
}

export interface RehearsalMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  markdown_content: string | null
  search_sources: SearchSource[] | null
  selected_file_ids: string[] | null
  input_tokens: number
  output_tokens: number
  created_at: string
}

export interface SearchSource {
  title: string
  url: string
  snippet?: string
}

export interface PlaybackAssets {
  voice_id: string
  tts_model: string
  video_urls: string[]
  videos: VideoAssetForPlayback[]
}

export interface VideoAssetForPlayback {
  video_id: number
  scene_key: string
  scene_name: string
  video_url: string
  video_oss_url: string
}

export interface SSEStartEvent {
  event: 'start'
  answer_message_id: number
  selected_file_ids: string[]
}

export interface SSEDeltaEvent {
  event: 'delta'
  delta: string
}

export interface SSEDoneEvent {
  event: 'done'
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  search_sources: SearchSource[]
}

export interface SSEErrorEvent {
  event: 'error'
  message: string
}

export type SSEEvent = SSEStartEvent | SSEDeltaEvent | SSEDoneEvent | SSEErrorEvent

export interface FeedbackForm {
  comment: string
  edited_markdown: string
  apply_to_kernel: boolean
}
