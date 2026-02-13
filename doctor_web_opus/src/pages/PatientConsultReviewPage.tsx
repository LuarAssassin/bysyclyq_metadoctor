import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { consultReviewApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import type {
  ConsultReviewStatus,
  DoctorConsultMessage,
  DoctorConsultPatientNode,
  DoctorConsultSessionMessagesPayload,
  DoctorConsultTreePayload,
} from '@/types/api'
import PageHeader from '@/components/PageHeader'
import GlassCard from '@/components/GlassCard'
import StatusBadge from '@/components/StatusBadge'
import { cn } from '@/lib/cn'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquareText,
  PencilLine,
  RefreshCw,
  RotateCcw,
  UserRound,
  XCircle,
} from 'lucide-react'
import dayjs from 'dayjs'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function reviewStatusLabel(status: ConsultReviewStatus) {
  if (status === 'pending') return '待审核'
  if (status === 'approved') return '已通过'
  if (status === 'approved_edited') return '编辑后通过'
  if (status === 'rejected') return '已驳回'
  return status
}

function reviewStatusVariant(status: ConsultReviewStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'pending') return 'warning'
  if (status === 'approved' || status === 'approved_edited') return 'success'
  if (status === 'rejected') return 'danger'
  return 'neutral'
}

function assistantBubbleClass(status: ConsultReviewStatus) {
  if (status === 'pending') return 'bg-amber-50/80 border border-amber-200'
  if (status === 'rejected') return 'bg-red-50/80 border border-red-200'
  return 'bg-white border border-alpine-100 shadow-sm'
}

function patientDisplayName(node: DoctorConsultPatientNode) {
  return node.patient.nickname || node.patient.username || `患者#${node.patient.id}`
}

