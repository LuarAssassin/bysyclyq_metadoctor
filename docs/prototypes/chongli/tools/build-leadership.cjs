const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createRequire} = require('node:module');
const testRequire = createRequire(path.resolve(__dirname, '../tests/package.json'));
const {chromium} = testRequire('playwright');
const [input, output] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) {
  console.error('Usage: node tools/build-leadership.cjs <portal.html> <new-dashboard.html>');
  process.exit(2);
}
const source = path.resolve(input);
const target = path.resolve(output);
const opts = {executablePath: process.env.CHROMIUM_PATH || undefined};
if (process.env.CHROMIUM_SINGLE_PROCESS === '1') {
  opts.args = ['--single-process', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote'];
}
function snapshots() {
  const host=document.getElementById('view-screen'), wall=window.LeadWall, data=window.LeadData;
  const variants=[];
  for(const days of [30,7,1]) {
    variants.push({days,dept:'',doctor:''});
    for(const dept of data.options.dept) {
      variants.push({days,dept,doctor:''});
      for(const doctor of data.doctorsByDept[dept]) variants.push({days,dept,doctor});
    }
  }
  // Read-only snapshots all show the same hospital marks. Keep the original
  // image elements, dimensions and accessible attributes, and share their
  // two embedded originals through CSS replaced-image content.
  const logoSelectors=['.ld-parent-logo','.ld-chongli-logo'];
  const logoRules=logoSelectors.map(selector=>{
    const src=host.querySelector('.ld-campus-mark '+selector)?.getAttribute('src');
    if(!src?.startsWith('data:image/')) throw Error('Expected a bundled hospital logo: '+selector);
    return '.ld-snapshot .ld-campus-mark '+selector+'{content:url("'+src+'")}';
  }).join('\n');
  const ids=new Set(['view-screen']);
  const crossIds = (days,dept,doctor)=>variants.findIndex(s=>s.days===days && s.dept===dept && s.doctor===doctor);
  function makeNative(old,tag) {
    const replacement=document.createElement(tag);
    for (const attr of old.attributes) {
      if(!['type','disabled','role','tabindex'].includes(attr.name) && !attr.name.startsWith('on')) replacement.setAttribute(attr.name,attr.value);
    }
    while(old.firstChild) replacement.append(old.firstChild);
    old.replaceWith(replacement);
    return replacement;
  }
  function nav(node,index){
    if(index<0) return;
    let original=node;
    if (node.tagName==='TR') original=node.querySelector('th,td');
    if(!original) return;
    const label=makeNative(original,'label');
    label.htmlFor='lead-read-v'+index;label.dataset.readNav='v'+index;
  }
  const sections=[];
  variants.forEach((current,index)=>{
    wall.reset();wall.set(current);
    const explanation=host.querySelector('#ld-method');
    if(explanation){explanation.click();host.querySelector('#ld-methodbox [data-ld-close]')?.click();}
    const clone=host.cloneNode(true);
    clone.querySelectorAll('style,script,#ld-hospital[hidden],#ld-detail[hidden]').forEach(el=>el.remove());
    for(const selector of logoSelectors) {
      clone.querySelector('.ld-campus-mark '+selector).removeAttribute('src');
    }
    clone.removeAttribute('hidden');
    clone.classList.remove('cl-view');
    clone.classList.add('ld-snapshot');clone.dataset.readKey='v'+index;
    const livePeriod=clone.querySelector('#ld-period');
    if(livePeriod) {
      const period=document.createElement('div');period.className='lead-read-period';period.setAttribute('aria-label','统计周期');
      for(const days of [1,7,30]){
        const label=document.createElement('label');const to=crossIds(days,current.dept,current.doctor);
        label.htmlFor='lead-read-v'+to;label.dataset.readNav='v'+to;label.textContent=days===1?'单日':'近'+days+'天';
        if(days===current.days) label.setAttribute('aria-current','true');
        period.append(label);
      }
      livePeriod.replaceWith(period);
    }
    for(const [key,idx] of [['#ld-crumb-hospital',crossIds(current.days,'','')],['#ld-crumb-dept',crossIds(current.days,current.dept,'')]]){
      const crumb=clone.querySelector(key);if(crumb)nav(crumb,idx);
    }
    clone.querySelectorAll('[data-ld-dept]').forEach(el=>{
      if(el.tagName==='OPTION')return;
      nav(el,crossIds(current.days,el.dataset.ldDept,''));
    });
    clone.querySelectorAll('[data-ld-doctor]').forEach(el=>nav(el,crossIds(current.days,current.dept,el.dataset.ldDoctor)));
    const brandline=clone.querySelector('.ld-brandline');
    if(brandline) brandline.textContent='崇礼院区 · 演示数据 · 只读预览';
    const back=clone.querySelector('#ld-back');
    if(back){
      back.setAttribute('popovertarget','lead-read-portal');
      back.setAttribute('popovertargetaction','show');
      back.setAttribute('aria-label','返回门户');
      back.querySelector('span').textContent='返回门户';
    }
    clone.querySelectorAll('#ld-full,#ld-filters').forEach(n=>n.remove());
    const method=clone.querySelector('#ld-method');
    const dialogs=[...clone.querySelectorAll('dialog')];
    const methodPanel=dialogs.find(el=>/口径|指标说明|预测依据|评价方法/.test(el.textContent)&&!/清空筛选|应用筛选/.test(el.textContent));
    if(method && methodPanel) {
      const n=makeNative(methodPanel,'section');n.removeAttribute('open');n.removeAttribute('hidden');n.setAttribute('popover','auto');
      n.classList.add('lead-read-dialog');method.setAttribute('popovertarget',n.id);
      n.querySelectorAll('button').forEach(b=>{b.setAttribute('popovertarget',n.id);b.setAttribute('popovertargetaction','hide');});
    } else if(method) method.remove();
    clone.querySelectorAll('dialog, [data-ldd-dim]').forEach(el=>{
      if(el.tagName==='DIALOG')el.remove();else if(el.tagName==='BUTTON')makeNative(el,'span');
    });
    const inClone=[clone,...clone.querySelectorAll('*')];
    const idMap=new Map();
    for(const e of inClone){
      if(e.id) {ids.add(e.id);idMap.set(e.id,'read'+index+'-'+e.id);}
    }
    const rewrite=value=>value.replace(/#([A-Za-z_][A-Za-z0-9_-]*)/g,(all,id)=>idMap.has(id)?'#'+idMap.get(id):all);
    const idRefs=new Set(['for','list','aria-labelledby','aria-describedby','aria-controls','aria-owns','aria-activedescendant','popovertarget','headers']);
    for(const e of inClone) {
      if(e.id){e.dataset.readId=e.id;e.id=idMap.get(e.id);}
      if(e.tagName==='INPUT'&&e.hasAttribute('name'))e.name='read'+index+'-'+e.name;
      for(const a of [...e.attributes]){
        if(a.name.startsWith('on'))e.removeAttribute(a.name);
        else if(idRefs.has(a.name))e.setAttribute(a.name,a.value.split(/\s+/).map(id=>idMap.get(id)||id).join(' '));
        else if(a.value.includes('#'))e.setAttribute(a.name,rewrite(a.value));
      }
    }
    // Static radio controls can still switch between all read-only dashboard views. Other
    // JS-dependent data breakdowns are shown without interactive affordances.
    clone.querySelectorAll('button:not([popovertarget])').forEach(b=>{
      if(b.hidden)return;
      b.disabled=true;b.style.cursor='default';b.tabIndex=-1;
    });
    sections.push(clone.outerHTML);
  });
  // Class-based rules already apply to both the live dashboard and its snapshots.
  // Replay just the ID-based selectors for the copies, retaining responsive groups.
  function snapshotRules(rules) {
    const copied = [];
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const selector = rule.selectorText.replace(/#([A-Za-z_][A-Za-z0-9_-]*)/g,
          (match,id) => ids.has(id) ? '[data-read-id="'+id+'"]' : match);
        if (selector !== rule.selectorText) copied.push(selector+'{'+rule.style.cssText+'}');
      } else if (rule.cssRules && rule.cssText.startsWith('@')) {
        const inner = snapshotRules(rule.cssRules);
        if (inner) copied.push(rule.cssText.slice(0,rule.cssText.indexOf('{'))+'{'+inner+'}');
      }
    }
    return copied.join('\n');
  }
  const css=[...document.querySelectorAll('style')].map(element=>snapshotRules(element.sheet.cssRules)).join('\n');
  return {sections,css:css+'\n'+logoRules,variants};
}

