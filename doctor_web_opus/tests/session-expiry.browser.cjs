const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { join, extname } = require('node:path')
const { chromium } = require('playwright')
const dist = process.argv[2] || join(__dirname, '../dist')
const origin = 'https://doctor.test'
const demoCounts = {
  profile: { id: 1, display_name: '测试医生' },
  counts: { patients: 0, sessions: 0, ai_replies: 0, pending_reviews: 0, reviewed_replies: 0, failed_replies: 0 },
  trend: [], period: { start_date: '2026-11-25', end_date: '2026-11-25', time_zone: 'Asia/Shanghai' },
  pending_sessions: [], knowledge: { total: 0, ready: 0, processing: 0, failed: 0 }, readiness: {},
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }

async function run(browser, refreshStatus) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    await context.addInitScript(() => {
      localStorage.setItem('md_access_token', 'old-access')
      localStorage.setItem('md_refresh_token', 'test-refresh')
    })
    let refreshes = 0
    await context.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (url.pathname === '/api/doctor/workspace/') {
        if (request.headers().authorization === 'Bearer new-access') {
          return route.fulfill({ json: { code: 200, message: '', data: demoCounts } })
        }
        return route.fulfill({ status: 401, json: { message: '登录已失效，请重新登录' } })
      }
      if (url.pathname === '/api/auth/token/refresh/') {
        refreshes++
        assert.equal(request.postDataJSON().refresh, 'test-refresh')
        return route.fulfill({ status: refreshStatus, json: refreshStatus === 200
          ? { code: 200, message: '', data: { access: 'new-access' } }
          : { message: refreshStatus === 401 ? '登录已失效，请重新登录' : '暂时无法续期' } })
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404 })
      const relative = request.isNavigationRequest() ? 'index.html' : url.pathname.replace(/^\/doctor\//, '')
      const body = await readFile(join(dist, relative)).catch(() => null)
      return body ? route.fulfill({ body, contentType: types[extname(relative)] }) : route.fulfill({ status: 404 })
    })
    const page = await context.newPage()
    await page.goto(origin + '/doctor/workspace')
    if (refreshStatus === 401) {
      await page.getByRole('heading', { name: '医生登录', exact: true }).waitFor({ timeout: 4500 })
      assert.equal(new URL(page.url()).searchParams.get('redirect'), '/workspace')
      assert.deepEqual(await page.evaluate(() => [localStorage.getItem('md_access_token'), localStorage.getItem('md_refresh_token')]), [null, null])
    } else if (refreshStatus === 200) {
      await page.getByText('测试医生，欢迎回来。', { exact: false }).waitFor({ timeout: 4500 })
      assert.equal(await page.evaluate(() => localStorage.getItem('md_access_token')), 'new-access')
    } else {
      await page.getByRole('button', { name: '重试', exact: true }).waitFor({ timeout: 4500 })
      assert.equal(new URL(page.url()).pathname, '/doctor/workspace')
      assert.equal(await page.evaluate(() => localStorage.getItem('md_refresh_token')), 'test-refresh')
    }
    assert.equal(refreshes, 1)
    console.log('PASS refresh response', refreshStatus)
  } finally {
    await context.close()
  }
}

async function main() {
  const browser = await chromium.launch()
  try {
    for (const status of [401, 200, 503]) await run(browser, status)
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
