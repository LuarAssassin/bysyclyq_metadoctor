(() => {
  const root=document.getElementById('ld-app');
  const el=id=>document.getElementById('ld-'+id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number(v||0).toLocaleString('zh-CN');
  const pct=(n,d)=>d?(100*n/d).toFixed(1)+'%':'—';
  const names={symptom:'症状 / 主诉',disease:'已记录病种',region:'患者来源区域',channel:'来源渠道',scene:'服务场景'};
  const keys=Object.keys(names),defaults={days:30,dept:'',doctor:'',symptom:'',disease:'',region:'',channel:'',scene:''};
  const assignedDepartment='运动医学科';
  let boardRole='', activeView='screen', state={...defaults}, last=null;
  function roleForBoard(){
    const selected=window.CL?.currentRole?.();
    if(selected==='director'||selected==='leader')return selected;
    return activeView==='director'?'director':'leader';
  }
  function syncScope(){
    const role=roleForBoard();
    if(role===boardRole)return;
    boardRole=role;
    state={...defaults,dept:role==='director'?assignedDepartment:''};
    last=null;
    for(const id of ['filterbox','methodbox']){
      const dialog=el(id);if(dialog.open)modalClose(dialog);
    }
    for(const id of ['depts','detail','evals','quality-note','plot','fc-summary','action','methodcopy','filterfields'])el(id).replaceChildren();
  }
  const colors=['#7de0c1','#78acc8','#c0b49a','#a3a5ce','#7f939b','#637981'];
  function set(patch){
    syncScope();
    const next={...state,...patch};
    if(boardRole==='director')next.dept=assignedDepartment;
    next.days=[1,7,30].includes(Number(next.days))?Number(next.days):30;
    const options=window.LeadData.options;
    for(const k of ['dept','doctor',...keys])if(next[k]&&!options[k].includes(next[k]))next[k]='';
    if(next.dept!==state.dept && !Object.hasOwn(patch,'doctor'))next.doctor='';
    if(!next.dept || (next.doctor&&!window.LeadData.doctorsByDept[next.dept]?.includes(next.doctor)))next.doctor='';
    state=next;render();
  }
  function back(){if(state.doctor)set({doctor:''});else if(state.dept&&boardRole==='leader')set({dept:'',doctor:''});else window.CL?.go('portal')}
  const api={set,reset:()=>set({...defaults}),showDept:dept=>set({dept,doctor:''}),showDoctor:doctor=>set({doctor}),back,render,get state(){return {...state}}};
  window.LeadWall=api;
  function sumHead(r){
    const {current,previous}=r;
    for(const key of ['patients','services','rounds']){
      el(key).textContent=num(current[key]);
      const prior=previous[key],delta=prior?(current[key]-prior)/prior*100:0;
      const change=prior?(delta>0?'+':'')+delta.toFixed(1)+'%':current[key]?'上期为 0':'—';
      el(key+'-change').innerHTML='较上期 <b>'+esc(change)+'</b>';
    }
    const regions=r.groups.region.filter(x=>x.patients>0).sort((a,b)=>b.patients-a.patients);
    const shortlist=regions.slice(0,2),rest=regions.slice(2);
    if(rest.length)shortlist.push({name:'其他区域',patients:rest.reduce((s,g)=>s+g.patients,0),other:true});
    el('regions').innerHTML=shortlist.length?'<div class="ld-regionline" aria-hidden="true">'+shortlist.map((g,i)=>'<i style="flex:'+g.patients+';background:'+colors[i]+'"></i>').join('')+'</div><div class="ld-regionlabels">'+shortlist.map((g,i)=>'<button type="button" '+(g.other?'data-ld-open-filter="region"':'data-ld-region="'+esc(g.name)+'"')+' title="'+esc(g.name)+' '+num(g.patients)+' 人"><i class="ld-dot" style="background:'+colors[i]+'"></i>'+esc(g.name)+' '+pct(g.patients,current.patients)+'</button>').join('')+'</div>':'<p class="ld-soft">当前条件下暂无患者记录</p>';
  }
  function plot(r){
    const future=r.forecast.eligible?r.forecast.days:[],history=r.days;
    if(!r.current.services&&!future.length){el('plot').innerHTML='<p class="ld-emptymsg">所选范围暂无服务，无法生成趋势。</p>';return}
    const n=history.length+future.length, m=history.length;
    const high=Math.max(1,...history.map(d=>d.services),...future.map(d=>d.high));
    const step=high<=12?2:high<=35?5:high<=80?10:high<=200?25:50;
    const cap=Math.ceil(high/(step*2))*step*2;
    const x=i=>+(1000*i/Math.max(n-1,1)).toFixed(2), y=v=>+(96-92*v/cap).toFixed(2);
    const points=history.map((v,i)=>[x(i),y(v.services)]);
    const futureLine=future.map((v,i)=>[x(m+i),y(v.value)]);
    const coords=arr=>arr.map(p=>p.join(',')).join(' ');
    let svg='<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="ld-areagrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6ecdb4" stop-opacity=".24"/><stop offset="100%" stop-color="#6ecdb4" stop-opacity="0"/></linearGradient></defs>';
    for(const yy of [4,50,96])svg+='<path d="M0 '+yy+'H1000" stroke="#35505c" vector-effect="non-scaling-stroke" stroke-width="1" stroke-dasharray="2 4"/>';
    if(points.length){svg+='<polygon fill="url(#ld-areagrad)" points="'+coords([[0,96],...points,[points[points.length-1][0],96]])+'"/><polyline fill="none" stroke="#81e1c4" stroke-width="2.6" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" points="'+coords(points)+'"/>';}
    if(points.length===1){const [px,py]=points[0];svg+='<svg x="'+px+'" y="'+py+'" width="0" height="0" overflow="visible"><circle r="3" fill="#8be4ca"/></svg>';}
    if(future.length){
      const top=future.map((v,i)=>[x(m+i),y(v.high)]),bottom=future.map((v,i)=>[x(m+i),y(v.low)]).reverse(),join=points.slice(-1);
      svg+='<rect x="'+x(m-1)+'" y="0" width="'+(1000-x(m-1))+'" height="99" fill="#ffcf8b" opacity=".038"/><path d="M'+x(m-1)+' 1v97" stroke="#a09580" vector-effect="non-scaling-stroke" stroke-width="1" stroke-dasharray="3 3"/><polygon fill="#edb977" opacity=".21" points="'+coords([...join,...top,...bottom])+'"/><polyline fill="none" stroke="#ffc585" stroke-width="2.6" vector-effect="non-scaling-stroke" stroke-dasharray="5 5" stroke-linecap="round" stroke-linejoin="round" points="'+coords([...join,...futureLine])+'"/>';
    }
    const labels=history.concat(future),ix=Array.from(new Set([0,Math.round((m-1)*.42),m-1,n-1]));
    el('plot').innerHTML='<div class="ld-plotarea"><div class="ld-y"><span>'+cap+'</span><span>'+cap/2+'</span><span>0</span></div>'+svg+'</svg></div><div class="ld-x">'+ix.map(i=>'<span style="left:'+100*i/Math.max(1,n-1)+'%">'+esc(labels[i].date.slice(5).replace('-','/'))+'</span>').join('')+'</div>';
  }
  function master(r){
    const fc=r.forecast,stats=r.current;
    el('fc-summary').innerHTML=fc.eligible?'<span>未来 7 天预计服务</span><strong>'+num(fc.total)+'</strong><span>次</span><small>情景范围 '+num(fc.low)+'–'+num(fc.high)+'</small>':'<span>未来 7 天服务需求</span><strong>—</strong><small>历史样本不足</small>';
    plot(r);
    const demand=r.focus?.demand;
    el('action').innerHTML=demand&&fc.eligible?'预计 <button type="button" class="ld-link" data-ld-disease="'+esc(demand.name)+'">'+esc(demand.name)+'</button> 相关服务 '+num(demand.value)+' 次，近 7 天实际 '+num(demand.last)+' 次。':'预测参考前 28 天相同星期的服务记录。';
    const groups=r.groups.dept.filter(d=>d.services>0).sort((a,b)=>b.services-a.services);
    const max=groups[0]?.services||1;
    el('depts').innerHTML=groups.length?groups.map(g=>'<button type="button" class="ld-dept-row" data-ld-dept="'+esc(g.name)+'" aria-label="查看'+esc(g.name)+'科室分析"><span class="ld-dept-name">'+esc(g.name)+'</span><span class="ld-dept-val"><i style="width:'+28*g.services/max+'px"></i>'+num(g.services)+'</span><span>'+pct(g.completed,g.services)+'</span><span class="ld-dept-quality" title="抽检合格 '+g.passed+' / '+g.audited+'">'+pct(g.passed,g.audited)+'</span></button>').join(''):'<p class="ld-emptymsg">当前筛选条件下暂无科室服务记录。</p>';
    const quality=r.focus?.quality, note=el('quality-note');
    note.hidden=!quality;
    if(quality)note.innerHTML='<b>质控关注</b> <button type="button" class="ld-link" data-ld-quality-dept="'+esc(quality.name)+'">'+esc(quality.name)+'</button> 抽检 '+num(quality.audited)+' 份，'+num(quality.failed)+' 份未通过。';
    const rows=[['热度','回访患者占比',stats.returning,stats.patients,'既往用过 / 本期患者'],['能力','任务完成率',stats.completed,stats.services,'已完成 / 全部服务'],['专业度','专家抽检合格率',stats.passed,stats.audited,'合格 / 抽检服务'],['成效','随访按期完成率',stats.ontime,stats.followups,'按期完成 / 应随访']];
    el('evals').innerHTML=rows.map(([title,label,n,d,definition])=>'<div class="ld-evalitem"><h3><i></i>'+title+'</h3><div class="ld-eval-value"><b>'+pct(n,d)+'</b><span>'+label+'</span></div><p>'+num(n)+' / '+num(d)+' · '+definition+(d>0&&d<5?' · 小样本':'')+'</p></div>').join('');
  }
  function render(){
    if(!window.LeadData || !root.isConnected)return;
    syncScope();
    const r=window.LeadData.query(state);last=r;const detail=!!state.dept;
    const director=boardRole==='director';
    root.dataset.boardRole=boardRole;
    el('hospital').hidden=detail;el('detail').hidden=!detail;
    el('title').textContent=director?'科主任工作台':'院领导工作台';
    const trail=director?[]:['<button type="button" id="ld-crumb-hospital" '+(!detail?'aria-current="page"':'')+'>全院总览</button>'];
    if(detail)trail.push('<button type="button" id="ld-crumb-dept" '+(!state.doctor?'aria-current="page"':'')+'>'+esc(state.dept)+'</button>');
    if(state.doctor)trail.push('<span aria-current="page">'+esc(state.doctor)+'</span>');
    el('crumb').innerHTML=trail.join('<span class="ld-div" aria-hidden="true">/</span>');el('period').value=String(state.days);
    el('dates').textContent=r.period.start.replaceAll('-','.')+' – '+r.period.end.replaceAll('-','.');
    const active=keys.filter(k=>state[k]);el('filtermarks').hidden=!active.length;
    el('filtermarks').innerHTML=active.map(k=>'<button class="ld-chip" type="button" data-ld-del="'+k+'" aria-label="移除'+esc(names[k])+'筛选">'+esc(names[k])+' · '+esc(state[k])+' ×</button>').join('')+'<button type="button" class="ld-link ld-clearall" id="ld-reset-scope">清除条件</button>';
    el('foot').textContent='模拟评估数据集 · 统计截止 '+window.LeadData.asOf.replaceAll('-','.')+' · 当前周期 '+state.days+' 天';
    sumHead(r);if(detail){if(window.LeadDetail)window.LeadDetail.render(el('detail'),r,{...state,role:boardRole},api)}else master(r);
    window.dispatchEvent(new CustomEvent('lead:render',{detail:{state:{...state}}}));
  }
  function modalOpen(d){if(!d.open){if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')}}
  function modalClose(d){if(typeof d.close==='function')d.close();else d.removeAttribute('open')}
  function openFilters(focus=''){
    const scope=boardRole==='director'?window.LeadData.query({dept:assignedDepartment,doctor:state.doctor,days:state.days}):null;
    const values=key=>scope?Array.from(new Set([...scope.groups[key].map(group=>group.name),...(state[key]?[state[key]]:[])])):window.LeadData.options[key];
    el('filterfields').innerHTML=keys.map(k=>'<label for="ld-f-'+k+'">'+names[k]+'<select id="ld-f-'+k+'"><option value="">全部</option>'+values(k).map(v=>'<option value="'+esc(v)+'" '+(state[k]===v?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>').join('');
    modalOpen(el('filterbox'));if(focus)el('f-'+focus)?.focus();
  }
  function clearDims(){set(Object.fromEntries(keys.map(k=>[k,''])))}
  function openMethod(){
    const r=last,m=r.forecast;
    el('methodcopy').innerHTML='<h3>统计范围</h3><p>本期 '+esc(r.period.start)+' 至 '+esc(r.period.end)+'，上期 '+esc(r.period.priorStart)+' 至 '+esc(r.period.priorEnd)+'。统计使用固定 60 天的演示服务记录。工作台当日的操作记录单独演示。环比为上一个等长周期。</p><h3>人数、服务与沟通</h3><p>患者人数按所选周期去重。每次开始一项服务记 1 次，一次问答往返记 1 轮。例如，同一患者做一次术后随访并完成四轮问答，分别计 1 人、1 次、4 轮。</p><h3>热度、能力、专业度与成效</h3><p>既往用过的患者占本期去重患者的比例体现持续使用情况。任务完成率按本期服务记录计算。专业度按专家抽检结果计算，同时展示合格数和抽检数。随访按期完成率以应随访服务为分母。分母为零时显示「—」。上线前基线、医生工时和临床获益需另行采集，这里呈现服务运行成效。</p><h3>未来 7 天需求</h3><p>'+esc(m.method)+' 当前预测参考 '+num(m.sample)+' 份历史服务。图上实线表示记录，虚线和色带表示估计与情景范围。</p>';
    modalOpen(el('methodbox'));
  }
  el('period').onchange=e=>set({days:Number(e.target.value)});
  el('filters').onclick=()=>openFilters();el('method').onclick=openMethod;
  el('apply').onclick=()=>{const vals=Object.fromEntries(keys.map(k=>[k,el('f-'+k).value]));modalClose(el('filterbox'));set(vals)};
  el('clear-filters').onclick=()=>{modalClose(el('filterbox'));clearDims()};
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.ldClose)modalClose(document.getElementById(b.dataset.ldClose));
    else if(b.id==='ld-crumb-hospital')api.showDept('');
    else if(b.id==='ld-crumb-dept')set({doctor:''});
    else if(b.id==='ld-reset-scope')clearDims();
    else if(b.hasAttribute('data-ld-dept'))api.showDept(b.dataset.ldDept);
    else if(b.hasAttribute('data-ld-doctor'))api.showDoctor(b.dataset.ldDoctor);
    else if(b.dataset.ldQualityDept)api.showDept(b.dataset.ldQualityDept);
    else if(b.dataset.ldRegion)set({region:b.dataset.ldRegion});
    else if(b.dataset.ldDisease)set({disease:b.dataset.ldDisease});
    else if(b.dataset.ldDel)set({[b.dataset.ldDel]:''});
    else if(b.dataset.ldOpenFilter)openFilters(b.dataset.ldOpenFilter);
  });
  for(const d of [el('filterbox'),el('methodbox')])d.addEventListener('click',e=>{if(e.target!==d)return;const z=d.getBoundingClientRect();if(e.clientX<z.left||e.clientX>z.right||e.clientY<z.top||e.clientY>z.bottom)modalClose(d)});
  const inFull=()=>Boolean(document.fullscreenElement||document.webkitFullscreenElement);
  const exitFull=async()=>{if(inFull())await (document.exitFullscreen||document.webkitExitFullscreen).call(document)};
  function updateFull(){const t=inFull()?'退出全屏':'全屏展示';el('full').querySelector('span').textContent=t;el('full').setAttribute('aria-label',t)}
  el('back').onclick=async()=>{try{await exitFull()}catch{}window.CL?.go('portal')};
  el('full').onclick=async()=>{try{if(inFull())await exitFull();else{const box=root.closest('#view-screen')||root;await (box.requestFullscreen||box.webkitRequestFullscreen).call(box)}el('notice').textContent=''}catch{el('notice').textContent='可在浏览器单独打开此文件后使用全屏。'}updateFull()};
  document.addEventListener('fullscreenchange',updateFull);document.addEventListener('webkitfullscreenchange',updateFull);
  window.addEventListener('cl:view',e=>{
    const route=e.detail;
    if(['director','leader','screen'].includes(route)){
      activeView=route;render();
    }else{
      boardRole='';
      for(const id of ['filterbox','methodbox']){const dialog=el(id);if(dialog.open)modalClose(dialog);}
    }
  });
  render();
})();
