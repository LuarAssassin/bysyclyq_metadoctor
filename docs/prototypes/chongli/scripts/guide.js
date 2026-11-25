(() => {
  const root=document.querySelector('#view-guide .cg'), movie=root.querySelector('video'), chapterNav=root.querySelector('.cg-list'), steps=root.querySelector('.cg-steps');
  const media=[{"title":"设定数字医生的回复方式","target":"doctorPersona","steps":[["选择细分专业","在「我的数字医生」中选择细分专业，确认患者看到的服务方向。"],["调整回复风格","选择「简洁直接」和「分步说明」，观察右侧示例回复如何变化。"],["保存配置草稿","读一遍患者视角的试答，满意后保存草稿，再准备提交审查。"]],"poster":"assets/guide-doctor.jpg","url":"assets/guide-doctor.mp4"},{"title":"核对资料并加入知识库","target":"doctorKnowledge","steps":[["检索专业资料","输入「骨关节炎」，或用专科、地区筛选资料。"],["查看来源和范围","打开结果，核对发布机构和日期，按需查看原文。"],["勾选并加入","勾选需要的条目并加入知识库，在「已加入」中核对结果。"]],"poster":"assets/guide-knowledge.jpg","url":"assets/guide-knowledge.mp4"},{"title":"从草稿到授权启用","target":"doctorRelease","steps":[["提交版本审查","医生提交当前草稿，院方收到待审任务。"],["院方审阅报告","院方核对服务范围和风险提示，可通过或退回修改。"],["医生确认启用","通过后，医生确认授权该版本。再查看患者入口及当前服务版本。"]],"poster":"assets/guide-release.jpg","url":"assets/guide-release.mp4"}];
  let index=0, activeStep=-1;
  const btn=(label,cls)=>{const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;return b;};
  media.forEach((item,i)=>{
    const button=btn('','cg-chapter'),number=document.createElement('span'),detail=document.createElement('span'),name=document.createElement('strong'),timing=document.createElement('small');
    number.className='cg-no';number.textContent=String(i+1).padStart(2,'0');name.textContent=item.title;timing.textContent='15 秒 · 中文字幕';detail.append(name,timing);button.append(number,detail);button.addEventListener('click',()=>select(i));chapterNav.append(button);
  });
  function select(i){
    index=i;activeStep=-1;movie.pause();movie.poster=media[i].poster;movie.src=media[i].url;movie.load();movie.setAttribute('aria-label',media[i].title+'，带中文字幕');root.querySelector('#cg-name').textContent=media[i].title;
    chapterNav.querySelectorAll('button').forEach((b,k)=>b.setAttribute('aria-current',String(i===k)));steps.replaceChildren();media[i].steps.forEach((s,k)=>{const b=btn('','cg-step'),time=document.createElement('b'),title=document.createElement('span');time.textContent=k===0?'00:00':k===1?'00:05':'00:10';title.textContent=s[0];b.title=s[1];b.setAttribute('aria-label',s[0]+'。'+s[1]);b.append(time,title);b.addEventListener('click',()=>{movie.currentTime=k*5;movie.play().catch(()=>{});sync();});steps.append(b);});sync();
  }
  function sync(){const k=Math.max(0,Math.min(2,Math.floor((movie.currentTime||0)/5)));if(k===activeStep)return;activeStep=k;steps.querySelectorAll('button').forEach((b,j)=>b.setAttribute('aria-current',String(k===j)));}
  const tryButton=root.querySelector('.cg-try');
  const homeActions={patient:'返回患者服务',director:'返回科主任工作台',leader:'返回院领导工作台',reviewer:'返回发布审查工作台',admin:'返回院方管理工作台'};
  movie.addEventListener('timeupdate',sync);
  tryButton.addEventListener('click',()=>{
    movie.pause();
    const role=CL.currentRole();
    CL.go(role && role!=='doctor'?role:media[index].target);
  });
  window.addEventListener('cl:view',event=>{
    if(event.detail==='guide'){
      const role=CL.currentRole();
      tryButton.textContent=role==='doctor'?'前往操作':homeActions[role]||'用医生账号体验此步骤';
    }
    else movie.pause();
  });
  select(0);
})();
