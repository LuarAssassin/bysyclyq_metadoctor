import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { rehearsalApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import { askRehearsalStream } from '@/lib/stream'
import { PCMStreamPlayer, type AudioPlayerState } from '@/lib/audio-player'
import type {
  RehearsalAudioInfo,
  RehearsalDoneEvent,
  RehearsalMessage,
  RehearsalPlaybackAssets,
  RehearsalSession,
  RehearsalStartEvent,
} from '@/types/api'
import PageHeader from '@/components/PageHeader'
import GlassCard from '@/components/GlassCard'
import StatusBadge from '@/components/StatusBadge'
import { cn } from '@/lib/cn'
import {
  Bot,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  MessageCirclePlus,
  Mic,
  MicOff,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Shuffle,
  Sparkles,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import dayjs from 'dayjs'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MDEditor from '@uiw/react-md-editor'
import { motion, AnimatePresence } from 'framer-motion'

/* ── helpers ───────────────────────── */

function makeTempMessage(overrides: Partial<RehearsalMessage> & { id: number; role: string; content: string }): RehearsalMessage {
  const now = new Date().toISOString()
  const { id, role, content, ...rest } = overrides
  return {
    id, session: 0, role, turn_index: 0,
    generation_status: 'generating',
    reply_to: null, content,
    content_markdown: content, edited_markdown: null, edited_at: null,
    model_name: null, selected_file_ids: [], selected_file_meta: [],
    grounding_answer: null, grounding_sources: [], search_sources: [],
    input_tokens: null, output_tokens: null, total_tokens: null,
    error_message: null, meta: null, created_at: now, updated_at: now,
    ...rest,
  }
}

/* ── Component ─────────────────────── */

export default function RehearsalArenaPage() {
  // Sessions
  const [sessions, setSessions] = useState<RehearsalSession[]>([])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  // Messages
  const [messages, setMessages] = useState<RehearsalMessage[]>([])
  const [msgLoading, setMsgLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [question, setQuestion] = useState('')
  const [forcedSearch, setForcedSearch] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Playback
  const [playback, setPlayback] = useState<RehearsalPlaybackAssets | null>(null)
  const [playUrl, setPlayUrl] = useState('')

  // Audio
  const [enableAudio, setEnableAudio] = useState(true)
  const [audioMuted, setAudioMuted] = useState(false)
  const [audioPlayerState, setAudioPlayerState] = useState<AudioPlayerState>('idle')
  const [audioInfo, setAudioInfo] = useState<RehearsalAudioInfo | null>(null)
  const playerRef = useRef<PCMStreamPlayer | null>(null)

  // Editor drawer
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editMsgId, setEditMsgId] = useState<number | null>(null)
  const [editMd, setEditMd] = useState('')
  const [feedbackComment, setFeedbackComment] = useState('')
  const [applyKernel, setApplyKernel] = useState(true)

  const currentSession = sessions.find((s) => s.id === sessionId) || null

  const scrollBottom = () => { requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }) }

  // 清理音频播放器
  useEffect(() => {
    return () => { playerRef.current?.stop() }
  }, [])

  /* ── Data loaders ──────────────── */

  const loadSessions = useCallback(async () => {
    setSessionLoading(true)
    try {
      const data = await rehearsalApi.listSessions()
      setSessions(data)
      if (!sessionId && data.length) setSessionId(data[0]!.id)
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setSessionLoading(false) }
  }, [sessionId])

  const loadMessages = useCallback(async (sid?: number) => {
    const id = sid ?? sessionId
    if (!id) { setMessages([]); return }
    setMsgLoading(true)
    try {
      const data = await rehearsalApi.listMessages(id, 100)
      setMessages(data.messages)
      scrollBottom()
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setMsgLoading(false) }
  }, [sessionId])

  const loadPlayback = async () => {
    try {
      const data = await rehearsalApi.getPlaybackAssets()
      setPlayback(data)
      const urls = data.video_urls
      if (urls.length) setPlayUrl(urls[Math.floor(Math.random() * urls.length)]!)
    } catch (e) { toast.error(toErrorMessage(e)) }
  }

  const refreshAll = async () => { await Promise.all([loadSessions(), loadPlayback()]); await loadMessages() }
  useEffect(() => { refreshAll() }, []) // eslint-disable-line
  useEffect(() => { if (sessionId) loadMessages(sessionId) }, [sessionId]) // eslint-disable-line

  /* ── Actions ───────────────────── */

  const createSession = async () => {
    try {
      const r = await rehearsalApi.createSession(newTitle)
      toast.success(r.message); setNewTitle('')
      await loadSessions()
      setSessionId(r.data.id)
    } catch (e) { toast.error(toErrorMessage(e)) }
  }

  const selectSession = (id: number) => { setSessionId(id) }

  const sendQuestion = async () => {
    const q = question.trim()
    if (!q) { toast.warning('请输入问诊问题'); return }
    if (!sessionId) { toast.warning('请先创建或选择会话'); return }
    setSending(true)
    const localQ = q; setQuestion('')

    // 停止上一轮音频
    playerRef.current?.stop()
    playerRef.current = null
    setAudioInfo(null)
    setAudioPlayerState('idle')

    // 如果启用语音，初始化播放器（用户交互时机，AudioContext 合规）
    if (enableAudio) {
      const player = new PCMStreamPlayer(24000, setAudioPlayerState)
      await player.init()
      if (audioMuted) player.setMuted(true)
      playerRef.current = player
    }

    // Optimistic user message
    const tempUser = makeTempMessage({ id: -Date.now(), role: 'user', content: localQ, generation_status: 'succeeded' })
    setMessages((prev) => [...prev, tempUser]); scrollBottom()

    let startPayload: RehearsalStartEvent | null = null

    try {
      const askPayload: { question: string; forced_search?: boolean; enable_audio: boolean } = {
        question: localQ,
        enable_audio: enableAudio,
      }
      if (forcedSearch) askPayload.forced_search = true

      await askRehearsalStream(
        sessionId,
        askPayload,
        {
          onStart: (data) => {
            startPayload = data
            if (data.audio) setAudioInfo(data.audio)
            setMessages((prev) => {
              let next = prev.map((m) => m.id === tempUser.id ? { ...m, id: data.question_message_id } : m)
              const assistantMsg = makeTempMessage({
                id: data.answer_message_id, role: 'assistant', content: '',
                generation_status: 'generating', reply_to: data.question_message_id,
                selected_file_ids: data.selected_file_ids || [],
                selected_file_meta: data.selected_file_meta || [],
                grounding_sources: data.grounding_sources || [],
              })
              next = [...next, assistantMsg]
              return next
            })
            scrollBottom()
          },
          onDelta: (data) => {
            setMessages((prev) => prev.map((m) =>
              m.id === data.message_id
                ? { ...m, content: m.content + data.delta, content_markdown: m.content + data.delta }
                : m
            ))
            scrollBottom()
          },
          onAudioDelta: (data) => {
            playerRef.current?.feed(data.delta)
          },
          onAudioError: (data) => {
            console.warn('[AudioError]', data.message)
            toast.warning(`语音流: ${data.message}`, { duration: 3000 })
          },
          onDone: (data: RehearsalDoneEvent) => {
            if (data.audio) setAudioInfo(data.audio)
            setMessages((prev) => prev.map((m) =>
              m.id === data.message_id
                ? {
                    ...m, generation_status: 'succeeded',
                    search_sources: data.search_sources || [],
                    selected_file_ids: data.selected_file_ids || m.selected_file_ids,
                    input_tokens: data.usage?.input_tokens ?? null,
                    output_tokens: data.usage?.output_tokens ?? null,
                    total_tokens: data.usage?.total_tokens ?? null,
                  }
                : m
            ))
          },
          onError: (data) => {
            const tid = data.message_id || startPayload?.answer_message_id
            if (tid) {
              setMessages((prev) => prev.map((m) =>
                m.id === tid ? { ...m, generation_status: 'failed', error_message: data.message } : m
              ))
            }
            toast.error(data.message || '流式问答出错')
          },
        },
      )
      await Promise.all([loadMessages(sessionId), loadSessions()])
    } catch (e) {
      toast.error(toErrorMessage(e))
      await loadMessages(sessionId)
    } finally {
      setSending(false)
    }
  }

  /* ── Editor ────────────────────── */

  const openEditor = (msg: RehearsalMessage) => {
    setEditMsgId(msg.id)
    setEditMd(msg.edited_markdown || msg.content_markdown || msg.content || '')
    setFeedbackComment(''); setApplyKernel(true); setDrawerOpen(true)
  }

  const saveMd = async () => {
    if (!editMsgId) return
    try {
      const r = await rehearsalApi.saveMarkdown(editMsgId, editMd)
      toast.success(r.message); await loadMessages()
    } catch (e) { toast.error(toErrorMessage(e)) }
  }

  const submitFeedback = async () => {
    if (!editMsgId) return
    if (!feedbackComment.trim()) { toast.warning('请填写批改意见'); return }
    try {
      const r = await rehearsalApi.submitFeedback(editMsgId, {
        comment: feedbackComment, edited_markdown: editMd, apply_to_kernel: applyKernel,
      })
      toast.success(r.message); setDrawerOpen(false)
      await loadMessages()
    } catch (e) { toast.error(toErrorMessage(e)) }
  }

  const renderMarkdown = (msg: RehearsalMessage) => msg.edited_markdown || msg.content_markdown || msg.content || ''

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !sending) { e.preventDefault(); sendQuestion() }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="AI 问诊演练场" subtitle="会话 → 流式回答 → Token/来源 → Markdown 批改 → 反馈学习闭环">
        <button onClick={() => refreshAll()} className="inline-flex items-center gap-1.5 text-xs font-medium text-ice-600 hover:text-ice-700 bg-ice-50 hover:bg-ice-100 px-3 py-2 rounded-lg transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> 刷新全部
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
        {/* Sidebar */}
        <div className="space-y-3">
          <GlassCard title="演练会话" extra={<StatusBadge variant="info">{sessions.length} 个</StatusBadge>}>
            <div className="flex gap-2 mb-3">
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="flex-1 h-9 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300" placeholder="新会话标题（可选）" />
              <button onClick={createSession} className="h-9 px-3 rounded-lg bg-ice-500 hover:bg-ice-600 text-white transition-colors flex-shrink-0">
                <MessageCirclePlus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {sessionLoading && !sessions.length ? <Loader2 className="w-4 h-4 animate-spin mx-auto my-4 text-alpine-300" /> :
                sessions.length === 0 ? <p className="text-xs text-alpine-400 text-center py-4">暂无会话</p> :
                sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => selectSession(s.id)}
                    className={cn(
                      'w-full text-left rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 transition-all',
                      s.id === sessionId
                        ? 'bg-ice-50 border border-ice-200 shadow-ice'
                        : 'border border-transparent hover:bg-alpine-50'
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-alpine-800 truncate">{s.title || `会话 #${s.id}`}</p>
                      <p className="text-[11px] text-alpine-400">{dayjs(s.last_message_at || s.updated_at).format('MM-DD HH:mm')}</p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-alpine-300 flex-shrink-0" />
                  </button>
                ))}
            </div>
          </GlassCard>

          {/* Playback Assets */}
          <GlassCard title="问诊回放资产" extra={
            <button onClick={loadPlayback} className="text-xs text-ice-500 hover:text-ice-600 transition-colors">刷新</button>
          }>
            <div className="text-xs text-alpine-500 space-y-1 mb-2">
              <p><span className="text-alpine-400">voice:</span> {playback?.voice_name || '-'}</p>
              <p><span className="text-alpine-400">model:</span> {playback?.tts_model || '-'}</p>
            </div>
            <button onClick={() => {
              const urls = playback?.video_urls || []
              if (urls.length) setPlayUrl(urls[Math.floor(Math.random() * urls.length)]!)
            }} className="text-xs text-ice-600 hover:text-ice-700 flex items-center gap-1 mb-2">
              <Shuffle className="w-3 h-3" /> 随机切换视频
            </button>
            {playUrl ? (
              <video controls src={playUrl} onError={() => loadPlayback()} className="w-full rounded-lg bg-alpine-900" />
            ) : <p className="text-xs text-alpine-400 text-center py-4">暂无可播放视频</p>}
          </GlassCard>
        </div>

        {/* Chat Main */}
        <GlassCard
          title={currentSession?.title || '请先创建会话'}
          extra={
            <div className="flex items-center gap-2">
              <StatusBadge variant="success">
                <Bot className="w-3 h-3" />{messages.filter((m) => m.role === 'assistant').length} 回答
              </StatusBadge>
            </div>
          }
          bodyClassName="p-0"
          noPadding
        >
          {/* Messages */}
          <div ref={listRef} className="h-[calc(100vh-340px)] min-h-[400px] overflow-y-auto px-5 py-4 space-y-3">
            {msgLoading && !messages.length ? (
              <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-alpine-300" /></div>
            ) : messages.length === 0 ? (
              <div className="py-16 text-center">
                <Sparkles className="w-10 h-10 text-ice-300 mx-auto mb-3" />
                <p className="text-sm text-alpine-400">输入一个问题开始 AI 问诊演练</p>
              </div>
            ) : messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div className={cn(
                  'max-w-[85%] xl:max-w-[75%] rounded-2xl px-4 py-3',
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-ice-500 to-ice-600 text-white'
                    : 'bg-white border border-alpine-100 shadow-sm'
                )}>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={cn(
                      'w-5 h-5 rounded-md flex items-center justify-center text-[10px]',
                      msg.role === 'user' ? 'bg-white/20' : 'bg-ice-50'
                    )}>
                      {msg.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3 text-ice-600" />}
                    </div>
                    <span className={cn('text-[11px] font-medium', msg.role === 'user' ? 'text-white/70' : 'text-alpine-400')}>
                      {msg.role === 'user' ? '医生' : 'AI 医生'}
                    </span>
                    <span className={cn('text-[10px]', msg.role === 'user' ? 'text-white/40' : 'text-alpine-300')}>
                      {dayjs(msg.created_at).format('HH:mm')}
                    </span>
                  </div>

                  {/* Content */}
                  {msg.role === 'assistant' ? (
                    <div className="prose-chat">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {renderMarkdown(msg)}
                      </ReactMarkdown>
                      {msg.generation_status === 'generating' && (
                        <span className="inline-block w-2 h-4 bg-ice-400 rounded-sm animate-pulse ml-0.5" />
                      )}
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  )}

                  {/* Meta */}
                  {msg.role === 'assistant' && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-alpine-100/60">
                      <StatusBadge
                        variant={msg.generation_status === 'failed' ? 'danger' : msg.generation_status === 'succeeded' ? 'success' : 'warning'}
                        dot
                      >
                        {msg.generation_status}
                      </StatusBadge>
                      {msg.total_tokens && <StatusBadge variant="info">tokens: {msg.total_tokens}</StatusBadge>}
                      {(msg.selected_file_ids?.length ?? 0) > 0 && (
                        <StatusBadge variant="ice"><FileText className="w-3 h-3" />{msg.selected_file_ids.length} files</StatusBadge>
                      )}
                      {(msg.search_sources?.length ?? 0) > 0 && (
                        <StatusBadge variant="success"><ExternalLink className="w-3 h-3" />{msg.search_sources.length} 来源</StatusBadge>
                      )}
                      <button onClick={() => openEditor(msg)} className="ml-auto text-xs text-ice-500 hover:text-ice-600 flex items-center gap-1 transition-colors">
                        <Pencil className="w-3 h-3" /> 批改
                      </button>
                    </div>
                  )}
                  {msg.error_message && <p className="text-xs text-red-500 mt-1">{msg.error_message}</p>}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Audio status bar */}
          {sending && enableAudio && (
            <div className="border-t border-alpine-100/60 px-5 py-2 bg-gradient-to-r from-ice-50/80 to-snow-50/60 flex items-center gap-3">
              <div className="flex items-center gap-2">
                {audioPlayerState === 'playing' ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ice-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-ice-500" />
                  </span>
                ) : audioPlayerState === 'error' ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-alpine-300 animate-pulse" />
                )}
                <span className="text-[11px] font-medium text-alpine-500">
                  {audioPlayerState === 'playing' ? '语音播放中' : audioPlayerState === 'error' ? '语音错误' : '等待语音流…'}
                </span>
              </div>
              {audioInfo?.voice_name && (
                <span className="text-[10px] text-alpine-400">音色: {audioInfo.voice_name}</span>
              )}
              <button
                onClick={() => {
                  const next = !audioMuted
                  setAudioMuted(next)
                  playerRef.current?.setMuted(next)
                }}
                className="ml-auto p-1 rounded-md hover:bg-white/60 transition-colors"
                title={audioMuted ? '取消静音' : '静音'}
              >
                {audioMuted ? <VolumeX className="w-3.5 h-3.5 text-alpine-400" /> : <Volume2 className="w-3.5 h-3.5 text-ice-500" />}
              </button>
            </div>
          )}

          {/* Audio done stats */}
          {!sending && audioInfo && audioInfo.status !== 'disabled' && (
            <div className="border-t border-alpine-100/60 px-5 py-2 bg-snow-50/40 flex flex-wrap items-center gap-3">
              <StatusBadge variant={audioInfo.status === 'succeeded' ? 'success' : audioInfo.status === 'failed' ? 'danger' : 'info'} dot>
                语音 {audioInfo.status === 'succeeded' ? '完成' : audioInfo.status === 'failed' ? '失败' : audioInfo.status}
              </StatusBadge>
              {audioInfo.voice_name && (
                <span className="text-[10px] text-alpine-400">音色: {audioInfo.voice_name}</span>
              )}
              {typeof audioInfo.first_audio_delay_ms === 'number' && (
                <span className="text-[10px] text-alpine-400">首帧: {audioInfo.first_audio_delay_ms}ms</span>
              )}
              {typeof audioInfo.audio_chunk_count === 'number' && (
                <span className="text-[10px] text-alpine-400">chunks: {audioInfo.audio_chunk_count}</span>
              )}
              {audioInfo.error && (
                <span className="text-[10px] text-red-400">错误: {audioInfo.error}</span>
              )}
              <button onClick={() => setAudioInfo(null)} className="ml-auto p-0.5 rounded hover:bg-alpine-100 transition-colors">
                <X className="w-3 h-3 text-alpine-300" />
              </button>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-alpine-100 px-5 py-3 bg-snow-50/60">
            <div className="flex items-end gap-3">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="输入问诊问题，例如：血压偏高并伴头痛，应该怎么处理？"
                className="flex-1 rounded-xl border border-alpine-200 px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ice-300 bg-white transition-all"
              />
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button
                  onClick={sendQuestion}
                  disabled={sending || !question.trim()}
                  className="h-10 px-5 rounded-xl bg-gradient-to-r from-ice-500 to-ice-600 text-white text-sm font-medium shadow-lg shadow-ice-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all hover:shadow-ice-500/30"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  发送
                </button>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={forcedSearch} onChange={(e) => setForcedSearch(e.target.checked)} className="rounded border-alpine-300 text-ice-500 focus:ring-ice-300" />
                    <span className="text-[11px] text-alpine-400">强制搜索</span>
                  </label>
                  <button
                    onClick={() => setEnableAudio(!enableAudio)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-all',
                      enableAudio
                        ? 'bg-ice-100 text-ice-600 hover:bg-ice-200'
                        : 'bg-alpine-100 text-alpine-400 hover:bg-alpine-200'
                    )}
                    title={enableAudio ? '语音已开启，点击关闭' : '语音已关闭，点击开启'}
                  >
                    {enableAudio ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                    {enableAudio ? '语音' : '静默'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Editor Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col"
            >
              <header className="flex items-center justify-between px-5 py-3 border-b border-alpine-100">
                <h3 className="text-base font-semibold text-alpine-900">回答 Markdown 批改</h3>
                <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-alpine-50 transition-colors">
                  <X className="w-5 h-5 text-alpine-500" />
                </button>
              </header>
              <div className="flex-1 overflow-y-auto p-5 space-y-4" data-color-mode="light">
                <MDEditor
                  value={editMd}
                  onChange={(v) => setEditMd(v || '')}
                  height={360}
                  preview="live"
                />
                <div>
                  <label className="block text-xs font-medium text-alpine-500 mb-1">批改意见 comment（用于反馈学习）</label>
                  <textarea
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300 resize-y"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={applyKernel} onChange={(e) => setApplyKernel(e.target.checked)} className="rounded border-alpine-300 text-ice-500 focus:ring-ice-300" />
                  <span className="text-sm text-alpine-600">提交后写入叙事底座</span>
                </label>
                <div className="flex gap-3">
                  <button onClick={saveMd} className="h-10 px-4 rounded-lg border border-alpine-200 text-sm font-medium text-alpine-700 hover:bg-alpine-50 flex items-center gap-2 transition-colors">
                    <Play className="w-3.5 h-3.5" /> 先保存 Markdown
                  </button>
                  <button onClick={submitFeedback} className="h-10 px-4 rounded-lg bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium flex items-center gap-2 transition-colors">
                    <Sparkles className="w-3.5 h-3.5" /> 提交反馈学习
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