export default function PatientConsultReviewPage() {
  const [tree, setTree] = useState<DoctorConsultPatientNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const [sessionPayload, setSessionPayload] = useState<DoctorConsultSessionMessagesPayload | null>(null)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [submittingMessageId, setSubmittingMessageId] = useState<number | null>(null)
  const [expandedPatientIds, setExpandedPatientIds] = useState<number[]>([])

  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [editingMarkdown, setEditingMarkdown] = useState('')
  const [editingNote, setEditingNote] = useState('')

  const firstSessionId = useMemo(() => {
    for (const node of tree) {
      if (node.sessions.length) return node.sessions[0]!.id
    }
    return null
  }, [tree])

  const loadTree = useCallback(async () => {
    setTreeLoading(true)
    try {
      const data: DoctorConsultTreePayload = await consultReviewApi.tree()
      setTree(data.patients)
      setExpandedPatientIds((prev) => {
        if (prev.length) return prev
        return data.patients.map((item) => item.patient.id)
      })

      setSelectedSessionId((prev) => {
        if (!prev) return data.patients[0]?.sessions[0]?.id ?? null
        const stillExists = data.patients.some((node) =>
          node.sessions.some((session) => session.id === prev),
        )
        return stillExists ? prev : (data.patients[0]?.sessions[0]?.id ?? null)
      })
    } catch (error) {
      toast.error(toErrorMessage(error))
    } finally {
      setTreeLoading(false)
    }
  }, [])

  const loadMessages = useCallback(async (sessionId: number) => {
    setMessagesLoading(true)
    try {
      const data = await consultReviewApi.sessionMessages(sessionId, 160)
      setSessionPayload(data)
    } catch (error) {
      toast.error(toErrorMessage(error))
    } finally {
      setMessagesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionPayload(null)
      return
    }
    void loadMessages(selectedSessionId)
  }, [selectedSessionId, loadMessages])

  useEffect(() => {
    if (!selectedSessionId && firstSessionId) {
      setSelectedSessionId(firstSessionId)
    }
  }, [firstSessionId, selectedSessionId])

  const togglePatientExpanded = (patientId: number) => {
    setExpandedPatientIds((prev) => (
      prev.includes(patientId)
        ? prev.filter((id) => id !== patientId)
        : [...prev, patientId]
    ))
  }

  const openEditor = (message: DoctorConsultMessage) => {
    setEditingMessageId(message.id)
    setEditingMarkdown(message.edited_markdown || message.content_markdown || message.content || '')
    setEditingNote(message.review_note || '')
  }

  const closeEditor = () => {
    setEditingMessageId(null)
    setEditingMarkdown('')
    setEditingNote('')
  }

  const submitReview = async (
    messageId: number,
    action: 'approve' | 'approve_edited' | 'pending' | 'reject',
    options?: { editedMarkdown?: string; reviewNote?: string },
  ) => {
    if (submittingMessageId) return
    if (action === 'approve_edited' && !(options?.editedMarkdown || '').trim()) {
      toast.warning('编辑后通过时，内容不能为空')
      return
    }

    setSubmittingMessageId(messageId)
    try {
      const res = await consultReviewApi.reviewMessage(messageId, {
        action,
        edited_markdown: options?.editedMarkdown,
        review_note: options?.reviewNote,
      })
      toast.success(res.message)
      if (action === 'approve_edited') closeEditor()
      if (selectedSessionId) {
        await loadMessages(selectedSessionId)
      }
      await loadTree()
    } catch (error) {
      toast.error(toErrorMessage(error))
    } finally {
      setSubmittingMessageId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="患者问诊审核" subtitle="患者 → 会话 → 消息树状管理，医生可直接通过或编辑后通过">
        <button
          onClick={() => void loadTree()}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ice-600 hover:text-ice-700 bg-ice-50 hover:bg-ice-100 px-3 py-2 rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          刷新树
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4">
        <GlassCard
          title="患者会话树"
          subtitle="按患者分组展示全部问诊会话"
          extra={<StatusBadge variant="warning">{tree.reduce((sum, node) => sum + node.pending_count, 0)} 待审核</StatusBadge>}
          bodyClassName="p-0"
          noPadding
        >
          <div className="max-h-[calc(100vh-240px)] overflow-y-auto p-3 space-y-2">
            {treeLoading && tree.length === 0 ? (
              <div className="py-12 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-alpine-300 mx-auto" />
              </div>
            ) : tree.length === 0 ? (
              <div className="py-12 text-center text-sm text-alpine-400">
                暂无患者问诊会话
              </div>
            ) : (
              tree.map((node) => {
                const expanded = expandedPatientIds.includes(node.patient.id)
                return (
                  <div key={node.patient.id} className="rounded-xl border border-alpine-100 bg-white/70">
                    <button
                      onClick={() => togglePatientExpanded(node.patient.id)}
                      className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-ice-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {node.patient.avatar ? (
                          <img src={node.patient.avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <UserRound className="w-4 h-4 text-ice-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-alpine-800 truncate">
                          {patientDisplayName(node)}
                        </p>
                        <p className="text-[11px] text-alpine-400">
                          {node.session_count} 个会话
                        </p>
                      </div>
                      {node.pending_count > 0 && (
                        <StatusBadge variant="warning" className="px-2 py-0.5 text-[10px]">
                          {node.pending_count}
                        </StatusBadge>
                      )}
                      {expanded ? (
                        <ChevronDown className="w-4 h-4 text-alpine-300" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-alpine-300" />
                      )}
                    </button>

                    {expanded && (
                      <div className="px-2 pb-2 space-y-1.5">
                        {node.sessions.map((session) => (
                          <button
                            key={session.id}
                            onClick={() => setSelectedSessionId(session.id)}
                            className={cn(
                              'w-full text-left rounded-lg px-2.5 py-2 border transition-colors',
                              selectedSessionId === session.id
                                ? 'border-ice-200 bg-ice-50'
                                : 'border-transparent hover:border-alpine-100 hover:bg-alpine-50/80',
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium text-alpine-800 truncate flex-1">
                                {session.title || `问诊 #${session.id}`}
                              </p>
                              {session.pending_count > 0 && (
                                <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                  {session.pending_count}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-alpine-400 mt-0.5">
                              {dayjs(session.last_message_at || session.updated_at).format('MM-DD HH:mm')}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </GlassCard>

        <GlassCard
          title={sessionPayload?.session.title || '请选择一个会话'}
          subtitle={sessionPayload ? `${sessionPayload.patient.nickname || sessionPayload.patient.username} · 会话消息审核` : '在左侧选择患者会话后开始审核'}
          extra={sessionPayload && (
            <>
              <StatusBadge variant="warning">{sessionPayload.stats.pending} 待审核</StatusBadge>
              <StatusBadge variant="success">{sessionPayload.stats.approved + sessionPayload.stats.approved_edited} 通过</StatusBadge>
              {sessionPayload.stats.rejected > 0 && (
                <StatusBadge variant="danger">{sessionPayload.stats.rejected} 驳回</StatusBadge>
              )}
            </>
          )}
          bodyClassName="p-0"
          noPadding
        >
          <div className="h-[calc(100vh-240px)] overflow-y-auto px-5 py-4 space-y-3">
            {messagesLoading ? (
              <div className="py-14 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-alpine-300 mx-auto" />
              </div>
            ) : !sessionPayload ? (
              <div className="py-14 text-center text-alpine-400">
                <MessageSquareText className="w-8 h-8 mx-auto mb-2 text-alpine-300" />
                请选择左侧会话
              </div>
            ) : sessionPayload.messages.length === 0 ? (
              <div className="py-14 text-center text-alpine-400">该会话暂无消息</div>
            ) : (
              sessionPayload.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[88%] xl:max-w-[76%] rounded-2xl px-4 py-3',
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-ice-500 to-ice-600 text-white'
                        : assistantBubbleClass(msg.review_status),
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={cn(
                        'w-5 h-5 rounded-md flex items-center justify-center',
                        msg.role === 'user' ? 'bg-white/20' : 'bg-ice-50',
                      )}>
                        {msg.role === 'user' ? (
                          <UserRound className="w-3 h-3" />
                        ) : (
                          <Bot className="w-3 h-3 text-ice-600" />
                        )}
                      </div>
                      <span className={cn(
                        'text-[11px] font-medium',
                        msg.role === 'user' ? 'text-white/70' : 'text-alpine-500',
                      )}>
                        {msg.role === 'user' ? '患者' : 'AI 医生'}
                      </span>
                      <span className={cn(
                        'text-[10px]',
                        msg.role === 'user' ? 'text-white/50' : 'text-alpine-300',
                      )}>
                        {dayjs(msg.created_at).format('HH:mm')}
                      </span>
                      {msg.role === 'assistant' && (
                        <span className="ml-auto">
                          <StatusBadge variant={reviewStatusVariant(msg.review_status)} className="px-2 py-0.5 text-[10px]">
                            {reviewStatusLabel(msg.review_status)}
                          </StatusBadge>
                        </span>
                      )}
                    </div>

                    {msg.role === 'assistant' ? (
                      <div className="prose-chat">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.edited_markdown || msg.content_markdown || msg.content || ''}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    )}

                    {msg.role === 'assistant' && (
                      <div className="mt-2 pt-2 border-t border-alpine-100/70">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => void submitReview(msg.id, 'approve', { reviewNote: msg.review_note || '' })}
                            disabled={!!submittingMessageId}
                            className="inline-flex items-center gap-1 text-xs h-7 px-2.5 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {submittingMessageId === msg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            审核通过
                          </button>
                          <button
                            onClick={() => openEditor(msg)}
                            disabled={!!submittingMessageId}
                            className="inline-flex items-center gap-1 text-xs h-7 px-2.5 rounded-lg border border-ice-200 text-ice-600 hover:bg-ice-50 disabled:opacity-50"
                          >
                            <PencilLine className="w-3 h-3" />
                            编辑
                          </button>
                          {msg.review_status !== 'pending' && (
                            <button
                              onClick={() => void submitReview(msg.id, 'pending')}
                              disabled={!!submittingMessageId}
                              className="inline-flex items-center gap-1 text-xs h-7 px-2.5 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              设为待审核
                            </button>
                          )}
                          {msg.review_status !== 'rejected' && (
                            <button
                              onClick={() => void submitReview(msg.id, 'reject')}
                              disabled={!!submittingMessageId}
                              className="inline-flex items-center gap-1 text-xs h-7 px-2.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
                            >
                              <XCircle className="w-3 h-3" />
                              驳回
                            </button>
                          )}
                        </div>

                        {editingMessageId === msg.id && (
                          <div className="mt-2.5 space-y-2">
                            <textarea
                              value={editingMarkdown}
                              onChange={(e) => setEditingMarkdown(e.target.value)}
                              rows={5}
                              className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ice-300"
                              placeholder="编辑后的回答内容"
                            />
                            <input
                              value={editingNote}
                              onChange={(e) => setEditingNote(e.target.value)}
                              className="w-full h-9 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300"
                              placeholder="审核备注（可选）"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => void submitReview(msg.id, 'pending', {
                                  editedMarkdown: editingMarkdown,
                                  reviewNote: editingNote,
                                })}
                                disabled={!!submittingMessageId}
                                className="h-8 px-3 rounded-lg border border-amber-200 text-amber-600 text-xs hover:bg-amber-50 disabled:opacity-50"
                              >
                                保存为待审核
                              </button>
                              <button
                                onClick={() => void submitReview(msg.id, 'approve_edited', {
                                  editedMarkdown: editingMarkdown,
                                  reviewNote: editingNote,
                                })}
                                disabled={!!submittingMessageId}
                                className="h-8 px-3 rounded-lg bg-ice-500 hover:bg-ice-600 text-white text-xs disabled:opacity-50"
                              >
                                编辑后通过
                              </button>
                              <button
                                onClick={closeEditor}
                                disabled={!!submittingMessageId}
                                className="h-8 px-3 rounded-lg border border-alpine-200 text-alpine-500 text-xs hover:bg-alpine-50 disabled:opacity-50"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

