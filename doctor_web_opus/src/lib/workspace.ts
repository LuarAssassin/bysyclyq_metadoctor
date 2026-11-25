import { requestData } from './http'

export interface WorkspaceSession {
  session_id: number
  patient: { id: number; display_name: string }
  pending_count: number
  last_message_at: string | null
}

export interface WorkspaceData {
  profile: { id: number; display_name: string; institution: string | null; profession: string | null }
  counts: {
    patients: number
    sessions: number
    ai_replies: number
    pending_reviews: number
    reviewed_replies: number
    failed_replies: number
  }
  trend: Array<{ date: string; ai_replies: number; patient_messages: number }>
  period: { start_date: string; end_date: string; time_zone: string; days: number }
  pending_sessions: WorkspaceSession[]
  knowledge: { total: number; ready: number; processing: number; failed: number }
  readiness: {
    profile: boolean
    avatar: boolean
    voice: boolean
    video: boolean
    kernel: boolean
    knowledge: boolean
    rehearsal: boolean
    kernel_revision: number | null
  }
  generated_at: string
}

/** Demo data is isolated from authentication, browser storage and real service calls. */
export const DEMO_WORKSPACE: WorkspaceData = {
  profile: { id: 0, display_name: '陈医生', institution: '崇礼院区', profession: '运动医学科' },
  counts: { patients: 28, sessions: 42, ai_replies: 136, pending_reviews: 6, reviewed_replies: 130, failed_replies: 1 },
  period: { start_date: '2026-11-06', end_date: '2026-11-12', time_zone: 'Asia/Shanghai', days: 7 },
  trend: [
    { date: '2026-11-06', ai_replies: 11, patient_messages: 12 },
    { date: '2026-11-07', ai_replies: 8, patient_messages: 9 },
    { date: '2026-11-08', ai_replies: 16, patient_messages: 18 },
    { date: '2026-11-09', ai_replies: 12, patient_messages: 14 },
    { date: '2026-11-10', ai_replies: 19, patient_messages: 21 },
    { date: '2026-11-11', ai_replies: 15, patient_messages: 16 },
    { date: '2026-11-12', ai_replies: 9, patient_messages: 10 },
  ],
  pending_sessions: [
    { session_id: 1001, patient: { id: 1, display_name: '患者示例 A' }, pending_count: 3, last_message_at: '2026-11-12T09:24:00+08:00' },
    { session_id: 1002, patient: { id: 2, display_name: '患者示例 B' }, pending_count: 2, last_message_at: '2026-11-12T08:46:00+08:00' },
    { session_id: 1003, patient: { id: 3, display_name: '患者示例 C' }, pending_count: 1, last_message_at: '2026-11-11T16:32:00+08:00' },
  ],
  knowledge: { total: 12, ready: 9, processing: 2, failed: 1 },
  readiness: { profile: true, avatar: true, voice: false, video: false, kernel: true, knowledge: true, rehearsal: true, kernel_revision: 3 },
  generated_at: '2026-11-12T09:30:00+08:00',
}

export async function getWorkspace(signal?: AbortSignal): Promise<WorkspaceData> {
  return requestData<WorkspaceData>({ method: 'GET', url: '/doctor/workspace/', signal })
}

export function formatWorkspaceTime(value: string | null, timeZone: string, includeDate = true): string {
  if (!value) return '暂无记录'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '时间暂不可用'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone, month: includeDate ? '2-digit' : undefined, day: includeDate ? '2-digit' : undefined,
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(parsed)
  } catch {
    return '时间暂不可用'
  }
}

export function getReadinessItems(data: WorkspaceData) {
  return [
    { key: 'profile', label: '医生资料', detail: '身份与专业信息', ready: data.readiness.profile, route: '/profile', chapter: 'profile' },
    { key: 'kernel', label: '专业表达', detail: data.readiness.kernel_revision ? `当前配置修订 ${data.readiness.kernel_revision}` : '回复方式与边界', ready: data.readiness.kernel, route: '/narrative-kernel', chapter: 'expression' },
    { key: 'knowledge', label: '专业知识', detail: `${data.knowledge.ready} 份资料就绪`, ready: data.readiness.knowledge, route: '/knowledge', chapter: 'knowledge' },
    { key: 'avatar', label: '医生形象', detail: '形象素材', ready: data.readiness.avatar, route: '/digital-human', chapter: 'avatar' },
    { key: 'voice', label: '声音', detail: '可选素材', ready: data.readiness.voice, route: '/digital-human', chapter: 'avatar' },
    { key: 'video', label: '数字人视频', detail: '可选素材', ready: data.readiness.video, route: '/digital-human', chapter: 'avatar' },
    { key: 'rehearsal', label: '试聊与校准', detail: '先体验，再调整', ready: data.readiness.rehearsal, route: '/rehearsal', chapter: 'rehearsal' },
  ]
}
