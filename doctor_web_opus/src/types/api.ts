/* ============================
   统一响应与分页
   ============================ */

export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export interface PageResult<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
  total_pages: number
  current_page: number
}

/* ============================
   认证
   ============================ */

export interface DoctorApplication {
  id: number
  username: string
  nickname: string | null
  email: string
  phone: string | null
  institution: string | null
  profession: string | null
  doctor_apply_status: 'pending' | 'approved' | 'rejected'
  doctor_applied_at: string | null
  doctor_reviewed_at: string | null
  doctor_review_note: string | null
  created_at: string
}

export interface LoginTokens {
  refresh: string
  access: string
}

export interface RefreshTokenPayload {
  access: string
}

/* ============================
   知识库
   ============================ */

export interface KnowledgeTag {
  id: number
  name: string
}

export interface KnowledgeItem {
  id: number
  file_name: string
  object_key: string
  oss_url: string
  content_type: string | null
  size_bytes: number
  etag: string | null
  upload_status: 'uploaded' | 'failed'
  knowledge_status: 'pending' | 'synced' | 'failed'
  extract_status: 'pending' | 'queued' | 'running' | 'success' | 'failed'
  qwen_file_id: string | null
  qwen_knowledge_base_id: string | null
  knowledge_description: string | null
  extract_raw_output: string | null
  extract_error: string | null
  extracted_at: string | null
  extract_retry_count: number
  tags: KnowledgeTag[]
  notes: string | null
  created_at: string
  updated_at: string
}

export interface KnowledgeUploadResult {
  count: number
  extract_queued_count: number
  extract_failed_count: number
  items: KnowledgeItem[]
}

export interface KnowledgeIndexItem {
  file_name: string
  file_id: string
  tags: string[]
  description: string
}

export interface KnowledgeTagSummary {
  id: number
  name: string
  file_count: number
}

/* ============================
   数字人素材
   ============================ */

