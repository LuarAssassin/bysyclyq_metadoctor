(()=>{
 const root=document.querySelector('.pt-wrap'),at=n=>document.getElementById('pt-'+n);
 const messages={education:{label:'阅读科普资料要留意什么？',title:'科普宣教',answer:'可以先看发布机构、作者、发布日期和适用人群。',extra:'下次就诊时，可以把资料来源和想了解的问题一起带给接诊医生。'},prep:{label:'复诊前准备什么？',title:'就诊准备',answer:'可以先整理上次的就诊记录、已有的检查资料，以及这次希望与医生讨论的问题。',extra:'按照就诊日期整理，方便沟通。具体携带哪些资料，请以接诊科室的通知为准。'},visit:{label:'怎样填写随访反馈？',title:'随访信息收集',answer:'收到院方随访表后，按问题记录最近的活动情况和变化。',extra:'如果希望医生联系，可以在反馈里注明联系意愿。'},contact:{label:'怎样联系主管医生？',title:'就医联系渠道',answer:'可以使用院方公布的咨询渠道，或在院方随访表中注明希望联系主管医生。',extra:'这里是数字医生演示页，当前对话不会发送给医生。'}};
 let selection='prep', currentView='', previewReturn='doctor';
 const formalOpenings={prep:'复诊资料准备要点如下。',education:'核对科普资料时，请留意以下事项。',visit:'填写随访记录时，请留意以下事项。',contact:'联系渠道说明如下。'};
 function render(){
   if(!window.CL?.state?.service)return;
   const s=CL.state.service,m=messages[selection],cfg=s.settings||{};
   const specialty=cfg.focus?' · '+cfg.focus:'';
   at('service').textContent='崇礼院区 · 运动医学科'+specialty+' · '+(s.active?'已启用':'已暂停')+' v'+String(s.version||'—').replace(/^v/i,'');
   at('available').hidden=!s.active;at('unavailable').hidden=s.active;
   root.querySelectorAll('[data-pt-q]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ptQ===selection)));
   at('ask').textContent=m.label;
   const opener=cfg.tone==='亲切自然'?'您好，':cfg.tone==='专业严谨'?formalOpenings[selection]:'';
   const body=cfg.depth==='分步说明'?'① '+m.answer+'\n② '+m.extra:m.answer+(selection==='contact'?' '+m.extra:'');
   at('answer').textContent=opener+body;at('source').textContent='服务范围 · '+m.title;
 }
 root.querySelectorAll('[data-pt-q]').forEach(button=>button.onclick=()=>{
   if(!['patient','doctorPatientPreview'].includes(currentView)||!CL.state.service.active)return;
   selection=button.dataset.ptQ;
   if(currentView==='patient')CL.recordPatientReply(selection);
   render();
 });
 const clinicalSources={doctor:'医生工作台',doctorFollow:'随访工作台',doctorRelease:'审查与授权'};
 at('home').onclick=()=>CL.go(currentView==='doctorPatientPreview'?previewReturn:'portal');
 window.addEventListener('cl:view',event=>{
   const next=event.detail;
   if(next==='doctorPatientPreview'&&next!==currentView){
     previewReturn=Object.hasOwn(clinicalSources,currentView)?currentView:'doctor';
   }
   if(next!==currentView)selection='prep';
   currentView=next;
   if(next!=='patient'&&next!=='doctorPatientPreview')return;
   const preview=next==='doctorPatientPreview';
   at('context').textContent=preview?'患者视角预览 · 医生工作台':'患者服务 · Patient Services';
   at('home').textContent=preview?'返回'+clinicalSources[previewReturn]:'返回门户';
   render();
 });
 window.addEventListener('cl:change',render);render();
})();
