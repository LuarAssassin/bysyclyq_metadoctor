import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { digitalHumanApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import { usePolling } from '@/hooks/use-polling'
import type { AvatarVideo, VoiceProfile } from '@/types/api'
import PageHeader from '@/components/PageHeader'
import GlassCard from '@/components/GlassCard'
import StatusBadge from '@/components/StatusBadge'
import { cn } from '@/lib/cn'
import {
  Expand,
  CircleStop,
  ImagePlus,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  UserCircle,
  Volume2,
  X,
} from 'lucide-react'
import dayjs from 'dayjs'
import { AnimatePresence, motion } from 'framer-motion'

const videoStatusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' }> = {
  submitted: { label: '已提交', variant: 'info' },
  running:   { label: '生成中', variant: 'warning' },
  succeeded: { label: '已完成', variant: 'success' },
  failed:    { label: '失败', variant: 'danger' },
}

const voiceCloneGuideText =
  '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。'

const VOICE_MAX_FILE_SIZE = 10 * 1024 * 1024
const VOICE_MAX_RECORD_SECONDS = 60

const FIXED_VIDEO_DURATION_SECONDS = 15
const FIXED_VIDEO_GENERATE_COUNT = 5

/* ── 录音时长格式化 ─────────── */
function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function encodeAudioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const numFrames = Math.min(audioBuffer.length, Math.floor(sampleRate * VOICE_MAX_RECORD_SECONDS))
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const wavBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(wavBuffer)

  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM
  view.setUint16(20, 1, true) // format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bitsPerSample
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  let writeOffset = 44
  for (let frame = 0; frame < numFrames; frame += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = audioBuffer.getChannelData(channel)[frame] ?? 0
      const clamped = Math.max(-1, Math.min(1, sample))
      const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
      view.setInt16(writeOffset, pcm, true)
      writeOffset += 2
    }
  }

  return wavBuffer
}

async function convertBlobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer()
  const decodeContext = new AudioContext()
  try {
    const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0))
    const wavArrayBuffer = encodeAudioBufferToWav(audioBuffer)
    return new Blob([wavArrayBuffer], { type: 'audio/wav' })
  } finally {
    await decodeContext.close().catch(() => {})
  }
}

