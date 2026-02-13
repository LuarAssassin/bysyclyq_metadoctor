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
  ExternalLink,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  Send,
  Square,
  Sparkles,
  User,
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
    review_status: 'pending',
    reviewed_at: null,
    review_note: null,
    reply_to: null, content,
    content_markdown: content, edited_markdown: null, edited_at: null,
    model_name: null, selected_file_ids: [], selected_file_meta: [],
    grounding_answer: null, grounding_sources: [], search_sources: [],
    input_tokens: null, output_tokens: null, total_tokens: null,
    error_message: null, meta: null, created_at: now, updated_at: now,
    ...rest,
  }
}

function assistantReviewBubbleClass(reviewStatus: string) {
  if (reviewStatus === 'pending') {
    return 'rounded-bl-md border border-amber-200/80 bg-amber-50/75'
  }
  if (reviewStatus === 'rejected') {
    return 'rounded-bl-md border border-rose-200/80 bg-rose-50/75'
  }
  return 'glass rounded-bl-md'
}

function assistantReviewStatusLabel(reviewStatus: string) {
  if (reviewStatus === 'pending') return '待审核'
  if (reviewStatus === 'approved') return '已通过'
  if (reviewStatus === 'approved_edited') return '编辑后通过'
  if (reviewStatus === 'rejected') return '已驳回'
  return '状态未知'
}

function assistantReviewStatusBadgeClass(reviewStatus: string) {
  if (reviewStatus === 'pending') {
    return 'bg-amber-100/80 text-amber-700 border border-amber-200/80'
  }
  if (reviewStatus === 'approved' || reviewStatus === 'approved_edited') {
    return 'bg-emerald-100/80 text-emerald-700 border border-emerald-200/80'
  }
  if (reviewStatus === 'rejected') {
    return 'bg-rose-100/80 text-rose-700 border border-rose-200/80'
  }
  return 'bg-slate-100 text-slate-500 border border-slate-200'
}

interface SearchSourceItem {
  key: string
  index: number
  title: string
  url: string
}

function normalizeSearchSources(sources: Array<Record<string, unknown>>): SearchSourceItem[] {
  const seen = new Set<string>()
  const items: SearchSourceItem[] = []

  sources.forEach((source, idx) => {
    const url = typeof source.url === 'string' ? source.url.trim() : ''
    if (!url) return

    const title = typeof source.title === 'string' && source.title.trim()
      ? source.title.trim()
      : url

    const rawIndex = typeof source.index === 'number'
      ? source.index
      : typeof source.index === 'string'
        ? Number(source.index)
        : Number.NaN
    const index = Number.isFinite(rawIndex) && rawIndex > 0 ? Math.trunc(rawIndex) : idx + 1
    const key = `${index}-${url}`
    if (seen.has(key)) return

    seen.add(key)
    items.push({ key, index, title, url })
  })

  return items
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error) {
    const text = `${error.name} ${error.message}`.toLowerCase()
    return text.includes('abort')
  }
  return false
}

function isAutoplayBlockedError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'NotAllowedError'
  }
  if (error instanceof Error) {
    const text = `${error.name} ${error.message}`.toLowerCase()
    return text.includes('notallowed') || text.includes('not allowed') || text.includes('autoplay')
  }
  return false
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  return candidates.find((item) => MediaRecorder.isTypeSupported(item))
}

