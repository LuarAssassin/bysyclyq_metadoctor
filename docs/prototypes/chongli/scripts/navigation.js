(()=>{
const defaultRoute='portal';
const roles={
 doctor:{title:'医生',home:'doctor',pages:['doctor','doctorPersona','doctorFollow','doctorResearch','doctorKnowledge','doctorRelease','doctorPatientPreview','guide','about']},
 director:{title:'科主任',home:'director',pages:['director']},
 leader:{title:'院领导',home:'leader',pages:['leader']},
 reviewer:{title:'院方审核人员',home:'reviewer',pages:['reviewer']},
 admin:{title:'院方管理员',home:'admin',pages:['admin']},
 patient:{title:'患者',home:'patient',pages:['patient']}
};
const groups={portal:'portal',about:'portal',guide:'guide',doctor:'doctor',doctorPersona:'doctor',doctorFollow:'doctor',doctorResearch:'doctor',doctorKnowledge:'doctor',doctorRelease:'doctorRelease',doctorPatientPreview:'patient',director:'screen',leader:'screen',reviewer:'admin',admin:'admin',patient:'patient'};
const names={portal:'院区门户',about:'平台介绍',guide:'操作指南',doctor:'医生工作台',doctorPersona:'数字医生构建平台',doctorFollow:'患者服务与智能随访平台',doctorResearch:'医学科研辅助平台',doctorKnowledge:'专业知识库',doctorRelease:'审查与授权',doctorPatientPreview:'患者视角预览',director:'科主任工作台',leader:'院领导工作台',reviewer:'发布审查工作台',admin:'院方管理工作台',patient:'患者服务'};
const aliases={'po-home':'portal','po-role-entries':'portal',roleDoctor:'doctor',roleDirector:'director',roleLeader:'leader',roleReviewer:'reviewer',roleAdmin:'admin',rolePatient:'patient',screen:'leader'};
const main=document.getElementById('cl-main'),shell=document.getElementById('platform-shell'),menu=document.getElementById('ws-menu');
const brandbar=document.getElementById('cl-brandbar'),roleLabel=document.getElementById('cl-active-role'),switchButton=document.getElementById('cl-role-change');
const reset=document.getElementById('cl-reset-dialog'),resetOpen=document.getElementById('cl-reset-open');
const sessionKey='chongli-role-demo:'+location.pathname;
const storedRole=()=>{try{return sessionStorage.getItem(sessionKey)}catch{return null}};
const stored=storedRole();
let role=Object.hasOwn(roles,stored)?stored:'', current='', pending='';
function remember(next){
 role=next;
 try{sessionStorage.setItem(sessionKey,next||'public')}catch{/* Previews without storage keep the role in this window. */}
}
CL.currentRole=()=>role;
function canonical(name){
 const key=String(name||'').replace(/^static-/,'');
 const result=Object.hasOwn(aliases,key)?aliases[key]:key;
 return Object.hasOwn(groups,result)?result:'portal';
}
function owner(name){
 return Object.keys(roles).find(key=>roles[key].pages.includes(name))||'';
}
function isPublic(name){return name==='portal'||name==='about'||name==='guide'}
function allowed(name){return role?roles[role].pages.includes(name):isPublic(name)}
function setLocation(name,mode){
 try{
  const stamp={chongliRole:role};
  if(mode==='push'&&location.hash!=='#'+name)history.pushState(stamp,'','#'+name);
  else if(mode==='replace')history.replaceState(stamp,'','#'+name);
 }catch{/* Embedded local previews can still navigate in memory. */}
}
const railLinks=Array.from(shell.querySelectorAll('[data-platform-route]'));
const compactNav=matchMedia('(max-width:1050px)');
const syncMenu=()=>{menu.open=!compactNav.matches};
if(compactNav.addEventListener)compactNav.addEventListener('change',syncMenu);
else if(compactNav.addListener)compactNav.addListener(syncMenu);
railLinks.forEach(link=>link.addEventListener('click',event=>{
 if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 event.preventDefault();CL.go(link.dataset.platformRoute);
}));
function showNavigation(name){
 const local=role==='doctor'&&groups[name]!=='portal'&&name!=='guide'&&name!=='doctorPatientPreview';
 main.toggleAttribute('data-workbench',local);
 shell.hidden=!local;
 if(local){
  for(const link of railLinks){
   link.hidden=!allowed(link.dataset.platformRoute);
   if(link.dataset.platformRoute===name)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  for(const group of shell.querySelectorAll('.ws-group'))group.hidden=!group.querySelector('a:not([hidden])');
  document.getElementById('ws-mobile-label').textContent=railLinks.find(item=>item.dataset.platformRoute===name)?.textContent.trim()||names[name];
  syncMenu();
 }
 roleLabel.hidden=!role;roleLabel.textContent=role?roles[role].title:'';
 switchButton.hidden=!role;resetOpen.hidden=role!=='admin';
 for(const item of brandbar.querySelectorAll('[data-nav]')){
  const dest=item.dataset.nav;
  if(item.closest('.cl-topnav'))item.hidden=Boolean(role)&&dest!=='portal'&&!allowed(dest);
  if(dest===name)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
 }
 for(const link of document.querySelectorAll('#po-about .po-system-action[data-poroute]')){
  link.hidden=Boolean(role)&&!allowed(canonical(link.dataset.poroute));
 }
}
function draw(name,focus){
 current=name;
 document.body.dataset.role=role||'public';
 const group=groups[name];
 showNavigation(name);
 for(const panel of document.querySelectorAll('.cl-view'))panel.hidden=panel.id!=='view-'+group;
 brandbar.hidden=group==='screen';
 document.getElementById('cl-skip').hidden=group==='screen';
 document.title=names[name]+' · 崇礼AI元医院';
 document.documentElement.style.backgroundColor=group==='screen'?'#0a1928':'#f5f6f8';
 window.dispatchEvent(new CustomEvent('cl:view',{detail:name}));
 window.scrollTo(0,0);if(focus)main.focus({preventScroll:true});
}
function focusRoles(suggested){
 const target=(suggested&&document.querySelector('#po-role-entries [data-role-entry="'+suggested+'"]'))||document.getElementById('po-role-entries');
 target?.scrollIntoView?.({block:'start'});
 target?.focus({preventScroll:true});
}
CL.enterRole=next=>{
 if(current!=='portal'||!Object.hasOwn(roles,next))return false;
 remember(next);
 const destination=pending&&roles[next].pages.includes(pending)?pending:roles[next].home;
 pending='';setLocation(destination,'push');draw(destination,true);return true;
};
CL.go=requested=>{
 const name=canonical(requested);
 if(name==='portal'){
  const wasRole=Boolean(role);pending='';remember('');
  setLocation('portal','push');draw('portal',true);if(wasRole)focusRoles();
  return;
 }
 if(!allowed(name)){
  if(role){
   const dest=roles[role].home;setLocation(dest,'replace');draw(dest,true);
  }else{
   pending=name;setLocation('portal','push');draw('portal',true);focusRoles(owner(name));
  }
  return;
 }
 pending='';setLocation(name,'push');draw(name,true);
};
for(const item of brandbar.querySelectorAll('[data-nav]'))item.addEventListener('click',event=>{event.preventDefault();CL.go(item.dataset.nav)});
switchButton.onclick=()=>CL.go('portal');
resetOpen.onclick=()=>{if(role==='admin')reset.showModal()};
document.getElementById('cl-cancel').onclick=()=>reset.close();
document.getElementById('cl-confirm').onclick=()=>{if(role!=='admin')return;reset.close();CL.resetDemo();CL.go('portal');location.reload()};
function followLocation(initial){
 const hash=location.hash.slice(1);
 let route=canonical(hash||defaultRoute);
 if(route==='portal'){
  remember('');pending='';
 }else if(!allowed(route)){
  if(initial&&!role&&stored===null&&!isPublic(route)){
   // A clean tab may open a shared demo deep link. A running session stays within its selected role.
   remember(owner(route));
  }else{
   route=role?roles[role].home:'portal';
  }
 }
 if(hash&&'#'+route!==location.hash||(!hash&&route!=='portal'))setLocation(route,'replace');
 if(initial||current!==route)draw(route,!initial);
}
window.addEventListener('popstate',()=>followLocation(false));
window.addEventListener('hashchange',()=>followLocation(false));
followLocation(true);document.documentElement.dataset.interactive='true';
})();
