(()=>{
 const wrap=document.querySelector('.rl-wrap'),e=id=>document.getElementById('rl-'+id);
 const names={draft:'草稿',changes:'需修改',submitted:'审查中',approved:'待医生授权',live:'已授权'};
 const info={draft:['草稿已准备','核对服务范围后，可以将此版本提交给院方审查。','提交院方审查'],changes:['请按院方意见修改','阅读下方院方意见，修改数字医生设置后重新提交。','重新提交审查'],submitted:['院方正在审查这个版本','可先核对本次提交的辅助报告。院方完成审查后，处理意见将显示在下方。','查看送审报告'],approved:['院方已通过，请确认授权','请阅读审查报告，确认服务范围后由你本人授权启用。','授权启用此版本'],live:['本版本已由医生授权','患者网页现使用此版本。可预览患者实际看到的入口。','预览患者服务']};
 let lastStage='';
 function active(){return window.CL&&CL.state&&CL.state.release&&CL.state.service}
 function v(raw){return 'v'+String(raw||'—').replace(/^v/i,'')}
 function render(){
  if(!active())return;const {release:r,service:s}=CL.state,k=r.status in info?r.status:'draft',resume=k==='live'&&!s.active,entry=resume?['服务已暂停','请核对服务状态及院方意见，再确认恢复此版本。','重新授权启用']:info[k],consent=k==='approved'||resume, signature=k+':'+r.version+':'+s.active;
  if(lastStage!==signature)e('ack').checked=false;lastStage=signature;
  const cfg=r.settings||{};e('report-ver').textContent='核对对象 '+v(r.version)+' · '+[cfg.focus,cfg.tone,cfg.depth].filter(Boolean).join(' / ');e('version').textContent='本次版本 '+v(r.version);e('status').textContent=names[k];e('status').dataset.kind=k;e('next').textContent=entry[0];e('guidance').textContent=entry[1];e('primary').textContent=entry[2];e('primary').disabled=consent&&!e('ack').checked;e('consent').hidden=!consent;e('note').textContent=r.note||({draft:'提交后由院方填写。',submitted:'待院方经办人审查。',live:'已按本次记录完成授权。'}[k]||'暂无补充意见。');
  const showResume=!s.active&&!resume;e('resume-area').hidden=!showResume;if(!showResume)e('resume-ack').checked=false;e('resume').disabled=!e('resume-ack').checked;e('pause-reason').hidden=s.active||!s.reason;e('pause-reason').textContent=s.reason?'暂停原因：'+s.reason:'';
  const idx={draft:0,changes:0,submitted:1,approved:2,live:3}[k];Array.from(e('steps').children).forEach((node,i)=>{node.toggleAttribute('data-past',i<idx);if(i===idx)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current')});
  e('service-state').textContent=s.active?'服务中':'已暂停';e('service-state').dataset.kind=s.active?'live':'changes';e('current').textContent=v(s.version);e('diff').textContent=!s.active?'当前患者入口显示暂停提示。':String(s.version)===String(r.version)?'患者访问此版本的演示服务。':'新版本授权后，患者入口才会切换。';
 }
 wrap.querySelectorAll('[data-rl-go]').forEach(b=>b.onclick=()=>CL.go(b.dataset.rlGo));e('ack').onchange=render;e('resume-ack').onchange=render;e('resume').onclick=()=>{if(e('resume-ack').checked)CL.resume();render()};
 e('primary').onclick=()=>{if(!active())return;const k=CL.state.release.status;if(k==='approved'||(k==='live'&&!CL.state.service.active)){if(!e('ack').checked)return;if(k==='live')CL.resume();else CL.authorize()}else if(k==='submitted'){const report=e('ai-report');report.open=true;report.querySelector('summary').focus()}else if(k==='live')CL.go('doctorPatientPreview');else CL.submit();render()};
 e('export').onclick=()=>{const {service:s}=CL.state,card=['崇礼AI元医院智能化平台','数字医生渠道交接卡 · 离线演示','','医生：陈医生 / 运动医学科','服务版本：'+v(s.version),'状态：'+(s.active?'已在本原型内启用':'已暂停'),'入口：本原型内「患者服务」','可规划的接入位置：院内网页、服务号菜单、小程序服务页。','服务范围：科普宣教、就诊准备、随访信息收集。','','卡片记录导出时的状态。外部服务地址、服务号和小程序需由院方另行配置。'].join('\n');const url=URL.createObjectURL(new Blob(['\uFEFF',card],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='崇礼数字医生_渠道交接卡_'+v(s.version)+'.txt';wrap.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);e('message').textContent='已生成当前服务版本的渠道交接卡。'};
 window.addEventListener('cl:change',render);
 window.addEventListener('cl:view',event=>{
   if(event.detail!=='doctorRelease'){
     e('ack').checked=false;e('resume-ack').checked=false;
     return;
   }
   render();
 });
 render();
})();
