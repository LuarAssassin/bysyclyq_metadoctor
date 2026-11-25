export interface GuideVideo {
  /** Only add a source after checking its content and permission to use it. */
  verified: boolean
  src: string
  captionsSrc: string
  transcript: string
}

export interface GuideChapter {
  id: string
  title: string
  summary: string
  route: string | null
  action: string
  status: 'available' | 'planned'
  steps: Array<{ title: string; detail: string }>
  outcome: string
  note?: string
  video: GuideVideo | null
}

export const guideChapters: GuideChapter[] = [
  {
    id: 'profile', title: '完善医生资料', summary: '让患者清楚了解服务来自谁。',
    route: '/profile', action: '完善个人资料', status: 'available', video: null,
    steps: [
      { title: '核对基本信息', detail: '在个人资料中检查姓名、所属机构和专业。填写能够对外展示的真实信息。' },
      { title: '选择合适的头像', detail: '上传清晰、已获使用授权的个人头像。避免患者资料或无关人物出现在图片中。' },
      { title: '保存并检查', detail: '保存后重新核对信息。医生账号资格审核与数字医生服务版本审批是不同流程。' },
    ],
    outcome: '个人资料准确、完整，头像能够正常显示。',
  },
  {
    id: 'expression', title: '设置专业表达', summary: '明确怎样介绍自己，以及哪些问题需要交回医生。',
    route: '/narrative-kernel', action: '设置专业表达', status: 'available', video: null,
    steps: [
      { title: '写好开场介绍', detail: '在开场白中说明这是 AI 助手、可以协助的事项和服务边界。保存开场白时会尝试生成语音。' },
      { title: '补充表达反馈', detail: '用具体问题、现有回答和修改意见说明期待的表达。比起笼统要求“更专业”，给出一个可参考的例子更容易检查效果。' },
      { title: '维护回复边界', detail: '在回复规则中记录不应提供的内容，再到试聊中检查常见问题和超出范围的问题。' },
    ],
    outcome: '开场介绍清楚，表达和边界能够在试聊中核对。',
    note: '当前保存会更新现有配置，尚无草稿与服务版本隔离。请先确认修改内容，再保存。',
  },
  {
    id: 'knowledge', title: '整理专业知识', summary: '从手头已有的一份可靠资料开始。',
    route: '/knowledge', action: '打开专业知识库', status: 'available', video: null,
    steps: [
      { title: '选择资料', detail: '准备有权使用的指南、宣教材料或专业文档。上传前去除无关身份信息，避免将真实患者资料作为演示素材。' },
      { title: '上传并等待处理', detail: '在知识库上传文件，查看处理状态。仍在排队或处理中时，不代表资料已经可用于回答。' },
      { title: '核对解析结果', detail: '查看文件描述和标签。处理失败时先查看原因，再重试；最后用资料中的具体问题进行试聊。' },
    ],
    outcome: '所需资料处理完成，文件来源和内容可以核对。',
    note: '自动搜寻指南、批量选择导入及定期更新仍需后续接入，当前不会自动完成这些操作。',
  },
  {
    id: 'avatar', title: '准备形象与声音', summary: '先完成基础形象，再按需要制作声音和视频。',
    route: '/digital-human', action: '配置形象与声音', status: 'available', video: null,
    steps: [
      { title: '检查医生形象', detail: '上传适合患者端展示的清晰头像或正面照片，确认拥有图片的使用授权。' },
      { title: '按需准备声音', detail: '使用自己的声音或已获授权的声音素材，可录音或上传音频。检查音色创建结果，失败时按提示修正。' },
      { title: '查看视频任务', detail: '按需提交数字人视频生成任务。异步生成期间可继续其他工作，任务完成后再检查画面与播放效果。' },
    ],
    outcome: '已选择的素材处理完成，并经过本人检查。',
    note: '形象和声音素材准备完成，不等于服务已通过发布审查。',
  },
  {
    id: 'rehearsal', title: '试聊与校准', summary: '先从患者视角体验，再调整回答。',
    route: '/rehearsal', action: '开始试聊', status: 'available', video: null,
    steps: [
      { title: '测试常见场景', detail: '选择一个常见的宣教或就诊准备问题，观察内容、语气与信息来源是否符合预期。' },
      { title: '测试边界与缺项', detail: '尝试信息不完整、超出服务范围等问题，检查助手是否说明限制，并给出合适的后续沟通提示。' },
      { title: '记录修改意见', detail: '对不合适的回答进行编辑或反馈。只有检查清楚反馈内容后，再决定是否将其应用到当前配置。' },
    ],
    outcome: '关键使用场景有可检查的试聊记录，需要修改的问题已记录。',
    note: '演练通过不能代替正式机构审查或临床验证。',
  },
  {
    id: 'review', title: '复核服务记录', summary: '日常集中处理需要查看的 AI 回复。',
    route: '/consult-review', action: '查看待复核记录', status: 'available', video: null,
    steps: [
      { title: '从工作台进入', detail: '工作台汇总待复核的 AI 回复。选择会话后查看患者问题、上下文和生成内容。' },
      { title: '记录复核结论', detail: '根据实际内容选择通过、编辑后通过或驳回，必要时填写说明。不要用批量确认代替医学判断。' },
      { title: '回看处理结果', detail: '确认复核状态已更新。发现需要改进的表达，可回到专业表达和试聊继续修正。' },
    ],
    outcome: '需要复核的回复有清楚的处理状态与记录。',
    note: '当前是回复生成后的事后复核，不会在回复到达患者前拦截；驳回复核记录也不等于撤回已发送内容。',
  },
  {
    id: 'publication', title: '审查授权与发布', summary: '后续将连接院方审查、医生授权和多渠道入口。',
    route: null, action: '规划中', status: 'planned', video: null,
    steps: [
      { title: '形成审查建议', detail: '计划由 AI 汇总风险与试聊结果，辅助责任人员审查；AI 不替代正式机构审批。' },
      { title: '医生确认具体版本', detail: '计划让医生查看审查报告和变更内容，对明确的服务版本授权。' },
      { title: '生成受控服务入口', detail: '计划提供链接、二维码等入口，并统一响应暂停与版本状态；公众号、小程序需要各自的接入授权。' },
    ],
    outcome: '本章节用于说明建设方向，当前无法在这里提交审查或启用服务。',
  },
]

