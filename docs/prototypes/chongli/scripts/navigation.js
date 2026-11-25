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
const tasks={
 serviceFollow:{title:'患者服务与智能随访平台',routes:{patient:'patient',doctor:'doctorFollow'}},
 serviceGovernance:{title:'数字医生治理与评价平台',routes:{director:'director',leader:'leader',reviewer:'reviewer',admin:'admin'}}
};
const main=document.getElementById('cl-main'),shell=document.getElementById('platform-shell'),menu=document.getElementById('ws-menu');
const skipLink=document.getElementById('cl-skip');
skipLink.addEventListener('click',event=>{
 event.preventDefault();
 main.focus({preventScroll:true});
 main.scrollIntoView({block:'start'});
});
const brandbar=document.getElementById('cl-brandbar'),roleLabel=document.getElementById('cl-active-role'),switchButton=document.getElementById('cl-role-change');
const reset=document.getElementById('cl-reset-dialog'),resetOpen=document.getElementById('cl-reset-open');
const accounts=Object.freeze([
 {id:'CL1001',role:'doctor',name:'陈医生'},
 {id:'PT1001',role:'patient',name:'演示患者'},
 {id:'CL2001',role:'director',name:'运动医学科主任'},
 {id:'CL3001',role:'leader',name:'院领导'},
 {id:'CL4001',role:'reviewer',name:'院方审核人员'},
 {id:'CL5001',role:'admin',name:'院方管理员'}
].map(account=>Object.freeze({...account,label:roles[account.role].title})));
const accountById=new Map(accounts.map(account=>[account.id,account]));
const sessionKey='chongli-demo-account:'+location.pathname+':'+defaultRoute;
function readSession(key){
 try{return sessionStorage.getItem(key)}catch{return null}
}
function writeSession(key,value){
 try{if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key)}catch{/* Sandboxed previews retain the session in memory. */}
}
const savedAccount=readSession(sessionKey);
let account=accountById.get(savedAccount)||null;
let role=account?.role||'',current='',pending='';
function remember(next){
 account=next;role=next?.role||'';
 // An explicit sign-out must also survive a reload of the standalone board.
 writeSession(sessionKey,next?.id||'signed-out');
}
function rememberTarget(name){
 pending=name;writeSession(sessionKey+':destination',name);
}
CL.accounts=accounts;
CL.currentAccount=()=>account;
CL.currentRole=()=>role;
function canonical(name){
 const key=String(name||'').replace(/^static-/,'');
 const result=Object.hasOwn(aliases,key)?aliases[key]:key;
 return Object.hasOwn(groups,result)||Object.hasOwn(tasks,result)?result:'portal';
}
function isPublic(name){return name==='portal'||name==='about'||name==='guide'}
function routeFor(target){
 if(Object.hasOwn(tasks,target))return tasks[target].routes[role]||'';
 return target;
}
function allowed(target){
 const route=routeFor(target);
 return isPublic(route)||Boolean(role&&roles[role].pages.includes(route));
}
function setLocation(name,mode){
 try{
  const stamp={chongliRoute:name};
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
 roleLabel.hidden=!account;roleLabel.textContent=account?account.name:'';
 switchButton.hidden=!role;resetOpen.hidden=role!=='admin';
 for(const item of brandbar.querySelectorAll('[data-nav]')){
  const dest=item.dataset.nav;
  if(item.closest('.cl-topnav'))item.hidden=Boolean(role)&&dest!=='portal'&&!allowed(dest);
  if(dest===name)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
 }
 for(const link of document.querySelectorAll('#po-home .ac-service-item [data-poroute], #po-about .po-system-action[data-poroute]')){
  const item=link.closest('.ac-service-item')||link;
  item.hidden=Boolean(account)&&!allowed(canonical(link.dataset.poroute));
 }
}
function draw(name,focus){
 current=name;
 document.body.dataset.role=role||'public';
 const group=groups[name];
 showNavigation(name);
 for(const panel of document.querySelectorAll('.cl-view'))panel.hidden=panel.id!=='view-'+group;
 brandbar.hidden=group==='screen';
 skipLink.hidden=group==='screen';
 document.title=names[name]+' · 崇礼AI元医院';
 document.documentElement.style.backgroundColor=group==='screen'?'#0a1928':'#f5f6f8';
 window.dispatchEvent(new CustomEvent('cl:view',{detail:name}));
 window.scrollTo(0,0);if(focus)main.focus({preventScroll:true});
}
function visit(name,mode='push',focus=true){
 setLocation(name,mode);draw(name,focus);
}
function notifyDenied(requested){
 window.dispatchEvent(new CustomEvent('cl:account-notice',{detail:{
  message:'当前账号可使用'+names[roles[role].home]+'，没有「'+(tasks[requested]?.title||names[requested])+'」的访问权限。'
 }}));
}
function openLogin(target,mode){
 rememberTarget(target);
 if(current!=='portal'||location.hash!=='#portal')visit('portal',mode);
 window.dispatchEvent(new CustomEvent('cl:login-request',{detail:{destination:target}}));
}
function navigate(name,mode){
 if(allowed(name)){
  rememberTarget('');visit(routeFor(name),mode);return;
 }
 if(!account){openLogin(name,mode);return}
 rememberTarget('');visit(roles[role].home,'replace');notifyDenied(name);
}
CL.go=requested=>navigate(canonical(requested),'push');
CL.requestLogin=(destination='')=>{
 const target=destination?canonical(destination):'';
 if(account){navigate(target||roles[role].home,'push');return}
 openLogin(target,'push');
};
CL.cancelLogin=()=>rememberTarget('');
CL.loginAccount=value=>{
 const id=String(value||'').trim().toUpperCase();
 const next=accountById.get(id);
 if(!next)return {ok:false,message:'未找到这个演示账号，请核对账号或从列表选择。'};
 if(account&&account!==next)return {ok:false,message:'请先退出当前账号，再使用其他账号进入。'};
 remember(next);
 const requested=pending;
 const denied=Boolean(requested&&!allowed(requested));
 const destination=requested&&!denied?routeFor(requested):roles[role].home;
 rememberTarget('');visit(destination);
 if(denied)notifyDenied(requested);
 return {ok:true,account:next};
};
CL.logout=()=>{
 remember(null);rememberTarget('');visit('portal','replace');
};
for(const item of brandbar.querySelectorAll('[data-nav]'))item.addEventListener('click',event=>{event.preventDefault();CL.go(item.dataset.nav)});
switchButton.onclick=()=>{CL.logout();CL.requestLogin()};
resetOpen.onclick=()=>{if(role==='admin')reset.showModal()};
document.getElementById('cl-cancel').onclick=()=>reset.close();
document.getElementById('cl-confirm').onclick=()=>{if(role!=='admin')return;reset.close();CL.resetDemo();CL.logout();location.reload()};
function followLocation(initial){
 const hash=location.hash.slice(1);
 const target=canonical(hash||defaultRoute);
 // Only the separately packaged leadership display starts with a viewing account.
 if(initial&&defaultRoute==='leader'&&target==='leader'&&savedAccount===null)remember(accountById.get('CL3001'));
 if(!allowed(target)){
  if(!account){openLogin(target,'replace');return}
  visit(roles[role].home,'replace',!initial);notifyDenied(target);return;
 }
 const route=routeFor(target);
 if(hash&&'#'+route!==location.hash||(!hash&&route!=='portal'))setLocation(route,'replace');
 if(initial||current!==route)draw(route,!initial);
 if(initial&&!account&&route==='portal'){
  const saved=readSession(sessionKey+':destination');
  if(saved&&!isPublic(canonical(saved)))openLogin(canonical(saved),'replace');
 }
}
window.addEventListener('popstate',()=>followLocation(false));
window.addEventListener('hashchange',()=>followLocation(false));
followLocation(true);document.documentElement.dataset.interactive='true';
})();
