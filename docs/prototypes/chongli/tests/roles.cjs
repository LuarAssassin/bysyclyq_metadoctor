const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const path = require('node:path');
const file = path.resolve(process.env.PROTOTYPE_HTML || path.join(__dirname, '..', 'index.html'));
const url = pathToFileURL(file).href;
const executablePath = process.env.CHROMIUM_PATH || undefined;
const roles = {
  doctor:['医生','#page-home'], director:['科主任','#view-screen'], leader:['院领导','#view-screen'],
  reviewer:['院方审核人员','#view-admin'], patient:['患者','#view-patient'], admin:['院方管理员','#view-admin']
};
const choices = '#po-home a[data-role-entry]';
const errors=[];
function routeUrl(route){return url+'#'+route}
async function assertRoute(page,role,route=role){
  await page.waitForFunction(([role,route])=>window.CL?.currentRole?.()===role && location.hash==='#'+route,[role,route],{timeout:3500});
  assert.equal(await page.locator('.cl-view:visible').count(),1);
}
async function enter(page,role){
  const link=page.locator(choices+'[data-role-entry="'+role+'"]:visible');
  assert((await link.innerText()).includes(roles[role][0]),role+' home entrance');
  await link.click();await assertRoute(page,role);
  await page.locator(roles[role][1]).waitFor({state:'visible'});
}
async function home(page){
  const exit=page.locator('#ld-back:visible,#pt-home:visible,#cl-role-change:visible').first();
  assert(await exit.count()>0,'Missing return-to-portal after '+page.url());
  await exit.click();await page.locator(choices+':visible').first().waitFor();
}
async function checkViewport(page){
  const size=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth]);
  assert(size[1]<=size[0]+1,'Horizontal overflow '+size+' in '+page.url());
}
async function rolesAndMotion(page){
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});await page.goto(url);
    assert.equal(await page.locator(choices+':visible').count(),Object.keys(roles).length);
    await checkViewport(page);
    for(const role of Object.keys(roles)){
      await enter(page,role);await checkViewport(page);
      // A reload of the active role must restore that role and view.
      if(width===1440){await page.reload();await assertRoute(page,role)}
      await home(page);await checkViewport(page);
    }
  }
}
async function crossRoleBoundary(page){
  await page.setViewportSize({width:1440,height:900});
  const forbiddenRoutes={doctor:['reviewer','admin','leader'],reviewer:['doctorRelease','admin','leader'],patient:['doctor','reviewer','screen'],director:['leader','admin','doctorResearch'],leader:['reviewer','doctorRelease']};
  for(const [role,foreign] of Object.entries(forbiddenRoutes)){
    await enter(page,role);
    for(const route of foreign){
      await page.evaluate(hash=>{location.hash=hash},route);
      await assertRoute(page,role);
      assert.equal(await page.locator(roles[role][1]).isVisible(),true);
      const regular=page.locator('[data-platform-route="'+route+'"]:visible');
      assert.equal(await regular.count(),0,role+' inappropriate navigation to '+route);
    }
    await home(page);
  }
}
async function permissionsAndAudit(page){
  await enter(page,'admin');
  await page.locator('#view-admin [data-ad-tab=review]').click();
  assert.equal(await page.locator('#view-admin [data-ad-act=approve]:visible,#view-admin [data-ad-act=changes]:visible').count(),0);
  await home(page);await enter(page,'reviewer');
  await page.locator('#view-admin [data-reviewer-workspace]').waitFor({state:'visible'});
  assert.equal(await page.locator('#view-admin [data-ad-tab=doctors]:visible,#view-admin [data-ad-tab=campus]:visible,#view-admin [data-ad-act=screen]:visible').count(),0);
  for(const [decision,reason,target] of [['changes','请核对服务范围。','changes'],['approve','已核对版本、知识来源和人工复核范围。','approved']]){
    await page.locator('#ad-review-detail [data-ad-act="'+decision+'"]:visible').click();
    await page.locator('#ad-reason').fill(reason);await page.locator('#ad-form button[type=submit]').click();
    assert.equal(await page.evaluate(()=>CL.state.release.status),target);
    assert.equal(await page.evaluate(()=>CL.state.service.version),'1.2','approval alone cannot switch patient service');
    await page.locator('#view-admin [data-ad-tab=audit]').click();
    assert((await page.locator('#ad-logrows').innerText()).includes(reason));
    if(decision==='changes'){
      await home(page);await enter(page,'doctor');
      await page.locator('#platform-shell [data-platform-route=doctorRelease]').click();
      assert.equal(await page.locator('#rl-note').innerText(),reason);await page.locator('#rl-primary').click();assert.equal(await page.evaluate(()=>CL.state.release.status),'submitted');
      await home(page);await enter(page,'reviewer');
    }
  }
  await home(page);await enter(page,'patient');
  assert.match(await page.locator('#pt-service').innerText(),/1\.2/);
  await page.locator('[data-pt-q=visit]').click();assert.match(await page.locator('#pt-ask').innerText(),/随访/);
  await home(page);await enter(page,'doctor');
  await page.locator('#platform-shell [data-platform-route=doctorRelease]').click();
  assert.equal(await page.locator('#rl-note').innerText(),'已核对版本、知识来源和人工复核范围。');
  assert(await page.locator('#rl-primary').isDisabled());await page.locator('#rl-ack').check();await page.locator('#rl-primary').click();
  assert.equal(await page.evaluate(()=>CL.state.service.version),'1.3');
  await home(page);await enter(page,'patient');
  assert.match(await page.locator('#pt-service').innerText(),/1\.3/);
  await home(page);await enter(page,'admin');
  await page.locator('#view-admin [data-ad-tab=doctors]').click();
  assert((await page.locator('#ad-content').innerText()).includes('数字医生名册'));
  await page.locator('#view-admin [data-ad-tab=campus]').click();
  await page.locator('#view-admin [data-ad-act=invite]').click();
  await page.locator('#ad-name').fill('演示测试医生');await page.locator('#ad-invite-dept').fill('运动医学科');
  await page.locator('#ad-invite button[type=submit]').click();
  assert((await page.locator('#ad-content').innerText()).includes('演示测试医生'));await home(page);
}
async function boards(page){
  const app=page.locator('#view-screen');
  const nums=()=>app.locator('#ld-patients,#ld-services,#ld-rounds').allTextContents().then(vals=>vals.map(v=>Number(v.replaceAll(',',''))));
  await enter(page,'director');assert.match(await app.locator('#ld-title').innerText(),/科主任/);
  assert.deepEqual(await nums(),[784,930,2642]);
  const docs=await app.locator('[data-ld-doctor]:visible').evaluateAll(els=>[...new Set(els.map(el=>el.dataset.ldDoctor))].sort());
  assert.deepEqual(docs,['运动医学 AI 01','运动医学 AI 02']);
  assert((await app.locator('[data-ld-dept]:visible').evaluateAll(els=>els.map(el=>el.dataset.ldDept))).every(d=>d==='运动医学科'));
  assert.equal(await app.locator('#ld-app').getAttribute('data-board-role'),'director');
  assert.match(await app.locator('.ldd-forecast').innerText(),/224/);
  assert.doesNotMatch(await app.innerText(),/康复医学 AI|骨科 AI/);
  await app.locator('[data-ld-doctor="运动医学 AI 02"]:visible').first().click();
  assert.deepEqual(await page.evaluate(()=>[LeadWall.state.dept,LeadWall.state.doctor]),['运动医学科','运动医学 AI 02']);
  await app.locator('#ld-period').selectOption('7');await app.locator('#ld-filters').click();await app.locator('#ld-clear-filters').click();
  assert.equal(await page.evaluate(()=>LeadWall.state.dept),'运动医学科');
  await page.evaluate(()=>{LeadWall.back();LeadWall.reset()});
  assert.equal(await page.evaluate(()=>LeadWall.state.dept),'运动医学科');
  assert.doesNotMatch(await app.innerText(),/康复医学 AI|骨科 AI/);await home(page);
  await enter(page,'leader');assert.match(await app.locator('#ld-title').innerText(),/院领导/);
  assert.deepEqual(await nums(),[1542,2235,6379]);
  const depts=await app.locator('[data-ld-dept]:visible').evaluateAll(els=>[...new Set(els.map(el=>el.dataset.ldDept))].sort());
  assert.deepEqual(depts,['运动医学科','康复医学科','骨科'].sort());
  await app.locator('[data-ld-dept="骨科"]:visible').first().click();await app.locator('[data-ld-doctor="骨科 AI 01"]:visible').first().click();
  assert.equal(await page.evaluate(()=>LeadWall.state.dept),'骨科');await home(page);
}
async function legacy(caller){
  for(const [legacyRoute,role,route] of [['screen','leader','leader'],['admin','admin','admin'],['doctorPersona','doctor','doctorPersona']]){
    const page=await caller.context().newPage();
    try{
      await page.goto(routeUrl(legacyRoute));await assertRoute(page,role,route);
      assert.equal(await page.locator('.cl-view:visible').count(),1);
    }finally{await page.close()}
  }
}
async function navigation(page){
  await enter(page,'doctor');await page.locator('#platform-shell [data-platform-route=doctorFollow]').click();
  await assertRoute(page,'doctor','doctorFollow');await page.goBack();await assertRoute(page,'doctor');
  await page.goForward();await assertRoute(page,'doctor','doctorFollow');await home(page);
}
async function native(page){
  const f=page;
  await page.goto(url);
  await f.locator('#po-home').waitFor({state:'visible'});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:920});
    for(const [role,[label]] of Object.entries(roles)){
      const key='role'+role[0].toUpperCase()+role.slice(1);
      const b=f.locator('#po-home [popovertarget="read-'+key+'"]:visible');
      assert.equal(await b.count(),1,role+' native button');
      await b.click();const panel=f.locator('#read-'+key);await panel.waitFor({state:'visible'});
      assert.equal(await panel.getAttribute('data-native-role'),role);
      const txt=await panel.innerText();assert(txt.includes(({reviewer:'院方审核工作台',admin:'院方管理工作台'})[role]||label),role+' label');assert(txt.length>60,role+' role-specific data');
      assert.equal(await panel.locator('[data-role-entry],.nw-switch').count(),0,role+' cross-role switching');
      const details=panel.locator('details');assert(await details.count()>=2);const detail=details.nth(1);const wasOpen=await detail.evaluate(el=>el.open);await detail.locator('summary').click();assert.equal(await detail.evaluate(el=>el.open),!wasOpen);
      assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await panel.getByRole('button',{name:'返回身份选择'}).click();assert(!(await panel.isVisible()));
      assert.equal(await f.locator('#static-'+key).count(),1);
    }
  }
}
(async()=>{
 const options={executablePath,headless:true};
 if(process.env.CHROMIUM_SINGLE_PROCESS==='1') options.args=['--no-sandbox','--single-process','--disable-gpu','--disable-dev-shm-usage','--disable-software-rasterizer','--no-zygote','--disable-breakpad','--disable-crash-reporter'];
 const browser=await chromium.launch(options);
 const mode=process.argv[2];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});const page=await context.newPage();
  page.setDefaultTimeout(4500);page.on('pageerror',e=>errors.push(e.message));
  if(!mode||mode==='entry'){await rolesAndMotion(page);console.log('PASS six separate role entries, refresh and mobile/desktop widths.')}
  await page.setViewportSize({width:1440,height:900});await page.goto(url);
  if(!mode||mode==='scope'){await crossRoleBoundary(page);await navigation(page);await legacy(page);console.log('PASS role-scoped navigation, cross-role hash, history, refresh and legacy links.')}
  if(!mode||mode==='boards'){await boards(page);console.log('PASS director restricted metrics, physician drill, filter/reset consistency and hospital-wide leader data.')}
  if(!mode||mode==='review'){await permissionsAndAudit(page);console.log('PASS separate reviewer and doctor approval, patient only authorized release, administrator management.')}

  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
 if(!mode||mode==='native'){
   const viewer=await chromium.launch(options);
   try{
     const page=await viewer.newPage({javaScriptEnabled:false});
     await native(page);
     console.log('PASS six isolated script-free role dashboards, actions, details and return.');
   }finally{await viewer.close()}
 }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
