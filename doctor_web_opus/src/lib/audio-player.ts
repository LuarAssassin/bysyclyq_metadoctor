/**
 * PCMStreamPlayer — 实时流式播放 base64 编码的 PCM16 音频
 *
 * 核心原理：
 *   使用 WebAudio AudioContext 的精确时间线做 gap-free 拼接。
 *   每个 audio_delta base64 分片被解码为 Float32 采样后，
 *   通过 AudioBufferSourceNode 排入调度队列，
 *   scheduledEndTime 保证前后缓冲无缝衔接。
 *
 * 断流恢复：
 *   如果网络延迟导致 scheduledEndTime < currentTime（buffer underrun），
 *   下一个 chunk 会立即从 currentTime 开始播放，自动恢复。
 *
 * 移动端回退（微信/WebView）：
 *   init() 在用户手势中预激活一个 <audio> 元素（循环播放极小音量静音）。
 *   如果 AudioContext 始终 suspended / 无法推进时间线，
 *   waitUntilDrained() 将累积 PCM → WAV Blob → 复用已激活的 <audio> 播放。
 */

export type AudioPlayerState = 'idle' | 'playing' | 'stopped' | 'error'

export interface AudioPlayerStats {
  chunksReceived: number
  chunksScheduled: number
  totalSamples: number
  bufferUnderruns: number
  firstChunkDelayMs: number | null
}

export class PCMStreamPlayer {
  private ctx: AudioContext | null = null
  private gainNode: GainNode | null = null
  private sampleRate: number
  private scheduledEndTime = 0
  private _state: AudioPlayerState = 'idle'
  private _stats: AudioPlayerStats = {
    chunksReceived: 0,
    chunksScheduled: 0,
    totalSamples: 0,
    bufferUnderruns: 0,
    firstChunkDelayMs: null,
  }
  private firstChunkTs: number | null = null
  private createdAt = 0
  private onStateChange?: (state: AudioPlayerState) => void

  // ── WAV 回退相关 ──
  private accumulatedChunks: Float32Array[] = []
  private accumulatedSampleCount = 0
  private warmAudio: HTMLAudioElement | null = null
  private warmBlobUrl: string | null = null
  private fallbackBlobUrl: string | null = null

  constructor(sampleRate = 24000, onStateChange?: (state: AudioPlayerState) => void) {
    this.sampleRate = sampleRate
    this.onStateChange = onStateChange
  }

  /* ── public API ───────────────────────────────── */

  get state() { return this._state }
  get stats() { return { ...this._stats } }

  async init(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    this.ctx = new AudioContext({ sampleRate: this.sampleRate })
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.gainNode = this.ctx.createGain()
    this.gainNode.connect(this.ctx.destination)

    // 预激活 <audio> 元素用于 WAV 回退
    this.warmUpAudioElement()

    this.scheduledEndTime = 0
    this.createdAt = performance.now()
    this.firstChunkTs = null
    this._stats = {
      chunksReceived: 0, chunksScheduled: 0,
      totalSamples: 0, bufferUnderruns: 0,
      firstChunkDelayMs: null,
    }
    this.accumulatedChunks = []
    this.accumulatedSampleCount = 0
    this.cleanupFallbackBlob()
    this.setState('idle')
  }

  feed(base64Chunk: string): void {
    if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') return

    this._stats.chunksReceived++
    if (this.firstChunkTs === null) {
      this.firstChunkTs = performance.now()
      this._stats.firstChunkDelayMs = Math.round(this.firstChunkTs - this.createdAt)
    }

    try {
      const float32 = base64PcmToFloat32(base64Chunk)
      if (float32.length === 0) return

      // 始终累积（用于 WAV 回退）
      this.accumulatedChunks.push(float32)
      this.accumulatedSampleCount += float32.length

      this.scheduleBuffer(float32)
      this.setState('playing')
    } catch (err) {
      console.warn('[PCMStreamPlayer] decode error:', err)
      this.setState('error')
    }
  }

