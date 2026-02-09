import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { doctorApi, sessionApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import { askPatientStream } from '@/lib/stream'
import { PCMStreamPlayer, type AudioPlayerState } from '@/lib/audio-player'
import type {
  AudioInfo,
  DoctorAssets,
  PatientMessage,
  PatientSession,
  SSEDoneEvent,
  SSEStartEvent,
} from '@/types/api'
import DigitalHumanPlayer from '@/components/DigitalHumanPlayer'
import { cn } from '@/lib/cn'
import {
  ArrowLeft,
  Bot,
  Loader2,
  Send,
  Sparkles,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react'
import dayjs from 'dayjs'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { motion } from 'framer-motion'

/* ── helpers ───────────────────── */

function makeTempMsg(overrides: { id: number; role: string; content: string } & Partial<PatientMessage>): PatientMessage {
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

/* ── Component ─────────────────── */

export default function ChatPage() {
  const { sessionId: rawId } = useParams<{ sessionId: string }>()
  const sessionId = Number(rawId)
  const nav = useNavigate()

  // Data
  const [session, setSession] = useState<PatientSession | null>(null)
  const [assets, setAssets] = useState<DoctorAssets | null>(null)
  const [messages, setMessages] = useState<PatientMessage[]>([])
  const [loading, setLoading] = useState(true)

  // Chat
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [videoActive, setVideoActive] = useState(false) // 数字人视频是否活跃（等语音播完才停）
  const listRef = useRef<HTMLDivElement>(null)

  // Audio
  const [audioMuted, setAudioMuted] = useState(false)
  const [audioState, setAudioState] = useState<AudioPlayerState>('idle')
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null)
  const playerRef = useRef<PCMStreamPlayer | null>(null)

  const scrollBottom = () => requestAnimationFrame(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  })

  // 清理
  useEffect(() => () => { playerRef.current?.stop() }, [])

  /* ── 加载数据 ────────────────── */

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const msgData = await sessionApi.messages(sessionId)
      setSession(msgData.session)
      setMessages(msgData.messages)
      scrollBottom()

      // 加载医生素材
      if (msgData.session.doctor?.id) {
        const a = await doctorApi.getAssets(msgData.session.doctor.id)
        setAssets(a)
      }
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setLoading(false) }
  }, [sessionId])

  useEffect(() => { loadData() }, [loadData])

  /* ── 发送问题 ────────────────── */

  const sendQuestion = async () => {
    const q = question.trim()
    if (!q) { toast.warning('请输入您的问题'); return }
    if (!sessionId) return
    setSending(true)
    setVideoActive(true)
    setQuestion('')

    // 停掉上一轮播放器
    playerRef.current?.stop()
    playerRef.current = null
    setAudioInfo(null)
    setAudioState('idle')

    // 初始化新播放器（用户交互中，AudioContext 合规）
    const player = new PCMStreamPlayer(24000, setAudioState)
    await player.init()
    if (audioMuted) player.setMuted(true)
    playerRef.current = player

    // 乐观消息
    const tempUser = makeTempMsg({ id: -Date.now(), role: 'user', content: q, generation_status: 'succeeded' })
    setMessages((prev) => [...prev, tempUser])
    scrollBottom()

    let startPayload: SSEStartEvent | null = null

    try {
      await askPatientStream(
        sessionId,
        { question: q, forced_search: true, enable_audio: true },
        {
          onStart: (data) => {
            startPayload = data
            if (data.audio) setAudioInfo(data.audio)
            setMessages((prev) => {
              let next = prev.map((m) => m.id === tempUser.id ? { ...m, id: data.question_message_id } : m)
              const assistantMsg = makeTempMsg({
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
          },
          onDone: (data: SSEDoneEvent) => {
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
            toast.error(data.message || '问诊出错')
          },
        },
      )
      // SSE 流结束，但音频可能还在播放
      setSending(false)

      // 等待 WebAudio 队列里最后一个 buffer 播完
      if (playerRef.current) {
        await playerRef.current.waitUntilDrained()
      }
      setVideoActive(false)

      // 刷新最终数据
      const final = await sessionApi.messages(sessionId)
      setMessages(final.messages)
    } catch (e) {
      toast.error(toErrorMessage(e))
      setVideoActive(false)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !sending) { e.preventDefault(); sendQuestion() }
  }

  const doctorName = session?.doctor?.nickname || session?.doctor?.username || '医生'

  /* ── Render ──────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <Loader2 className="w-6 h-6 animate-spin text-frost-400" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-snow-50">
      {/* ── 数字人视频区 ────────── */}
      <div className="relative flex-shrink-0">
        {/* 返回按钮 */}
        <button
          onClick={() => nav('/sessions')}
          className="absolute top-3 left-3 z-20 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform"
        >
          <ArrowLeft className="w-4.5 h-4.5 text-white" />
        </button>

        <DigitalHumanPlayer
          videos={assets?.videos || []}
          doctorName={doctorName}
          isResponding={videoActive}
          className="w-full aspect-[16/10] max-h-[35dvh]"
        />

        {/* 语音状态 */}
        {videoActive && audioState === 'playing' && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-black/30 backdrop-blur-sm rounded-full px-2.5 py-1">
            <span className="pulse-dot" style={{ transform: 'scale(0.7)' }} />
            <span className="text-[10px] text-white/80 font-medium">
              {audioInfo?.voice_name || '语音播放中'}
            </span>
          </div>
        )}
      </div>

      {/* ── 消息区 ─────────────── */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="py-12 text-center">
            <Sparkles className="w-8 h-8 text-frost-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400">向 {doctorName} 提问开始问诊</p>
            <p className="text-xs text-slate-300 mt-1">例如：最近睡眠不好怎么办？</p>
          </div>
        ) : messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div className={cn(
              'max-w-[88%] rounded-2xl px-4 py-3',
              msg.role === 'user'
                ? 'bg-gradient-to-br from-frost-500 to-frost-400 text-white rounded-br-md'
                : 'glass rounded-bl-md'
            )}>
              {/* 头部 */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className={cn(
                  'w-5 h-5 rounded-md flex items-center justify-center',
                  msg.role === 'user' ? 'bg-white/20' : 'bg-frost-50'
                )}>
                  {msg.role === 'user' ? <User className="w-3 h-3 text-white" /> : <Bot className="w-3 h-3 text-frost-500" />}
                </div>
                <span className={cn('text-[11px] font-medium', msg.role === 'user' ? 'text-white/70' : 'text-slate-400')}>
                  {msg.role === 'user' ? '我' : doctorName}
                </span>
                <span className={cn('text-[10px]', msg.role === 'user' ? 'text-white/40' : 'text-slate-300')}>
                  {dayjs(msg.created_at).format('HH:mm')}
                </span>
              </div>

              {/* 内容 */}
              {msg.role === 'assistant' ? (
                <div className="prose-patient">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.edited_markdown || msg.content_markdown || msg.content || ''}
                  </ReactMarkdown>
                  {msg.generation_status === 'generating' && (
                    <span className="inline-block w-1.5 h-4 bg-frost-400 rounded-sm animate-pulse ml-0.5" />
                  )}
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              )}

              {/* 错误 */}
              {msg.error_message && (
                <p className="text-[11px] text-petal-400 mt-1.5">{msg.error_message}</p>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── 音频完成统计 ──────── */}
      {!sending && audioInfo && audioInfo.status !== 'disabled' && (
        <div className="flex-shrink-0 px-4 py-1.5 bg-frost-50/60 border-t border-frost-100/60 flex items-center gap-3">
          <div className={cn(
            'text-[10px] font-medium px-2 py-0.5 rounded-md',
            audioInfo.status === 'succeeded' ? 'bg-aurora-50 text-aurora-600' : audioInfo.status === 'failed' ? 'bg-petal-50 text-petal-500' : 'bg-frost-100 text-frost-600'
          )}>
            {audioInfo.status === 'succeeded' ? '语音完成' : audioInfo.status === 'failed' ? '语音失败' : audioInfo.status}
          </div>
          {audioInfo.voice_name && <span className="text-[10px] text-slate-400">{audioInfo.voice_name}</span>}
          {typeof audioInfo.first_audio_delay_ms === 'number' && (
            <span className="text-[10px] text-slate-300">首帧 {audioInfo.first_audio_delay_ms}ms</span>
          )}
          <button
            onClick={() => setAudioInfo(null)}
            className="ml-auto text-[10px] text-slate-300 active:text-slate-500"
          >
            关闭
          </button>
        </div>
      )}

      {/* ── 输入区 ─────────────── */}
      <div className="flex-shrink-0 border-t border-slate-100 bg-white/80 backdrop-blur-sm px-3 py-2.5 safe-bottom">
        <div className="flex items-end gap-2">
          {/* 静音按钮 */}
          <button
            onClick={() => {
              const next = !audioMuted
              setAudioMuted(next)
              playerRef.current?.setMuted(next)
            }}
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors',
              audioMuted ? 'bg-slate-100 text-slate-400' : 'bg-frost-50 text-frost-500'
            )}
          >
            {audioMuted ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
          </button>

          {/* 输入框 */}
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="描述您的症状或问题…"
            className="flex-1 min-h-[40px] max-h-[100px] rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-frost-300 bg-white transition-all"
          />

          {/* 发送 */}
          <button
            onClick={sendQuestion}
            disabled={sending || !question.trim()}
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all',
              sending || !question.trim()
                ? 'bg-slate-100 text-slate-300'
                : 'btn-primary shadow-none'
            )}
          >
            {sending ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Send className="w-4.5 h-4.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