export interface VoiceProfile {
  id: number
  name: string
  preferred_name: string
  target_model: string
  qwen_voice_id: string
  sample_file_name: string
  sample_oss_url: string
  sample_content_type: string | null
  sample_size_bytes: number
  is_active: boolean
  status: 'ready' | 'failed'
  error_message: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface DoctorAvatarProfile {
  avatar: string | null
}

export interface AvatarVideo {
  id: number
  image_file_name: string
  image_oss_url: string
  video_model: string
  scene_key: string | null
  scene_name: string | null
  prompt: string
  negative_prompt: string | null
  resolution: '720P' | '1080P' | string
  duration_seconds: number
  prompt_extend: boolean
  watermark: boolean
  audio_enabled: boolean
  task_request_id: string | null
  task_id: string
  task_status: 'submitted' | 'running' | 'succeeded' | 'failed'
  video_url_external: string | null
  video_file_name: string | null
  video_oss_url: string | null
  video_content_type: string | null
  video_size_bytes: number | null
  error_message: string | null
  completed_at: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
  video_play_url?: string | null
}

export interface AvatarVideoBatchResult {
  count: number
  failed_count: number
  items: AvatarVideo[]
  failed_items: Array<{ scene_key: string; scene_name: string; error: string }>
}

/* ============================
   叙事底座
   ============================ */

export interface NarrativeKernel {
  id: number
  schema_version: string
  kernel_name: string
  revision: number
  payload: Record<string, unknown>
  compiled_prompt: string
  last_annotation_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface NarrativeOpening {
  text: string
  default_text: string
  has_custom_text: boolean
  audio_url: string | null
  audio_oss_url: string | null
  audio_content_type: string | null
  audio_size_bytes: number | null
  audio_updated_at: string | null
  updated_at: string | null
  voice_id: string | null
  tts_model: string | null
  voice_name: string | null
}

export interface NarrativeOpeningSaveResult {
  opening: NarrativeOpening
  kernel: NarrativeKernel
}

export interface NarrativeAnnotation {
  id: number
  source: 'rehearsal' | 'manual' | 'import'
  question: string
  answer: string
  comment: string
  delta: Record<string, unknown>
  llm_applied: boolean
  llm_delta: Record<string, unknown>
  llm_error: string | null
  revision_after: number
  created_at: string
}

export interface NarrativeAnnotationCreateResult {
  annotation: NarrativeAnnotation
  kernel: NarrativeKernel
}

export interface NarrativeRedlines {
  revision: number
  negative_rules: string[]
  bad_response_examples: Array<{
    question?: string
    answer?: string
    comment?: string
    created_at?: string
  }>
}

export interface NarrativeRedlineMutationResult {
  added_rules?: string[]
  removed_rules?: string[]
  revision: number
  negative_rules: string[]
  annotation?: NarrativeAnnotation
}

/* ============================
   AI 问诊演练
   ============================ */

export interface RehearsalSession {
  id: number
  title: string
  status: 'active' | 'archived' | string
  summary: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export interface RehearsalMessage {
  id: number
  session: number
  role: 'user' | 'assistant' | string
  turn_index: number
  generation_status: 'generating' | 'succeeded' | 'failed' | string
  reply_to: number | null
  content: string
  content_markdown: string
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

export interface RehearsalMessageListPayload {
  session: RehearsalSession
  messages: RehearsalMessage[]
}

export interface RehearsalPlaybackAssets {
  tts_model: string
  voice_id: string
  voice_name: string
  video_urls: string[]
  videos: Array<{
    video_id: number
    scene_key: string | null
    scene_name: string | null
    video_url: string | null
    video_oss_url: string
  }>
  video_message: string
}

export interface RehearsalFeedback {
  id: number
  message: number
  comment: string
  edited_markdown: string
  status: 'saved' | 'applied' | 'failed' | string
  apply_to_kernel: boolean
  annotation_id: number | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface MarkdownSaveResult {
  message: RehearsalMessage
  feedback: RehearsalFeedback
}

export interface FeedbackApplyResult {
  feedback: RehearsalFeedback
  annotation: NarrativeAnnotation
  kernel: NarrativeKernel
}

/* ============================
   患者问诊审核
   ============================ */

export type ConsultReviewStatus = 'pending' | 'approved' | 'approved_edited' | 'rejected' | string

export interface DoctorConsultPatientSummary {
  id: number
  username: string
  nickname: string | null
  avatar: string | null
}

export interface DoctorConsultSessionNode {
  id: number
  title: string
  status: 'active' | 'archived' | string
  is_pinned: boolean
  pinned_at: string | null
  summary: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
  pending_count: number
  total_message_count: number
}

export interface DoctorConsultPatientNode {
  patient: DoctorConsultPatientSummary
  pending_count: number
  session_count: number
  sessions: DoctorConsultSessionNode[]
}

export interface DoctorConsultTreePayload {
  patients: DoctorConsultPatientNode[]
  session_count: number
  pending_count: number
}

export interface DoctorConsultMessage {
  id: number
  session: number
  role: 'user' | 'assistant' | string
  turn_index: number
  generation_status: 'generating' | 'succeeded' | 'failed' | string
  review_status: ConsultReviewStatus
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

export interface DoctorConsultSessionMessagesPayload {
  session: {
    id: number
    title: string
    status: 'active' | 'archived' | string
    is_pinned: boolean
    pinned_at: string | null
    summary: string | null
    last_message_at: string | null
    created_at: string
    updated_at: string
  }
  patient: DoctorConsultPatientSummary
  messages: DoctorConsultMessage[]
  stats: {
    pending: number
    approved: number
    approved_edited: number
    rejected: number
  }
}

export interface DoctorConsultReviewResult {
  message: DoctorConsultMessage
  pending_count: number
}

/* ============================
   SSE 事件
   ============================ */

export interface RehearsalAudioInfo {
  enabled: boolean
  status: 'disabled' | 'streaming' | 'succeeded' | 'failed' | 'stopped'
  voice_id?: string
  voice_name?: string
  tts_model?: string
  audio_format?: string   // "pcm16"
  sample_rate?: number    // 24000
  channels?: number       // 1
  error?: string | null
  first_audio_delay_ms?: number | null
  audio_chunk_count?: number
  audio_base64_chars?: number
}

export interface RehearsalStartEvent {
  session_id: number
  question_message_id: number
  answer_message_id: number
  selected_file_ids: string[]
  selected_file_meta: Array<Record<string, unknown>>
  grounding_sources: Array<Record<string, unknown>>
  audio?: RehearsalAudioInfo
}

export interface RehearsalDeltaEvent {
  message_id: number
  delta: string
}

export interface RehearsalAudioDeltaEvent {
  message_id: number
  audio_format: string    // "pcm16"
  sample_rate: number     // 24000
  channels: number        // 1
  delta: string           // base64 encoded PCM16 audio
}

export interface RehearsalAudioErrorEvent {
  message_id: number
  message: string
}

export interface RehearsalDoneEvent {
  message_id: number
  usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  search_sources: Array<Record<string, unknown>>
  selected_file_ids: string[]
  audio?: RehearsalAudioInfo
}

export interface RehearsalErrorEvent {
  message_id?: number
  message: string
}
