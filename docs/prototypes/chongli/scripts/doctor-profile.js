(() => {
  const root = document.querySelector('.drb');
  const get = id => root.querySelector('#drb-' + id);
  const value = name => root.querySelector('input[name="drb-' + name + '"]:checked').value;
  const names = {kind:'亲切自然',direct:'简洁直接',formal:'专业严谨',short:'只说重点',steps:'分步说明'};
  const material = {'膝关节':'膝部近期的活动记录','肩关节':'肩部近期的活动记录','运动损伤':'受伤经过及近期活动记录','术后康复':'出院后已有的康复记录'};
  const opening = {kind:'您好，可以提前把资料放在一起，复诊时好找。',direct:'请提前整理以下资料。',formal:'建议按本次复诊目的整理相关资料。'};
  let saved = '';
  function state() {return {focus:get('focus').value,tone:value('tone'),depth:value('depth')};}
  function render() {
    const s = state(), data = material[s.focus];
    const scenario=get('scenario').value;
    const scenarioTitle=get('scenario').options[get('scenario').selectedIndex].textContent;
    get('focus-title').textContent = s.focus + ' · ' + scenarioTitle;
    get('question').textContent={visit:'复诊前，我可以准备些什么？',follow:'我的随访记录里要说明什么？',scope:'能帮我调整下周的康复训练量吗？'}[scenario];
    get('answer').textContent = opening[s.tone] + (s.depth === 'short' ? '带上既往就诊资料和' + data + '，记下想和医生讨论的问题。' : '\n1. 把已有的门诊记录或报告按时间整理。\n2. 带上' + data + '，方便医生了解近况。\n3. 将最想问的问题写下来，复诊时逐条沟通。');
    if(scenario!=='visit'){
      const lead={kind:'您好，',direct:'',formal:'就这个问题，'}[s.tone];
      const detailed=s.depth==='steps';
      if(scenario==='follow'){
        get('answer').textContent=lead+(detailed?'可先记下以下事项。\n1. 写下'+data+'的日期和变化。\n2. 标明最希望医生了解的问题。\n3. 如需医生联系，请在反馈中注明。':'请写下'+data+'及最希望医生了解的问题。如需医生联系，可以在反馈中注明。');
      }else{
        get('answer').textContent=lead+(detailed?'训练量需要主管医生结合你的情况评估。\n1. 可先备好'+data+'。\n2. 将拟调整的项目和疑问记录下来，与主管医生确认。':'个人训练安排需要主管医生评估。可以先整理'+data+'，再与医生确认。');
      }
    }
    const {release,service,knowledgeIds}=window.CL.state;
    const labels={draft:'草稿',submitted:'院方审查中',approved:'待本人授权',changes:'待修改',live:'已授权'};
    get('candidate').textContent='v'+release.version+' · '+(labels[release.status]||'待核对');
    const selected=window.atlasKnowledgeTitles?.()||[];
    get('sources').textContent=selected.length?selected.join('、'):(knowledgeIds.length?knowledgeIds.length+' 份资料已选入':'尚未选入专科资料');
    get('live-version').textContent='当前服务 v'+service.version+' · '+(service.active?'已启用':'已暂停');
    get('draft').textContent = saved === JSON.stringify(s) ? '设置已保存' : '有未保存的修改';
  }
  function hydrateSettings(){
    const settings=window.CL.state.release.settings || {};
    if(Array.from(get('focus').options).some(option=>option.value===settings.focus))get('focus').value=settings.focus;
    for(const group of ['tone','depth']){
      const input=Array.from(root.querySelectorAll('input[name="drb-'+group+'"]')).find(item=>names[item.value]===settings[group]);
      if(input)input.checked=true;
    }
    saved=JSON.stringify(state());
    render();
  }
  function saveSettings(){
    const draft=state(),next={focus:draft.focus,tone:names[draft.tone],depth:names[draft.depth]};
    const last=window.CL.state.release.settings||{};
    if(Object.keys(next).some(key=>next[key]!==last[key])){
      if(window.CL.saveSettings(next)===false){get('feedback').textContent='当前版本无法更改，请先查看审查状态。';return false}
    }
    saved=JSON.stringify(draft);render();get('feedback').textContent='专业与表达设置已保存。';return true;
  }
  root.addEventListener('change',()=>{render();get('feedback').textContent='已更新患者视角。'});
  window.addEventListener('cl:change',()=>{
    if(saved===JSON.stringify(state()))hydrateSettings();
    else render();
  });
  get('save').onclick=saveSettings;
  get('kb').onclick=()=>window.atlasDoctorGo('knowledge',get('focus').value);
  get('review').onclick=()=>{if(saveSettings())window.CL.go('doctorRelease');};
  window.addEventListener('cl:view',e=>{
    if(window.CL.currentRole()!=='doctor'){
      get('feedback').textContent='';
      get('scenario').selectedIndex=0;
      hydrateSettings();
    }else if(e.detail==='doctorPersona'){
      // Keep unsaved choices while the doctor checks their specialty's sources.
      if(saved===JSON.stringify(state()))hydrateSettings();
      else render();
    }
  });
  hydrateSettings();
  render();
})();
