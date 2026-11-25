(() => {
  const app=document.querySelector('[data-admin-app]');
  const content=app.querySelector('#ad-content');
  const dlg=app.querySelector('#ad-dialog');
  const db=app.querySelector('#ad-dbody');
  const msg=app.querySelector('#ad-message');
  const pages=['overview','doctors','review','campus','audit'];
  let tab='overview', search='', department='all', statusFilter='all', logSearch='', action='', profileId='chen';
  const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ein=escapeText;
  const statuses={draft:'草稿',submitted:'待院方审查',approved:'待医生授权',changes:'已退回修改',live:'已授权启用'};
  const tag=(s,tone='')=>'<span class="ad-tag '+tone+'">'+ein(s)+'</span>';
  const btn=(task,text,style='')=>'<button type="button" data-ad-act="'+task+'" class="ad-btn '+style+'">'+text+'</button>';
  const textButton=(task,text)=>'<button type="button" data-ad-act="'+task+'" class="ad-textbtn">'+text+'</button>';
  const box=(inside)=>'<section class="ad-box">'+inside+'</section>';
  const note=(body)=>'<div class="ad-note">'+body+'</div>';
  const wallLink=document.getElementById('ad-screen-pop');
  if(location.protocol==='file:'){const u=new URL(location.href);u.hash='screen';wallLink.href=u.href;wallLink.hidden=false;}
  let selectedWork='release';
  const reviewerTabs=['review','audit'];
  const reviewerActions=['approve','changes','close'];
  const pageLabels={overview:'治理工作台',doctors:'医生管理',review:'发布审查',campus:'院区管理',audit:'操作记录'};
  const localRole=()=>window.CL?.currentRole?.();
  const isReviewer=()=>localRole()==='reviewer';
  const isAdmin=()=>localRole()==='admin';
  const canManage=isAdmin;
  const canDecide=isReviewer;
  let evaluationDept='all';
  const canAccess=()=>isReviewer()||canManage();
  const isReviewEvent=entry=>/提交版本|审查|授权|退回/.test(entry.action);
  const header=app.querySelector('.ad-header');
  const fullTitle=header.querySelector('h1').textContent;
  const fullEyebrow=header.querySelector('.ad-label').textContent;
  const fullSubtitle=header.querySelector('.ad-sub').textContent;
  let decisionTarget=null;
  function reviewerSnapshot(){
    const s=window.CL.state;
    return {r:s.release,v:s.service,knowledgeIds:s.release.snapshot?.knowledgeIds||s.knowledgeIds||[],audit:(s.audit||[]).filter(isReviewEvent)};
  }
  function configureAccess(reviewer){
    app.toggleAttribute('data-reviewer-workspace',reviewer);
    header.querySelector('h1').textContent=reviewer?'院方审核工作台':isAdmin()?'院方管理工作台':fullTitle;
    header.querySelector('.ad-label').textContent=reviewer?'Clinical AI Review':fullEyebrow;
    header.querySelector('.ad-sub').textContent=reviewer?'院方审核人员 · 数字医生治理与评价平台':isAdmin()?'院方管理员 · 医生入驻、服务运行与版本进度':fullSubtitle;
    header.querySelector('[data-ad-act="review"]').textContent=isAdmin()?'查看版本进度':'审查待发布版本';
    header.querySelector('[data-ad-act="screen"]').textContent=isAdmin()?'服务运行统计':'查看服务评价';
    wallLink.hidden=reviewer||isAdmin()||location.protocol!=='file:';
    header.querySelector('.ad-screen-tools').hidden=reviewer;
    app.querySelector('.ad-tabs').setAttribute('aria-label',reviewer?'版本审核导航':'院方管理功能');
    app.querySelectorAll('[data-ad-tab]').forEach(button=>{
      const key=button.dataset.adTab;
      button.hidden=reviewer&&!reviewerTabs.includes(key);
      button.textContent=reviewer&&key==='review'?'发布申请':reviewer&&key==='audit'?'审查记录':isAdmin()&&key==='review'?'版本进度':pageLabels[key];
    });
  }
  function snapshot(){
    const s=window.CL.state;
    const dir=window.CL.directory();
    const depts=[...new Set(dir.map(d=>d.dept).filter(Boolean))];
    const account=window.CL.hospitalMetrics();
    const total=key=>dir.reduce((count,d)=>count+Number(d[key]||0),0);
    const m={
      live:account.live??dir.filter(d=>d.active).length,
      replies:account.replies??total('replies'),pending:account.pending??total('pending'),
      totalFeedback:account.totalFeedback??total('feedback'),
      reviewed:account.reviewed??(total('feedback')-total('pending'))
    };
    return {r:s.release,v:s.service,m,dir,depts,knowledgeIds:s.release.snapshot?.knowledgeIds||s.knowledgeIds||[],invites:s.invites||[],audit:Array.isArray(s.audit)?s.audit:[]};
  }
  function auditLines(items){
    if(!items.length)return '<p class="ad-empty">暂时没有符合条件的操作记录。</p>';
    return '<ol class="ad-list">'+items.map(e=>'<li><div><b>'+ein(e.action)+'</b>　<time>'+ein(e.time)+'</time></div><p>'+ein(e.actor)+(e.detail?' · '+ein(e.detail):'')+'</p>'+(e.reviewNote?'<p><strong>审核意见</strong>　'+ein(e.reviewNote)+'</p>':'')+'</li>').join('')+'</ol>';
  }
  function workSelect(key,title,line,badge){
    return '<button type="button" class="ad-task" data-ad-work="'+key+'" aria-pressed="'+String(selectedWork===key)+'"><span><strong>'+ein(title)+'</strong><small>'+ein(line)+'</small></span>'+badge+'</button>';
  }
  function compareSettings(x){
    const {r,v}=x;
    const rows=[['细分专业','focus'],['回复风格','tone'],['解释深度','depth']].map(([label,key])=>{
      const current=v.settings?.[key],candidate=(r.snapshot?.settings||r.settings)?.[key];
      return '<tr><th scope="row">'+label+'</th><td>'+ein(current||'未记录')+'</td><td class="'+(candidate&&candidate!==current?'ad-diff':'')+'">'+ein(candidate||'未记录')+'</td></tr>';
    });
    const liveSources=Array.isArray(v.knowledgeIds)?v.knowledgeIds.length+' 项':'未记录';
    rows.push('<tr><th scope="row">引用资料索引</th><td>'+liveSources+'</td><td>'+x.knowledgeIds.length+' 项</td></tr>');
    return '<div class="ad-section"><h3>版本对照</h3><table class="ad-cmp"><thead><tr><th scope="col">比较项</th><th scope="col">服务版 v'+ein(v.version)+'</th><th scope="col">工作版 v'+ein(r.version)+'</th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
  }
  function reviewChecks(x){
    const verifiedTitles=typeof window.atlasKnowledgeTitles==='function'?window.atlasKnowledgeTitles(x.knowledgeIds):[];
    const sources=verifiedTitles.length?'<ul class="ad-source">'+verifiedTitles.map(title=>'<li>'+ein(title)+'</li>').join('')+'</ul>':'<p>'+ (x.knowledgeIds.length?'可在专业知识库中逐项查看已选资料。':'本工作版尚未挂接资料索引。请核对服务范围是否有相应的专业资料支持。')+'</p>';
    return '<div class="ad-section"><h3>发布材料核对</h3><details class="ad-readrow"><summary>知识来源 · '+x.knowledgeIds.length+' 项索引</summary>'+sources+'</details><details class="ad-readrow"><summary>服务范围与人工复核</summary><p>核对健康宣教、就诊资料准备和随访信息采集的适用范围。查看是否向患者标明 AI 身份，并明确需医生判断的反馈由谁复核。</p></details></div>';
  }
  function reviewStep(x,withButtons){
    const {r,v}=x;
    const steps={draft:'下一步由医生提交草稿。',submitted:'院方填写处理意见，意见将进入医生可查阅的审查报告。',approved:'院方已通过。请医生查阅报告、本人确认授权启用。',changes:'已退回。请医生根据审查意见修订后重新提交。',live:v.active?'医生已授权，当前版本已向患者开放。':'患者服务已暂停，恢复服务需医生确认。'};
    let actions='';
    if(!withButtons)actions=btn('review',r.status==='submitted'&&canDecide()?'核对并填写意见':'查看审查记录','ad-primary');
    else if(r.status==='submitted'&&canDecide())actions=btn('approve','填写通过意见','ad-primary')+btn('changes','退回修改');
    return (r.note?note('<strong>最近审查意见</strong><br>'+ein(r.note)):'')+'<div class="ad-dfoot"><p>'+ein(steps[r.status]||'查看版本记录。')+'</p><div class="ad-links">'+actions+'</div></div>';
  }
  function releaseDetail(x,editing){
    const {r,v}=x;
    const progress=tag(statusLabel(r.status),r.status==='submitted'?'ad-amber':r.status==='changes'?'ad-rose':'ad-green');
    const meta='运动医学科 · 患者端 v'+ein(v.version)+' '+(v.active?'服务中':'已暂停')+(r.snapshot?' · 送审单 '+ein(r.submissionId):'');
    const ethics=isReviewer()?'<details class="ad-review-report"><summary>伦理审查助手 · 辅助核对报告</summary><ul><li><strong>服务身份</strong>　患者示例答复已标明 AI 数字医生身份。</li><li><strong>服务边界</strong>　就诊准备、健康宣教与随访信息采集属于本次核对范围，涉及个体诊疗决策的问题交由主管医生处理。</li><li><strong>需人工核对</strong>　结合下方知识来源及版本对照，核实拟发布内容适用范围，并在审核意见中记录判断依据。</li></ul><p class="ad-smallinfo">以上为原型的模拟辅助核对结果。</p></details>':'';
    return '<div class="ad-dhead"><div><h2>陈医生的数字医生</h2><p>'+meta+'</p></div>'+progress+'</div>'+compareSettings(x)+reviewChecks(x)+ethics+reviewStep(x,editing);
  }
  function evaluationDetail(x){
    const metric=(name,value)=>'<dl><dt>'+name+'</dt><dd>'+ein(value)+'</dd></dl>';
    const activeDept=isAdmin()?evaluationDept:'all';
    const members=x.dir.filter(d=>activeDept==='all'||d.dept===activeDept);
    const sum=field=>members.reduce((n,d)=>n+Number(d[field]||0),0);
    const rows=members.map(d=>'<tr><th scope="row">'+ein(d.dept)+'<span class="ad-cellmeta">'+ein(d.name)+'</span></th><td>'+ein(d.replies)+'</td><td>'+ein(d.pending)+'</td></tr>').join('');
    const selector=isAdmin()?'<label class="ad-controls">服务科室 <select id="ad-evaluation-dept"><option value="all">全部科室</option>'+x.depts.map(d=>'<option value="'+ein(d)+'" '+(d===activeDept?'selected':'')+'>'+ein(d)+'</option>').join('')+'</select></label>':'';
    const more=isAdmin()?'':'<div class="ad-dfoot"><p>按科室、时间或患者来源比较服务覆盖、抽检结果与随访完成情况。</p>'+btn('screen','进入评价大屏','ad-primary')+'</div>';
    return '<div class="ad-dhead"><div><h2>'+(isAdmin()?'服务运行统计':'院区服务评价')+'</h2><p>崇礼院区 · 今日演示记录</p></div></div>'+selector+'<div class="ad-result-grid">'+metric('数字医生回复',sum('replies'))+metric('收到随访反馈',sum('feedback'))+metric('待医生复核',sum('pending'))+'</div><div class="ad-section"><h3>各医生服务情况</h3><table class="ad-cmp"><thead><tr><th scope="col">科室 / 医生</th><th scope="col">数字医生回复</th><th scope="col">随访待复核</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+more;
  }
  function overview(x){
    const release=workSelect('release','数字医生发布申请','陈医生 · v'+x.r.version,tag(statusLabel(x.r.status),x.r.status==='submitted'?'ad-amber':''));
    const performance=workSelect('evaluation',isAdmin()?'服务运行统计':'院区服务评价',x.depts.length+' 个科室 · '+x.dir.length+' 位医生',tag('院级'));
    const summary='<div class="ad-railinfo"><h3>今日院区摘要</h3><dl class="ad-mini"><dt>服务中数字医生</dt><dd>'+ein(x.m.live)+' 位</dd><dt>数字医生回复</dt><dd>'+ein(x.m.replies)+' 条</dd><dt>待复核反馈</dt><dd>'+ein(x.m.pending)+' 份</dd></dl></div>';
    return '<div class="ad-workbench" id="ad-workbench"><section class="ad-rail" aria-label="治理事项"><div class="ad-phead"><h2>治理事项</h2></div><div class="ad-railitems">'+release+performance+'</div>'+summary+'</section><section class="ad-detail" id="ad-detail" aria-label="所选事项详情">'+(selectedWork==='release'?releaseDetail(x,false):evaluationDetail(x))+'</section></div>';
  }
  function statusLabel(value){return statuses[value]||value||'暂无申请';}
  function rosterRow(x){
    const term=search.trim();
    const rows=x.dir.filter(d=>(!term||(d.name+' '+d.dept).includes(term))&&(department==='all'||d.dept===department)&&(statusFilter==='all'||(statusFilter==='active')===d.active));
    if(!rows.length)return '<tr><td colspan="5" class="ad-empty">没有符合条件的医生。</td></tr>';
    return rows.map(d=>'<tr><td><strong>'+ein(d.name)+'</strong><span class="ad-cellmeta">'+ein(d.dept)+'</span></td><td>'+tag(d.active?'服务中':'已暂停',d.active?'ad-green':'ad-rose')+'</td><td>v'+ein(d.version)+'</td><td>'+tag(statusLabel(d.status))+'</td><td><button type="button" class="ad-textbtn" data-ad-act="profile" data-ad-id="'+ein(d.id)+'">'+(d.id==='chen'?'管理服务':'查看服务')+'</button></td></tr>').join('');
  }
  function doctors(x){
    const opts=x.depts.map(d=>'<option value="'+ein(d)+'" '+(department===d?'selected':'')+'>'+ein(d)+'</option>').join('');
    return box('<div class="ad-topline"><div><h2>数字医生名册</h2><p class="ad-sub">查看院区各科室的服务版本和运行状态。</p></div>'+tag(x.dir.length+' 位医生')+'</div><div class="ad-controls"><input id="ad-roster-search" aria-label="搜索医生或科室" placeholder="搜索医生或科室" value="'+ein(search)+'"><select id="ad-dept" aria-label="科室筛选"><option value="all">全部科室</option>'+opts+'</select><select id="ad-state" aria-label="服务状态筛选"><option value="all">全部服务状态</option><option value="active" '+(statusFilter==='active'?'selected':'')+'>服务中</option><option value="paused" '+(statusFilter==='paused'?'selected':'')+'>已暂停</option></select></div><div class="ad-table-wrap ad-tablewrap-wide" tabindex="0" aria-label="医生列表"><table class="ad-table"><thead><tr><th>医生 / 科室</th><th>当前状态</th><th>服务版本</th><th>发布进度</th><th>操作</th></tr></thead><tbody id="ad-roster-rows">'+rosterRow(x)+'</tbody></table></div>');
  }
  function campus(x){
    const departments=x.depts.map(d=>{
      const members=x.dir.filter(m=>m.dept===d);
      return '<div class="ad-row"><div><h3>'+ein(d)+'</h3><span class="ad-smallinfo">'+members.filter(m=>m.active).length+' 位服务中 / '+members.length+' 位已入册</span></div><button type="button" class="ad-textbtn" data-ad-act="department-report" data-ad-department="'+ein(d)+'" aria-label="查看'+ein(d)+'的服务成效">查看科室成效</button></div>';
    }).join('');
    const records=x.invites.length?'<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>受邀医生</th><th>科室</th><th>登记时间</th><th>状态</th></tr></thead><tbody>'+x.invites.map(i=>'<tr><td>'+ein(i.name)+'</td><td>'+ein(i.dept)+'</td><td>'+ein(i.time)+'</td><td>'+tag(i.status||'待确认','ad-amber')+'</td></tr>').join('')+'</tbody></table></div>':'<p class="ad-empty">暂无邀请记录，可为待加入的医生登记邀请。</p>';
    return '<div class="ad-split">'+box('<div class="ad-topline"><div><h2>医生入驻邀请</h2><p class="ad-sub">在院区登记拟加入的医生与所属科室。</p></div>'+btn('invite','登记邀请','ad-primary')+'</div>'+records+note('邀请登记完成后，可安排医生查看使用教程。本次演示仅保存邀请记录。'))+box('<h2>科室接入情况</h2>'+departments+'<div class="ad-footer">'+textButton('guide','查看医生培训教程')+'</div>')+'</div>';
  }
  function review(x){
    const {r}=x;
    const status=statusLabel(r.status);
    const recent=x.audit.filter(isReviewEvent).slice(0,4);
    const submitted=r.status==='submitted';
    const stage='<section class="ad-rail"><div class="ad-phead"><h2>审查记录</h2></div><div style="padding:12px 17px">'+auditLines(recent)+'</div></section>';
    const record='<section class="ad-detail" aria-label="发布审查详情">'+(!submitted?'<p class="ad-smallinfo">当前没有待审版本 · '+ein(status)+'</p>':'')+releaseDetail(x,true)+'</section>';
    if(isReviewer()){
      const queue='<section class="ad-rail ad-review-rail" aria-label="发布申请队列"><div class="ad-phead"><h2>发布申请</h2><p class="ad-sub">待审 '+(submitted?'1':'0')+' 项</p></div><div class="ad-review-card"><strong>陈医生 · 运动医学科</strong><small>工作版本 v'+ein(r.version)+'</small>'+tag(status,submitted?'ad-amber':'')+'</div><div class="ad-phead"><h3>最近审查记录</h3></div>'+auditLines(recent)+'</section>';
      return '<div class="ad-workbench" id="ad-review-workbench">'+queue+'<section class="ad-detail" id="ad-review-detail" aria-label="发布申请核对详情">'+(!submitted?'<p class="ad-smallinfo">当前没有待审版本</p>':'')+releaseDetail(x,true)+'</section></div>';
    }
    return '<div class="ad-workbench">'+stage+record+'</div>';
  }
  function audit(x){return box('<div class="ad-topline"><div><h2>操作记录</h2><p class="ad-sub">查阅本次演示中的版本提交、处理意见、医生授权和服务变更。</p></div>'+tag(x.audit.length+' 条')+'</div><div class="ad-controls"><input type="search" id="ad-log-search" aria-label="搜索操作记录" placeholder="搜索操作、人员或备注" value="'+ein(logSearch)+'"></div><div id="ad-logrows">'+auditLines(filterLog(x))+'</div>');}
  function reviewHistory(x){
    return box('<div class="ad-topline"><div><h2>审查记录</h2><p class="ad-sub">查看版本提交、院方意见及医生授权记录。</p></div>'+tag(x.audit.length+' 条')+'</div><div class="ad-controls"><input type="search" id="ad-log-search" aria-label="搜索审查记录" placeholder="搜索版本、操作或审核意见" value="'+ein(logSearch)+'"></div><div id="ad-logrows">'+auditLines(filterLog(x))+'</div>');
  }
  function filterLog(x){return x.audit.filter(e=>[e.action,e.actor,e.detail,e.time,e.reviewNote].join(' ').includes(logSearch.trim()));}
  function render(){
    if(!window.CL?.state||!canAccess())return;
    const reviewer=isReviewer();
    if(reviewer&&!reviewerTabs.includes(tab))tab='review';
    configureAccess(reviewer);
    const x=reviewer?reviewerSnapshot():snapshot();
    app.querySelectorAll('[data-ad-tab]').forEach(b=>{if(b.dataset.adTab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    app.querySelector('.ad-header [data-ad-act="review"]').hidden=tab==='review';
    content.innerHTML=({overview,doctors,review,campus,audit:reviewer?reviewHistory:audit})[tab](x);
  }
  function switchTab(name){if(!canAccess()||!(isReviewer()?reviewerTabs:pages).includes(name))return;tab=name;msg.textContent='';render();}
  function showDialog(key){
    if(!canAccess()||(isReviewer()&&!['approve','changes'].includes(key)))return;
    const {r,v,dir}=isReviewer()?reviewerSnapshot():snapshot();
    if(['approve','changes'].includes(key)&&(!canDecide()||r.status!=='submitted'))return;
    action=key;decisionTarget=key==='pause'?v.version:r.submissionId;
    const title=app.querySelector('#ad-dtitle');
    if(key==='profile'){
      const d=dir.find(d=>d.id===profileId);if(!d)return;
      const isChen=d.id==='chen';
      title.textContent=d.name+' · 服务详情';
      const metrics='<div class="ad-row"><span>今日数字医生回复</span><strong>'+ein(d.replies)+' 条</strong></div><div class="ad-row"><span>随访反馈 / 已发出</span><strong>'+ein(d.feedback)+' / '+ein(d.sent)+'</strong></div><div class="ad-row"><span>待医生复核</span><strong>'+ein(d.pending)+' 条</strong></div>';
      db.innerHTML='<p class="ad-sub">'+ein(d.dept)+' · 崇礼院区</p><div class="ad-row"><span>患者服务</span>'+tag(d.active?'服务中':'已暂停',d.active?'ad-green':'ad-rose')+'</div><div class="ad-row"><span>当前服务版本</span><strong>v'+ein(d.version)+'</strong></div><div class="ad-row"><span>发布进度</span>'+tag(statusLabel(d.status))+'</div>'+metrics+'<div class="ad-footer">'+(isChen?btn('review','查看发布审查')+(v.active?btn('pause','暂停服务','ad-caution'):'<span class="ad-smallinfo">等待医生确认恢复</span>'):btn('close','关闭'))+'</div>';
    }else if(key==='invite'){
      title.textContent='登记入驻邀请';
      db.innerHTML='<p class="ad-sub">填写拟邀请的医生及科室，登记后进入待确认名单。</p><form id="ad-invite"><label for="ad-name">医生姓名</label><input required maxlength="30" id="ad-name" autocomplete="off"><label for="ad-invite-dept">所属科室</label><input required id="ad-invite-dept" list="ad-depts" maxlength="40" placeholder="选择或填写科室"><datalist id="ad-depts">'+snapshot().depts.map(d=>'<option value="'+ein(d)+'"></option>').join('')+'</datalist><p role="status" id="ad-invite-msg" class="ad-feedback"></p><div class="ad-footer"><button type="submit" class="ad-btn ad-primary">保存邀请记录</button>'+btn('close','取消')+'</div></form>';
    }else{
      const forms={approve:['通过本次审查','意见会进入审查报告。通过后由医生本人确认是否启用。','通过意见','确认通过'],
        changes:['退回医生修改','请写明需调整的位置和原因，医生可据此修改后重新提交。','修改意见','确认退回'],
        pause:['暂停数字医生服务','确认后患者入口将显示暂停状态，原因会保存在操作记录中。','暂停原因','确认暂停']};
      const [heading,info,label,submit]=forms[key];title.textContent=heading;
      db.innerHTML='<p class="ad-sub" style="margin-top:8px">'+info+'</p><form id="ad-form"><label for="ad-reason">'+label+'（必填）</label><textarea required id="ad-reason" maxlength="600" placeholder="请填写具体说明"></textarea><div class="ad-footer"><button type="submit" class="ad-btn '+(key==='pause'?'ad-caution':'ad-primary')+'">'+submit+'</button>'+btn('close','取消')+'</div></form>';
    }
    if(!dlg.open)dlg.showModal();
    if(key==='invite')db.querySelector('input').focus();else if(key!=='profile')db.querySelector('textarea').focus();
  }
  app.addEventListener('click',ev=>{
    const button=ev.target.closest('button');
    if(!button||!canAccess())return;
    if(isReviewer()&&(button.dataset.adWork||(button.dataset.adAct&&!reviewerActions.includes(button.dataset.adAct))))return;
    if(button.dataset.adWork){
      selectedWork=button.dataset.adWork;render();
      app.querySelector('[data-ad-work="'+selectedWork+'"]').focus({preventScroll:true});
      return;
    }
    if(button.dataset.adTab){switchTab(button.dataset.adTab);return;}
    const key=button.dataset.adAct;if(!key)return;
    if(isAdmin()&&(key==='screen'||key==='department-report')){
      evaluationDept=key==='screen'?'all':button.dataset.adDepartment;
      selectedWork='evaluation';switchTab('overview');
      app.querySelector('#ad-evaluation-dept')?.focus({preventScroll:true});
      return;
    }
    if(isAdmin()&&key==='doctorRelease')return;
    if(key==='department-report'){
      window.CL.go('screen');
      window.LeadWall.reset();
      window.LeadWall.showDept(button.dataset.adDepartment);
      return;
    }
    if(key==='close'){dlg.close();return;}
    if(key==='screen'||key==='doctorRelease'||key==='guide'){if(dlg.open)dlg.close();window.CL.go(key);return;}
    if(pages.includes(key)){if(dlg.open)dlg.close();switchTab(key);app.querySelector('[data-ad-tab="'+key+'"]').focus();return;}
    if(key==='profile')profileId=button.dataset.adId||'chen';
    if(['profile','pause','approve','changes','invite'].includes(key))showDialog(key);
  });
  app.addEventListener('input',e=>{
    if(!canAccess())return;
    if(!isReviewer()&&e.target.id==='ad-roster-search'){search=e.target.value;app.querySelector('#ad-roster-rows').innerHTML=rosterRow(snapshot());}
    if(e.target.id==='ad-log-search'){logSearch=e.target.value;app.querySelector('#ad-logrows').innerHTML=auditLines(filterLog(isReviewer()?reviewerSnapshot():snapshot()));}
    if(e.target.id==='ad-reason')e.target.setCustomValidity('');
  });
  app.addEventListener('change',e=>{
    if(!canManage())return;
    if(e.target.id==='ad-evaluation-dept'){evaluationDept=e.target.value;render();app.querySelector('#ad-evaluation-dept')?.focus({preventScroll:true});return;}
    if(e.target.id==='ad-dept')department=e.target.value;
    else if(e.target.id==='ad-state')statusFilter=e.target.value;else return;
    app.querySelector('#ad-roster-rows').innerHTML=rosterRow(snapshot());
  });
  app.addEventListener('submit',e=>{
    if(!canAccess()||(isReviewer()&&(e.target.id!=='ad-form'||!['approve','changes'].includes(action)))){e.preventDefault();return;}
    if(e.target.id==='ad-invite'){
      e.preventDefault();const name=db.querySelector('#ad-name').value.trim(),dept=db.querySelector('#ad-invite-dept').value.trim(),notice=db.querySelector('#ad-invite-msg');
      if(!name||!dept){notice.textContent='请填写医生姓名和科室。';return;}
      const x=snapshot();if([...x.dir,...x.invites].some(d=>d.name===name&&d.dept===dept)){notice.textContent='该医生已在名册或邀请记录中。';return;}
      if(!window.CL.invite(name,dept)){notice.textContent='未能保存邀请，请检查姓名和科室。';return;}
      dlg.close();render();msg.textContent='邀请记录已保存，状态为待确认。';return;
    }
    if(e.target.id!=='ad-form')return;e.preventDefault();
    const area=app.querySelector('#ad-reason'),reason=area.value.trim();
    if(!reason){area.setCustomValidity('请填写具体说明');area.reportValidity();return;}
    if(['approve','changes'].includes(action)&&!canDecide())return;
    const operation={approve:'approve',changes:'returnForChanges',pause:'pause'}[action];
    if(!operation)return;
    const success=window.CL[operation](reason,decisionTarget);dlg.close();render();
    msg.textContent=success?({approve:'院方已通过审查，等待医生确认授权。',changes:'修改意见已写入审查报告。',pause:'服务已暂停，原因已记录。'})[action]:'版本状态已变化，请按当前进度重新操作。';
  });
  if(window.CL)window.CL.adminTab=switchTab;
  window.addEventListener('cl:change',render);
  window.addEventListener('cl:view',e=>{
    if(dlg.open){dlg.close();db.replaceChildren();action='';}
    if(!['reviewer','admin'].includes(e.detail))return;
    tab=isReviewer()?'review':'overview';
    selectedWork='release';evaluationDept='all';logSearch='';msg.textContent='';
    if(isAdmin())profileId='chen';
    render();
  });
  render();
})();
