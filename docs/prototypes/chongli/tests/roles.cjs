const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const file = path.resolve(process.env.PROTOTYPE_HTML || path.join(__dirname, '..', 'index.html'));
const url = pathToFileURL(file).href;
const executablePath = process.env.CHROMIUM_PATH || undefined;
const roles = {
  doctor:['医生','#page-home'], director:['科主任','#view-screen'], leader:['院领导','#view-screen'],
  reviewer:['院方审核人员','#view-admin'], patient:['患者','#view-patient'], admin:['院方管理员','#view-admin']
};
const accounts = {doctor:'CL1001', patient:'PT1001', director:'CL2001', leader:'CL3001', reviewer:'CL4001', admin:'CL5001'};
const errors=[];
function routeUrl(route){return url+'#'+route}
async function assertRoute(page,role,route=role){
  await page.waitForFunction(([role,route])=>window.CL?.currentRole?.()===role && location.hash==='#'+route,[role,route],{timeout:3500});
  assert.equal(await page.locator('.cl-view:visible').count(),1);
}
async function openLogin(page){
  const dialog=page.locator('#cl-login-dialog');
  if(!await dialog.isVisible())await page.locator('#po-login-open').click();
  await dialog.waitFor({state:'visible'});
  return dialog;
}
async function enter(page,role){
  const dialog=await openLogin(page);
  const id=accounts[role];
  const sample=dialog.locator('[data-demo-account="'+id+'"]');
  assert((await sample.innerText()).includes(roles[role][0]),role+' demo account');
  await sample.click();await assertRoute(page,role);
  assert.equal(await page.evaluate(()=>CL.currentAccount().id),id);
  await page.locator(roles[role][1]).waitFor({state:'visible'});
}
async function home(page){
  const exit=page.locator('#cl-role-change:visible,#ld-back:visible').first();
  assert(await exit.count()>0,'Missing account control in '+page.url());
  await exit.click();
  // A board may take its viewer back to the portal with an active account.
  if(await page.evaluate(()=>!!CL.currentAccount()))await page.locator('#cl-role-change').click();
  await page.waitForFunction(()=>CL.currentAccount()===null);
  if(await page.locator('#cl-login-dialog').isVisible())await page.keyboard.press('Escape');
  await page.locator('#po-login-open').waitFor({state:'visible'});
}
async function checkViewport(page){
  const size=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth]);
  assert(size[1]<=size[0]+1,'Horizontal overflow '+size+' in '+page.url());
}
async function horizontalLogos(page,selector){
  const marks=page.locator(selector+':visible img');
  assert.equal(await marks.count(),2,'Two hospital logos at '+selector);
  const [parent,campus]=await marks.evaluateAll(async imgs=>Promise.all(imgs.map(async img=>{
    await img.decode(); const r=img.getBoundingClientRect();
    return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height};
  })));
  assert(parent.width>0 && campus.width>0,'Logos displayed at '+selector);
  assert(parent.right<=campus.x+1,'Parent logo must precede campus logo in the same line at '+selector);
  const verticalOverlap=Math.min(parent.bottom,campus.bottom)-Math.max(parent.y,campus.y);
  assert(verticalOverlap>=Math.min(parent.height,campus.height)*.6,'Logo vertical alignment at '+selector);
}
async function rolesAndMotion(page){
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});await page.goto(url);
    assert.equal(await page.locator('#po-home [data-role-entry]:visible').count(),0);
    assert.equal(await page.locator('#po-login-open:visible').count(),1);
    assert.match(await page.locator('#po-account-hint').innerText(),/患者/);
    await checkViewport(page);await horizontalLogos(page,'.cl-id-marks');
    for(const role of Object.keys(roles)){
      await enter(page,role);await checkViewport(page);
      if(role==='leader'||role==='director')await horizontalLogos(page,'.ld-campus-mark');
      if(width===1440){await page.reload();await assertRoute(page,role)}
      await home(page);await checkViewport(page);
    }
  }
}
async function accountInput(page){
  const dialog=await openLogin(page);
  const input=dialog.locator('#cl-demo-account');
  assert.equal(await dialog.locator('input[type=password]').count(),0);
  assert.equal(await dialog.locator('[data-demo-account]').count(),Object.keys(accounts).length);
  assert.equal(await dialog.getAttribute('open')!==null,true);
  await input.fill('UNKNOWN');await input.press('Enter');
  assert.match(await dialog.locator('#cl-login-error').innerText(),/账号/);
  assert.equal(await page.evaluate(()=>CL.currentAccount()),null);
  await input.fill('  pt1001  ');await input.press('Enter');
  await assertRoute(page,'patient');await home(page);
  await openLogin(page);await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cl-login-dialog').isVisible(),false);
}
async function crossRoleBoundary(page){
  await page.setViewportSize({width:1440,height:900});
  const forbiddenRoutes={doctor:['reviewer','admin','leader'],reviewer:['doctorRelease','admin','leader'],patient:['doctor','reviewer','screen'],director:['leader','admin','doctorResearch'],leader:['reviewer','doctorRelease'],admin:['reviewer','doctorRelease','director']};
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
  await page.locator('#ad-review-detail [data-ad-act=approve]:visible').click();
  await page.locator('#ad-reason').fill('第一次打开的送审单');
  const editor=await page.context().newPage();
  await editor.goto(url);await enter(editor,'doctor');
  const updated=await editor.evaluate(()=>{
    CL.addKnowledge([0]);
    CL.submit();
    return CL.state.release;
  });
  await page.waitForFunction(id=>CL.state.release.submissionId===id,updated.submissionId);
  await page.locator('#ad-form button[type=submit]').click();
  assert.equal(await page.evaluate(()=>CL.state.release.status),'submitted','stale decision must not approve a new submission of the same semantic version');
  assert.match(await page.locator('#ad-message').innerText(),/重新操作/);
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
  assert(await page.locator('#rl-primary').isDisabled());await page.locator('#rl-ack').check();
  const oldId=await page.evaluate(()=>CL.state.release.submissionId);
  await editor.evaluate(()=>{
    CL.addKnowledge([1]);
    CL.saveSettings({focus:'肩关节',tone:'专业严谨',depth:'分步说明'});
    CL.submit();
  });
  await home(editor);await enter(editor,'reviewer');
  const newId=await editor.evaluate(()=>{CL.approve('已核对变更后的资料。');return CL.state.release.submissionId});
  await page.waitForFunction(id=>CL.state.release.submissionId===id&&CL.state.release.status==='approved',newId);
  assert(await page.locator('#rl-primary').isDisabled(),'new approval requires fresh clinician consent');
  assert.equal(await page.evaluate(id=>CL.authorize(id),oldId),false);
  await page.locator('#rl-ack').check();await page.locator('#rl-primary').click();
  assert.equal(await page.evaluate(()=>CL.state.service.version),'1.3');
  assert.deepEqual(await page.evaluate(()=>CL.state.service.knowledgeIds),[0,1]);
  assert.equal(await page.evaluate(()=>CL.state.service.submissionId),newId);
  await page.evaluate(()=>CL.setKnowledge([0]));
  assert.deepEqual(await page.evaluate(()=>[CL.state.release.version,CL.state.service.knowledgeIds]),['1.4',[0,1]],'draft edits must leave the active service intact');
  await editor.close();
  await home(page);await enter(page,'patient');
  assert.match(await page.locator('#pt-service').innerText(),/1\.3/);
  assert.match(await page.locator('#pt-service').innerText(),/肩关节/);
  assert.match(await page.locator('#pt-answer').innerText(),/复诊资料准备要点如下。①.*②/s);
  await home(page);await enter(page,'admin');
  await page.locator('#view-admin [data-ad-tab=doctors]').click();
  assert((await page.locator('#ad-content').innerText()).includes('数字医生名册'));
  await page.locator('#view-admin [data-ad-tab=campus]').click();
  await page.locator('#view-admin [data-ad-act=invite]').click();
  await page.locator('#ad-name').fill('演示测试医生');await page.locator('#ad-invite-dept').fill('运动医学科');
  await page.locator('#ad-invite button[type=submit]').click();
  assert((await page.locator('#ad-content').innerText()).includes('演示测试医生'));
  await page.locator('#view-admin [data-ad-tab=doctors]').click();
  await page.locator('[data-ad-act=profile][data-ad-id=chen]').click();
  await page.locator('#ad-dialog [data-ad-act=pause]').click();
  await page.locator('#ad-reason').fill('演示服务质量复核');
  await page.locator('#ad-form button[type=submit]').click();
  await home(page);await enter(page,'patient');
  await page.locator('#pt-unavailable').waitFor({state:'visible'});
  assert.equal(await page.locator('#pt-available').isVisible(),false);
  await home(page);await enter(page,'doctor');
  await page.locator('#platform-shell [data-platform-route=doctorRelease]').click();
  assert(await page.locator('#rl-resume').isDisabled());
  await page.locator('#rl-resume-ack').check();await page.locator('#rl-resume').click();
  assert.deepEqual(await page.evaluate(()=>[CL.state.service.active,CL.state.service.version,CL.state.release.status]),[true,'1.3','draft']);
  await home(page);await enter(page,'admin');
  await page.locator('#view-admin [data-ad-tab=audit]').click();
  assert.match(await page.locator('#ad-logrows').innerText(),/演示服务质量复核/,'pause reason stays in the audit after recovery');
  await home(page);
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
async function deepLinks(caller){
  for(const [requested,id,role,expected] of [
    ['screen','CL3001','leader','leader'],
    ['admin','PT1001','patient','patient'],
    ['doctorPersona','CL1001','doctor','doctorPersona'],
    ['roleReviewer','CL5001','admin','admin'],
    ['serviceFollow','CL1001','doctor','doctorFollow'],
    ['serviceFollow','PT1001','patient','patient'],
    ['serviceGovernance','CL2001','director','director'],
    ['serviceGovernance','PT1001','patient','patient']
  ]){
    const page=await caller.context().newPage();
    try{
      await page.goto(url);
      await page.evaluate(()=>sessionStorage.setItem('chongli-role-demo:'+location.pathname,'leader'));
      await page.goto(routeUrl(requested));
      await page.locator('#cl-login-dialog').waitFor({state:'visible'});
      await assertRoute(page,'','portal');
      assert.equal(await page.evaluate(()=>CL.currentAccount()),null);
      assert.equal(await page.locator('#view-admin:visible,#view-screen:visible,#view-doctor:visible').count(),0);
      await page.reload();await page.locator('#cl-login-dialog').waitFor({state:'visible'});
      await page.locator('[data-demo-account="'+id+'"]').click();
      await assertRoute(page,role,expected);
      await page.reload();await assertRoute(page,role,expected);
      await home(page);
    }finally{await page.close()}
  }
  const page=await caller.context().newPage();
  try{
    await page.goto(routeUrl('doctorPersona'));
    await page.locator('#cl-login-dialog').waitFor();
    await page.keyboard.press('Escape');await enter(page,'doctor');
    await assertRoute(page,'doctor','doctor');await home(page);
    await page.goBack();await page.waitForFunction(()=>CL.currentAccount()===null);
    assert.equal(await page.locator('#view-doctor:visible').count(),0);
  }finally{await page.close()}
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
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:920});await checkViewport(page);await horizontalLogos(page,'.cl-id-marks');
    const picker=f.locator('#read-accounts');
    await f.locator('#po-native-login').click();await picker.waitFor({state:'visible'});
    assert.equal(await picker.locator('[data-sample-account]').count(),Object.keys(accounts).length);
    for(const [role,[label]] of Object.entries(roles)){
      const key='role'+role[0].toUpperCase()+role.slice(1);
      const b=picker.locator('[data-sample-account="'+accounts[role]+'"]:visible');
      assert.equal(await b.count(),1,role+' native sample');
      await b.click();const panel=f.locator('#read-'+key);await panel.waitFor({state:'visible'});
      assert.equal(await panel.getAttribute('data-native-role'),role);
      const txt=await panel.innerText();assert(txt.includes(({reviewer:'院方审核工作台',admin:'院方管理工作台'})[role]||label),role+' label');assert(txt.length>60,role+' role-specific data');
      assert.equal(await panel.locator('[data-role-entry],.nw-switch').count(),0,role+' cross-role switching');
      const details=panel.locator('details');assert(await details.count()>=2);const detail=details.nth(1);const wasOpen=await detail.evaluate(el=>el.open);await detail.locator('summary').click();assert.equal(await detail.evaluate(el=>el.open),!wasOpen);
      assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await panel.getByRole('button',{name:'返回账号选择'}).click();await picker.waitFor({state:'visible'});assert(!(await panel.isVisible()));
      assert.equal(await f.locator('#static-'+key).count(),1);
    }
    await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});
  }
}
async function packedPreview(page){
  const html=fs.readFileSync(file,'utf8');
  if(html.includes('href="styles.css"'))return;
  await page.setViewportSize({width:390,height:844});
  await page.goto('about:blank');
  await page.setContent('<style>body{margin:0}iframe{display:block;border:0;width:100vw;height:100vh}</style><iframe name="preview" sandbox></iframe>');
  await page.locator('iframe').evaluate((frame,html)=>{frame.srcdoc=html},html);
  const frame=page.frame({name:'preview'});
  await frame.locator('#po-native-login').click();
  const picker=frame.locator('#read-accounts');
  await picker.locator('[data-sample-account="PT1001"]').click();
  const patient=frame.locator('#read-rolePatient');
  await patient.waitFor({state:'visible'});
  assert.equal(await frame.locator('.role-preview:visible').count(),1);
  assert.match(await patient.innerText(),/就诊准备|随访/);
  await patient.getByRole('button',{name:'返回账号选择'}).click();
  await picker.waitFor();assert.equal(await patient.isVisible(),false);
  console.log('PASS patient account in script-blocked, sandboxed embedded preview.');
}
(async()=>{
 const options={executablePath,headless:true};
 if(process.env.CHROMIUM_SINGLE_PROCESS==='1') options.args=['--no-sandbox','--single-process','--disable-gpu','--disable-dev-shm-usage','--disable-software-rasterizer','--no-zygote','--disable-breakpad','--disable-crash-reporter'];
 const browser=await chromium.launch(options);
 const mode=process.argv[2];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});const page=await context.newPage();
  page.setDefaultTimeout(4500);page.on('pageerror',e=>errors.push(e.message));
  if(!mode||mode==='entry'){await rolesAndMotion(page);await accountInput(page);console.log('PASS one portal login, six accounts including patient, validation, refresh, logo order and responsive widths.')}
  await page.setViewportSize({width:1440,height:900});await page.goto(url);
  if(!mode||mode==='scope'){await crossRoleBoundary(page);await navigation(page);await deepLinks(page);console.log('PASS guarded anonymous deep links, permitted destination, mismatched account, revoked session, persisted sign-in, history and scoped navigation.')}
  if(!mode||mode==='boards'){await boards(page);console.log('PASS director restricted metrics, physician drill, filter/reset consistency and hospital-wide leader data.')}
  if(!mode||mode==='review'){await permissionsAndAudit(page);console.log('PASS separate reviewer and doctor approval, patient only authorized release, administrator management.')}

  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
 if(!mode||mode==='native'){
   const viewer=await chromium.launch(options);
   try{
     const page=await viewer.newPage({javaScriptEnabled:false});
     await native(page);await packedPreview(page);
     console.log('PASS script-free account picker, six read-only workspaces, details and account return on three widths.');
   }finally{await viewer.close()}
 }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
