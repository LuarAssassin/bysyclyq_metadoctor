(()=>{
 const route={home:'doctor',followup:'doctorFollow',doctor:'doctorPersona',knowledge:'doctorKnowledge',research:'doctorResearch'};
 let args=null;
 window.atlasDoctorGo=(part,value)=>{if(route[part]){args={part,value};window.CL.go(route[part])}};
 function select(path){
   const part=Object.keys(route).find(key=>route[key]===path);
   if(!part)return;
   document.querySelectorAll('#cl-doctor .dw-locallinks button').forEach(b=>{if(b.dataset.dwLink===path)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
   Object.keys(route).forEach(k=>document.getElementById('page-'+k).hidden=k!==part);
   if(args && args.part===part){
     if(part==='knowledge')window.atlasSearch(args.value || '');
     else if(part==='followup')window.atlasFollowup(args.value);
   }
   args=null;
   window.dispatchEvent(new Event('atlas:refresh'));
 }
 document.querySelectorAll('.dw-locallinks button').forEach(b=>b.onclick=()=>window.CL.go(b.dataset.dwLink));
 function refreshService(){
   const model=window.CL.state;
   const counts=[8,12,10,15,13,17,window.CL.metrics().replies];
   const chart=document.querySelector('#page-home .ah-spark');
   document.querySelector('#page-home .ah-chartnum strong').textContent=counts[6];
   chart.setAttribute('aria-label','11 月 13 日至 19 日每日回复数量，依次为 '+counts.join('、')+' 条');
   [...chart.children].forEach((bar,i)=>{
     bar.style.setProperty('--h',100*counts[i]/Math.max(...counts)+'%');
     bar.title='11 月 '+(13+i)+' 日 · '+counts[i]+' 条';
   });
   const st={draft:'草稿',submitted:'待院方审查',approved:'待医生授权',changes:'需修改',live:'已授权'};
   document.getElementById('dw-service-summary').textContent=(model.service.active?'服务中':'已暂停')+' · v'+model.service.version+'　|　v'+model.release.version+' '+(st[model.release.status]||'');
 }
 window.addEventListener('cl:change',()=>{refreshService();window.dispatchEvent(new Event('atlas:refresh'))});
 window.addEventListener('cl:view',e=>select(e.detail));
 refreshService();select('doctor');
})();

// Workbench shortcuts keep the selected doctor identity in the same tab.
document.getElementById('ah-review').addEventListener('click', () => window.atlasDoctorGo('followup', atlasPending() ? 'pending' : 'done'));
document.querySelector('.ah-doctor').addEventListener('click', () => window.atlasDoctorGo('doctor'));
document.querySelector('.dw-release').addEventListener('click', () => CL.go('doctorRelease'));
