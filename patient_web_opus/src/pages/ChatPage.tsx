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
  PatientChatAttachment,
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
  Camera,
  ExternalLink,
  FileImage,
  FileText,
  Loader2,
  Mic,
  Pause,
  Paperclip,
  Play,
  Plus,
  Send,
  Square,
  Sparkles,
  User,
  X,
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

function normalizeMessageAttachments(meta: unknown): PatientChatAttachment[] {
  if (!meta || typeof meta !== 'object') return []
  const attachmentsRaw = (meta as Record<string, unknown>).attachments
  if (!Array.isArray(attachmentsRaw)) return []

  const items: PatientChatAttachment[] = []
  attachmentsRaw.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const row = item as Record<string, unknown>
    const attachmentId = typeof row.attachment_id === 'string' ? row.attachment_id : ''
    const fileKind = typeof row.file_kind === 'string' ? row.file_kind : 'document'
    const fileName = typeof row.file_name === 'string' ? row.file_name : '未命名附件'
    const contentType = typeof row.content_type === 'string' ? row.content_type : null
    const sizeBytes = typeof row.size_bytes === 'number' ? row.size_bytes : 0
    const fileUrl = typeof row.file_url === 'string'
      ? row.file_url
      : typeof row.oss_url === 'string'
        ? row.oss_url
        : null
    const previewUrl = typeof row.preview_url === 'string' ? row.preview_url : fileUrl
    const createdAt = typeof row.created_at === 'string' ? row.created_at : ''
    if (!attachmentId && !fileName) return
    items.push({
      attachment_id: attachmentId || `meta-${items.length}-${fileName}`,
      file_kind: fileKind,
      file_name: fileName,
      content_type: contentType,
      size_bytes: sizeBytes,
      file_url: fileUrl,
      preview_url: previewUrl,
      created_at: createdAt,
    })
  })

  return items
}

function formatAttachmentSize(sizeBytes: number): string {
  const size = Number(sizeBytes || 0)
  if (size <= 0) return ''
  if (size < 1024) return `${size}B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`
  return `${(size / (1024 * 1024)).toFixed(1)}MB`
}

function stripAttachmentSummaryText(content: string, hasAttachments: boolean): string {
  if (!hasAttachments) return content
  const normalized = String(content || '')
  const stripped = normalized.replace(/\n\[附件\]\n[\s\S]*$/u, '').trimEnd()
  return stripped || normalized
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

function formatRecordDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

type AttachmentPickerMode = 'all' | 'image' | 'document'

const REPORT_DOC_EXTENSIONS = [
  '.txt',
  '.md',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.json',
  '.epub',
  '.mobi',
]

const REPORT_DOC_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'application/json',
  'application/epub+zip',
  'application/x-mobipocket-ebook',
]

function isImageAttachmentFile(file: File): boolean {
  const mime = String(file.type || '').toLowerCase()
  const name = String(file.name || '').toLowerCase()
  return (
    mime.startsWith('image/')
    || /\.(jpe?g|png|gif|bmp|webp)$/.test(name)
  )
}