export default function DigitalHumanPage() {
  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)

  // Voice
  const [voices, setVoices] = useState<VoiceProfile[]>([])
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [creatingVoice, setCreatingVoice] = useState(false)
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [voiceName, setVoiceName] = useState('')
  const voiceRef = useRef<HTMLInputElement>(null)

  // Recording
  const [voiceMode, setVoiceMode] = useState<'file' | 'record'>('record')
  const [recordingState, setRecordingState] = useState<'idle' | 'starting' | 'recording' | 'processing'>('idle')
  const isRecording = recordingState === 'recording'
  const recordingBusy = recordingState !== 'idle'
  const recordingBusyRef = useRef(false)
  const recordingSequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const audioContextRef = useRef<AudioContext | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const voiceSubmitBusyRef = useRef(false)
  const [recordSec, setRecordSec] = useState(0)
  const [recordPreviewUrl, setRecordPreviewUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const waveCanvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const waveAnimRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)

  // Video
  const [videos, setVideos] = useState<AvatarVideo[]>([])
  const [videoLoading, setVideoLoading] = useState(false)
  const [creatingVideo, setCreatingVideo] = useState(false)
  const [previewVideo, setPreviewVideo] = useState<{
    title: string
    src: string
  } | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const [videoForm, setVideoForm] = useState({
    prompt: '', resolution: '720P',
  })

  const hasRunning = videos.some((v) => ['submitted', 'running'].includes(v.task_status))

  const loadAvatar = async () => {
    try {
      const data = await digitalHumanApi.getAvatar()
      setAvatarUrl(data.avatar || null)
    } catch (e) {
      toast.error(toErrorMessage(e))
    }
  }

  const loadVoices = async () => {
    setVoiceLoading(true)
    try { setVoices(await digitalHumanApi.listVoice()) } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setVoiceLoading(false) }
  }

  const loadVideos = useCallback(async () => {
    setVideoLoading(true)
    try { setVideos(await digitalHumanApi.listVideos()) } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setVideoLoading(false) }
  }, [])

  const refreshAll = () => Promise.all([loadAvatar(), loadVoices(), loadVideos()])
  useEffect(() => { refreshAll() }, []) // eslint-disable-line
  usePolling(loadVideos, 4000, hasRunning)

  const submitAvatar = async () => {
    if (!avatarFile) { toast.warning('请先选择头像图片'); return }
    setUploadingAvatar(true)
    try {
      const res = await digitalHumanApi.uploadAvatar(avatarFile)
      setAvatarUrl(res.data.avatar || null)
      toast.success(res.message)
      setAvatarFile(null)
      if (avatarRef.current) avatarRef.current.value = ''
    } catch (e) {
      toast.error(toErrorMessage(e))
    } finally {
      setUploadingAvatar(false)
    }
  }

  /* ── 录音控制 ─────────────── */

  const replacePreviewUrl = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = url
    setRecordPreviewUrl(url)
  }

  const cleanupRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    cancelAnimationFrame(waveAnimRef.current)
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((t) => t.stop())
    const audioCtx = audioContextRef.current
    audioContextRef.current = null
    if (audioCtx && audioCtx.state !== 'closed') void audioCtx.close().catch(() => {})
    analyserRef.current = null
    mediaRecorderRef.current = null
  }

  const startRecording = async () => {
    if (recordingBusyRef.current || voiceSubmitBusyRef.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') {
      toast.error('当前浏览器不支持在线录音，请在 HTTPS 页面使用支持录音的浏览器，或上传音频文件')
      return
    }
    recordingBusyRef.current = true
    const sequence = ++recordingSequenceRef.current
    setRecordingState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 } })
      if (!mountedRef.current || sequence !== recordingSequenceRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const audioCtx = new AudioContext()
      audioContextRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      let recorderFailed = false
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onerror = () => {
        if (!mountedRef.current || sequence !== recordingSequenceRef.current) return
        recorderFailed = true
        if (mountedRef.current && sequence === recordingSequenceRef.current) toast.error('录音失败，请检查麦克风后重新录制')
        if (recorder.state !== 'inactive') recorder.stop()
        cleanupRecording()
        recordingBusyRef.current = false
        if (mountedRef.current) setRecordingState('idle')
      }
      recorder.onstop = () => {
        void (async () => {
          if (!mountedRef.current || sequence !== recordingSequenceRef.current) return
          setRecordingState('processing')
          cleanupRecording()
          try {
            if (recorderFailed) return
            const rawMimeType = recorder.mimeType || 'audio/webm'
            const rawBlob = new Blob(chunks, { type: rawMimeType })
            if (!rawBlob.size) throw new Error('未采集到音频，请检查麦克风后重新录制')
            const finalBlob = rawMimeType.includes('wav') ? rawBlob : await convertBlobToWav(rawBlob)
            if (!mountedRef.current || sequence !== recordingSequenceRef.current) return
            if (finalBlob.size > VOICE_MAX_FILE_SIZE) throw new Error('录音超过 10MB，请缩短录音后重试')
            const file = new File([finalBlob], `录音_${dayjs().format('HHmmss')}.wav`, { type: 'audio/wav' })
            setVoiceFile(file)
            replacePreviewUrl(URL.createObjectURL(finalBlob))
          } catch (e) {
            if (mountedRef.current && sequence === recordingSequenceRef.current) {
              setVoiceFile(null)
              replacePreviewUrl(null)
              toast.error(e instanceof Error && !(e instanceof DOMException) ? e.message : '录音转码失败，请重新录音或上传 WAV/MP3/M4A 文件')
            }
          } finally {
            if (sequence === recordingSequenceRef.current) {
              cleanupRecording()
              recordingBusyRef.current = false
              if (mountedRef.current) setRecordingState('idle')
            }
          }
        })()
      }
      mediaRecorderRef.current = recorder
      recorder.start(200)
      setRecordSec(0)
      replacePreviewUrl(null)
      setVoiceFile(null)
      setRecordingState('recording')
      const startedAt = performance.now()
      timerRef.current = setInterval(() => {
        const seconds = Math.floor((performance.now() - startedAt) / 1000)
        setRecordSec(Math.min(seconds, VOICE_MAX_RECORD_SECONDS))
        if (seconds >= VOICE_MAX_RECORD_SECONDS && recorder.state !== 'inactive') {
          setRecordingState('processing')
          recorder.stop()
          cleanupRecording()
          toast.info('已录制 60 秒，正在处理录音')
        }
      }, 250)

      // 画波形
      const drawWave = () => {
        const canvas = waveCanvasRef.current
        if (!canvas || !analyserRef.current) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const { width, height } = canvas
        const bufLen = analyserRef.current.frequencyBinCount
        const dataArr = new Uint8Array(bufLen)
        analyserRef.current.getByteTimeDomainData(dataArr)

        ctx.clearRect(0, 0, width, height)

        // 背景
        ctx.fillStyle = 'rgba(224, 242, 254, 0.9)'
        ctx.fillRect(0, 0, width, height)

        // 波形
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)'
        ctx.beginPath()
        const sliceWidth = width / bufLen
        let x = 0
        for (let i = 0; i < bufLen; i++) {
          const v = dataArr[i]! / 128.0
          const y = (v * height) / 2
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
          x += sliceWidth
        }
        ctx.lineTo(width, height / 2)
        ctx.stroke()

        // 呼吸点
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)'
        ctx.beginPath()
        ctx.arc(width - 10, 10, 4, 0, Math.PI * 2)
        ctx.fill()

        waveAnimRef.current = requestAnimationFrame(drawWave)
      }
      drawWave()
    } catch (e) {
      if (sequence !== recordingSequenceRef.current) return
      cleanupRecording()
      recordingBusyRef.current = false
      if (mountedRef.current) {
        setRecordingState('idle')
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')
        toast.error(denied ? '麦克风权限被拒绝，请允许浏览器使用麦克风后重试' : '无法开始录音，请检查麦克风或改用音频文件上传')
      }
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      setRecordingState('processing')
      recorder.stop()
      cleanupRecording()
    }
  }

  const discardRecording = () => {
    if (recordingBusyRef.current || voiceSubmitBusyRef.current) return
    replacePreviewUrl(null)
    setVoiceFile(null)
    setRecordSec(0)
  }

  const selectVoiceFile = (file: File | null) => {
    if (recordingBusyRef.current || voiceSubmitBusyRef.current) return false
    replacePreviewUrl(null)
    setVoiceFile(null)
    setRecordSec(0)
    if (!file) return true
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!['wav', 'mp3', 'm4a'].includes(extension || '')) {
      toast.error('请选择 WAV、MP3 或 M4A 格式的音频')
      return false
    }
    if (!file.size || file.size > VOICE_MAX_FILE_SIZE) {
      toast.error(file.size ? '音频文件不能超过 10MB' : '音频文件为空，请重新选择')
      return false
    }
    setVoiceFile(file)
    return true
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      recordingSequenceRef.current++
      const recorder = mediaRecorderRef.current
      if (recorder) {
        recorder.onstop = null
        recorder.ondataavailable = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      cleanupRecording()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }, [])

  const submitVoice = async () => {
    if (recordingBusyRef.current || voiceSubmitBusyRef.current) return
    if (!voiceFile) { toast.warning('请先录制或选择音频样本'); return }
    voiceSubmitBusyRef.current = true
    setCreatingVoice(true)
    try {
      const res = await digitalHumanApi.createVoice({ audio: voiceFile, name: voiceName || undefined, set_active: true })
      toast.success(res.message)
      setVoiceFile(null)
      replacePreviewUrl(null)
      setRecordSec(0)
      setVoiceName('')
      if (voiceRef.current) voiceRef.current.value = ''
      await loadVoices()
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { voiceSubmitBusyRef.current = false; setCreatingVoice(false) }
  }

  const submitVideo = async () => {
    if (!imageFile) { toast.warning('请先上传医生正面图片'); return }
    setCreatingVideo(true)
    try {
      const res = await digitalHumanApi.createVideos({
        image: imageFile, prompt: videoForm.prompt || undefined,
        duration: FIXED_VIDEO_DURATION_SECONDS,
        resolution: videoForm.resolution,
        generate_count: FIXED_VIDEO_GENERATE_COUNT,
      })
      toast.success(res.message)
      if (res.data.failed_count > 0) toast.warning(`${res.data.failed_count} 条任务提交失败`)
      await loadVideos()
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setCreatingVideo(false) }
  }

  const refreshVideo = async (id: number) => {
    try { const r = await digitalHumanApi.refreshVideo(id); toast.success(r.message); await loadVideos() }
    catch (e) { toast.error(toErrorMessage(e)) }
  }

  const openVideoPreview = (video: AvatarVideo) => {
    const src = video.video_play_url || video.video_oss_url
    if (!src) {
      toast.warning('视频尚未就绪，暂不可预览')
      return
    }
    setPreviewVideo({
      title: video.scene_name || video.scene_key || `视频#${video.id}`,
      src,
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader title="数字人素材中心" subtitle="音色创建后可直接用于演练场；视频任务异步生成并返回签名播放地址">
        <button onClick={() => refreshAll()} className="inline-flex items-center gap-1.5 text-xs font-medium text-ice-600 hover:text-ice-700 bg-ice-50 hover:bg-ice-100 px-3 py-2 rounded-lg transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> 刷新素材
        </button>
      </PageHeader>

      <GlassCard title="医生头像（患者端展示）" extra={<StatusBadge variant="info"><ImagePlus className="w-3 h-3" />支持 JPG/PNG/WebP</StatusBadge>}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-20 h-20 rounded-2xl border border-alpine-100 bg-alpine-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="doctor-avatar" className="w-full h-full object-cover" />
            ) : (
              <UserCircle className="w-9 h-9 text-alpine-300" />
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <button
              onClick={() => avatarRef.current?.click()}
              className="w-full h-10 rounded-xl border border-dashed border-alpine-200 hover:border-ice-300 text-sm text-alpine-500 flex items-center justify-center gap-2 transition-colors"
            >
              <ImagePlus className="w-4 h-4" />
              {avatarFile ? avatarFile.name : '选择医生头像图片'}
            </button>
            <input
              ref={avatarRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.bmp,image/*"
              className="hidden"
              onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
            />
            <button
              onClick={submitAvatar}
              disabled={uploadingAvatar || !avatarFile}
              className="w-full h-10 rounded-xl bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {uploadingAvatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploadingAvatar ? '上传中...' : '上传并替换头像'}
            </button>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Voice Create */}
        <GlassCard title="医生音色复刻" extra={<StatusBadge variant="info"><Mic className="w-3 h-3" />最大 10MB</StatusBadge>}>
          <div className="space-y-2">
            {/* 模式切换 */}
            <div className="flex rounded-lg bg-alpine-50 p-0.5">
              <button
                onClick={() => setVoiceMode('record')}
                disabled={recordingBusy || creatingVoice}
                className={cn(
                  'flex-1 h-8 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-all',
                  voiceMode === 'record' ? 'bg-white text-alpine-800 shadow-sm' : 'text-alpine-400 hover:text-alpine-600'
                )}
              >
                <Mic className="w-3.5 h-3.5" /> 在线录音
              </button>
              <button
                onClick={() => setVoiceMode('file')}
                disabled={recordingBusy || creatingVoice}
                className={cn(
                  'flex-1 h-8 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-all',
                  voiceMode === 'file' ? 'bg-white text-alpine-800 shadow-sm' : 'text-alpine-400 hover:text-alpine-600'
                )}
              >
                <Volume2 className="w-3.5 h-3.5" /> 文件上传
              </button>
            </div>

            {voiceMode === 'record' && (
              <div className="rounded-xl bg-gradient-to-r from-snow-50 to-white px-3 py-1.5">
                <p className="text-xs font-medium text-ice-700 mb-1">点击【开始录音】并朗读：</p>
                <p className="text-xs leading-relaxed text-alpine-600">{voiceCloneGuideText}</p>
                <p className="text-xs text-alpine-500 mt-1">建议连续清晰朗读 10～20 秒，最长 60 秒，保持安静。</p>
              </div>
            )}

            {/* 文件上传模式 */}
            {voiceMode === 'file' && (
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">音频样本</label>
                <button onClick={() => voiceRef.current?.click()} className="w-full h-10 rounded-xl border border-dashed border-alpine-200 hover:border-ice-300 text-sm text-alpine-500 flex items-center justify-center gap-2 transition-colors">
                  <Volume2 className="w-4 h-4" />
                  {voiceFile ? voiceFile.name : '选择 WAV / MP3 / M4A 文件（最大 10MB）'}
                </button>
                <input ref={voiceRef} type="file" accept=".mp3,.wav,.m4a" className="hidden" disabled={recordingBusy || creatingVoice} onChange={(e) => { if (!selectVoiceFile(e.target.files?.[0] || null)) e.currentTarget.value = '' }} />
              </div>
            )}

            {/* 在线录音模式 */}
            {voiceMode === 'record' && (
              <div className="space-y-1.5">
                {/* 波形画布 */}
                <div className="relative rounded-xl overflow-hidden bg-gradient-to-r from-snow-50 to-white" style={{ height: 44 }}>
                  <canvas
                    ref={waveCanvasRef}
                    width={400}
                    height={44}
                    className="w-full h-full"
                  />
                  {isRecording && (
                    <div className="absolute top-2 left-3 flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                      </span>
                      <span className="text-[11px] font-mono text-red-300">{fmtDuration(recordSec)}</span>
                    </div>
                  )}
                </div>

                {/* 录音控制 */}
                <div className="flex items-center gap-2">
                  {!isRecording && !recordPreviewUrl && (
                    <button
                      onClick={startRecording}
                      disabled={recordingBusy || creatingVoice}
                      className="flex-1 h-10 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all hover:shadow-lg hover:shadow-red-500/20"
                    >
                      <Mic className="w-4 h-4" /> {recordingState === 'starting' ? '正在打开麦克风…' : recordingState === 'processing' ? '正在处理录音…' : '开始录音'}
                    </button>
                  )}
                  {isRecording && (
                    <button
                      onClick={stopRecording}
                      className="flex-1 h-10 rounded-xl bg-gradient-to-r from-alpine-700 to-alpine-800 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all hover:shadow-lg animate-pulse"
                    >
                      <CircleStop className="w-4 h-4" /> 停止录音 · {fmtDuration(recordSec)}
                    </button>
                  )}
                  {!isRecording && recordPreviewUrl && (
                    <>
                      <audio src={recordPreviewUrl} controls className="flex-1 h-9 rounded-lg" />
                      <button
                        onClick={discardRecording}
                        disabled={recordingBusy || creatingVoice}
                        className="h-9 px-3 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-xs font-medium flex items-center gap-1 transition-colors"
                        title="丢弃录音"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* 录音完成提示 */}
                {!isRecording && voiceFile && voiceMode === 'record' && (
                  <div className="flex items-center gap-2 rounded-lg bg-ice-50 px-3 py-2">
                    <Mic className="w-3.5 h-3.5 text-ice-500 flex-shrink-0" />
                    <span className="text-xs text-ice-700 truncate">{voiceFile.name}</span>
                    <span className="text-[10px] text-ice-400 flex-shrink-0">{fmtDuration(recordSec)}</span>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-alpine-500 mb-1">音色名称（可选）</label>
              <input value={voiceName} onChange={(e) => setVoiceName(e.target.value)} className="w-full h-9 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300 transition-all" placeholder="默认自动生成" />
            </div>
            <button onClick={submitVoice} disabled={creatingVoice || recordingBusy || !voiceFile} className="w-full h-10 rounded-xl bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
              {creatingVoice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
              {creatingVoice ? '创建中...' : '创建音色'}
            </button>
          </div>
        </GlassCard>

        {/* Voice List */}
        <GlassCard title="音色档案列表" extra={<StatusBadge variant="success">{voices.length} 条</StatusBadge>}>
          {voiceLoading ? (
            <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-alpine-300" /></div>
          ) : voices.length === 0 ? (
            <p className="text-sm text-alpine-400 text-center py-8">暂无音色档案</p>
          ) : (
            <div className="space-y-2">
              {voices.map((v) => (
                <div key={v.id} className="rounded-xl border border-alpine-100 bg-snow-50 p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-alpine-800 truncate">{v.name}</p>
                    <p className="text-xs text-alpine-400 mt-0.5 font-mono truncate">{v.qwen_voice_id}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusBadge variant={v.status === 'ready' ? 'success' : 'danger'}>{v.status === 'ready' ? '可用' : '失败'}</StatusBadge>
                    {v.is_active && <StatusBadge variant="ice">当前</StatusBadge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Video Generation */}
      <GlassCard
        title="医生数字人视频生成"
        extra={<StatusBadge variant={hasRunning ? 'warning' : 'success'} dot>{hasRunning ? '轮询中 (4s)' : '任务稳定'}</StatusBadge>}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-alpine-500 mb-1">首帧图片</label>
            <button onClick={() => imageRef.current?.click()} className="w-full h-10 rounded-xl border border-dashed border-alpine-200 hover:border-ice-300 text-sm text-alpine-500 flex items-center justify-center gap-2 transition-colors">
              <ImagePlus className="w-4 h-4" />
              {imageFile ? imageFile.name : '上传医生正面图片'}
            </button>
            <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-alpine-500 mb-1">固定生成策略</label>
            <div className="h-10 rounded-lg border border-alpine-200 bg-alpine-50 px-3 text-sm text-alpine-600 flex items-center">
              时长 {FIXED_VIDEO_DURATION_SECONDS} 秒 · 任务 {FIXED_VIDEO_GENERATE_COUNT} 条
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input value={videoForm.prompt} onChange={(e) => setVideoForm((p) => ({ ...p, prompt: e.target.value }))} className="flex-1 h-10 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300" placeholder="正向提示词（可选补充要求）" />
          <button onClick={submitVideo} disabled={creatingVideo} className="h-10 px-5 rounded-xl bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2 transition-colors flex-shrink-0">
            {creatingVideo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            提交批量任务
          </button>
        </div>
      </GlassCard>

      {/* Video Grid */}
      {videoLoading && !videos.length ? (
        <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-alpine-300" /></div>
      ) : videos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {videos.map((v, i) => {
            const st = videoStatusMap[v.task_status] || videoStatusMap.submitted!
            return (
              <motion.article
                key={v.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-alpine-900/[0.04]">
                  <h4 className="text-sm font-medium text-alpine-800 truncate">{v.scene_name || v.scene_key || `视频#${v.id}`}</h4>
                  <StatusBadge variant={st.variant} dot>{st.label}</StatusBadge>
                </div>
                <div className="aspect-video bg-alpine-900">
                  {(v.video_play_url || v.video_oss_url) ? (
                    <video
                      controls
                      src={v.video_play_url || v.video_oss_url || undefined}
                      onError={() => { toast.info('播放地址可能过期，正在刷新'); loadVideos() }}
                      className="w-full h-full object-contain bg-alpine-900"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm text-alpine-400">视频未就绪</div>
                  )}
                </div>
                <div className="px-3 py-2">
                  <p className="text-[11px] text-alpine-400 truncate">task: {v.task_id}</p>
                  <p className="text-[11px] text-alpine-400">{dayjs(v.updated_at).format('MM-DD HH:mm')}</p>
                  {v.error_message && <p className="text-[11px] text-red-500 line-clamp-2 mt-0.5">{v.error_message}</p>}
                  <button
                    onClick={() => openVideoPreview(v)}
                    disabled={!(v.video_play_url || v.video_oss_url)}
                    className="mt-1.5 w-full text-xs text-alpine-600 hover:text-alpine-700 py-1.5 rounded-lg hover:bg-alpine-50 transition-colors flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Expand className="w-3 h-3" /> 放大查看
                  </button>
                  <button onClick={() => refreshVideo(v.id)} className="mt-1 w-full text-xs text-ice-600 hover:text-ice-700 py-1.5 rounded-lg hover:bg-ice-50 transition-colors flex items-center justify-center gap-1">
                    <RefreshCw className="w-3 h-3" /> 刷新状态
                  </button>
                </div>
              </motion.article>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {previewVideo && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
              onClick={() => setPreviewVideo(null)}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 p-4 sm:p-6 flex items-center justify-center"
            >
              <div
                className="w-full max-w-6xl rounded-2xl overflow-hidden border border-white/20 bg-alpine-900 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-12 px-4 flex items-center justify-between bg-alpine-900/90 border-b border-white/10">
                  <p className="text-sm font-medium text-white truncate">{previewVideo.title}</p>
                  <button
                    onClick={() => setPreviewVideo(null)}
                    className="w-8 h-8 rounded-lg text-white/80 hover:text-white hover:bg-white/10 flex items-center justify-center"
                    title="关闭"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="w-full bg-black" style={{ height: 'min(78vh, 860px)' }}>
                  <video
                    controls
                    autoPlay
                    src={previewVideo.src}
                    className="w-full h-full object-contain bg-black"
                  />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