async function run(){
  const browser=await chromium.launch(opts);
  try{
    const p=await browser.newPage({viewport:{width:1920,height:1080}});
    await p.goto(pathToFileURL(source).href);
    await p.waitForFunction(()=>typeof window.CL?.loginAccount==='function');
    await p.evaluate(()=>{
      const login=CL.loginAccount('CL3001');
      if(!login.ok||login.account.role!=='leader') throw Error('Could not open the leadership demo account');
    });
    await p.waitForFunction(()=>window.LeadWall?.set && window.LeadData?.query && !document.getElementById('view-screen').hidden,null,{timeout:8000});
    await p.evaluate(()=>document.fonts.ready);
    const snap=await p.evaluate(snapshots);
    const inputs=snap.variants.map((s,i)=>'<input class="lead-read-choice" type="radio" name="lead-read-scope" id="lead-read-v'+i+'" aria-label="'+[s.dept||'全院',s.doctor,s.days===1?'单日':'近'+s.days+'天'].filter(Boolean).join(' · ')+'"'+(!i?' checked':'')+'>').join('');
    const rules=snap.variants.map((s,i)=>'#lead-read-v'+i+':checked ~ [data-read-key="v'+i+'"]{display:block!important}').join('\n');
    const navStyles='[data-read-nav]{cursor:pointer;touch-action:manipulation}[data-read-nav]:focus-visible{outline:2px solid currentColor}.lead-read-period{display:inline-flex;gap:4px;font:inherit;align-items:center}.lead-read-period label{display:block;white-space:nowrap;cursor:pointer;padding:4px 8px;border-radius:6px;font-size:13px}.lead-read-period [aria-current]{background:#27515c;color:#fff}.lead-read-dialog:popover-open{position:fixed;margin:auto;inset:0;max-width:min(630px,90vw);max-height:80vh;overflow:auto;background:#152e3a;color:white;border:1px solid #71898f;padding:18px 22px}.lead-read-dialog:not(:popover-open){display:none!important}.lead-read-dialog::backdrop{background:#11222dbb}';
    // A native mode switch keeps both views inside this file, including when
    // a sandboxed srcdoc disallows scripts and outbound navigation.
    const portalMode=':has(#lead-read-portal:popover-open)';
    const switchStyles='#lead-read-portal:popover-open{position:fixed;inset:auto 16px 16px auto;margin:0;padding:0;border:0;border-radius:10px;box-shadow:0 2px 12px #14345230}#lead-read-portal button{background:#16465a;color:white;border:0;font:inherit;padding:10px 15px;cursor:pointer}';
    const portalSwitch='<div id="lead-read-portal" popover="manual"><button type="button" popovertarget="lead-read-portal" popovertargetaction="hide">返回演示大屏</button></div>';
    const css='<style>html:not([data-interactive]):not('+portalMode+'){background:#102230}html:not([data-interactive]):not('+portalMode+') :is(#cl-brandbar,#cl-main,#cl-skip){display:none!important}html[data-interactive] #lead-read,html'+portalMode+' #lead-read{display:none!important}#lead-read>.lead-read-choice{position:absolute;opacity:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}#lead-read>.ld-snapshot{display:none!important}'+snap.css+navStyles+switchStyles+rules+'</style>';
    const html=await fs.readFile(source,'utf8');
    const original="const defaultRoute='portal'";if(!html.includes(original)) throw Error('Missing expected route');
    const result=html.replace(original,"const defaultRoute='leader'").replace(/<title>.*?<\/title>/,'<title>AI 医生服务与成效 · 崇礼院区管理大屏</title>').replace('</head>',()=>css+'</head>').replace('</body>',()=>'<section id="lead-read" aria-label="院科服务评价总览">'+inputs+snap.sections.join('')+'</section>'+portalSwitch+'</body>');
    await fs.writeFile(target,result);
    console.log('Wrote',target,Buffer.byteLength(result),'bytes,',snap.sections.length,'script-independent views');
  }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1});
