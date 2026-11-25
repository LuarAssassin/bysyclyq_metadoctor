(()=>{
 const rows=[
  {id:'A',name:'患者示例 A',topic:'术后随访',title:'患者请求医生联系',time:'09:10',message:'我已经记下这几天的活动情况了，想请主管医生方便时联系我。'},
  {id:'B',name:'患者示例 B',topic:'康复随访',title:'患者询问康复安排',time:'10:35',message:'这一周的康复记录我整理好了，请问可以和医生确认下一阶段的安排吗？'},
  {id:'C',name:'患者示例 C',topic:'复诊准备',title:'已整理复诊资料',time:'08:26',message:'之前的报告都已整理好，我会在复诊时带来。',done:true,note:'已阅，资料准备情况已记录。'},
  {id:'D',name:'患者示例 D',topic:'随访登记',title:'已补充回访时间',time:'08:41',message:'我已在记录里补充方便接听电话的时间。',done:true,note:'已记录可联系时段。'},
  {id:'E',name:'患者示例 E',topic:'运动记录',title:'已提交活动记录',time:'09:22',message:'本周的活动记录已提交，方便下次复诊时一起看。',done:true,note:'已阅，下次复诊核对记录。'},
  {id:'F',name:'患者示例 F',topic:'复诊准备',title:'已收到复诊提醒',time:'10:04',message:'收到提醒，我会带上之前的记录。',done:true,note:'已确认收到提醒。'}
 ];
 const checks={
   A:'核对患者的联系请求，记录是否需要另行回访。',
   B:'记录患者希望核对的下一阶段安排，交由主管医生结合康复记录判断。',
   C:'核对患者是否已准备好既往资料。',D:'核对联系时间的信息是否完整。',
   E:'核对患者提交的活动记录和复诊诉求。',F:'核对患者是否已收到并理解复诊提醒。'
 };
 const outcomes=['仅记录反馈','拟电话联系','拟复诊时沟通'];
 const host=document.querySelector('.fu-work');
 const el=id=>host.querySelector('#fu-'+id);
 let filter='pending',current='A';
 el('patient').addEventListener('click',()=>window.CL.go('doctorPatientPreview'));
 window.atlasPending=()=>window.CL?.metrics().pending ?? rows.filter(r=>!r.done).length;
 function syncFeedback(){
   const notes = window.CL?.state.reviewNotes || {};
   for(const row of rows.slice(0,2)){
     const wasDone=Boolean(row.done);
     row.done=Object.hasOwn(notes,row.id);
     if(row.done) row.note=notes[row.id];
     else if(wasDone) row.note='';
   }
 }
 window.addEventListener('cl:change',()=>{syncFeedback();if(!document.getElementById('page-followup').hidden)render()});
 window.addEventListener('cl:view',()=>{
   if(window.CL.currentRole()==='doctor')return;
   for(const row of rows.slice(0,2)){
     if(!row.done){delete row.note;delete row.outcome;}
   }
   filter='pending';current='A';el('live').textContent='';render();
 });
 syncFeedback();
 function render(){
   const items=rows.filter(r=>Boolean(r.done)===(filter==='done'));
   if(!items.some(r=>r.id===current))current=items[0]?.id;
   el('pending').textContent=window.atlasPending();el('done').textContent=rows.length-window.atlasPending();
   host.querySelectorAll('[data-fu-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.fuFilter===filter)));
   el('list').innerHTML=items.map(r=>'<button type="button" class="fu-row" data-fu-id="'+r.id+'" aria-pressed="'+(r.id===current)+'"><span class="fu-rowline"><b>'+r.name+'</b><small>'+r.time+'</small></span><span class="fu-rowlabel">'+r.title+'</span></button>').join('')||'<p class="fu-empty">当前没有待复核反馈</p>';
   const r=items.find(item=>item.id===current);
   if(!r){el('record').innerHTML='<div class="fu-empty"><h2>已完成今日复核</h2><p>可在「已复核」中查看每一份记录。</p></div>';return;}
   el('record').innerHTML='<div class="fu-record-top"><span class="fu-status '+(r.done?'isdone':'')+'">'+(r.done?'已复核':'待医生复核')+'</span></div><h2>'+r.title+'</h2><p class="fu-meta">'+r.name+' · '+r.topic+' · '+r.time+'</p><div class="fu-quote"><b>患者原话</b><blockquote>'+r.message+'</blockquote></div><div class="cx-check"><b>本次核对</b><span id="fu-check"></span></div><div class="cx-outcome"><label class="fu-label" for="fu-outcome">后续跟进方式</label>'+(r.done?'<p id="fu-result"></p>':'<select class="cx-control" id="fu-outcome"></select>')+'</div><label class="fu-label" for="fu-note">复核备注'+(r.done?'':'<small>选填</small>')+'</label><textarea class="fu-note" id="fu-note" maxlength="800" '+(r.done?'readonly':'')+' placeholder="记录下一步跟进事项"></textarea><div class="fu-foot"><small>保存在「已复核」，同步更新复核数。</small>'+(r.done?'':'<button type="button" id="fu-submit" class="fu-submit">保存复核记录</button>')+'</div>';
   el('note').value=r.note||(r.done?'未填写备注':'');
   el('check').textContent=checks[r.id];
   if(r.done){
     el('result').textContent=window.CL.state.reviewOutcomes?.[r.id]||'未单列跟进方式';
   }else{
     const selector=el('outcome');
     outcomes.forEach(label=>{const choice=document.createElement('option');choice.value=label;choice.textContent=label;selector.append(choice)});
     selector.value=r.outcome||outcomes[0];selector.onchange=()=>{r.outcome=selector.value;};
     el('note').oninput=e=>r.note=e.target.value;
     el('submit').onclick=()=>{if(!window.CL.reviewFeedback(r.id,r.note||'',r.outcome||outcomes[0]))return;syncFeedback();render();window.dispatchEvent(new Event('atlas:refresh'));el('live').textContent=r.name+' 已完成复核';(el('submit')||host.querySelector('[data-fu-filter="done"]')).focus({preventScroll:true});};
   }
 }
 host.addEventListener('click',e=>{
   const f=e.target.closest('[data-fu-filter]'),row=e.target.closest('[data-fu-id]');
   if(f){filter=f.dataset.fuFilter;render();}
   else if(row){current=row.dataset.fuId;render();el('list').querySelector('[aria-pressed="true"]').focus({preventScroll:true});}
 });
 window.atlasFollowup=id=>{const r=rows.find(x=>x.id===String(id||'').toUpperCase());if(r){filter=r.done?'done':'pending';current=r.id;}else{filter=id==='done'?'done':'pending';current=rows.find(x=>Boolean(x.done)===(filter==='done'))?.id;}render();};
 render();
})();
