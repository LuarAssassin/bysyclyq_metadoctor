/**
 * PCMStreamPlayer — 实时流式播放 base64 编码的 PCM16 音频
 *
 * 使用 WebAudio AudioContext 的精确时间线做 gap-free 拼接。
 * 每个 audio_delta base64 分片被解码为 Float32 采样后，
 * 通过 AudioBufferSourceNode 排入调度队列。
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

  constructor(sampleRate = 24000, onStateChange?: (state: AudioPlayerState) => void) {
    this.sampleRate = sampleRate
    this.onStateChange = onStateChange
  }

  get state() { return this._state }

  async init(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    this.ctx = new AudioContext({ sampleRate: this.sampleRate })
    this.gainNode = this.ctx.createGain()
    this.gainNode.connect(this.ctx.destination)
    this.scheduledEndTime = 0
    this.chunksScheduled = 0
    this.setState('idle')
  }

  feed(base64Chunk: string): void {
    if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') return
    try {
      const float32 = base64PcmToFloat32(base64Chunk)
      if (float32.length === 0) return
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
   * 等待所有已排入队列的音频播放完毕。
   * SSE 流结束后调用，确保视频/动画和语音同步停止。
   */
  async waitUntilDrained(): Promise<void> {
    if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') return
    if (this.chunksScheduled === 0) return
    return new Promise<void>((resolve) => {
      const check = () => {
        if (!this.ctx || this.ctx.state === 'closed' || this._state === 'stopped') {
          resolve(); return
        }
        if (this.ctx.currentTime >= this.scheduledEndTime) {
          resolve(); return
        }
        setTimeout(check, 120)
      }
      check()
    })
  }

  stop(): void {
    this.setState('stopped')
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close().catch(() => {})
    this.ctx = null
    this.gainNode = null
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
}

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