  setVolume(v: number): void {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, v))
  }

  setMuted(muted: boolean): void {
    if (this.gainNode) this.gainNode.gain.value = muted ? 0 : 1
  }

  async waitUntilDrained(): Promise<void> {
    if (this._state === 'stopped') return
    if (this._stats.chunksScheduled === 0 && this.accumulatedSampleCount === 0) return

    if (this.ctx && this.ctx.state !== 'closed' && this._stats.chunksScheduled > 0) {
      const drained = await this.waitAudioCtxDrain(8000)
      if (drained) return
    }

    if (this.accumulatedSampleCount > 0) {
      console.warn('[PCMStreamPlayer] AudioContext 无法播放，回退到 <audio> WAV')
      await this.playAccumulatedAsWav()
    }
  }

  stop(): void {
    this.cleanupWarmAudio()
    this.cleanupFallbackBlob()
    this.setState('stopped')
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {})
    }
    this.ctx = null
    this.gainNode = null
    this.accumulatedChunks = []
    this.accumulatedSampleCount = 0
  }

  /* ── internal ─────────────────────────────────── */

  private setState(s: AudioPlayerState) {
    if (s === this._state) return
    this._state = s
    this.onStateChange?.(s)
  }

  private scheduleBuffer(samples: Float32Array): void {
    if (!this.ctx || !this.gainNode) return

    const buffer = this.ctx.createBuffer(1, samples.length, this.sampleRate)
    buffer.getChannelData(0).set(samples)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.gainNode)

    const now = this.ctx.currentTime
    let startAt = this.scheduledEndTime
    if (startAt < now) {
      if (this._stats.chunksScheduled > 0) this._stats.bufferUnderruns++
      startAt = now
    }
    source.start(startAt)
    this.scheduledEndTime = startAt + buffer.duration

    this._stats.chunksScheduled++
    this._stats.totalSamples += samples.length
  }

  // ── AudioContext drain with timeout ──

  private waitAudioCtxDrain(timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const wallStart = Date.now()
      const ctxTimeStart = this.ctx?.currentTime ?? 0

      const check = () => {
        if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') {
          resolve(false); return
        }
        const ctxNow = this.ctx.currentTime
        if (ctxNow >= this.scheduledEndTime) { resolve(true); return }

        const elapsed = Date.now() - wallStart
        const ctxAdvanced = ctxNow - ctxTimeStart > 0.05

        if (this.ctx.state === 'suspended' && !ctxAdvanced && elapsed > 2000) {
          resolve(false); return
        }
        if (this.ctx.state === 'running' && !ctxAdvanced && elapsed > 3000) {
          resolve(false); return
        }
        if (elapsed > timeoutMs) { resolve(ctxAdvanced); return }
        setTimeout(check, 150)
      }
      check()
    })
  }

  // ── <audio> 预激活 + WAV 回退 ──

  private warmUpAudioElement(): void {
    const silentPcm = new Int16Array(Math.floor(this.sampleRate * 0.25))
    const silentWav = createWavBlob(silentPcm, this.sampleRate)
    const url = URL.createObjectURL(silentWav)

    const audio = new Audio()
    audio.volume = 0.001
    audio.loop = true
    audio.src = url

    audio.play().then(() => {
      this.warmAudio = audio
      this.warmBlobUrl = url
    }).catch(() => {
      URL.revokeObjectURL(url)
    })
  }

  private async playAccumulatedAsWav(): Promise<void> {
    if (this.accumulatedChunks.length === 0) return

    const merged = new Float32Array(this.accumulatedSampleCount)
    let offset = 0
    for (const chunk of this.accumulatedChunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    const pcm16 = new Int16Array(merged.length)
    for (let i = 0; i < merged.length; i++) {
      const s = merged[i]!
      pcm16[i] = s < 0
        ? Math.max(-32768, Math.round(s * 32768))
        : Math.min(32767, Math.round(s * 32767))
    }

    const wavBlob = createWavBlob(pcm16, this.sampleRate)
    const wavUrl = URL.createObjectURL(wavBlob)
    this.fallbackBlobUrl = wavUrl

    const audio = this.warmAudio ?? new Audio()
    audio.loop = false
    audio.volume = 1
    audio.src = wavUrl

    this.setState('playing')
    try {
      await audio.play()
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        audio.addEventListener('ended', done, { once: true })
        audio.addEventListener('error', done, { once: true })
      })
    } catch (err) {
      console.warn('[PCMStreamPlayer] WAV <audio> 回退也失败:', err)
      this.setState('error')
    } finally {
      this.cleanupFallbackBlob()
    }
  }

  private cleanupWarmAudio(): void {
    if (this.warmAudio) {
      this.warmAudio.pause()
      this.warmAudio.removeAttribute('src')
      this.warmAudio.load()
      this.warmAudio = null
    }
    if (this.warmBlobUrl) {
      URL.revokeObjectURL(this.warmBlobUrl)
      this.warmBlobUrl = null
    }
  }

  private cleanupFallbackBlob(): void {
    if (this.fallbackBlobUrl) {
      URL.revokeObjectURL(this.fallbackBlobUrl)
      this.fallbackBlobUrl = null
    }
  }
}

// ── WAV 文件生成 ──

function createWavBlob(pcm16: Int16Array, sampleRate: number): Blob {
  const dataBytes = pcm16.byteLength
  const buffer = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buffer)

  writeAscii(v, 0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  writeAscii(v, 8, 'WAVE')
  writeAscii(v, 12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  writeAscii(v, 36, 'data')
  v.setUint32(40, dataBytes, true)
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm16.buffer))
  return new Blob([buffer], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/* ── PCM16 base64 → Float32 转换 ─────────────── */

function base64PcmToFloat32(base64: string): Float32Array {
  const binaryStr = atob(base64)
  const byteLen = binaryStr.length
  const sampleCount = byteLen >>> 1
  if (sampleCount === 0) return new Float32Array(0)

  const buffer = new ArrayBuffer(byteLen)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < byteLen; i++) {
    view[i] = binaryStr.charCodeAt(i)
  }

  const int16 = new Int16Array(buffer)
  const float32 = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = int16[i]! / 32768
  }
  return float32
}