function extensionFromMimeType(mimeType: string): string {
  const lower = (mimeType || '').toLowerCase()
  if (lower.includes('webm')) return 'webm'
  if (lower.includes('ogg')) return 'ogg'
  if (lower.includes('wav')) return 'wav'
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3'
  if (lower.includes('mp4') || lower.includes('m4a')) return 'm4a'
  if (lower.includes('aac')) return 'aac'
  return 'webm'
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
  const [stopping, setStopping] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [videoActive, setVideoActive] = useState(false) // 数字人视频是否活跃（等语音播完才停）
  const [openingPlaying, setOpeningPlaying] = useState(false)
  const [openingAutoplayBlocked, setOpeningAutoplayBlocked] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const activeAnswerMessageIdRef = useRef<number | null>(null)
  const activeAnswerContentRef = useRef("")
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaChunksRef = useRef<Blob[]>([])
  const openingAudioRef = useRef<HTMLAudioElement | null>(null)
  const openingAutoPlayedRef = useRef(false)

  // Audio
  const [audioMuted, setAudioMuted] = useState(false)
  const [audioState, setAudioState] = useState<AudioPlayerState>('idle')
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null)
  const playerRef = useRef<PCMStreamPlayer | null>(null)

  const scrollBottom = () => requestAnimationFrame(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  })

  const resizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(Math.max(el.scrollHeight, 24), 120)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden'
  }

  const stopOpeningAudio = () => {
    if (openingAudioRef.current) {
      openingAudioRef.current.pause()
      openingAudioRef.current.src = ''
      openingAudioRef.current.load()
      openingAudioRef.current = null
    }
    setOpeningPlaying(false)
    setOpeningAutoplayBlocked(false)
  }

  const playOpeningAudio = async () => {
    const audio = openingAudioRef.current
    if (!audio) return false
    try {
      await audio.play()
      setOpeningAutoplayBlocked(false)
      return true
    } catch (error) {
      if (isAutoplayBlockedError(error)) {
        setOpeningAutoplayBlocked(true)
      }
      return false
    }
  }

  useEffect(() => { resizeInput() }, [question])

  // 清理
  useEffect(() => () => {
    streamAbortRef.current?.abort()
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    } catch {
      // noop
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaRecorderRef.current = null
    mediaStreamRef.current = null
    mediaChunksRef.current = []
    stopOpeningAudio()
    playerRef.current?.stop()
  }, [])

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

  useEffect(() => {
    if (openingAudioRef.current) {
      openingAudioRef.current.muted = audioMuted
    }
  }, [audioMuted])

  useEffect(() => {
    openingAutoPlayedRef.current = false
    stopOpeningAudio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (messages.length > 0) {
      stopOpeningAudio()
      return
    }

    const openingAudioUrl = assets?.opening?.audio_url || ''
    if (!openingAudioUrl || openingAutoPlayedRef.current) return

    const audio = new Audio(openingAudioUrl)
    audio.preload = 'auto'
    audio.muted = audioMuted
    openingAudioRef.current = audio
    openingAutoPlayedRef.current = true

    const handlePlay = () => setOpeningPlaying(true)
    const handleStop = () => setOpeningPlaying(false)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handleStop)
    audio.addEventListener('ended', handleStop)

    void playOpeningAudio().then((ok) => {
      if (ok) return
      const retryByGesture = () => {
        void playOpeningAudio().then((played) => {
          if (!played) return
          document.removeEventListener('pointerdown', retryByGesture)
          document.removeEventListener('touchstart', retryByGesture)
          document.removeEventListener('keydown', retryByGesture)
        })
      }
      document.addEventListener('pointerdown', retryByGesture)
      document.addEventListener('touchstart', retryByGesture, { passive: true })
      document.addEventListener('keydown', retryByGesture)
      // 清理由 effect return 统一处理
      ;(audio as HTMLAudioElement & { _retryByGesture?: () => void })._retryByGesture = retryByGesture
    })

    return () => {
      const retryByGesture = (audio as HTMLAudioElement & { _retryByGesture?: () => void })._retryByGesture
      if (retryByGesture) {
        document.removeEventListener('pointerdown', retryByGesture)
        document.removeEventListener('touchstart', retryByGesture)
        document.removeEventListener('keydown', retryByGesture)
      }
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handleStop)
      audio.removeEventListener('ended', handleStop)
      audio.pause()
      if (openingAudioRef.current === audio) {
        openingAudioRef.current = null
      }
      setOpeningPlaying(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets?.opening?.audio_url, messages.length, audioMuted])

  /* ── 语音输入 ────────────────── */

  const startRecording = async () => {
    if (sending || stopping || recording || transcribing) return
    if (typeof MediaRecorder === 'undefined') {
      toast.error('当前浏览器不支持录音，请改用文字输入')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('当前设备不支持麦克风录音')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMime = pickRecorderMimeType()
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream)

      mediaChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          mediaChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        toast.error('录音失败，请重试')
        stream.getTracks().forEach((track) => track.stop())
        mediaRecorderRef.current = null
        mediaStreamRef.current = null
        mediaChunksRef.current = []
        setRecording(false)
      }

      recorder.onstop = async () => {
        setRecording(false)
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null

        const mimeType = recorder.mimeType || preferredMime || 'audio/webm'
        const blob = new Blob(mediaChunksRef.current, { type: mimeType })
        mediaRecorderRef.current = null
        mediaChunksRef.current = []

        if (!blob.size) {
          toast.warning('未检测到有效语音，请重试')
          return
        }

        setTranscribing(true)
        try {
          const ext = extensionFromMimeType(mimeType)
          const fileName = `patient-question-${Date.now()}.${ext}`
          const result = await sessionApi.transcribeAudio(blob, fileName)
          const recognized = (result.text || '').trim()
          if (!recognized) {
            toast.warning('未识别到有效语音内容')
            return
          }
          setQuestion((prev) => (prev.trim() ? `${prev}\n${recognized}` : recognized))
          requestAnimationFrame(() => {
            resizeInput()
            inputRef.current?.focus()
          })
        } catch (error) {
          toast.error(toErrorMessage(error))
        } finally {
          setTranscribing(false)
        }
      }

      recorder.start(250)
      setRecording(true)
    } catch (error) {
      toast.error(toErrorMessage(error))
    }
  }

  const stopRecording = () => {
    if (!recording) return
    try {
      mediaRecorderRef.current?.stop()
    } catch {
      setRecording(false)
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null
      mediaStreamRef.current = null
      mediaChunksRef.current = []
    }
  }

  /* ── 发送问题 ────────────────── */

  const sendQuestion = async () => {
    if (sending || stopping || recording || transcribing) return
    const q = question.trim()
    if (!q) { toast.warning('请输入您的问题'); return }
    if (!sessionId) return

    const controller = new AbortController()
    streamAbortRef.current?.abort()
    streamAbortRef.current = controller
    activeAnswerMessageIdRef.current = null
    activeAnswerContentRef.current = ""

    setSending(true)
    stopOpeningAudio()
    // 发送问题后先保持“待机轻动”，收到模型回答增量再切到响应态随机播放。
    setVideoActive(false)
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
    const tempUser = makeTempMsg({
      id: -Date.now(),
      role: 'user',
      content: q,
      generation_status: 'succeeded',
      review_status: 'approved',
    })
    setMessages((prev) => [...prev, tempUser])
    scrollBottom()

    let startPayload: SSEStartEvent | null = null
    let hasResponseStarted = false

    try {
      await askPatientStream(
        sessionId,
        { question: q, enable_audio: true },
        {
          onStart: (data) => {
            startPayload = data
            activeAnswerMessageIdRef.current = data.answer_message_id
            if (data.audio) setAudioInfo(data.audio)
            setMessages((prev) => {
              let next = prev.map((m) => m.id === tempUser.id ? { ...m, id: data.question_message_id } : m)
              const assistantMsg = makeTempMsg({
                id: data.answer_message_id, role: 'assistant', content: '',
                generation_status: 'generating', reply_to: data.question_message_id,
                review_status: 'pending',
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
            if (!hasResponseStarted) {
              hasResponseStarted = true
              setVideoActive(true)
            }
            activeAnswerContentRef.current = `${activeAnswerContentRef.current}${data.delta}`
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
            setMessages((prev) => {
              const next = prev.map((m) =>
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
              )
              const latest = next.find((m) => m.id === data.message_id)?.content || activeAnswerContentRef.current
              activeAnswerContentRef.current = latest
              return next
            })
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
        { signal: controller.signal },
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
      if (!isAbortError(e)) toast.error(toErrorMessage(e))
      setVideoActive(false)
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
      }
      activeAnswerMessageIdRef.current = null
      activeAnswerContentRef.current = ""
      setSending(false)
    }
  }

  const stopGeneration = async () => {
    if (!sending || stopping || !sessionId) return
    setStopping(true)
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    playerRef.current?.stop()
    playerRef.current = null
    setAudioState('stopped')
    setVideoActive(false)

    try {
      const messageId = activeAnswerMessageIdRef.current
      if (messageId) {
        await sessionApi.interruptMessage(
          sessionId,
          messageId,
          activeAnswerContentRef.current,
        )
      }
      const final = await sessionApi.messages(sessionId)
      setMessages(final.messages)
    } catch (e) {
      toast.error(toErrorMessage(e))
    } finally {
      activeAnswerMessageIdRef.current = null
      activeAnswerContentRef.current = ""
      setSending(false)
      setStopping(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !sending && !stopping && !recording && !transcribing) {
      e.preventDefault()
      sendQuestion()
    }
  }

  const doctorName = session?.doctor?.nickname || session?.doctor?.username || '医生'
  const openingText = (assets?.opening?.text || '').trim()
  const hasTypedQuestion = question.trim().length > 0

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
          muted={audioMuted}
          onToggleMute={() => {
            const next = !audioMuted
            setAudioMuted(next)
            playerRef.current?.setMuted(next)
          }}
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
          <div className="py-8">
            {openingText ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl px-4 py-3"
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-5 h-5 rounded-md bg-frost-50 flex items-center justify-center">
                    <Bot className="w-3 h-3 text-frost-500" />
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">{doctorName} 开场白</span>
                  {openingPlaying && (
                    <span className="ml-auto text-[10px] text-frost-500">播放中</span>
                  )}
                </div>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {openingText}
                </p>
                {assets?.opening?.audio_url && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => {
                        const audio = openingAudioRef.current
                        if (!audio) return
                        if (openingPlaying) {
                          audio.pause()
                          return
                        }
                        void playOpeningAudio()
                      }}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-frost-50 text-frost-600 text-[11px] font-medium"
                    >
                      {openingPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      {openingPlaying ? '暂停' : '播放开场白'}
                    </button>
                    {openingAutoplayBlocked && (
                      <span className="text-[10px] text-slate-400">自动播放受限，请手动播放</span>
                    )}
                  </div>
                )}
                {!assets?.opening?.audio_url && (
                  <p className="mt-2 text-[10px] text-slate-400">
                    暂无开场白语音，请在医生端保存开场白后自动生成
                  </p>
                )}
              </motion.div>
            ) : (
              <div className="text-center">
                <Sparkles className="w-8 h-8 text-frost-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400">向 {doctorName} 提问开始问诊</p>
              </div>
            )}
            <p className="text-xs text-slate-300 mt-4 text-center">例如：最近睡眠不好怎么办？</p>
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
                : assistantReviewBubbleClass(msg.review_status)
            )}>
              {/* 头部 */}
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className={cn(
                    'w-5 h-5 rounded-md flex items-center justify-center',
                    msg.role === 'user' ? 'bg-white/20' : 'bg-frost-50'
                  )}>
                    {msg.role === 'user' ? <User className="w-3 h-3 text-white" /> : <Bot className="w-3 h-3 text-frost-500" />}
                  </div>
                  <span className={cn('text-[11px] font-medium truncate', msg.role === 'user' ? 'text-white/70' : 'text-slate-400')}>
                    {msg.role === 'user' ? '我' : doctorName}
                  </span>
                  <span className={cn('text-[10px] flex-shrink-0', msg.role === 'user' ? 'text-white/40' : 'text-slate-300')}>
                    {dayjs(msg.created_at).format('HH:mm')}
                  </span>
                </div>
                {msg.role === 'assistant' && (
                  <span
                    className={cn(
                      'inline-flex items-center h-5 px-2 rounded-md text-[10px] font-medium whitespace-nowrap',
                      assistantReviewStatusBadgeClass(msg.review_status),
                    )}
                  >
                    {assistantReviewStatusLabel(msg.review_status)}
                  </span>
                )}
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

              {msg.role === 'assistant' && (() => {
                const sources = normalizeSearchSources(msg.search_sources || [])
                if (!sources.length) return null
                return (
                  <div className="mt-2 pt-2 border-t border-slate-100/70">
                    <p className="text-[11px] text-slate-400 mb-1.5">参考来源</p>
                    <div className="space-y-1.5">
                      {sources.map((source) => (
                        <a
                          key={source.key}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[11px] leading-relaxed text-frost-600 hover:text-frost-500"
                        >
                          <span className="text-slate-400 mr-1">[{source.index}]</span>
                          {source.title}
                          <ExternalLink className="w-3 h-3 inline ml-1 align-text-bottom" />
                        </a>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── 音频完成统计 ──────── */}
      {!sending && !stopping && audioInfo && audioInfo.status !== 'disabled' && (
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
      <div className="flex-shrink-0 px-3 pt-2 pb-[calc(var(--safe-bottom)+10px)] bg-gradient-to-t from-white/95 via-white/85 to-transparent">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => toast.info('上传功能即将上线')}
            className="w-11 h-11 rounded-2xl border border-slate-200 bg-white/90 text-slate-500 flex items-center justify-center shadow-[0_6px_16px_rgba(15,23,42,0.08)] active:scale-95 transition-all"
            title="上传（即将支持）"
          >
            <Plus className="w-5 h-5" />
          </button>

          <div className="flex-1 rounded-[26px] border border-slate-200/90 bg-white/95 px-2.5 py-1.5 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-2">
              <textarea
                ref={inputRef}
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value)
                  resizeInput()
                }}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={sending || stopping}
                placeholder="描述您的症状或问题…"
                className="flex-1 min-h-[24px] max-h-[120px] bg-transparent px-1.5 py-0 leading-6 text-sm resize-none focus:outline-none placeholder:text-slate-300 text-slate-700 disabled:text-slate-400"
              />

              <button
                onClick={() => {
                  if (sending) {
                    void stopGeneration()
                    return
                  }
                  if (hasTypedQuestion) {
                    void sendQuestion()
                    return
                  }
                  if (recording) {
                    stopRecording()
                    return
                  }
                  void startRecording()
                }}
                disabled={
                  sending
                    ? stopping
                    : hasTypedQuestion
                      ? (stopping || recording || transcribing)
                      : (stopping || transcribing)
                }
                className={cn(
                  'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all',
                  stopping || transcribing
                    ? 'bg-slate-100 text-slate-300'
                    : (sending || recording)
                      ? 'bg-gradient-to-br from-rose-500 to-rose-400 text-white shadow-[0_8px_18px_rgba(244,63,94,0.30)] active:scale-95'
                      : hasTypedQuestion
                        ? 'bg-gradient-to-br from-frost-500 to-frost-400 text-white shadow-[0_8px_18px_rgba(14,165,233,0.30)] active:scale-95'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200/80'
                )}
                title={
                  sending
                    ? '停止生成'
                    : hasTypedQuestion
                      ? '发送问题'
                      : recording
                        ? '结束录音'
                        : '语音输入'
                }
              >
                {stopping || transcribing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : sending ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : hasTypedQuestion ? (
                  <Send className="w-4 h-4" />
                ) : recording ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
