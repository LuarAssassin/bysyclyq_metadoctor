import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const fixed = !process.argv.includes('--observe')
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const origin = process.env.VOICE_TEST_ORIGIN || 'http://127.0.0.1:5187'
const results = []
async function page() {
 const p = await browser.newPage()
 await p.route('**/api/**', async route => {
  const data = route.request().url().includes('/avatar/') ? { avatar: null } : []
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 200, message: 'ok', data }) })
 })
 await p.goto(origin + '/tests/voice-audit.html')
 await p.getByRole('button', { name: '开始录音', exact: true }).waitFor()
 return p
}
try {
 {
  const p = await page(); await p.evaluate(() => window.__audit.deferPermission = true)
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '开始录音'); b.click(); b.click() })
  const calls = await p.evaluate(() => window.__audit.permissionRequests)
  results.push({ case: 'double_start_during_permission', permissionRequests: calls })
  if (fixed) assert.equal(calls, 1)
  await p.evaluate(() => window.__audit.releasePermission()); await p.close()
 }
 {
  const p = await page(); await p.getByRole('button', { name: '开始录音', exact: true }).click()
  await p.getByRole('button', { name: /停止录音/ }).click()
  await p.waitForFunction(() => window.__audit.pendingDecode.length === 1)
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '开始录音'); b?.click() })
  const calls = await p.evaluate(() => window.__audit.permissionRequests)
  results.push({ case: 'start_while_converting', permissionRequests: calls })
  if (fixed) assert.equal(calls, 1)
  await p.evaluate(() => window.__audit.releaseDecode()); await p.close()
 }
 {
  const p = await page(); await p.evaluate(() => window.__audit.failRecorder = true)
  await p.getByRole('button', { name: '开始录音', exact: true }).click()
  await p.waitForFunction(() => window.__audit.recorderCalls === 1)
  const state = await p.evaluate(() => ({ tracksStopped: window.__audit.streams[0].stopped, contextClosed: window.__audit.contexts[0].closed }))
  results.push({ case: 'recorder_constructor_failure', ...state })
  if (fixed) { assert.equal(state.tracksStopped, 1); assert.equal(state.contextClosed, true) }
  await p.close()
 }
 {
  const p = await page(); await p.getByRole('button', { name: '开始录音', exact: true }).click()
  await p.getByRole('button', { name: /停止录音/ }).click()
  await p.waitForFunction(() => window.__audit.pendingDecode.length === 1)
  await p.evaluate(() => window.__audit.releaseDecode()); await p.locator('audio').waitFor()
  await p.evaluate(() => window.__audit.unmount())
  const state = await p.evaluate(() => ({ created: window.__audit.createdUrls.length, revoked: window.__audit.revokedUrls.length }))
  results.push({ case: 'preview_cleanup_on_unmount', ...state })
  if (fixed) assert.equal(state.revoked, state.created)
  await p.close()
 }
 {
  const p = await page(); await p.getByRole('button', { name: '文件上传', exact: true }).click()
  await p.locator('input[type=file][accept*=mp3]').setInputFiles({ name: 'too-large.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(11 * 1024 * 1024) })
  const disabled = await p.getByRole('button', { name: '创建音色', exact: true }).isDisabled()
  results.push({ case: 'oversize_file_blocked_before_upload', disabled })
  if (fixed) assert.equal(disabled, true)
  await p.close()
 }
 {
  const p = await page(); await p.evaluate(() => window.__audit.deferPermission = true)
  await p.getByRole('button', { name: '开始录音', exact: true }).click()
  await p.evaluate(() => { window.__audit.unmount(); window.__audit.releasePermission() })
  await p.waitForFunction(() => window.__audit.streams.length === 1)
  const state = await p.evaluate(() => ({ stopped: window.__audit.streams[0].stopped, contextsCreated: window.__audit.contexts.length }))
  results.push({ case: 'leave_before_permission_resolves', ...state })
  if (fixed) { assert.equal(state.stopped, 1); assert.equal(state.contextsCreated, 0) }
  await p.close()
 }
 {
  const p = await page(); await p.getByRole('button', { name: '开始录音', exact: true }).click()
  await p.getByRole('button', { name: /停止录音/ }).click()
  await p.waitForFunction(() => window.__audit.pendingDecode.length === 1)
  await p.evaluate(() => { window.__audit.unmount(); window.__audit.releaseDecode() })
  await p.waitForFunction(() => window.__audit.contexts.every(c => c.closed))
  const created = await p.evaluate(() => window.__audit.createdUrls.length)
  results.push({ case: 'leave_during_audio_conversion', createdPreviewUrls: created })
  if (fixed) assert.equal(created, 0)
  await p.close()
 }
 {
  const p = await page(); let posts = 0; let sample = null
  await p.route('**/api/doctor/digital-human/voice/', async route => {
   if (route.request().method() === 'POST') {
    posts++
    const body = route.request().postDataBuffer(); const i = body.indexOf(Buffer.from('RIFF'))
    sample = { wav: i >= 0, bits: body.readUInt16LE(i + 34), sampleRate: body.readUInt32LE(i + 24), defaultModelUsed: !body.includes(Buffer.from('name="target_model"')) }
   }
   await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 200, message: 'ok', data: [] }) })
  })
  await p.getByRole('button', { name: '开始录音', exact: true }).click()
  await p.getByRole('button', { name: /停止录音/ }).click()
  await p.waitForFunction(() => window.__audit.pendingDecode.length === 1)
  await p.evaluate(() => window.__audit.releaseDecode()); await p.locator('audio').waitFor()
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '创建音色'); b.click(); b.click() })
  await p.waitForFunction(() => !document.querySelector('audio'))
  results.push({ case: 'record_to_wav_and_single_upload', posts, sample })
  if (fixed) { assert.equal(posts, 1); assert.equal(sample.wav, true); assert.equal(sample.bits, 16); assert.ok(sample.sampleRate >= 16000); assert.equal(sample.defaultModelUsed, true) }
  await p.close()
 }
 {
  const p = await browser.newPage({ permissions: ['microphone'] }); let nativeSample = null
  await p.route('**/api/**', async route => {
   if (route.request().method() === 'POST' && route.request().url().includes('/voice/')) {
    const b = route.request().postDataBuffer(); const i = b.indexOf(Buffer.from('RIFF'))
    const channels = b.readUInt16LE(i + 22), rate = b.readUInt32LE(i + 24), bytes = b.readUInt32LE(i + 40)
    nativeSample = { bits: b.readUInt16LE(i + 34), channels, sampleRate: rate, duration: bytes / (rate * channels * 2), pcmBytes: bytes }
   }
   const data = route.request().url().includes('/avatar/') ? { avatar: null } : []
   await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 200, message: 'ok', data }) })
  })
  await p.goto(origin + '/tests/voice-native.html')
  await p.getByRole('button', { name: '开始录音', exact: true }).click()
  await p.getByRole('button', { name: /停止录音/ }).waitFor()
  await new Promise(resolve => setTimeout(resolve, 2000))
  await p.getByRole('button', { name: /停止录音/ }).click()
  await p.locator('audio').waitFor()
  await p.getByRole('button', { name: '创建音色', exact: true }).click()
  await p.waitForFunction(() => !document.querySelector('audio'))
  results.push({ case: 'native_chromium_recorder_synthetic_device', sample: nativeSample })
  assert.ok(nativeSample && nativeSample.pcmBytes > 1000); assert.equal(nativeSample.bits, 16); assert.ok(nativeSample.sampleRate >= 16000); assert.ok(nativeSample.duration >= 1)
  await p.close()
 }
 console.log(JSON.stringify({ fixedExpected: fixed, results }, null, 2))
} finally { await browser.close() }
