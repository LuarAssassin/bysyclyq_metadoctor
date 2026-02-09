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
  CircleStop,
  ImagePlus,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Trash2,
  Volume2,
} from 'lucide-react'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'

const videoStatusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' }> = {
  submitted: { label: '已提交', variant: 'info' },
  running:   { label: '生成中', variant: 'warning' },
  succeeded: { label: '已完成', variant: 'success' },
  failed:    { label: '失败', variant: 'danger' },
}

/* ── 录音时长格式化 ─────────── */
function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function DigitalHumanPage() {
  // Voice
  const [voices, setVoices] = useState<VoiceProfile[]>([])
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [creatingVoice, setCreatingVoice] = useState(false)
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [voiceName, setVoiceName] = useState('')
  const voiceRef = useRef<HTMLInputElement>(null)

  // Recording
  const [voiceMode, setVoiceMode] = useState<'file' | 'record'>('file')
  const [isRecording, setIsRecording] = useState(false)
  const [recordSec, setRecordSec] = useState(0)
  const [recordPreviewUrl, setRecordPreviewUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const waveCanvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const waveAnimRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)

  // Video
  const [videos, setVideos] = useState<AvatarVideo[]>([])
  const [videoLoading, setVideoLoading] = useState(false)
  const [creatingVideo, setCreatingVideo] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const [videoForm, setVideoForm] = useState({
    prompt: '', duration: 5, resolution: '720P', generate_count: 5,
  })

  const hasRunning = videos.some((v) => ['submitted', 'running'].includes(v.task_status))

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

  const refreshAll = () => Promise.all([loadVoices(), loadVideos()])
  useEffect(() => { refreshAll() }, []) // eslint-disable-line
  usePolling(loadVideos, 4000, hasRunning)

  /* ── 录音控制 ─────────────── */

  const cleanupRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    cancelAnimationFrame(waveAnimRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    analyserRef.current = null
    mediaRecorderRef.current = null
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 } })
      streamRef.current = stream

      // 波形可视化
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      // 录音
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        const ext = recorder.mimeType.includes('mp4') ? 'mp4' : recorder.mimeType.includes('webm') ? 'webm' : 'wav'
        const file = new File([blob], `录音_${dayjs().format('HHmmss')}.${ext}`, { type: recorder.mimeType })
        setVoiceFile(file)
        setRecordPreviewUrl(URL.createObjectURL(blob))
        audioCtx.close().catch(() => {})
        cleanupRecording()
      }
      mediaRecorderRef.current = recorder
      recorder.start(200) // 每 200ms 产出一个 chunk

      // 计时
      setRecordSec(0)
      setRecordPreviewUrl(null)
      setVoiceFile(null)
      timerRef.current = setInterval(() => setRecordSec((s) => s + 1), 1000)
      setIsRecording(true)

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
        ctx.fillStyle = 'rgba(15, 23, 42, 0.6)'
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
    } catch {
      toast.error('无法访问麦克风，请检查浏览器权限')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  const discardRecording = () => {
    if (recordPreviewUrl) URL.revokeObjectURL(recordPreviewUrl)
    setRecordPreviewUrl(null)
    setVoiceFile(null)
    setRecordSec(0)
  }

  // 组件卸载清理
  useEffect(() => {
    return () => {
      cleanupRecording()
      if (recordPreviewUrl) URL.revokeObjectURL(recordPreviewUrl)
    }
  }, []) // eslint-disable-line

  const submitVoice = async () => {
    if (!voiceFile) { toast.warning('请先上传音频样本'); return }
    setCreatingVoice(true)
    try {
      const res = await digitalHumanApi.createVoice({ audio: voiceFile, name: voiceName || undefined, set_active: true })
      toast.success(res.message)
      setVoiceFile(null)
      setVoiceName('')
      if (voiceRef.current) voiceRef.current.value = ''
      await loadVoices()
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setCreatingVoice(false) }
  }

  const submitVideo = async () => {
    if (!imageFile) { toast.warning('请先上传医生正面图片'); return }
    setCreatingVideo(true)
    try {
      const res = await digitalHumanApi.createVideos({
        image: imageFile, prompt: videoForm.prompt || undefined,
        duration: videoForm.duration, resolution: videoForm.resolution,
        generate_count: videoForm.generate_count,
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

  return (
    <div className="space-y-4">
      <PageHeader title="数字人素材中心" subtitle="音色创建后可直接用于演练场；视频任务异步生成并返回签名播放地址">
        <button onClick={() => refreshAll()} className="inline-flex items-center gap-1.5 text-xs font-medium text-ice-600 hover:text-ice-700 bg-ice-50 hover:bg-ice-100 px-3 py-2 rounded-lg transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> 刷新素材
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Voice Create */}
        <GlassCard title="医生音色复刻" extra={<StatusBadge variant="info"><Mic className="w-3 h-3" />最大 20MB</StatusBadge>}>
          <div className="space-y-3">
            {/* 模式切换 */}
            <div className="flex rounded-lg bg-alpine-50 p-0.5">
              <button
                onClick={() => { setVoiceMode('file'); if (isRecording) stopRecording() }}
                className={cn(
                  'flex-1 h-8 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-all',
                  voiceMode === 'file' ? 'bg-white text-alpine-800 shadow-sm' : 'text-alpine-400 hover:text-alpine-600'
                )}
              >
                <Volume2 className="w-3.5 h-3.5" /> 文件上传
              </button>
              <button
                onClick={() => setVoiceMode('record')}
                className={cn(
                  'flex-1 h-8 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-all',
                  voiceMode === 'record' ? 'bg-white text-alpine-800 shadow-sm' : 'text-alpine-400 hover:text-alpine-600'
                )}
              >
                <Mic className="w-3.5 h-3.5" /> 在线录音
              </button>
            </div>

            {/* 文件上传模式 */}
            {voiceMode === 'file' && (
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">音频样本</label>
                <button onClick={() => voiceRef.current?.click()} className="w-full h-10 rounded-xl border border-dashed border-alpine-200 hover:border-ice-300 text-sm text-alpine-500 flex items-center justify-center gap-2 transition-colors">
                  <Volume2 className="w-4 h-4" />
                  {voiceFile ? voiceFile.name : '选择音频文件'}
                </button>
                <input ref={voiceRef} type="file" accept=".mp3,.wav,.m4a,.aac,.flac,.ogg,.webm" className="hidden" onChange={(e) => { setVoiceFile(e.target.files?.[0] || null); setRecordPreviewUrl(null) }} />
              </div>
            )}

            {/* 在线录音模式 */}
            {voiceMode === 'record' && (
              <div className="space-y-2.5">
                {/* 波形画布 */}
                <div className="relative rounded-xl overflow-hidden bg-alpine-900/60" style={{ height: 72 }}>
                  <canvas
                    ref={waveCanvasRef}
                    width={400}
                    height={72}
                    className="w-full h-full"
                  />
                  {!isRecording && !recordPreviewUrl && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-alpine-400">
                      点击下方按钮开始录音
                    </div>
                  )}
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
                      className="flex-1 h-10 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white text-sm font-medium flex items-center justify-center gap-2 transition-all hover:shadow-lg hover:shadow-red-500/20"
                    >
                      <Mic className="w-4 h-4" /> 开始录音
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
            <button onClick={submitVoice} disabled={creatingVoice || !voiceFile} className="w-full h-10 rounded-xl bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-alpine-500 mb-1">首帧图片</label>
            <button onClick={() => imageRef.current?.click()} className="w-full h-10 rounded-xl border border-dashed border-alpine-200 hover:border-ice-300 text-sm text-alpine-500 flex items-center justify-center gap-2 transition-colors">
              <ImagePlus className="w-4 h-4" />
              {imageFile ? imageFile.name : '上传医生正面图片'}
            </button>
            <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-alpine-500 mb-1">时长 (2-15s)</label>
            <input type="number" min={2} max={15} value={videoForm.duration} onChange={(e) => setVideoForm((p) => ({ ...p, duration: +e.target.value }))} className="w-full h-10 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-alpine-500 mb-1">任务数量 (1-5)</label>
            <input type="number" min={1} max={5} value={videoForm.generate_count} onChange={(e) => setVideoForm((p) => ({ ...p, generate_count: +e.target.value }))} className="w-full h-10 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300" />
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
                    <video controls src={v.video_play_url || v.video_oss_url || undefined} onError={() => { toast.info('播放地址可能过期，正在刷新'); loadVideos() }} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm text-alpine-400">视频未就绪</div>
                  )}
                </div>
                <div className="px-3 py-2">
                  <p className="text-[11px] text-alpine-400 truncate">task: {v.task_id}</p>
                  <p className="text-[11px] text-alpine-400">{dayjs(v.updated_at).format('MM-DD HH:mm')}</p>
                  {v.error_message && <p className="text-[11px] text-red-500 line-clamp-2 mt-0.5">{v.error_message}</p>}
                  <button onClick={() => refreshVideo(v.id)} className="mt-1.5 w-full text-xs text-ice-600 hover:text-ice-700 py-1.5 rounded-lg hover:bg-ice-50 transition-colors flex items-center justify-center gap-1">
                    <RefreshCw className="w-3 h-3" /> 刷新状态
                  </button>
                </div>
              </motion.article>
            )
          })}
        </div>
      )}
    </div>
  )
}
