(()=>{
 const root=document.getElementById('kb-app'),at=id=>document.getElementById('kb-'+id);
 const rows=[
 {title:'骨关节炎的诊断与管理（NICE NG226）',specialty:'骨科',origin:'国际',source:'英国 NICE',date:'发布于 2022.10.19',keywords:'膝关节 骨关节炎 骨科 NICE 指南 osteoarthritis',description:'官方条目名称为 Osteoarthritis in over 16s: diagnosis and management。可打开 NICE 页面核对原文；加入知识库只保存本条来源索引。',official:true},
 {title:'术后随访信息采集表',specialty:'运动医学',origin:'院内',source:'样例表单',date:'示例日期 2026.11.18',keywords:'膝关节 术后随访 活动记录 运动医学',description:'示例表单包含回访日期、患者自述、希望医生解答的问题和联系偏好。用于演示如何整理随访资料。'},
 {title:'运动损伤就诊资料清单',specialty:'运动医学',origin:'国内',source:'样例清单',date:'示例日期 2026.11.16',keywords:'运动损伤 复诊准备 运动医学 训练',description:'示范记录影像检查、既往就诊材料、运动项目和日期。便于医生检查患者是否已整理好复诊所需材料。'},
 {title:'肩关节康复记录模板',specialty:'康复医学',origin:'院内',source:'样例模板',date:'示例日期 2026.11.13',keywords:'康复医学 肩关节 随访 术后随访',description:'用于演示如何归档康复记录、记录中断原因及患者想咨询的问题。'},
 {title:'运动损伤研究文献提取表',specialty:'运动医学',origin:'国际',source:'样例文献卡',date:'示例日期 2026.11.11',keywords:'循证 运动损伤 研究 文献 运动医学',description:'模拟国际文献的归档条目，展示研究对象、研究设计、观察指标和原文位置等字段。'},
 {title:'膝关节复诊沟通提纲',specialty:'骨科',origin:'国内',source:'样例提纲',date:'示例日期 2026.11.08',keywords:'骨科 膝关节 复诊 随访',description:'整理患者近期变化、待核对的报告和希望讨论的问题，可作为演示知识库中的准备材料。'}
 ];
 const book='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 3h12l2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2Z"/><path d="M8 3v14M5 17h14M11 8h5M11 11h4"/></svg>';
 let mode='discover',topic='全部专科',detail=null;
 const saved=new Set((window.CL.state.knowledgeIds || []).filter(id=>rows[id])),selected=new Set();
 window.addEventListener('cl:change',()=>{saved.clear();for(const id of window.CL.state.knowledgeIds || []){if(rows[id]){saved.add(id);selected.delete(id)}}render()});
 window.atlasKnowledgeTitles=()=>Array.from(saved,id=>rows[id].title);
 function say(note){at('live').textContent=note}
 function resetFilters(){at('search').value='';at('origin').value='全部来源';topic='全部专科'}
 function render(){
   const term=at('search').value.trim().toLowerCase(),origin=at('origin').value;
   const matches=rows.map((r,id)=>({r,id})).filter(({r,id})=>(mode==='discover'||saved.has(id))&&(topic==='全部专科'||topic===r.specialty)&&(origin==='全部来源'||r.origin===origin)&&[r.title,r.keywords,r.source,r.specialty,r.origin].join(' ').toLowerCase().includes(term));
   at('saved-count').textContent=saved.size;at('list-title').textContent=mode==='discover'?'可选资料':'我的资料';at('total').textContent='· '+matches.length+' 条';
   root.querySelectorAll('[data-kbmode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kbmode===mode)));root.querySelectorAll('[data-kbtopic]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kbtopic===topic)));
   at('import').hidden=mode==='saved';at('import').disabled=!selected.size;at('import').textContent=selected.size?'加入知识库（'+selected.size+'）':'加入知识库';
   at('rows').innerHTML=matches.map(({r,id})=>'<li class="kb-row">'+(mode==='discover'?'<input type="checkbox" aria-label="选择'+r.title+'" data-kbsel="'+id+'" '+(saved.has(id)?'checked disabled':selected.has(id)?'checked':'')+'>':'')+'<span aria-hidden="true" class="kb-book" data-origin="'+r.origin+'">'+book+'</span><div class="kb-copy"><button type="button" class="kb-title" data-kbdetail="'+id+'">'+r.title+'</button><div class="kb-meta"><span>'+r.specialty+'</span><span>'+r.origin+' · '+r.source+'</span><span>'+r.date+'</span></div></div>'+(saved.has(id)?'<span class="kb-status">已加入</span>':'')+'</li>').join('');
   at('empty').hidden=matches.length>0;const newShelf=mode==='saved'&&saved.size===0;at('empty-message').textContent=newShelf?'知识库里还没有资料。':'未找到符合条件的资料。';at('clear').textContent=newShelf?'去发现资料':'清除筛选';
 }
 function toggle(i){if(saved.has(i))return;if(selected.has(i))selected.delete(i);else selected.add(i);render()}
 function openDetail(i){detail=i;const r=rows[i];at('dialog-title').textContent=r.title;at('dialog-meta').textContent=r.specialty+' · '+r.origin+' · '+r.source+' · '+r.date;at('description').textContent=r.description;at('official').hidden=!r.official;at('dialog-select').disabled=saved.has(i);at('dialog-select').textContent=saved.has(i)?'已加入知识库':selected.has(i)?'取消勾选':'勾选这份资料';at('dialog').showModal()}
 root.addEventListener('click',e=>{
   const b=e.target.closest('button');if(!b)return;
   if(b.dataset.kbmode!==undefined){mode=b.dataset.kbmode;resetFilters();render()}
   if(b.dataset.kbtopic!==undefined){topic=b.dataset.kbtopic;render()}
   if(b.dataset.kbq!==undefined){window.atlasSearch(b.dataset.kbq)}
   if(b.dataset.kbdetail!==undefined)openDetail(+b.dataset.kbdetail);
 });
 at('rows').addEventListener('change',e=>{const id=e.target.dataset.kbsel;if(id!==undefined){toggle(+id);root.querySelector('[data-kbsel="'+id+'"]')?.focus({preventScroll:true})}});
 at('search-form').addEventListener('submit',e=>{e.preventDefault();render();say('找到 '+at('total').textContent.replace('· ','')+'资料')});at('search').addEventListener('input',render);at('origin').addEventListener('change',render);
 at('clear').onclick=()=>{if(mode==='saved'&&!saved.size)mode='discover';resetFilters();render()};
 at('import').onclick=()=>{const added=selected.size;selected.forEach(i=>saved.add(i));selected.clear();window.CL.setKnowledge(Array.from(saved));render();say('已加入 '+added+' 份资料');window.dispatchEvent(new Event('atlas:refresh'))};
 at('close').onclick=()=>at('dialog').close();at('dialog-select').onclick=()=>{at('dialog').close();toggle(detail);root.querySelector('[data-kbdetail="'+detail+'"]')?.focus({preventScroll:true})};
 window.atlasSaved=()=>saved.size;window.atlasSearch=q=>{mode='discover';resetFilters();at('search').value=String(q||'');render()};render();
})();
