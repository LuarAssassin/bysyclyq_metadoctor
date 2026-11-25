const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const file = path.resolve(process.env.PROTOTYPE_HTML || path.join(__dirname, '..', 'index.html'));
const html = fs.readFileSync(file,'utf8');
const packed = !html.includes('href="styles.css"');
const slides = [
  {id:'campus', title:'门诊楼', source:'https://www.bjmu.edu.cn/bdyx110zn/bygs/ac64ab2442d54cc9a05b0eaee7029f2c.htm', subject:[315,185,1010,263]},
  {id:'teaching', title:'医学教学', source:'https://bynews.bjmu.edu.cn/tszt/qjs30n/8cb0c0aed4c041dd9872e6747e5a0816.htm', subject:[265,230,414,435]},
  {id:'education', title:'运动健康科普', source:'https://www.puh3.net.cn/info/1971/155321.htm', subject:[290,198,1000,368]}
];
const sizes = [{width:1440,height:900},{width:820,height:1024},{width:390,height:844},{width:320,height:720}];

async function verifyPhoto(view, slide) {
  const gallery = view.locator('#po-home .po-media');
  const photo = gallery.locator('.po-image:visible');
  const credit = gallery.locator('.po-credit:visible');
  assert.equal(await photo.count(), 1, 'One visible image');
  assert.equal(await photo.getAttribute('data-photo'), slide.id);
  assert.equal(await credit.count(), 1, 'One visible credit');
  assert((await credit.innerText()).includes(slide.title));
  assert.equal(await credit.locator('a').getAttribute('href'), slide.source);
  return photo.evaluate(async (image, subject) => {
    await image.decode();
    const gallery = image.closest('.po-media');
    const frame = image.closest('.po-frame');
    const caption = gallery.querySelector('.po-caption');
    const copy = document.querySelector('#po-home .po-copy');
    const picture = image.getBoundingClientRect(), box = frame.getBoundingClientRect();
    const label = caption.getBoundingClientRect(), heading = copy.getBoundingClientRect();
    const imageStyle = getComputedStyle(image);
    // Map the building name or people's faces from original-image pixels into
    // the rendered picture and verify nothing crops them out.
    const scale = imageStyle.objectFit === 'contain'
      ? Math.min(picture.width / image.naturalWidth, picture.height / image.naturalHeight)
      : Math.max(picture.width / image.naturalWidth, picture.height / image.naturalHeight);
    const [px,py] = imageStyle.objectPosition.split(' ').map(token => parseFloat(token) / 100);
    const left = picture.left + (picture.width - image.naturalWidth * scale) * px;
    const top = picture.top + (picture.height - image.naturalHeight * scale) * py;
    const [x1,y1,x2,y2] = subject;
    const inside = (x,y) => x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1;
    const layers = [];
    for (let item = image; item; item = item.parentElement) {
      const style = getComputedStyle(item);
      layers.push([style.opacity,style.maskImage,style.mixBlendMode]);
      if (item === gallery) break;
    }
    return {
      frame:[box.x,box.y,box.width,box.height],
      subjectsVisible:inside(left + x1 * scale, top + y1 * scale) && inside(left + x2 * scale, top + y2 * scale),
      captionBelow:label.top >= box.bottom - 1,
      copySeparate:heading.right <= box.left + 1 || heading.bottom <= box.top + 1,
      photoOpaque:layers.every(([opacity,mask,blend]) => opacity === '1' && mask === 'none' && blend === 'normal'),
      horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1
    };
  },slide.subject);
}

