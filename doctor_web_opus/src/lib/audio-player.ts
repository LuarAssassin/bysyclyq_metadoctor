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

  constructor(sampleRate = 24000, onStateChange?: (state: AudioPlayerState) => void) {
    this.sampleRate = sampleRate
    this.onStateChange = onStateChange
  }

  /* ── public API ───────────────────────────────── */

  get state() { return this._state }
  get stats() { return { ...this._stats } }

  /**
   * 初始化 AudioContext（必须在用户交互后调用）。
   * 如已初始化则复用。
   */
  async init(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    this.ctx = new AudioContext({ sampleRate: this.sampleRate })
    this.gainNode = this.ctx.createGain()
    this.gainNode.connect(this.ctx.destination)
    this.scheduledEndTime = 0
    this.createdAt = performance.now()
    this.firstChunkTs = null
    this._stats = {
      chunksReceived: 0, chunksScheduled: 0,
      totalSamples: 0, bufferUnderruns: 0,
      firstChunkDelayMs: null,
    }
    this.setState('idle')
  }

  /**
   * 喂入一个 base64 PCM16 音频分片。
   */
  feed(base64Chunk: string): void {
    if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') return

    this._stats.chunksReceived++

    // 记录首帧延迟
    if (this.firstChunkTs === null) {
      this.firstChunkTs = performance.now()
      this._stats.firstChunkDelayMs = Math.round(this.firstChunkTs - this.createdAt)
    }

    try {
      const float32 = base64PcmToFloat32(base64Chunk)
      if (float32.length === 0) return
      this.scheduleBuffer(float32)
      this.setState('playing')
    } catch (err) {
      console.warn('[PCMStreamPlayer] decode error:', err)
      this.setState('error')
    }
  }

  /** 设置音量 0~1 */
  setVolume(v: number): void {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, v))
  }

  /** 静音/取消静音 */
  setMuted(muted: boolean): void {
    if (this.gainNode) this.gainNode.gain.value = muted ? 0 : 1
  }

  /**
   * 停止播放并释放资源。
   * 调用后不可再 feed。
   */
  stop(): void {
    this.setState('stopped')
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {})
    }
    this.ctx = null
    this.gainNode = null
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
    // gap-free scheduling：排在上一个缓冲结尾；若已过期则立即播放（断流恢复）
    let startAt = this.scheduledEndTime
    if (startAt < now) {
      // buffer underrun — 从当前时刻追赶
      if (this._stats.chunksScheduled > 0) this._stats.bufferUnderruns++
      startAt = now
    }

    source.start(startAt)
    this.scheduledEndTime = startAt + buffer.duration

    this._stats.chunksScheduled++
    this._stats.totalSamples += samples.length
  }
}

/* ── PCM16 base64 → Float32 转换 ─────────────── */

function base64PcmToFloat32(base64: string): Float32Array {
  const binaryStr = atob(base64)
  const byteLen = binaryStr.length
  // PCM16 = 2 bytes per sample
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
    // Int16 → Float32 [-1.0, 1.0]
    float32[i] = int16[i]! / 32768
  }
  return float32
}
