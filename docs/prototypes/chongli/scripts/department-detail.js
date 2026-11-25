(() => {
  const options = [
    ['clinical','专病需求'], ['source','患者来源'], ['scene','服务场景']
  ];
  const secondaryFilters = ['symptom','disease','region','channel','scene'];
  function escapeText(value){
    return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  const count = n => Number(n||0).toLocaleString('zh-CN');
  const fraction = (part,whole) => whole ? count(part)+' / '+count(whole) : '—';
  const percent = (part,whole) => whole ? Math.round(part/whole*1000)/10+'%' : '—';
  function score(title,value,label,note){
    return '<section class="ldd-score"><h3>'+title+'</h3><div class="ldd-scoredata"><b>'+value+'</b><small>'+label+'</small></div><p class="ldd-note">'+note+'</p></section>';
  }
  function scores(s){
    return '<div class="ldd-scores" aria-label="四项服务评价">'+
      score('服务热度',percent(s.returning,s.patients),'患者复用率','周期前已用过院区 AI 的患者 '+fraction(s.returning,s.patients)+' 人')+
      score('服务能力',percent(s.completed,s.services),'任务完成率','已完成 '+fraction(s.completed,s.services)+' 次服务')+
      score('专业度',percent(s.passed,s.audited),'专家抽检合格率',s.audited?'合格 '+fraction(s.passed,s.audited)+' 份抽检':'本期暂无专家抽检')+
      score('服务成效',percent(s.ontime,s.followups),'随访按期完成率',s.followups?'按期完成 '+fraction(s.ontime,s.followups)+' 次应随访':'本期无应完成随访')+'</div>';
  }
  function measure(title,part,whole){
    return '<div><dt>'+title+'</dt><dd>'+fraction(part,whole)+'</dd></div>';
  }
  function evidence(s){
    return '<dl class="ldd-criteria" aria-label="质量与服务成效依据">'+
      measure('抽检依据可追溯',s.cited,s.audited)+measure('应转人工且及时转交',s.escalationTimely,s.escalationDue)+measure('人工转交已闭环',s.closed,s.handoffs)+'</dl>';
  }
  function inspect(s){
    const unpassed=s.audited-s.passed;
    if(unpassed>0) return '专家抽检中有 '+count(unpassed)+' 份未通过。建议复核其专科依据、答复内容和授权范围。';
    if(s.unresolved>0) return '本期发起的人工转交仍有 '+count(s.unresolved)+' 次未闭环，可由科室核对处理进度。';
    if(s.repeatRounds>0) return '有 '+count(s.repeatRounds)+' 次服务沟通达到五轮，可抽查长对话，了解患者集中追问的环节。';
    if(!s.audited) return '当前筛选范围尚无专家抽检记录，可选取不同服务场景补充抽检。';
    return '可结合患者需求分布选取下一批抽检样本。';
  }
  function comparison(result,state){
    const s=result.current, doctor=Boolean(state.doctor);
    let content;
    if(doctor){
      const per= s.services ? (s.rounds/s.services).toFixed(1) : '—';
      content='<table class="ldd-table" aria-label="数字医生服务强度"><thead><tr><th scope="col">服务强度</th><th scope="col">次均沟通</th><th scope="col">五轮及以上</th></tr></thead><tbody><tr><th scope="row">当期表现</th><td>'+per+' 轮</td><td>'+count(s.repeatRounds)+' 次</td></tr></tbody></table>';
    }else{
      const rows=result.groups.doctor;
      content='<table class="ldd-table" aria-label="本科室数字医生比较"><thead><tr><th scope="col">数字医生</th><th scope="col">患者人数</th><th scope="col">服务次数</th><th scope="col">抽检合格 / 抽检</th></tr></thead><tbody>'+
        rows.filter(r=>r.services>0).map(r=>'<tr><th scope="row"><button type="button" data-ld-doctor="'+escapeText(r.name)+'" class="ldd-doctor-link">'+escapeText(r.name)+'</button></th><td>'+count(r.patients)+'</td><td>'+count(r.services)+'</td><td>'+fraction(r.passed,r.audited)+'</td></tr>').join('')+'</tbody></table>';
    }
    return '<section class="ldd-panel"><div class="ldd-panelhead"><h2>'+(doctor?'数字医生服务复盘':'科内数字医生')+
      '</h2><span class="ldd-topnote">'+(doctor?'当前筛选范围':'选择数字医生查看详情')+'</span></div>'+content+evidence(s)+
      '<p class="ldd-flag"><strong>科室关注</strong>'+inspect(s)+'</p></section>';
  }
  function groupChart(result,key,title,field,unit,denom){
    const filtered=(result.groups[key]||[]).filter(x=>x[field]>0).sort((a,b)=>b[field]-a[field]);
    const rows=filtered.slice(0,4);
    return '<div class="ldd-series"><h3 class="ldd-serieshead">'+title+'<small>'+unit+' · 前四项</small></h3>'+
      (rows.length?rows.map(row=>{
        const w=denom?row[field]/denom*100:0;
        return '<button type="button" class="ldd-row" data-ldd-dim="'+key+'" data-ldd-value="'+escapeText(row.name)+'" title="'+escapeText(row.name)+' · '+count(row[field])+unit+' · 占 '+percent(row[field],denom)+'"><span class="ldd-rowtext"><span>'+escapeText(row.name)+'</span><b>'+count(row[field])+'</b></span><span class="ldd-track" aria-hidden="true"><i style="width:'+Math.max(0,Math.min(100,w)).toFixed(2)+'%"></i></span></button>';
      }).join(''):'<p class="ldd-note">暂无记录</p>')+'</div>';
  }
  function demand(result,state,tab){
    const s=result.current;
    const name='ldd-section-'+[state.days,state.dept,state.doctor].map(v=>v||'all').join('-');
    const tabs=options.map(([val,label])=>'<label class="ldd-tab"><input type="radio" name="'+escapeText(name)+'" value="'+val+'" data-ldd-tab="'+val+'"'+(tab===val?' checked':'')+'>'+label+'</label>').join('');
    const sceneChart=groupChart(result,'scene','服务类型','services','次',s.services);
    const flow='<div class="ldd-series"><h3>服务结果</h3><p class="ldd-note">任务完成 '+fraction(s.completed,s.services)+' 次</p><p class="ldd-note">随访按期完成 '+fraction(s.ontime,s.followups)+' 次</p><p class="ldd-note">人工转交闭环 '+fraction(s.closed,s.handoffs)+' 次</p></div>';
    return '<section class="ldd-panel ldd-demand"><div class="ldd-panelhead ldd-demand-head"><h2>服务需求分布</h2><div class="ldd-tabs" role="group" aria-label="需求分布维度">'+tabs+'</div></div>'+
      '<div class="ldd-tabbody" data-ldd-panel="clinical">'+groupChart(result,'symptom','主要症状 / 主诉','services','次',s.services)+groupChart(result,'disease','病种 · 诊断记录','services','次',s.services)+'</div>'+
      '<div class="ldd-tabbody" data-ldd-panel="source">'+groupChart(result,'region','患者来源地区','patients','人',s.patients)+groupChart(result,'channel','服务进入渠道','services','次',s.services)+'</div>'+
      '<div class="ldd-tabbody" data-ldd-panel="scene">'+sceneChart+flow+'</div></section>';
  }
  function forecastSummary(fc){
    const estimate=fc.eligible?'<p><b>'+count(fc.total)+'</b>次 · 历史观测范围 '+count(fc.low)+'–'+count(fc.high)+' 次</p>':'<p>历史样本不足，暂无法估算</p>';
    return '<section class="ldd-forecast" aria-label="未来服务需求预测"><h2>未来 7 天服务需求</h2>'+estimate+'<p>近 28 天同范围内 '+count(fc.sample)+' 次服务记录</p></section>';
  }
  function render(host,result,state,controller){
    const prior=host.querySelector('[data-ldd-tab]:checked')?.value;
    const context=state.dept+'|'+state.doctor;
    const tab=host.dataset.analysisScope===context && prior ? prior:'clinical';
    host.dataset.analysisScope=context;
    if(!result.current.services){
      host.innerHTML='<div class="ldd-content"><section class="ldd-empty"><h2>当前范围暂无服务记录</h2><p class="ldd-note">可调整统计周期，或清空疾病、地区和场景等筛选条件。</p>'+
        (secondaryFilters.some(key=>state[key])?'<button type="button" data-ldd-clear>清空分析条件</button>':'')+'</section></div>';
    }else{
      host.innerHTML='<div class="ldd-content">'+scores(result.current)+'<div class="ldd-grid">'+comparison(result,state)+demand(result,state,tab)+'</div></div>';
    }
    if(state.role==='director')host.querySelector('.ldd-content').insertAdjacentHTML('beforeend',forecastSummary(result.forecast));
    host.onclick=e=>{
      const item=e.target.closest('[data-ldd-dim]');
      if(item) controller.set({[item.dataset.lddDim]:item.dataset.lddValue});
      else if(e.target.closest('[data-ldd-clear]')) controller.set(Object.fromEntries(secondaryFilters.map(key=>[key,''])));
    };
  }
  window.LeadDetail={render};
  window.LeadWall?.render?.();
})();