async function cycleSlides(page, view, scriptEnabled) {
  const gallery = view.locator('#po-home .po-media');
  const choices = gallery.getByRole('radio');
  await choices.first().waitFor({state:'visible'});
  assert.equal(await choices.count(), slides.length);
  assert.equal(await gallery.locator('.po-pause').isVisible(), scriptEnabled);
  for (const size of sizes) {
    await page.setViewportSize(size);
    // Capture a rendered frame before measuring after a responsive breakpoint.
    // Browser-side animation callbacks do not execute in script-blocked previews.
    await page.screenshot();
    await choices.first().focus();
    let initial;
    for (const [index,slide] of slides.entries()) {
      assert(await choices.nth(index).isChecked(), 'Keyboard selection: '+slide.id);
      const {frame,subjectsVisible,captionBelow,copySeparate,photoOpaque,horizontalOverflow} = await verifyPhoto(view, slide);
      const label = size.width+'px '+slide.id;
      assert(subjectsVisible,label+' crops a subject or building name');
      assert(captionBelow && copySeparate,label+' overlaps photo, caption, or introductory text');
      assert(photoOpaque,label+' blends the original photo with its background');
      assert(!horizontalOverflow,label+' overflows the viewport');
      if (!index) initial = frame;
      else assert(frame.every((n,i) => Math.abs(n - initial[i]) <= 1),label+' moves the photographic frame');
      await page.keyboard.press('ArrowRight');
    }
  }
}

async function autoplay(page) {
  await page.clock.install();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(pathToFileURL(file).href);
  const gallery = page.locator('#po-home .po-media');
  const choices = gallery.getByRole('radio');
  const toggle = gallery.locator('.po-pause');
  assert(await choices.nth(0).isChecked());
  await page.clock.fastForward(7000);
  assert(await choices.nth(1).isChecked(), 'Autoplay advances the photograph');
  await toggle.click();
  await page.mouse.move(0,0);
  await toggle.blur();
  await page.clock.fastForward(7000);
  assert(await choices.nth(1).isChecked(), 'Paused photograph must stay in place');
  await toggle.click();
  await page.mouse.move(0,0);
  await toggle.blur();
  await page.clock.fastForward(7000);
  assert(await choices.nth(2).isChecked(), 'Play resumes the sequence');
  const layers = await gallery.evaluate(element => {
    element.querySelector('#po-pick-campus').click();
    element.querySelector('#po-pick-teaching').click();
    return [...element.querySelectorAll('.po-outgoing')].map(image => image.getAttribute('aria-hidden'));
  });
  assert.deepEqual(layers,['true'],'Rapid changes retain a single decorative outgoing photograph');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();
  await page.clock.fastForward(7000);
  assert(await choices.nth(0).isChecked(),'Reduced motion starts with a still photograph');
  await choices.nth(1).check();
  assert.equal(await gallery.locator('.po-outgoing').count(),0,'Reduced motion changes photographs immediately');
  await choices.nth(0).check();
  await page.clock.resume();
}

async function nativePreview(page) {
  if (!packed) {
    await page.goto(pathToFileURL(file).href);
    return page;
  }
  await page.setContent('<style>body{margin:0}iframe{width:100vw;height:100vh;display:block;border:0}</style><iframe sandbox name="gallery-review"></iframe>');
  await page.locator('iframe').evaluate((element,source) => { element.srcdoc = source; },html);
  return page.frame({name:'gallery-review'});
}

async function run(scriptEnabled) {
  const launch = {executablePath:process.env.CHROMIUM_PATH || undefined};
  if (process.env.CHROMIUM_SINGLE_PROCESS==='1') launch.args = ['--single-process','--disable-gpu','--disable-dev-shm-usage','--no-zygote'];
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({viewport:sizes[0],javaScriptEnabled:scriptEnabled || packed,reducedMotion:'reduce'});
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror',e => errors.push(e.message));
    let view = page;
    if (scriptEnabled) await autoplay(page);
    else view = await nativePreview(page);
    await cycleSlides(page,view,scriptEnabled);
    if (scriptEnabled) {
      await page.locator('#po-login-open').click();
      await page.locator('[data-demo-account="PT1001"]').click();
      await page.locator('#view-patient').waitFor({state:'visible'});
    } else {
      await view.locator('#po-native-login').click();
      await view.locator('#read-accounts [data-sample-account="PT1001"]').click();
      await view.locator('#read-rolePatient').waitFor({state:'visible'});
    }
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();
  }
}

(async () => {
  await run(true);
  console.log('PASS gallery autoplay, pause, reduced motion and patient login');
  await run(false);
  console.log('PASS manual keyboard gallery, source attribution, focal crops and stable layout at four widths, including the script-blocked packed preview when supplied');
})().catch(error => { console.error(error); process.exitCode=1; });
