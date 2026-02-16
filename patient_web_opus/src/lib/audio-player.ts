/**
 * PCMStreamPlayer — 实时流式播放 base64 编码的 PCM16 音频
 *
 * 使用 WebAudio AudioContext 的精确时间线做 gap-free 拼接。
 * 每个 audio_delta base64 分片被解码为 Float32 采样后，
 * 通过 AudioBufferSourceNode 排入调度队列。
 *
 * 移动端回退（微信/WebView）：
 *   init() 在用户手势中预激活一个 <audio> 元素（循环播放极小音量静音）。
 *   如果 AudioContext 始终 suspended / 无法推进时间线，
 *   waitUntilDrained() 将累积 PCM → WAV Blob → 复用已激活的 <audio> 播放。
 */

export type AudioPlayerState = 'idle' | 'playing' | 'stopped' | 'error'

export class PCMStreamPlayer {
  private ctx: AudioContext | null = null
  private gainNode: GainNode | null = null
  private sampleRate: number
  private scheduledEndTime = 0
  private _state: AudioPlayerState = 'idle'
  private chunksScheduled = 0
  private onStateChange?: (state: AudioPlayerState) => void
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null

  // ── WAV 回退相关 ──
  /** 累积所有 PCM Float32 分片 */
  private accumulatedChunks: Float32Array[] = []
  private accumulatedSampleCount = 0
  /** 用户手势中预激活的 <audio> 元素（循环播放静音保持活跃） */
  private warmAudio: HTMLAudioElement | null = null
  private warmBlobUrl: string | null = null
  /** 回退播放的 blob URL（用于 cleanup） */
  private fallbackBlobUrl: string | null = null

  constructor(sampleRate = 24000, onStateChange?: (state: AudioPlayerState) => void) {
    this.sampleRate = sampleRate
    this.onStateChange = onStateChange
  }

  get state() { return this._state }

  /**
   * 初始化播放器。**必须在用户手势（如 click）同步调用链中执行**，
   * 以便 AudioContext 和 <audio> 预激活都在手势上下文内完成。
   */
  async init(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }

    this.ctx = new AudioContext({ sampleRate: this.sampleRate })
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.gainNode = this.ctx.createGain()
    this.gainNode.connect(this.ctx.destination)

    // 播放一帧静音激活 AudioContext
    this.playSilentFrame()