function isDocumentAttachmentFile(file: File): boolean {
  if (isImageAttachmentFile(file)) return false
  const mime = String(file.type || '').toLowerCase()
  const name = String(file.name || '').toLowerCase()
  const byMime = REPORT_DOC_MIME_TYPES.includes(mime)
  const byExt = REPORT_DOC_EXTENSIONS.some((ext) => name.endsWith(ext))
  return byMime || byExt
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
  const [pendingAttachments, setPendingAttachments] = useState<PatientChatAttachment[]>([])
  const [uploadingAttachments, setUploadingAttachments] = useState(false)
  const [sending, setSending] = useState(false)
  const [waitingAssistantStart, setWaitingAssistantStart] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [videoActive, setVideoActive] = useState(false) // 数字人视频是否活跃（等语音播完才停）
  const [openingPlaying, setOpeningPlaying] = useState(false)
  const [openingAutoplayBlocked, setOpeningAutoplayBlocked] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const imageAttachmentInputRef = useRef<HTMLInputElement>(null)
  const reportAttachmentInputRef = useRef<HTMLInputElement>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const activeAnswerMessageIdRef = useRef<number | null>(null)
  const activeAnswerContentRef = useRef("")
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaChunksRef = useRef<Blob[]>([])
  const recordingWaveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const recordingAnalyserRef = useRef<AnalyserNode | null>(null)
  const recordingAudioCtxRef = useRef<AudioContext | null>(null)
  const recordingWaveAnimRef = useRef(0)
  const recordingWaveDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const openingAudioRef = useRef<HTMLAudioElement | null>(null)
  const openingAutoPlayedRef = useRef(false)
  const [recordSec, setRecordSec] = useState(0)

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

  const stopRecordingVisualization = useCallback((options?: { resetDuration?: boolean }) => {
    const resetDuration = options?.resetDuration ?? true
    cancelAnimationFrame(recordingWaveAnimRef.current)
    recordingWaveAnimRef.current = 0
    recordingAnalyserRef.current = null
    recordingWaveDataRef.current = null
    recordingStartedAtRef.current = null
    if (recordingAudioCtxRef.current) {
      void recordingAudioCtxRef.current.close().catch(() => {
        // noop
      })
      recordingAudioCtxRef.current = null
    }

    const canvas = recordingWaveCanvasRef.current
    if (canvas) {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.floor(rect.width * dpr))
      const height = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, rect.width, rect.height)
      }
    }

    if (resetDuration) setRecordSec(0)
  }, [])

  const drawRecordingWave = useCallback(() => {
    const canvas = recordingWaveCanvasRef.current
    if (!canvas) return
    const analyser = recordingAnalyserRef.current

    const rect = canvas.getBoundingClientRect()
    const widthCss = Math.max(1, rect.width)
    const heightCss = Math.max(1, rect.height)
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const widthPx = Math.floor(widthCss * dpr)
    const heightPx = Math.floor(heightCss * dpr)
    if (canvas.width !== widthPx || canvas.height !== heightPx) {
      canvas.width = widthPx
      canvas.height = heightPx
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const bg = ctx.createLinearGradient(0, 0, widthCss, 0)
    bg.addColorStop(0, 'rgba(224, 242, 254, 0.75)')
    bg.addColorStop(1, 'rgba(240, 249, 255, 0.88)')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, widthCss, heightCss)

    ctx.beginPath()
    ctx.moveTo(0, heightCss / 2)
    ctx.lineTo(widthCss, heightCss / 2)
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.14)'
    ctx.lineWidth = 1
    ctx.stroke()

    const wave = ctx.createLinearGradient(0, 0, widthCss, 0)
    wave.addColorStop(0, 'rgba(14, 165, 233, 0.82)')
    wave.addColorStop(1, 'rgba(6, 182, 212, 0.72)')

    let pointCount = 96
    let data: Uint8Array<ArrayBuffer> | null = null
    if (analyser) {
      const timeDomainLength = analyser.fftSize
      pointCount = Math.max(8, timeDomainLength)
      if (!recordingWaveDataRef.current || recordingWaveDataRef.current.length !== timeDomainLength) {
        recordingWaveDataRef.current = new Uint8Array(new ArrayBuffer(timeDomainLength))
      }
      data = recordingWaveDataRef.current
      analyser.getByteTimeDomainData(data)
    }

    ctx.beginPath()
    const now = performance.now()
    const centerY = heightCss / 2
    const simAmp = heightCss * (0.14 + 0.05 * Math.sin(now / 700))
    for (let i = 0; i < pointCount; i += 1) {
      const x = (i / (pointCount - 1)) * widthCss
      const y = data
        ? (data[i] / 255) * heightCss
        : centerY + Math.sin((now / 170) + i * 0.34) * simAmp
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = wave
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.shadowColor = 'rgba(14, 165, 233, 0.22)'
    ctx.shadowBlur = 8
    ctx.stroke()
    ctx.shadowBlur = 0

    recordingWaveAnimRef.current = requestAnimationFrame(drawRecordingWave)
  }, [])

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

  useEffect(() => {
    if (!recording) return
    if (!recordingStartedAtRef.current) {
      recordingStartedAtRef.current = performance.now()
    }
    setRecordSec(0)
    const timer = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current
      if (!startedAt) return
      const elapsed = Math.max(0, Math.floor((performance.now() - startedAt) / 1000))
      setRecordSec(elapsed)
    }, 200)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(() => {
    if (!recording) return
    const rafId = requestAnimationFrame(() => {
      cancelAnimationFrame(recordingWaveAnimRef.current)
      drawRecordingWave()
    })
    return () => cancelAnimationFrame(rafId)
  }, [recording, drawRecordingWave])

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
    stopRecordingVisualization()
    stopOpeningAudio()
    playerRef.current?.stop()
  }, [stopRecordingVisualization])

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
    setPendingAttachments([])
    setUploadingAttachments(false)
    setWaitingAssistantStart(false)
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

  useEffect(() => {
    if (!waitingAssistantStart) return
    scrollBottom()
  }, [waitingAssistantStart])

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

      stopRecordingVisualization()

      mediaChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder

      const audioCtxCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (audioCtxCtor) {
        try {
          const audioCtx = new audioCtxCtor()
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume().catch(() => {
              // noop
            })
          }
          const source = audioCtx.createMediaStreamSource(stream)
          const analyser = audioCtx.createAnalyser()
          analyser.fftSize = 1024
          analyser.smoothingTimeConstant = 0.84
          source.connect(analyser)
          recordingAudioCtxRef.current = audioCtx
          recordingAnalyserRef.current = analyser
          recordingStartedAtRef.current = performance.now()
        } catch {
          stopRecordingVisualization({ resetDuration: false })
        }
      }

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
        stopRecordingVisualization()
        setRecording(false)
      }

      recorder.onstop = async () => {
        setRecording(false)
        stopRecordingVisualization({ resetDuration: false })
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null

        const mimeType = recorder.mimeType || preferredMime || 'audio/webm'
        const blob = new Blob(mediaChunksRef.current, { type: mimeType })
        mediaRecorderRef.current = null
        mediaChunksRef.current = []

        if (!blob.size) {
          setRecordSec(0)
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
          setRecordSec(0)
          setTranscribing(false)
        }
      }

      recorder.start(250)
      setRecording(true)
      requestAnimationFrame(() => {
        cancelAnimationFrame(recordingWaveAnimRef.current)
        drawRecordingWave()
      })
    } catch (error) {
      stopRecordingVisualization()
      toast.error(toErrorMessage(error))
    }
  }

  const stopRecording = () => {
    if (!recording) return
    try {
      mediaRecorderRef.current?.stop()
    } catch {
      setRecording(false)
      stopRecordingVisualization()
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null
      mediaStreamRef.current = null
      mediaChunksRef.current = []
    }
  }

  const openAttachmentPicker = (mode: AttachmentPickerMode = 'all') => {
    if (sending || stopping || recording || transcribing || uploadingAttachments) return
    if (mode === 'image') {
      imageAttachmentInputRef.current?.click()
      return
    }
    if (mode === 'document') {
      reportAttachmentInputRef.current?.click()
      return
    }
    attachmentInputRef.current?.click()
  }

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((prev) => prev.filter((item) => item.attachment_id !== attachmentId))
  }

  const handleAttachmentFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
    mode: AttachmentPickerMode = 'all',
  ) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length || !sessionId) return

    if (sending || stopping || recording || transcribing) {
      toast.warning('当前正在对话处理中，请稍后上传附件')
      return
    }

    let uploadFiles = files
    if (mode === 'image') {
      uploadFiles = files.filter((file) => isImageAttachmentFile(file))
      if (!uploadFiles.length) {
        toast.warning('请上传图片文件')
        return
      }
    } else if (mode === 'document') {
      uploadFiles = files.filter((file) => isDocumentAttachmentFile(file))
      if (!uploadFiles.length) {
        toast.warning('请上传报告文档（如 PDF、DOCX）')
        return
      }
    }

    const ignoredCount = files.length - uploadFiles.length
    if (ignoredCount > 0) {
      toast.info(`已忽略 ${ignoredCount} 个不符合类型的文件`)
    }

    setUploadingAttachments(true)
    try {
      const result = await sessionApi.uploadAttachments(sessionId, uploadFiles)
      const uploaded = result.attachments || []
      if (!uploaded.length) {
        toast.warning('未返回可用附件，请重试')
        return
      }
      setPendingAttachments((prev) => {
        const next = [...prev]
        uploaded.forEach((item) => {
          if (!next.some((existing) => existing.attachment_id === item.attachment_id)) {
            next.push(item)
          }
        })
        return next
      })
      toast.success(`已添加 ${uploaded.length} 个附件`)
    } catch (error) {
      toast.error(toErrorMessage(error))
    } finally {
      setUploadingAttachments(false)
    }
  }

  /* ── 发送问题 ────────────────── */

  const sendQuestion = async () => {
    if (sending || stopping || recording || transcribing || uploadingAttachments) return
    const q = question.trim()
    const pending = [...pendingAttachments]
    if (!q && !pending.length) { toast.warning('请输入您的问题'); return }
    if (!sessionId) return
    const askQuestion = q || '请结合我上传的附件，给出专业分析和建议。'
    const attachmentIds = pending
      .map((item) => item.attachment_id)
      .filter((item) => Boolean(item))

    const controller = new AbortController()
    streamAbortRef.current?.abort()
    streamAbortRef.current = controller
    activeAnswerMessageIdRef.current = null
    activeAnswerContentRef.current = ""

    setSending(true)
    setWaitingAssistantStart(true)
    stopOpeningAudio()
    // 发送问题后先保持“待机轻动”，收到模型回答增量再切到响应态随机播放。
    setVideoActive(false)
    setQuestion('')
    setPendingAttachments([])

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
      content: askQuestion,
      content_markdown: askQuestion,
      meta: pending.length
        ? {
            attachments: pending.map((item) => ({
              attachment_id: item.attachment_id,
              file_kind: item.file_kind,
              file_name: item.file_name,
              content_type: item.content_type,
              size_bytes: item.size_bytes,
              file_url: item.file_url,
              preview_url: item.preview_url,
              created_at: item.created_at,
            })),
          }
        : null,
      generation_status: 'succeeded',
      review_status: 'approved',
    })
    setMessages((prev) => [...prev, tempUser])
    scrollBottom()

    let startPayload: SSEStartEvent | null = null
    let hasResponseStarted = false
    let streamStarted = false

    try {
      await askPatientStream(
        sessionId,
        {
          question: askQuestion,
          attachment_ids: attachmentIds,
          enable_audio: true,
        },
        {
          onStart: (data) => {
            streamStarted = true
            setWaitingAssistantStart(false)
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
            setWaitingAssistantStart(false)
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
            setWaitingAssistantStart(false)
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
      setWaitingAssistantStart(false)
      if (!streamStarted && pending.length) {
        setPendingAttachments((prev) => (prev.length ? prev : pending))
      }
      if (!isAbortError(e)) toast.error(toErrorMessage(e))
      setVideoActive(false)
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
      }
      activeAnswerMessageIdRef.current = null
      activeAnswerContentRef.current = ""
      setWaitingAssistantStart(false)
      setSending(false)
    }
  }

  const stopGeneration = async () => {
    if (!sending || stopping || !sessionId) return
    setStopping(true)
    setWaitingAssistantStart(false)
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
  const hasSendableInput = hasTypedQuestion || pendingAttachments.length > 0

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
        ) : messages.map((msg) => {
          const messageAttachments = normalizeMessageAttachments(msg.meta)
          const userDisplayContent = stripAttachmentSummaryText(
            msg.content || '',
            messageAttachments.length > 0,
          )
          const assistantRawContent = msg.edited_markdown || msg.content_markdown || msg.content || ''
          const assistantVisibleContent = assistantRawContent.replace('[生成中]', '').trim()
          const showAssistantLoading = (
            msg.role === 'assistant'
            && msg.generation_status === 'generating'
            && !assistantVisibleContent
          )
          return (
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
                  showAssistantLoading ? (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-frost-500" />
                      <span className="text-[13px]">医生正在分析中…</span>
                    </div>
                  ) : (
                    <div className="prose-patient">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {assistantRawContent}
                      </ReactMarkdown>
                      {msg.generation_status === 'generating' && (
                        <span className="inline-block w-1.5 h-4 bg-frost-400 rounded-sm animate-pulse ml-0.5" />
                      )}
                    </div>
                  )
                ) : (
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{userDisplayContent}</p>
                )}

                {msg.role === 'user' && messageAttachments.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {messageAttachments.map((attachment) => {
                      const isImage = attachment.file_kind === 'image'
                      const fileUrl = attachment.file_url || attachment.preview_url
                      const sizeText = formatAttachmentSize(attachment.size_bytes)
                      return (
                        <a
                          key={attachment.attachment_id}
                          href={fileUrl || '#'}
                          target={fileUrl ? '_blank' : undefined}
                          rel={fileUrl ? 'noopener noreferrer' : undefined}
                          className={cn(
                            'flex items-center gap-2 rounded-xl px-2 py-1.5 border',
                            fileUrl
                              ? 'border-white/25 bg-white/12 active:bg-white/18'
                              : 'border-white/20 bg-white/8',
                          )}
                          onClick={(event) => {
                            if (!fileUrl) event.preventDefault()
                          }}
                        >
                          <div className="w-7 h-7 rounded-md bg-white/20 flex items-center justify-center overflow-hidden">
                            {isImage && attachment.preview_url ? (
                              <img
                                src={attachment.preview_url}
                                alt={attachment.file_name}
                                className="w-full h-full object-cover"
                              />
                            ) : isImage ? (
                              <FileImage className="w-4 h-4 text-white/85" />
                            ) : (
                              <FileText className="w-4 h-4 text-white/85" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-white/90 truncate">{attachment.file_name}</p>
                            {sizeText && (
                              <p className="text-[10px] text-white/60">{sizeText}</p>
                            )}
                          </div>
                        </a>
                      )
                    })}
                  </div>
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
          )
        })}

        {waitingAssistantStart && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="max-w-[88%] rounded-2xl rounded-bl-md px-4 py-3 glass">
              <div className="flex items-center gap-2 text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-frost-500" />
                <span className="text-[13px]">医生正在思考中…</span>
              </div>
            </div>
          </motion.div>
        )}
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
        {(recording || transcribing) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-2.5 rounded-2xl border border-frost-100/80 bg-white/92 px-3 py-2 shadow-[0_10px_24px_rgba(14,165,233,0.12)] backdrop-blur-sm"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                {recording ? (
                  <span className="pulse-dot shrink-0" style={{ transform: 'scale(0.78)' }} />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 text-frost-500 animate-spin shrink-0" />
                )}
                <span className="text-[11px] font-medium text-slate-600 truncate">
                  {recording ? '正在聆听，请继续描述症状' : '语音识别中，马上填入输入框'}
                </span>
              </div>
              {(recording || recordSec > 0) && (
                <span className="text-[10px] font-mono text-frost-500">{formatRecordDuration(recordSec)}</span>
              )}
            </div>

            <div className="h-11 rounded-xl overflow-hidden border border-frost-100/70 bg-gradient-to-r from-snow-50 to-white">
              {recording ? (
                <canvas
                  ref={recordingWaveCanvasRef}
                  className="w-full h-full"
                />
              ) : (
                <div className="w-full h-full px-2.5 flex items-center gap-1.5">
                  {Array.from({ length: 16 }).map((_, idx) => (
                    <span
                      key={idx}
                      className="flex-1 rounded-full bg-gradient-to-t from-frost-300/75 to-frost-500/85 animate-pulse"
                      style={{
                        height: `${30 + ((idx * 17) % 46)}%`,
                        animationDelay: `${idx * 65}ms`,
                        animationDuration: '1s',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        <div className="mb-2.5 -mx-1 px-1 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max pr-1">
            <button
              type="button"
              onClick={() => openAttachmentPicker('image')}
              disabled={sending || stopping || recording || transcribing || uploadingAttachments}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] font-medium whitespace-nowrap',
                'border-slate-200/90 bg-white/90 text-slate-600',
                sending || stopping || recording || transcribing || uploadingAttachments
                  ? 'opacity-50'
                  : 'active:scale-95',
              )}
            >
              <Camera className="w-3.5 h-3.5" />
              拍药盒
            </button>
            <button
              type="button"
              onClick={() => openAttachmentPicker('document')}
              disabled={sending || stopping || recording || transcribing || uploadingAttachments}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] font-medium whitespace-nowrap',
                'border-slate-200/90 bg-white/90 text-slate-600',
                sending || stopping || recording || transcribing || uploadingAttachments
                  ? 'opacity-50'
                  : 'active:scale-95',
              )}
            >
              <FileText className="w-3.5 h-3.5" />
              传报告
            </button>
          </div>
        </div>

        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.gif,.bmp,.webp,.txt,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.epub,.mobi"
          className="hidden"
          onChange={(event) => {
            void handleAttachmentFileChange(event, 'all')
          }}
        />
        <input
          ref={imageAttachmentInputRef}
          type="file"
          multiple
          accept="image/*,.jpg,.jpeg,.png,.gif,.bmp,.webp"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            void handleAttachmentFileChange(event, 'image')
          }}
        />
        <input
          ref={reportAttachmentInputRef}
          type="file"
          multiple
          accept=".txt,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.epub,.mobi"
          className="hidden"
          onChange={(event) => {
            void handleAttachmentFileChange(event, 'document')
          }}
        />

        {(uploadingAttachments || pendingAttachments.length > 0) && (
          <div className="mb-2.5 rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
            <div className="flex items-center gap-2">
              <Paperclip className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] text-slate-500 font-medium">
                {uploadingAttachments
                  ? '附件上传中…'
                  : `已添加 ${pendingAttachments.length} 个附件`}
              </span>
            </div>
            {!!pendingAttachments.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {pendingAttachments.map((attachment) => {
                  const isImage = attachment.file_kind === 'image'
                  const sizeText = formatAttachmentSize(attachment.size_bytes)
                  return (
                    <div
                      key={attachment.attachment_id}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-2 py-1.5 max-w-full"
                    >
                      {isImage && attachment.preview_url ? (
                        <img
                          src={attachment.preview_url}
                          alt={attachment.file_name}
                          className="w-8 h-8 rounded-md object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-md bg-white border border-slate-200 flex items-center justify-center">
                          {isImage ? (
                            <FileImage className="w-4 h-4 text-frost-500" />
                          ) : (
                            <FileText className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] text-slate-600 truncate max-w-[150px]">{attachment.file_name}</p>
                        {sizeText && (
                          <p className="text-[10px] text-slate-400">{sizeText}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(attachment.attachment_id)}
                        disabled={sending || stopping || uploadingAttachments}
                        className="w-5 h-5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center disabled:opacity-40"
                        title="移除附件"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => openAttachmentPicker('all')}
            disabled={sending || stopping || recording || transcribing || uploadingAttachments}
            className={cn(
              'w-11 h-11 rounded-2xl border border-slate-200 bg-white/90 text-slate-500 flex items-center justify-center shadow-[0_6px_16px_rgba(15,23,42,0.08)] transition-all',
              sending || stopping || recording || transcribing || uploadingAttachments
                ? 'opacity-55'
                : 'active:scale-95',
            )}
            title="上传图片/文档"
          >
            {uploadingAttachments ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Plus className="w-5 h-5" />
            )}
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
                  if (hasSendableInput) {
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
                    : hasSendableInput
                      ? (stopping || recording || transcribing || uploadingAttachments)
                      : (stopping || transcribing || uploadingAttachments)
                }
                className={cn(
                  'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all',
                  stopping || transcribing
                    ? 'bg-slate-100 text-slate-300'
                    : (sending || recording)
                      ? 'bg-gradient-to-br from-rose-500 to-rose-400 text-white shadow-[0_8px_18px_rgba(244,63,94,0.30)] active:scale-95'
                      : hasSendableInput
                        ? 'bg-gradient-to-br from-frost-500 to-frost-400 text-white shadow-[0_8px_18px_rgba(14,165,233,0.30)] active:scale-95'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200/80'
                )}
                title={
                  sending
                    ? '停止生成'
                    : hasSendableInput
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
                ) : hasSendableInput ? (
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
