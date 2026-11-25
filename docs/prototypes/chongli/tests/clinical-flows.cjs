const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const url = pathToFileURL(path.resolve(process.env.PROTOTYPE_HTML || path.join(__dirname, '..', 'index.html'))).href;
const nav = (page, route) => page.locator('[data-platform-route="' + route + '"]').click();
const focus = page => page.locator('#drb-focus');
async function signIn(page, id) {
  if (!await page.locator('#cl-login-dialog').isVisible()) await page.locator('#po-login-open').click();
  await page.locator('[data-demo-account="' + id + '"]').click();
  await page.waitForFunction(id => window.CL?.currentAccount()?.id === id, id);
}
async function profileAndSources(page) {
  await nav(page, 'doctorPersona');
  await focus(page).selectOption('术后康复');
  await page.locator('label').filter({has: page.locator('input[name="drb-tone"][value="direct"]')}).click();
  await page.locator('#drb-scenario').selectOption('scope');
  assert.match(await page.locator('#drb-answer').innerText(), /主管医生/);
  assert.match(await page.locator('#drb-draft').innerText(), /未保存/);
  await page.locator('#drb-kb').click();
  assert.equal(await page.locator('#kb-search').inputValue(), '术后康复');
  const match = page.locator('#kb-rows li').filter({hasText:'术后随访信息采集表'});
  await match.locator('[data-kbdetail]').click();
  assert.equal(await page.locator('#kb-official').isVisible(), false);
  await page.locator('#kb-dialog-select').click();
  await page.locator('#kb-import').click();
  assert.equal(await page.locator('#kb-saved-count').innerText(), '1');
  assert.match(await page.locator('#kb-live').innerText(), /来源索引/);
  await nav(page, 'doctorPersona');
  assert.equal(await focus(page).inputValue(), '术后康复');
  assert.match(await page.locator('#drb-draft').innerText(), /未保存/);
  assert.match(await page.locator('#drb-sources').innerText(), /术后随访信息采集表/);
  assert.equal(await page.evaluate(() => CL.state.release.settings.focus), '膝关节');
  await page.locator('#drb-save').click();
  await page.reload();
  assert.equal(await focus(page).inputValue(), '术后康复');
  assert.match(await page.locator('#drb-draft').innerText(), /已保存/);
  assert.equal(await page.evaluate(() => CL.state.service.settings.focus), '膝关节');
}
async function followup(page) {
  await nav(page, 'doctor');
  await page.locator('#ah-review').click();
  await page.locator('[data-fu-id="A"]').click();
  await page.locator('#fu-outcome').selectOption('拟电话联系');
  await page.locator('#fu-note').fill('演示工作单：核对联系时间。');
  await page.locator('#fu-submit').click();
  assert.equal(await page.locator('#fu-pending').innerText(), '1');
  await page.locator('[data-fu-filter="done"]').click();
  await page.locator('[data-fu-id="A"]').click();
  assert.equal(await page.locator('#fu-result').innerText(), '拟电话联系');
  assert.match(await page.locator('#fu-note').inputValue(), /联系时间/);
  await nav(page, 'doctor');
  assert.match(await page.locator('#dw-impact').innerText(), /5 份/);
  assert.match(await page.locator('#ah-status').innerText(), /1 条/);
}
async function research(page) {
  await nav(page, 'doctorResearch');
  await page.locator('#rs-intake summary').click();
  const sample = {name:'科研示例.txt',mimeType:'text/plain',buffer:Buffer.from('虚构记录：希望复诊时沟通。')};
  const image = {name:'图例.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/z4kAAAAASUVORK5CYII=', 'base64')};
  const pdf = {name:'核对材料.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% local download check\n%%EOF')};
  const wave = Buffer.alloc(44 + 800, 128);
  wave.write('RIFF');wave.writeUInt32LE(wave.length - 8, 4);wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);wave.writeUInt16LE(1, 20);wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);wave.writeUInt32LE(8000, 28);wave.writeUInt16LE(1, 32);
  wave.writeUInt16LE(8, 34);wave.write('data', 36);wave.writeUInt32LE(800, 40);
  const audio = {name:'录音.wav',mimeType:'audio/wav',buffer:wave};
  await page.locator('#rs-upload').setInputFiles([pdf,audio,image,sample]);
  await page.waitForFunction(() => document.querySelector('#rs-file-preview').textContent.includes('虚构记录'));
  const source = page.locator('#rs-file-list');
  await source.selectOption({label:'图例.png'});
  await page.locator('#rs-file-preview img').evaluate(img => img.decode());
  await source.selectOption({label:'录音.wav'});
  await page.waitForFunction(() => document.querySelector('#rs-file-preview audio')?.duration > 0);
  await source.selectOption({label:'核对材料.pdf'});
  const pdfDownload = page.waitForEvent('download');
  await page.locator('#rs-file-preview a').click();
  assert.deepEqual(await fs.readFile(await (await pdfDownload).path()),pdf.buffer);
  await source.selectOption({label:sample.name});
  await page.locator('#rs-section').selectOption('主要诉求');
  await page.locator('#rs-excerpt').fill('希望复诊时沟通。');
  await page.locator('#rs-locator').fill('第 1 行');
  await page.locator('#rs-add-excerpt').click();
  const body = await page.locator('#rs-draft').inputValue();
  assert.match(body, /科研示例.txt · 第 1 行/);
  assert.match(await page.locator('#rs-proof').innerText(), /希望复诊时沟通/);
  await page.locator('#rs-draft').fill(body + '\n人工补充：联系偏好待核对。');
  const download = page.waitForEvent('download');
  await page.locator('#rs-export').click();
  const content = await fs.readFile(await (await download).path(), 'utf8');
  for (const expected of ['科研示例.txt · 第 1 行', '主要诉求 1 → 原文 1', '人工补充', '正文经手工编辑']) assert.ok(content.includes(expected));
  await nav(page, 'doctor');
  await nav(page, 'doctorResearch');
  assert.match(await page.locator('#rs-draft').inputValue(), /人工补充/);
  // A TXT read that completes after sign-out must not restore materials to the next session.
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== '延时.txt') return read.call(this);
      return new Promise(resolve => { window.finishTestRead = () => resolve('延迟材料'); });
    };
  });
  await page.locator('#rs-upload').setInputFiles({...sample,name:'延时.txt'});
  await page.waitForFunction(() => typeof window.finishTestRead === 'function');
  await page.locator('#cl-role-change').click();
  await signIn(page,'PT1001');
  await page.evaluate(() => window.finishTestRead());
  await page.evaluate(() => CL.go('doctorResearch'));
  assert.equal(await page.evaluate(() => location.hash), '#patient');
  assert.equal(await page.locator('#rs-file-list option').count(), 1);
  await page.locator('#cl-role-change').click();
  await signIn(page, 'CL1001');
  await nav(page, 'doctorResearch');
  await page.locator('#rs-source').selectOption('local');
  assert.equal(await page.locator('#rs-source-lines li').count(), 0);
  assert.doesNotMatch(await page.locator('#rs-draft').inputValue(), /科研示例|人工补充|延迟材料/);
  assert.equal(await page.locator('#rs-file-preview').innerText(), '');
}
(async () => {
  const args = process.env.CHROMIUM_SINGLE_PROCESS === '1'
    ? ['--no-sandbox','--single-process','--disable-gpu','--disable-dev-shm-usage','--disable-software-rasterizer','--no-zygote','--disable-breakpad','--disable-crash-reporter'] : [];
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.goto(url);
    await signIn(page,'CL1001');
    await profileAndSources(page);
    await followup(page);
    await research(page);
    assert.deepEqual(errors, []);
    console.log('PASS specialty source selection and persisted draft, follow-up review and counters, attributed research export, sign-out privacy and delayed upload.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