    // 保活定时器
    this.stopKeepAlive()
    this.keepAliveTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') {
        this.stopKeepAlive()
        return
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {})
        this.playSilentFrame()
      }
    }, 3000)

    // ★ 预激活 <audio> 元素用于 WAV 回退
    // 在用户手势内 play() 后设为 loop，保持元素"已播放"状态
    this.warmUpAudioElement()

    this.scheduledEndTime = 0
    this.chunksScheduled = 0
    this.accumulatedChunks = []
    this.accumulatedSampleCount = 0
    this.cleanupFallbackBlob()
    this.setState('idle')
  }

  feed(base64Chunk: string): void {
    if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') return

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
      this.playSilentFrame()
    }

    try {
      const float32 = base64PcmToFloat32(base64Chunk)
      if (float32.length === 0) return

      // 始终累积（用于 WAV 回退）
      this.accumulatedChunks.push(float32)
      this.accumulatedSampleCount += float32.length

      this.scheduleBuffer(float32)
      this.setState('playing')
    } catch {
      this.setState('error')
    }
  }

  setVolume(v: number): void {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, v))
  }

  setMuted(muted: boolean): void {
    if (this.gainNode) this.gainNode.gain.value = muted ? 0 : 1
  }

  /**
   * 等待已排入队列的音频播放完毕。
   *
   * 1) 先尝试等 AudioContext 队列播完（带超时 + suspended 检测）
   * 2) 如果 AudioContext 无法播放，回退到 WAV + 预激活 <audio> 播放
   */
  async waitUntilDrained(): Promise<void> {
    if (this._state === 'stopped') return
    if (this.chunksScheduled === 0 && this.accumulatedSampleCount === 0) return

    // 尝试 AudioContext 播放（带超时保护，防止微信环境卡死）
    if (this.ctx && this.ctx.state !== 'closed' && this.chunksScheduled > 0) {
      const drained = await this.waitAudioCtxDrain(8000)
      if (drained) return // AudioContext 成功播完
    }

    // AudioContext 未能播放 → WAV 回退
    if (this.accumulatedSampleCount > 0) {
      console.warn(
        '[PCMStreamPlayer] AudioContext 无法播放音频，回退到 <audio> WAV 播放',
        '(accumulated', this.accumulatedSampleCount, 'samples)',
      )
      await this.playAccumulatedAsWav()
    }
  }

  stop(): void {
    this.stopKeepAlive()
    this.cleanupWarmAudio()
    this.cleanupFallbackBlob()
    this.setState('stopped')
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close().catch(() => {})
    this.ctx = null
    this.gainNode = null
    this.accumulatedChunks = []
    this.accumulatedSampleCount = 0
  }

  // ═══════════════════════════════════════════════════
  //  Private: AudioContext helpers
  // ═══════════════════════════════════════════════════

  private stopKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
  }

  private playSilentFrame(): void {
    if (!this.ctx || !this.gainNode) return
    const buffer = this.ctx.createBuffer(1, 1, this.sampleRate)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.gainNode)
    source.start()
  }

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
    if (startAt < now) startAt = now
    source.start(startAt)
    this.scheduledEndTime = startAt + buffer.duration
    this.chunksScheduled++
  }

  /**
   * 等待 AudioContext 时间线追上 scheduledEndTime，
   * 带超时 + suspended 状态快速退出。
   *
   * @returns true = 音频已全部播完; false = AudioContext 无法播放（需回退）
   */
  private waitAudioCtxDrain(timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const wallStart = Date.now()
      const ctxTimeStart = this.ctx?.currentTime ?? 0

      const check = () => {
        // 已关闭/停止
        if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') {
          resolve(false)
          return
        }

        const ctxNow = this.ctx.currentTime

        // ✅ 队列播完
        if (ctxNow >= this.scheduledEndTime) {
          resolve(true)
          return
        }

        const elapsed = Date.now() - wallStart
        const ctxAdvanced = ctxNow - ctxTimeStart > 0.05

        // ❌ context 一直 suspended 且 time 没动 → 2 秒后放弃
        if (this.ctx.state === 'suspended' && !ctxAdvanced && elapsed > 2000) {
          resolve(false)
          return
        }

        // ❌ context 声称 running 但 time 完全没推进 → 3 秒后放弃
        if (this.ctx.state === 'running' && !ctxAdvanced && elapsed > 3000) {
          resolve(false)
          return
        }

        // ❌ 总超时
        if (elapsed > timeoutMs) {
          resolve(ctxAdvanced)
          return
        }

        setTimeout(check, 150)
      }
      check()
    })
  }

  // ═══════════════════════════════════════════════════
  //  Private: <audio> 预激活 + WAV 回退
  // ═══════════════════════════════════════════════════

  /**
   * 在用户手势上下文中创建并 play() 一个 <audio> 元素。
   * 播放一段极低音量的静音 WAV 并 loop，使元素保持"已激活"状态。
   * 后续 playAccumulatedAsWav() 复用此元素可绕过 autoplay 限制。
   */
  private warmUpAudioElement(): void {
    // 生成 0.25 秒静音 WAV（6000 samples @24kHz）
    const silentPcm = new Int16Array(Math.floor(this.sampleRate * 0.25))
    const silentWav = createWavBlob(silentPcm, this.sampleRate)
    const url = URL.createObjectURL(silentWav)

    const audio = new Audio()
    audio.volume = 0.001 // 几乎静音但不为 0（某些浏览器对 volume=0 行为不同）
    audio.loop = true
    audio.src = url

    audio.play().then(() => {
      this.warmAudio = audio
      this.warmBlobUrl = url
    }).catch(() => {
      // 预激活失败（某些极端环境），后续回退会尝试新建 Audio
      URL.revokeObjectURL(url)
    })
  }

  /**
   * 将累积的所有 PCM 数据拼接为 WAV Blob，
   * 复用预激活的 <audio> 元素播放（绕过 autoplay 限制）。
   */
  private async playAccumulatedAsWav(): Promise<void> {
    if (this.accumulatedChunks.length === 0) return

    // 1. 合并 Float32 分片
    const merged = new Float32Array(this.accumulatedSampleCount)
    let offset = 0
    for (const chunk of this.accumulatedChunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    // 2. Float32 → Int16
    const pcm16 = new Int16Array(merged.length)
    for (let i = 0; i < merged.length; i++) {
      const s = merged[i]!
      pcm16[i] = s < 0
        ? Math.max(-32768, Math.round(s * 32768))
        : Math.min(32767, Math.round(s * 32767))
    }

    // 3. 生成 WAV Blob
    const wavBlob = createWavBlob(pcm16, this.sampleRate)
    const wavUrl = URL.createObjectURL(wavBlob)
    this.fallbackBlobUrl = wavUrl

    // 4. 复用预激活元素（关键：已被用户手势 play() 过）
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

// ═══════════════════════════════════════════════════
//  WAV 文件生成
// ═══════════════════════════════════════════════════

function createWavBlob(pcm16: Int16Array, sampleRate: number): Blob {
  const dataBytes = pcm16.byteLength
  const buffer = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buffer)

  writeAscii(v, 0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  writeAscii(v, 8, 'WAVE')

  writeAscii(v, 12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)            // PCM
  v.setUint16(22, 1, true)            // mono
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

// ═══════════════════════════════════════════════════
//  PCM16 base64 → Float32
// ═══════════════════════════════════════════════════

function base64PcmToFloat32(base64: string): Float32Array {
  const bin = atob(base64)
  const len = bin.length
  const sampleCount = len >>> 1
  if (sampleCount === 0) return new Float32Array(0)
  const buf = new ArrayBuffer(len)
  const view = new Uint8Array(buf)
  for (let i = 0; i < len; i++) view[i] = bin.charCodeAt(i)
  const int16 = new Int16Array(buf)
  const out = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) out[i] = int16[i]! / 32768
  return out
}
