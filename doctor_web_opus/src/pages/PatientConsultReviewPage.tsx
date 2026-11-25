import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { consultReviewApi } from '@/lib/api'
import { requestData, toErrorMessage } from '@/lib/http'
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

type PaginatedConsultPayload = DoctorConsultSessionMessagesPayload & {
  pagination?: { has_more: boolean; before_message_id: number | null }
}

function getSessionPage(sessionId: number, beforeMessageId?: number) {
  return requestData<PaginatedConsultPayload>({
    method: 'GET',
    url: `/doctor/patient-consults/sessions/${sessionId}/messages/`,
    params: { limit: 160, ...(beforeMessageId !== undefined ? { before_message_id: beforeMessageId } : {}) },
  })
}

function reviewStatusLabel(status: ConsultReviewStatus) {
  if (status === 'pending') return '待复核'
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

function canReviewMessage(message: DoctorConsultMessage) {
  return message.role === 'assistant' && message.generation_status === 'succeeded'
}

export default function PatientConsultReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSession = searchParams.get('session')
  const [tree, setTree] = useState<DoctorConsultPatientNode[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeLoaded, setTreeLoaded] = useState(false)
  const [treeRevision, setTreeRevision] = useState(0)
  const [treeError, setTreeError] = useState('')
  const [sessionPayload, setSessionPayload] = useState<PaginatedConsultPayload | null>(null)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState('')
  const [earlierLoading, setEarlierLoading] = useState(false)
  const [earlierError, setEarlierError] = useState('')
  const [submittingMessageId, setSubmittingMessageId] = useState<number | null>(null)
  const [expandedPatientIds, setExpandedPatientIds] = useState<number[]>([])
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [editingMarkdown, setEditingMarkdown] = useState('')
  const [editingNote, setEditingNote] = useState('')
  const treeRequest = useRef(0)
  const messageRequest = useRef(0)
  const earlierRequest = useRef(0)
  const earlierBusy = useRef(false)
  const messagePanel = useRef<HTMLDivElement>(null)
  const scrollAnchor = useRef<{ sessionId: number; height: number; top: number } | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)

  // A deep link is a selection hint only. Resolve it against this doctor's tree
  // before requesting any messages; never fetch an arbitrary URL-supplied ID.
  const selectedNode = useMemo(() => {
    if (!treeLoaded || treeLoading || treeError) return null
    if (requestedSession !== null) {
      if (!/^[1-9]\d*$/.test(requestedSession)) return null
      const id = Number(requestedSession)
      if (!Number.isSafeInteger(id)) return null
      const patientNode = tree.find(node => node.sessions.some(session => session.id === id))
      return patientNode ? { patientNode, sessionId: id } : null
    }
    const patientNode = tree.find(node => node.sessions.length > 0)
    return patientNode ? { patientNode, sessionId: patientNode.sessions[0]!.id } : null
  }, [tree, treeLoaded, treeLoading, treeError, requestedSession])
  const selectedSessionId = selectedNode?.sessionId ?? null
  const selectedSessionRef = useRef<number | null>(null)
  const payloadRef = useRef<PaginatedConsultPayload | null>(null)
  selectedSessionRef.current = selectedSessionId
  payloadRef.current = sessionPayload
  const linkError = treeLoaded && !treeLoading && !treeError && requestedSession !== null && !selectedNode
    ? '该会话不存在或不属于当前账号可查看的服务记录。请从左侧选择会话，或返回工作台。'
    : ''
  const visiblePayload = !treeLoading && !treeError && !messagesLoading && !messagesError &&
    sessionPayload?.session.id === selectedSessionId ? sessionPayload : null

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      treeRequest.current += 1
      messageRequest.current += 1
      earlierRequest.current += 1
    }
  }, [])

  const resetEarlier = useCallback(() => {
    earlierRequest.current += 1
    earlierBusy.current = false
    scrollAnchor.current = null
    setEarlierLoading(false)
    setEarlierError('')
  }, [])

  const loadTree = useCallback(async () => {
    const requestId = ++treeRequest.current
    setTreeLoading(true)
    setTreeError('')
    resetEarlier()
    messageRequest.current += 1
    setSessionPayload(null)
    try {
      const data: DoctorConsultTreePayload = await consultReviewApi.tree()
      if (!mounted.current || requestId !== treeRequest.current) return
      setTree(data.patients)
      setTreeLoaded(true)
      setTreeRevision(revision => revision + 1)
      setExpandedPatientIds(prev => {
        const patientIds = new Set(data.patients.map(item => item.patient.id))
        return prev.filter(id => patientIds.has(id))
      })
    } catch (error) {
      if (!mounted.current || requestId !== treeRequest.current) return
      setTreeError(toErrorMessage(error))
      setTree([])
    } finally {
      if (mounted.current && requestId === treeRequest.current) setTreeLoading(false)
    }
  }, [resetEarlier])

  const loadMessages = useCallback(async (sessionId: number) => {
    if (selectedSessionRef.current !== sessionId) return
    const requestId = ++messageRequest.current
    resetEarlier()
    setMessagesLoading(true)
    setMessagesError('')
    setSessionPayload(null)
    try {
      const data = await getSessionPage(sessionId)
      if (!mounted.current || requestId !== messageRequest.current || selectedSessionRef.current !== sessionId) return
      if (data.session.id !== sessionId) throw new Error('会话信息不匹配，请重试')
      setSessionPayload(data)
    } catch (error) {
      if (!mounted.current || requestId !== messageRequest.current || selectedSessionRef.current !== sessionId) return
      setMessagesError(toErrorMessage(error))
    } finally {
      if (mounted.current && requestId === messageRequest.current && selectedSessionRef.current === sessionId) {
        setMessagesLoading(false)
      }
    }
  }, [resetEarlier])

  useEffect(() => { void loadTree() }, [loadTree])

  useEffect(() => {
    messageRequest.current += 1
    resetEarlier()
    setSessionPayload(null)
    setMessagesError('')
    setMessagesLoading(false)
    setEditingMessageId(null)
    setEditingMarkdown('')
    setEditingNote('')
    if (selectedSessionId !== null) void loadMessages(selectedSessionId)
    return () => { messageRequest.current += 1 }
  }, [selectedSessionId, treeRevision, loadMessages, resetEarlier])

  const selectedPatientId = selectedNode?.patientNode.patient.id
  useEffect(() => {
    if (selectedPatientId !== undefined) {
      setExpandedPatientIds(prev => prev.includes(selectedPatientId) ? prev : [...prev, selectedPatientId])
    }
  }, [selectedPatientId])

  const selectSession = (sessionId: number) => {
    if (sessionId === selectedSessionId) return
    if (!tree.some(node => node.sessions.some(session => session.id === sessionId))) return
    messageRequest.current += 1
    resetEarlier()
    setSessionPayload(null)
    const next = new URLSearchParams(searchParams)
    next.set('session', String(sessionId))
    setSearchParams(next)
  }

  const loadEarlier = async () => {
    const cursor = visiblePayload?.pagination?.before_message_id
    const sessionId = selectedSessionId
    if (earlierBusy.current || submitting.current || !visiblePayload?.pagination?.has_more ||
      sessionId === null || !Number.isSafeInteger(cursor) || !cursor || cursor < 1) return
    const requestId = ++earlierRequest.current
    const messageGeneration = messageRequest.current
    earlierBusy.current = true
    setEarlierLoading(true)
    setEarlierError('')
    try {
      const data = await getSessionPage(sessionId, cursor)
      if (!mounted.current || requestId !== earlierRequest.current ||
        messageGeneration !== messageRequest.current || selectedSessionRef.current !== sessionId) return
      if (data.session.id !== sessionId) throw new Error('历史会话信息不匹配，请重试')
      if (data.pagination?.has_more && (!data.messages.length || data.pagination.before_message_id === cursor)) {
        throw new Error('历史记录未能继续加载，请重试')
      }
      const panel = messagePanel.current
      if (panel) scrollAnchor.current = { sessionId, height: panel.scrollHeight, top: panel.scrollTop }
      setSessionPayload(current => {
        if (!current || current.session.id !== sessionId) return current
        // Keep the latest local review result if an overlapping page is returned.
        const messagesById = new Map(data.messages.map(message => [message.id, message]))
        current.messages.forEach(message => messagesById.set(message.id, message))
        const messages = [...messagesById.values()].sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id,
        )
        return { ...current, messages, pagination: data.pagination }
      })
    } catch (error) {
      if (mounted.current && requestId === earlierRequest.current &&
        messageGeneration === messageRequest.current && selectedSessionRef.current === sessionId) {
        setEarlierError(toErrorMessage(error))
      }
    } finally {
      if (mounted.current && requestId === earlierRequest.current) {
        earlierBusy.current = false
        setEarlierLoading(false)
      }
    }
  }

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current
    const panel = messagePanel.current
    if (anchor && panel && anchor.sessionId === selectedSessionId) {
      panel.scrollTop = anchor.top + panel.scrollHeight - anchor.height
    }
    scrollAnchor.current = null
  }, [sessionPayload?.messages.length, selectedSessionId])

  const togglePatientExpanded = (patientId: number) => {
    setExpandedPatientIds((prev) => (
      prev.includes(patientId)
        ? prev.filter((id) => id !== patientId)
        : [...prev, patientId]
    ))
  }

  const openEditor = (message: DoctorConsultMessage) => {
    if (!canReviewMessage(message)) return
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
    if (submitting.current || !visiblePayload?.messages.some(message => message.id === messageId && canReviewMessage(message))) return
    if (action === 'approve_edited' && !(options?.editedMarkdown || '').trim()) {
      toast.warning('编辑后通过时，内容不能为空')
      return
    }

    submitting.current = true
    const submittedSessionId = selectedSessionId
    setSubmittingMessageId(messageId)
    try {
      const res = await consultReviewApi.reviewMessage(messageId, {
        action,
        edited_markdown: options?.editedMarkdown,
        review_note: options?.reviewNote,
      })
      if (!mounted.current) return
      toast.success(res.message)
      if (selectedSessionRef.current === submittedSessionId) closeEditor()
      const reviewedMessage = res.data.message
      setSessionPayload(current => {
        if (!current || current.session.id !== submittedSessionId) return current
        const previous = current.messages.find(message => message.id === messageId)
        if (!previous) return current
        const stats = { ...current.stats }
        if (previous?.generation_status === 'succeeded' &&
          (previous.review_status === 'pending' || previous.reviewed_at) &&
          Object.prototype.hasOwnProperty.call(stats, previous.review_status)) {
          const key = previous.review_status as keyof typeof stats
          stats[key] = Math.max(0, stats[key] - 1)
        }
        if (reviewedMessage.generation_status === 'succeeded' &&
          (reviewedMessage.review_status === 'pending' || reviewedMessage.reviewed_at) &&
          Object.prototype.hasOwnProperty.call(stats, reviewedMessage.review_status)) {
          const key = reviewedMessage.review_status as keyof typeof stats
          stats[key] += 1
        }
        return { ...current, stats, messages: current.messages.map(message => message.id === messageId ? reviewedMessage : message) }
      })
      setTree(current => current.map(node => {
        const sessions = node.sessions.map(session => session.id === submittedSessionId
          ? { ...session, pending_count: res.data.pending_count } : session)
        return { ...node, sessions, pending_count: sessions.reduce((sum, session) => sum + session.pending_count, 0) }
      }))
      // If the user left and returned while the review was in flight, replace
      // any pre-review initial GET with a fresh read after the mutation.
      if (submittedSessionId !== null && selectedSessionRef.current === submittedSessionId &&
        (payloadRef.current?.session.id !== submittedSessionId ||
          !payloadRef.current.messages.some(message => message.id === messageId))) {
        await loadMessages(submittedSessionId)
      }
    } catch (error) {
      if (mounted.current) toast.error(toErrorMessage(error))
    } finally {
      submitting.current = false
      if (mounted.current) setSubmittingMessageId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="服务记录复核" subtitle="复核已生成的 AI 回复；这是事后复核，不是发送前审批。">
        <Link to="/" className="text-sm text-ice-600 hover:underline">返回首页</Link>
        <button
          onClick={() => void loadTree()}
          disabled={treeLoading || !!submittingMessageId}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ice-600 hover:text-ice-700 bg-ice-50 hover:bg-ice-100 px-3 py-2 rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          刷新记录
        </button>
      </PageHeader>

      {linkError && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{linkError}</p>}
      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4">
        <GlassCard
          title="患者与会话"
          subtitle="仅显示当前账号可查看的服务记录"
          extra={!treeLoading && !treeError && <StatusBadge variant="warning">{tree.reduce((sum, node) => sum + node.pending_count, 0)} 待复核</StatusBadge>}
          bodyClassName="p-0"
          noPadding
        >
          <div className="max-h-[calc(100vh-240px)] overflow-y-auto p-3 space-y-2">
            {treeLoading ? (
              <div className="py-12 text-center" role="status">
                <Loader2 className="w-5 h-5 animate-spin text-alpine-300 mx-auto" />
                <p className="mt-2 text-sm text-alpine-500">正在加载服务记录</p>
              </div>
            ) : treeError ? (
              <div className="p-4 text-sm" role="alert"><p className="text-red-700">服务记录加载失败：{treeError}</p><button className="mt-3 text-ice-600 underline" onClick={() => void loadTree()}>重新加载服务记录</button></div>
            ) : tree.length === 0 ? (
              <div className="py-12 text-center text-sm text-alpine-400">
                暂无患者服务记录
              </div>
            ) : (
              tree.map((node) => {
                const expanded = expandedPatientIds.includes(node.patient.id)
                return (
                  <div key={node.patient.id} className="rounded-xl border border-alpine-100 bg-white/70">
                    <button
                      onClick={() => togglePatientExpanded(node.patient.id)}
                      aria-expanded={expanded}
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
                            onClick={() => selectSession(session.id)}
                            aria-pressed={selectedSessionId === session.id}
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
          title={visiblePayload?.session.title || '请选择一个会话'}
          subtitle={visiblePayload ? `${visiblePayload.patient.nickname || visiblePayload.patient.username} · 会话消息复核` : '选择会话，查看并复核已有回复'}
          extra={visiblePayload && (
            <>
              <StatusBadge variant="warning">{visiblePayload.stats.pending} 待复核</StatusBadge>
              <StatusBadge variant="success">{visiblePayload.stats.approved + visiblePayload.stats.approved_edited} 通过</StatusBadge>
              {visiblePayload.stats.rejected > 0 && (
                <StatusBadge variant="danger">{visiblePayload.stats.rejected} 驳回</StatusBadge>
              )}
            </>
          )}
          bodyClassName="p-0"
          noPadding
        >
          <div ref={messagePanel} className="h-[calc(100vh-240px)] overflow-y-auto px-5 py-4 space-y-3" aria-label="会话消息记录">
            {visiblePayload && visiblePayload.messages.length > 0 && (
              <div className="pb-3 border-b border-alpine-100 text-center space-y-2">
                <p className="text-xs text-alpine-500" role="status">已加载 {visiblePayload.messages.length} 条记录 · 复核统计包含整个会话</p>
                <button
                  onClick={() => void loadEarlier()}
                  disabled={earlierLoading || !!submittingMessageId || !visiblePayload.pagination?.has_more}
                  className="inline-flex items-center gap-2 text-sm text-ice-600 rounded-lg border border-alpine-200 px-4 py-2 hover:bg-ice-50 disabled:opacity-60 disabled:cursor-default"
                >
                  {earlierLoading && <Loader2 size={15} className="animate-spin" />}
                  {earlierLoading ? '正在加载更早记录' : earlierError ? '重试加载更早记录' : visiblePayload.pagination?.has_more ? '加载更早记录' : visiblePayload.pagination ? '已显示全部记录' : '历史记录暂不可加载'}
                </button>
                {earlierError && <p role="alert" className="text-sm text-red-700">历史记录加载失败：{earlierError}</p>}
              </div>
            )}
            {treeLoading || messagesLoading ? (
              <div className="py-14 text-center" role="status">
                <Loader2 className="w-5 h-5 animate-spin text-alpine-300 mx-auto" />
                <p className="mt-2 text-sm text-alpine-500">正在加载会话</p>
              </div>
            ) : messagesError ? (
              <div className="p-4 text-sm" role="alert"><p className="text-red-700">会话加载失败：{messagesError}</p><button className="mt-3 text-ice-600 underline" onClick={() => selectedSessionId !== null && void loadMessages(selectedSessionId)}>重试会话</button></div>
            ) : !visiblePayload ? (
              <div className="py-14 text-center text-alpine-400">
                <MessageSquareText className="w-8 h-8 mx-auto mb-2 text-alpine-300" />
                {treeError ? '服务记录暂时无法加载，请重试。' : linkError ? '当前链接的会话不可访问。' : '请选择左侧会话'}
              </div>
            ) : visiblePayload.messages.length === 0 ? (
              <div className="py-14 text-center text-alpine-400">该会话暂无消息</div>
            ) : (
              visiblePayload.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[88%] xl:max-w-[76%] rounded-2xl px-4 py-3',
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-ice-500 to-ice-600 text-white'
                        : canReviewMessage(msg) ? assistantBubbleClass(msg.review_status) : 'bg-alpine-50 border border-alpine-200',
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
                          <StatusBadge variant={canReviewMessage(msg) ? reviewStatusVariant(msg.review_status) : msg.generation_status === 'failed' ? 'danger' : 'neutral'} className="px-2 py-0.5 text-[10px]">
                            {canReviewMessage(msg) ? reviewStatusLabel(msg.review_status) : msg.generation_status === 'generating' ? '生成中' : msg.generation_status === 'failed' ? '生成失败' : '未完成'}
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

                    {msg.role === 'assistant' && !canReviewMessage(msg) && (
                      <p className="mt-2 text-xs text-alpine-500">
                        {msg.generation_status === 'generating' ? '回复尚未生成完成，暂不支持复核。' : '该回复未成功生成，不计入待复核记录。'}
                      </p>
                    )}

                    {canReviewMessage(msg) && (
                      <div className="mt-2 pt-2 border-t border-alpine-100/70">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => void submitReview(msg.id, 'approve', { reviewNote: msg.review_note || '' })}
                            disabled={!!submittingMessageId}
                            className="inline-flex items-center gap-1 text-xs h-7 px-2.5 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {submittingMessageId === msg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            复核通过
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
                              设为待复核
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
                              aria-label="编辑后的回答内容"
                              placeholder="编辑后的回答内容"
                            />
                            <input
                              value={editingNote}
                              onChange={(e) => setEditingNote(e.target.value)}
                              className="w-full h-9 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300"
                              aria-label="复核备注（可选）"
                              placeholder="复核备注（可选）"
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
                                保存为待复核
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

// Dashboards may link directly to a session when this review page is installed.
PatientConsultReviewPage.supportsSessionLink = true
