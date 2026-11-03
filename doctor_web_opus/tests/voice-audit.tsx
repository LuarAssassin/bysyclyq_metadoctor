import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import DigitalHumanPage from '../src/pages/DigitalHumanPage'
import '../src/index.css'
const a = (window as any).__audit = { permissionRequests: 0, streams: [], contexts: [], pendingPermission: [], pendingDecode: [], deferPermission: false, failRecorder: false, recorderCalls: 0, createdUrls: [], revokedUrls: [] }
function stream() { const s = { stopped: 0, getTracks() { return [{ stop() { s.stopped++ } }] } }; a.streams.push(s); return s }
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia() { a.permissionRequests++; if (a.deferPermission) return new Promise(resolve => a.pendingPermission.push(() => resolve(stream()))); return Promise.resolve(stream()) } } })
class FakeAudioContext {
  closed = false
  state = 'running'
  constructor() { a.contexts.push(this) }
  createMediaStreamSource() { return { connect() {} } }
  createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, getByteTimeDomainData(buf: Uint8Array) { buf.fill(128) } } }
  decodeAudioData() { return new Promise(resolve => a.pendingDecode.push(() => resolve({ numberOfChannels: 1, sampleRate: 24000, length: 144000, duration: 6, getChannelData() { return new Float32Array(144000).fill(0.01) } }))) }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve() }
}
class FakeMediaRecorder {
  static isTypeSupported(mime: string) { return mime.startsWith('audio/webm') }
  state = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: any; onstop: any; onerror: any
  constructor(..._args: unknown[]) { a.recorderCalls++; if (a.failRecorder) throw new Error('unsupported recorder') }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['synthetic'], { type: this.mimeType }) }); this.onstop?.() }) }
}
;(window as any).AudioContext = FakeAudioContext
;(window as any).MediaRecorder = FakeMediaRecorder
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = blob => { const url = create(blob); a.createdUrls.push(url); return url }
URL.revokeObjectURL = url => { a.revokedUrls.push(url); revoke(url) }
a.releasePermission = () => a.pendingPermission.splice(0).forEach((f: any) => f())
a.releaseDecode = () => a.pendingDecode.splice(0).forEach((f: any) => f())
const root = createRoot(document.getElementById('root')!)
a.unmount = () => root.unmount()
root.render(<><Toaster/><DigitalHumanPage/></>)
