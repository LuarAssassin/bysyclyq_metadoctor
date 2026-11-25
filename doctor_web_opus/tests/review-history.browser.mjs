// Run after npm run build with Playwright/Chromium available to Node.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright')
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const origin = 'http://review.test'
const now = '2026-11-12T12:00:00Z'
const patient = { id: 30, username: 'synthetic', nickname: '合成患者' }
const session = { id: 21, title: '合成会话', status: 'active', created_at: now, updated_at: now, last_message_at: now }
const replies = ['最早的待复核回复', '中间的已审回复', '最近的已审回复'].map((content, index) => ({
  id: 101 + index, session: session.id, role: 'assistant', content, content_markdown: content,
  turn_index: index, generation_status: 'succeeded', review_status: index === 0 ? 'pending' : 'approved',
  reviewed_at: index === 0 ? null : now, created_at: now, updated_at: now,
}))
const cursors = []
const writes = []
const unexpected = []
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_SINGLE_PROCESS ? { args: ['--single-process', '--no-zygote'] } : {}),
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
})
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.addInitScript(() => {
    localStorage.setItem('md_access_token', 'synthetic-token')
    localStorage.setItem('md_refresh_token', 'synthetic-refresh')
  })
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    // Fulfill the built app and its fixtures locally; no request reaches a server.
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) {
      const name = request.isNavigationRequest() ? '/index.html' : url.pathname
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' }
      try {
        return await route.fulfill({
          body: await readFile(path.join(dist, name)), contentType: mime[path.extname(name)] ?? 'application/octet-stream',
        })
      } catch { return route.fulfill({ status: 404, body: '' }) }
    }
    const success = data => route.fulfill({ json: { code: 200, message: '操作成功', data } })
    const pending = replies.filter(reply => reply.review_status === 'pending').length
    if (url.pathname.endsWith('/patient-consults/tree/')) {
      return success({ patients: [{ patient, pending_count: pending, session_count: 1,
        sessions: [{ ...session, pending_count: pending, total_message_count: replies.length }] }],
        pending_count: pending, session_count: 1 })
    }
    if (url.pathname.endsWith('/sessions/21/messages/')) {
      const cursor = url.searchParams.get('before_message_id')
      if (cursor !== null) {
        cursors.push(cursor)
        if (cursors.length === 1) return route.fulfill({ status: 503, json: { message: '合成错误' } })
      }
      // The repeated final row tests deduplication when the same page is retried.
      return success({ session, patient, messages: cursor === null ? replies.slice(-1) : replies,
        stats: { pending, approved: replies.length - pending, approved_edited: 0, rejected: 0 },
        pagination: { has_more: cursor === null, before_message_id: cursor === null ? replies[2].id : null } })
    }
    if (url.pathname.endsWith('/messages/101/review/') && request.method() === 'POST') {
      writes.push(request.postDataJSON())
      replies[0].review_status = 'approved'
      replies[0].reviewed_at = now
      return success({ message: replies[0], pending_count: 0 })
    }
    unexpected.push([request.method(), url.pathname])
    return route.fulfill({ status: 404, json: { message: '未配置的合成接口' } })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  await page.goto(origin + '/consult-review?session=21')
  await page.getByText('最近的已审回复', { exact: true }).waitFor()
  await page.getByRole('button', { name: '加载更早记录', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '历史记录加载失败' }).waitFor()
  assert.equal(await page.locator('.prose-chat').count(), 1)
  await page.getByRole('button', { name: '重试加载更早记录', exact: true }).click()
  const oldest = page.locator('.prose-chat').filter({ hasText: '最早的待复核回复' }).locator('..')
  await oldest.getByRole('button', { name: '复核通过', exact: true }).click()
  await oldest.getByRole('button', { name: '设为待复核', exact: true }).waitFor()
  assert.deepEqual(await page.locator('.prose-chat').allTextContents(), replies.map(reply => reply.content))
  assert.deepEqual(cursors, ['103', '103'])
  assert.equal(writes.length, 1)
  assert.equal(writes[0].action, 'approve')
  await page.goto(origin + '/consult-review?session=999')
  await page.getByRole('alert').filter({ hasText: '该会话不存在' }).waitFor()
  assert.deepEqual(unexpected, [])
  console.log('PASS historical review: retry, deduplication, one approval, invalid session blocked')
} finally {
  await browser.close()
}