export const availableChapterIds = guideChapters.filter((chapter) => chapter.status === 'available').map((chapter) => chapter.id)

export function parseGuideProgress(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    if (!Array.isArray(value)) return []
    return availableChapterIds.filter((id) => value.includes(id))
  } catch {
    return []
  }
}

export function toggleGuideProgress(ids: string[], id: string): string[] {
  const clean = parseGuideProgress(JSON.stringify(ids))
  if (!availableChapterIds.includes(id)) return clean
  return availableChapterIds.filter((item) => item === id ? !clean.includes(item) : clean.includes(item))
}

export function nextGuideChapter(ids: string[]): string {
  return availableChapterIds.find((id) => !ids.includes(id)) || availableChapterIds[0]!
}

export function getGuideChapter(id: string | null): GuideChapter {
  return guideChapters.find((chapter) => chapter.id === id) || guideChapters[0]!
}

export async function guideProgressKey(account: string, demo = false): Promise<string | null> {
  if (demo) return 'chongli-guide:v1:demo'
  if (!account.trim()) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account.trim()))
  const identity = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `chongli-guide:v1:account:${identity}`
}

function allowedMediaUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

export function hasGuideVideo(video: GuideVideo | null): video is GuideVideo {
  return Boolean(video?.verified && allowedMediaUrl(video.src) && allowedMediaUrl(video.captionsSrc) && video.transcript.trim())
}
