import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
export async function runWorkspaceBrowserChecks(browser, origin = 'http://127.0.0.1:5187') {
const results = []
const now = '2026-11-12T09:30:00+08:00'
const envelope = data => ({ code: 200, message: '操作成功', data })
const fixture = () => ({
 profile: { id: 10, display_name: '测试医生', institution: '测试院区', profession: '运动医学科' },
 counts: { patients: 2, sessions: 2, ai_replies: 2, pending_reviews: 2, reviewed_replies: 0, failed_replies: 0 },
 trend: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${String(i + 6).padStart(2, '0')}`, ai_replies: i === 6 ? 2 : 0, patient_messages: i === 6 ? 2 : 0 })),
 period: { start_date: '2026-11-06', end_date: '2026-11-12', time_zone: 'Asia/Shanghai', days: 7 },
 pending_sessions: [201, 202].map((id, i) => ({ session_id: id, patient: { id: i + 1, display_name: `合成患者${i + 1}` }, pending_count: 1, last_message_at: now })),
 knowledge: { total: 0, ready: 0, processing: 0, failed: 0 },
 readiness: { profile: true, avatar: false, voice: false, video: false, kernel: false, knowledge: false, rehearsal: false, kernel_revision: null },
 generated_at: now,
})
function tree(data) {
 return { patients: [201, 202].map((id, i) => ({ patient: { id: i + 1, username: `synthetic-${i}`, nickname: `合成患者${i + 1}`, avatar: null }, session_count: 1, pending_count: data.pending_sessions.find(s => s.session_id === id)?.pending_count || 0, sessions: [{ id, title: `测试会话${id}`, status: 'active', is_pinned: false, pinned_at: null, summary: null, last_message_at: now, created_at: now, updated_at: now, pending_count: data.pending_sessions.find(s => s.session_id === id)?.pending_count || 0, total_message_count: 1 }] })), session_count: 2, pending_count: data.counts.pending_reviews }
}
function assistantMessage(id, sessionId, content, createdAt = now) {
 return { id, session: sessionId, role: 'assistant', turn_index: id, generation_status: 'succeeded', review_status: 'pending', reviewed_at: null, review_note: null, reply_to: null, content, content_markdown: content, edited_markdown: null, edited_at: null, model_name: 'synthetic-model', selected_file_ids: [], selected_file_meta: [], grounding_answer: null, grounding_sources: [], search_sources: [], input_tokens: null, output_tokens: null, total_tokens: null, error_message: null, meta: null, created_at: createdAt, updated_at: createdAt }
}
function messages(id, data) {
 const pending = !!data.pending_sessions.find(s => s.session_id === id)?.pending_count
 return { session: { id, title: `测试会话${id}`, status: 'active', is_pinned: false, pinned_at: null, summary: null, last_message_at: now, created_at: now, updated_at: now }, patient: { id, username: `synthetic-${id}`, nickname: `合成患者${id}`, avatar: null }, stats: { pending: pending ? 1 : 0, approved: pending ? 0 : 1, approved_edited: 0, rejected: 0 }, messages: [{ ...assistantMessage(id + 1000, id, `仅用于测试的回复${id}`), review_status: pending ? 'pending' : 'approved', reviewed_at: pending ? null : now }], pagination: { has_more: false, before_message_id: null } }
}
async function apiPage({ history = false } = {}) {
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
 context.setDefaultTimeout(8_000)
 context.setDefaultNavigationTimeout(8_000)
 await context.addInitScript(() => { localStorage.setItem('md_access_token', 'synthetic-test-token'); localStorage.setItem('md_refresh_token', 'synthetic-test-refresh'); localStorage.setItem('md_last_username', 'synthetic-test-account') })
 const state = { data: fixture(), workspaceFail: false, treeFail: false, messageFail: false, delay201: false, calls: [], writes: 0, reviewRequests: [], historyCalls: [], historyFail: false, holdHistory: null, emptyTree: false, emptyMessageSessions: new Set() }
 const historyMessages = new Map([
  [1100, assistantMessage(1100, 201, '更早回复201', '2026-11-10T08:00:00+08:00')],
  [1200, assistantMessage(1200, 201, '历史回复201', '2026-11-11T08:00:00+08:00')],
  [1300, assistantMessage(1300, 201, '最新回复201', '2026-11-12T08:00:00+08:00')],
 ])
 if (history) {
  state.data.pending_sessions[0].pending_count = 3
  Object.assign(state.data.counts, { ai_replies: 4, pending_reviews: 4 })
 }
 function sessionPage(id, cursor) {
  const payload = messages(id, state.data)
  if (state.emptyMessageSessions.has(id)) return { ...payload, stats: { pending: 0, approved: 0, approved_edited: 0, rejected: 0 }, messages: [] }
  if (!history || id !== 201) return payload
  const all = [...historyMessages.values()]
  const stats = { pending: 0, approved: 0, approved_edited: 0, rejected: 0 }
  all.forEach(message => { stats[message.review_status]++ })
  // A deliberately overlapping last record exercises client prepend deduplication.
  return { ...payload, stats, messages: cursor === null ? [historyMessages.get(1300)] : all, pagination: { has_more: cursor === null, before_message_id: cursor === null ? 1300 : null } }
 }
 await context.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  state.calls.push(url.pathname)
  const reply = async (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? envelope(data) : { code: status, message: '模拟连接失败', data: null }) })
  if (url.pathname.endsWith('/doctor/workspace/')) return reply(state.data, state.workspaceFail ? 503 : 200)
  if (url.pathname.endsWith('/patient-consults/tree/')) return reply(state.emptyTree ? { patients: [], session_count: 0, pending_count: 0 } : tree(state.data), state.treeFail ? 503 : 200)
  const match = url.pathname.match(/sessions\/(\d+)\/messages\//)
  if (match) {
   const id = Number(match[1])
   const rawCursor = url.searchParams.get('before_message_id')
   const cursor = rawCursor === null ? null : Number(rawCursor)
   if (cursor !== null) {
    state.historyCalls.push({ sessionId: id, cursor })
    if (state.holdHistory) await state.holdHistory
    return reply(sessionPage(id, cursor), state.historyFail ? 503 : 200)
   }
   if (state.delay201 && id === 201) await new Promise(resolve => setTimeout(resolve, 500))
   return reply(sessionPage(id, null), state.messageFail ? 503 : 200)
  }
  if (url.pathname.includes('/review/')) {
   state.writes++
   const messageId = Number(url.pathname.match(/messages\/(\d+)\//)[1])
   const submitted = route.request().postDataJSON()
   state.reviewRequests.push({ messageId, body: submitted })
   if (history && historyMessages.has(messageId)) {
    const previous = historyMessages.get(messageId)
    const reviewStatus = { approve: 'approved', approve_edited: 'approved_edited', pending: 'pending', reject: 'rejected' }[submitted.action]
    const reviewed = { ...previous, review_status: reviewStatus, reviewed_at: reviewStatus === 'pending' ? null : now, review_note: submitted.review_note || null, updated_at: now, ...(submitted.edited_markdown !== undefined ? { edited_markdown: submitted.edited_markdown, edited_at: now } : {}) }
    historyMessages.set(messageId, reviewed)
    const pendingCount = [...historyMessages.values()].filter(message => message.review_status === 'pending').length
    state.data.pending_sessions[0].pending_count = pendingCount
    state.data.counts.pending_reviews = pendingCount + 1
    state.data.counts.reviewed_replies = 3 - pendingCount
    // Return the entire message just like the real mutation contract.
    return reply({ message: reviewed, pending_count: pendingCount })
   }
   const id = messageId - 1000
   state.data.pending_sessions = state.data.pending_sessions.filter(s => s.session_id !== id)
   state.data.counts.pending_reviews--
   state.data.counts.reviewed_replies++
   return reply({ message: messages(id, state.data).messages[0], pending_count: 0 })
  }
  // No test request may fall through to a real backend.
  return reply(null, 404)
 })
 return { context, page: await context.newPage(), state }
}
try {
 {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  context.setDefaultTimeout(8_000)
  context.setDefaultNavigationTimeout(8_000)
  let apiCalls = 0
  await context.route('**/api/**', async route => { apiCalls++; await route.abort() })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/preview')
  await page.getByRole('heading', { name: '医生工作台', exact: true }).waitFor()
  await page.getByRole('button', { name: '处理下一条' }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  for (const width of [1440, 1280, 390, 320]) {
   await page.setViewportSize({ width, height: 1000 })
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `preview overflows at ${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开功能导航' }).click()
  await page.getByRole('navigation').getByRole('link', { name: '使用指南', exact: true }).click()
  await page.getByRole('heading', { name: /使用指南|建立/ }).first().waitFor()
  assert.equal(apiCalls, 0, 'demo must not call authenticated APIs')
  assert.deepEqual(errors, [], 'browser runtime errors')
  await page.goto(origin + '/knowledge')
  await page.waitForURL(/\/auth\/login/)
  results.push('演示隔离、只读详情、手机导航、320/390/1280/1440无溢出、认证保护')
  await context.close()
 }
 {
  const { page, state, context } = await apiPage()
  await page.goto(origin + '/preview/guide?chapter=profile')
  const read = page.getByRole('checkbox', { name: '我已阅读这一节' })
  await read.check()
  await page.reload()
  await read.waitFor()
  assert.equal(await read.isChecked(), true)
  await page.goto(origin + '/guide?chapter=profile')
  await page.waitForFunction(() => document.querySelector('input[type=checkbox]')?.disabled === false)
  assert.equal(await read.isChecked(), false, 'a signed-in doctor must not inherit preview progress')
  assert.deepEqual(state.calls, [], 'preview and reading a guide must not call a doctor API even with a credential')
  await page.goto(origin + '/workspace')
  await page.locator('.cw-stats').waitFor()
  assert.deepEqual([...new Set(state.calls)], ['/api/doctor/workspace/'])
  assert.match(await page.locator('h1 + p').innerText(), /测试医生/)
  assert.equal(await page.getByText('患者示例 A', { exact: true }).count(), 0)
  const direct = await page.getByRole('link', { name: '处理下一条' }).count() > 0
  const expected = process.env.WORKSPACE_TEST_REVIEW
  if (expected) assert.equal(direct ? 'linked' : 'list', expected)
  if (!direct) {
    assert.equal(await page.locator('.cw-review-list a').count(), 0, 'legacy review cannot select a patient using the URL')
    const list = page.getByRole('link', { name: '打开复核列表' })
    assert.equal(await list.getAttribute('href'), '/consult-review')
    await list.click()
    await page.getByText('仅用于测试的回复201', { exact: true }).waitFor()
    assert.equal(new URL(page.url()).search, '')
  }
  results.push('持有合成登录令牌的预览零 API；真实工作台读取受保护接口；指南学习进度按身份隔离')
  state.workspaceFail = true
  await page.goto(origin + '/workspace')
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.cw-stats').count(), 0)
  state.workspaceFail = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.locator('.cw-stats').waitFor()
  state.workspaceFail = true
  await page.getByRole('button', { name: '刷新工作台' }).click()
  await page.getByText('刷新未完成，以下仍为上次数据').waitFor()
  state.workspaceFail = false
  state.data.pending_sessions = []
  state.data.counts.pending_reviews = 0
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('heading', { name: '当前没有待复核回复', exact: true }).waitFor()
  assert.equal(await page.locator('.cw-review-list a').count(), 0)
  assert.equal(state.writes, 0)
  results.push('独立工作台统计失败、重试、刷新保留有效数据及真实零待办')
  await context.close()
  if (!direct) {
    results.push('旧复核页使用通用列表入口，待办清单不承诺指定患者跳转')
    return { passed: results.length, results }
  }
 }
 {
  const { page, state, context } = await apiPage()
  await page.goto(origin + '/workspace')
  await page.getByRole('link', { name: '处理下一条' }).waitFor()
  await page.getByRole('link', { name: '复核合成患者2的会话，1条待复核' }).click()
  await page.getByText('仅用于测试的回复202', { exact: true }).waitFor()
  assert.ok(page.url().endsWith('session=202'))
  assert.ok(!state.calls.includes('/api/doctor/patient-consults/sessions/201/messages/'), 'deep link must select requested own session')
  await page.getByRole('button', { name: '复核通过', exact: true }).click()
  await page.getByRole('link', { name: '返回首页', exact: true }).waitFor()
  await page.getByRole('button', { name: '设为待复核', exact: true }).waitFor()
  await page.getByRole('link', { name: '返回首页', exact: true }).click()
  await page.getByRole('link', { name: '处理下一条' }).waitFor()
  assert.equal(state.writes, 1)
  assert.equal((await page.locator('.cw-stat-pending strong').innerText()).replace(/\s/g, ''), '1条')
  const before = state.calls.filter(x => x.includes('/messages/')).length
  await page.goto(origin + '/consult-review?session=999')
  await page.getByRole('alert').filter({ hasText: '该会话不存在' }).waitFor()
  assert.equal(state.calls.filter(x => x.includes('/messages/')).length, before, 'invalid deep links must not fetch messages')
  results.push('工作台到指定会话、一次复核、返回刷新、非法深链不请求')
  await context.close()
 }
 {
  const { page, state, context } = await apiPage()
  state.workspaceFail = true
  await page.goto(origin + '/workspace')
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.cw-stats').count(), 0, 'failure must not render zero statistics')
  state.workspaceFail = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.locator('.cw-stats').waitFor()
  state.workspaceFail = true
  await page.getByRole('button', { name: '刷新工作台' }).click()
  await page.getByText('刷新未完成，以下仍为上次数据').waitFor()
  await page.goto(origin + '/consult-review?session=201')
  await page.getByText('仅用于测试的回复201', { exact: true }).waitFor()
  state.messageFail = true
  await page.getByRole('button', { name: '合成患者2', exact: false }).click()
  await page.getByRole('button', { name: /测试会话202/ }).click()
  await page.getByRole('button', { name: '重试会话' }).waitFor()
  assert.equal(await page.getByText('仅用于测试的回复201', { exact: true }).count(), 0)
  state.messageFail = false
  await page.getByRole('button', { name: '重试会话' }).click()
  await page.getByText('仅用于测试的回复202', { exact: true }).waitFor()
  results.push('接口失败不伪造数据、重试、刷新保留上次状态、换患者失败不残留旧回复')
  await context.close()
 }
 {
  const { page, state, context } = await apiPage({ history: true })
  await page.goto(origin + '/consult-review?session=201')
  await page.getByText('最新回复201', { exact: true }).waitFor()
  await page.getByText('已加载 1 条记录 · 复核统计包含整个会话', { exact: true }).waitFor()
  state.historyFail = true
  await page.getByRole('button', { name: '加载更早记录', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '历史记录加载失败' }).waitFor()
  assert.equal(await page.getByText('最新回复201', { exact: true }).count(), 1, 'history failure must retain the latest page')
  assert.equal(await page.getByText('历史回复201', { exact: true }).count(), 0)
  state.historyFail = false
  await page.getByRole('button', { name: '重试加载更早记录', exact: true }).click()
  await page.getByText('已加载 3 条记录 · 复核统计包含整个会话', { exact: true }).waitFor()
  assert.equal(await page.getByText('最新回复201', { exact: true }).count(), 1, 'overlapping history must be deduplicated')
  const rendered = await page.locator('.prose-chat').allTextContents()
  assert.equal(JSON.stringify(rendered), JSON.stringify(['更早回复201', '历史回复201', '最新回复201']), 'history must be prepended in chronological order')
  assert.deepEqual(state.historyCalls, [{ sessionId: 201, cursor: 1300 }, { sessionId: 201, cursor: 1300 }], 'retry must reuse the failed cursor')
  const historicalBubble = page.locator('.prose-chat').filter({ hasText: /^历史回复201$/ }).locator('..')
  await historicalBubble.getByRole('button', { name: '编辑', exact: true }).click()
  await historicalBubble.getByRole('textbox', { name: '编辑后的回答内容', exact: true }).fill('历史回复201，经医生核对')
  await historicalBubble.getByRole('textbox', { name: '复核备注（可选）', exact: true }).fill('合成历史记录复核')
  await historicalBubble.getByRole('button', { name: '编辑后通过', exact: true }).click()
  await page.getByText('历史回复201，经医生核对', { exact: true }).waitFor()
  const reviewedBubble = page.locator('.prose-chat').filter({ hasText: /^历史回复201，经医生核对$/ }).locator('..')
  await reviewedBubble.getByRole('button', { name: '设为待复核', exact: true }).waitFor()
  assert.equal(state.writes, 1, 'historical review should submit once')
  assert.equal(state.reviewRequests[0].messageId, 1200)
  assert.equal(state.reviewRequests[0].body.action, 'approve_edited')
  assert.equal(state.reviewRequests[0].body.edited_markdown, '历史回复201，经医生核对')
  assert.equal(await page.getByText('更早回复201', { exact: true }).count(), 1, 'review must retain already loaded older records')
  assert.equal(await page.getByText('最新回复201', { exact: true }).count(), 1, 'review must retain the latest page')
  await page.getByText('已加载 3 条记录 · 复核统计包含整个会话', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '已显示全部记录', exact: true }).isDisabled(), true)
  results.push('历史加载失败与同游标重试、prepend去重排序、完整返回消息复核后保留历史')
  await context.close()
 }
 {
  const { page, state, context } = await apiPage({ history: true })
  await page.goto(origin + '/consult-review?session=201')
  await page.getByText('最新回复201', { exact: true }).waitFor()
  let releaseHistory
  state.holdHistory = new Promise(resolve => { releaseHistory = resolve })
  const isEarlier201 = value => {
   const url = new URL(value.url())
   return url.pathname.endsWith('/sessions/201/messages/') && url.searchParams.get('before_message_id') === '1300'
  }
  const historyRequested = page.waitForRequest(isEarlier201)
  await page.getByRole('button', { name: '加载更早记录', exact: true }).click()
  await historyRequested
  await page.getByRole('button', { name: '正在加载更早记录', exact: true }).waitFor()
  state.emptyMessageSessions.add(202)
  await page.getByRole('button', { name: '合成患者2', exact: false }).click()
  await page.getByRole('button', { name: /测试会话202/ }).click()
  await page.getByText('该会话暂无消息', { exact: true }).waitFor()
  assert.ok(page.url().endsWith('session=202'))
  const staleResponse = page.waitForResponse(isEarlier201)
  releaseHistory()
  const completedResponse = await staleResponse
  await completedResponse.finished()
  // Let the stale request's promise continuation and React render settle.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.getByText('该会话暂无消息', { exact: true }).waitFor()
  assert.equal(await page.locator('.prose-chat').count(), 0, 'late historical response must not populate another patient session')
  assert.equal(await page.getByRole('button', { name: /加载更早记录/ }).count(), 0, 'empty session must not retain the previous history control')
  state.emptyTree = true
  const beforeEmptyTree = state.calls.filter(path => path.includes('/sessions/') && path.endsWith('/messages/')).length
  await page.goto(origin + '/consult-review')
  await page.getByText('暂无患者服务记录', { exact: true }).waitFor()
  await page.getByText('请选择左侧会话', { exact: true }).waitFor()
  assert.equal(state.calls.filter(path => path.includes('/sessions/') && path.endsWith('/messages/')).length, beforeEmptyTree, 'empty patient tree must not issue a message request')
  Object.assign(state.data.counts, { patients: 0, sessions: 0, ai_replies: 0, pending_reviews: 0, reviewed_replies: 0, failed_replies: 0 })
  state.data.pending_sessions = []
  state.data.trend.forEach(day => { day.ai_replies = 0; day.patient_messages = 0 })
  await page.goto(origin + '/workspace')
  await page.getByRole('heading', { name: '当前没有待复核回复', exact: true }).waitFor()
  assert.equal((await page.locator('.cw-stat-pending strong').innerText()).replace(/\s/g, ''), '0条')
  assert.equal(await page.getByRole('link', { name: '处理下一条', exact: true }).count(), 0)
  assert.equal(state.writes, 0, 'history and empty-state navigation must remain read-only')
  results.push('挂起历史请求换患者不串会话、空消息与空患者树、零待办工作台真实空状态')
  await context.close()
 }

 return { passed: results.length, results }
} finally { await browser.close() }
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const require = createRequire(import.meta.url)
 const { chromium } = require('playwright')
 const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
 console.log(JSON.stringify(await runWorkspaceBrowserChecks(browser, process.env.WORKSPACE_TEST_ORIGIN), null, 2))
}
