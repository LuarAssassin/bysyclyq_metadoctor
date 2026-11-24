(()=>{
  const scope=document.currentScript.previousElementSibling;
  const find=sel=>scope.querySelector(sel);
  const examples={
    follow:{
      lines:['本周已经把活动情况写在记录本上。','希望主管医生方便时给我回个电话。','下次复诊我会带着记录本。'],
      fields:[['情况记录','患者自述已记录本周活动情况。',0],['主要诉求','希望主管医生来电联系。',1],['复诊准备','患者表示下次复诊将携带活动记录。',2],['待补信息','材料未提供手术日期、疼痛评分及检查结果。',null]]
    },
    rehab:{
      lines:['这周的康复日记已经整理好了。','我打算复诊时带去给运动医学科医生看。','想问还需要提前准备哪些材料。'],
      fields:[['情况记录','患者自述已整理本周康复日记。',0],['主要诉求','询问复诊前还需准备哪些材料。',2],['复诊准备','计划携带康复日记至运动医学科复诊。',1],['待补信息','材料未提供康复项目、训练强度及体格检查结果。',null]]
    }
  };
  examples.local={lines:[],fields:[['待补信息','请核对个案编码、资料日期及检查依据。缺失内容可标为未提供。',null]]};
  const drafts=new Map();
  const select=find('#rs-source'),draft=find('#rs-draft'),proof=find('#rs-proof'),choices=find('#rs-field-choices'),lines=find('#rs-source-lines'),status=find('#rs-status');
  function highlight(index){
    const item=examples[select.value],field=item.fields[index],sourceIndex=field[2];
    Array.from(choices.children).forEach((button,i)=>button.setAttribute('aria-pressed',String(index===i)));
    Array.from(lines.children).forEach((line,i)=>line.classList.toggle('active',i===sourceIndex));
    proof.textContent=sourceIndex===null?'原文中没有对应记录，请医生补充或保留“未提供”。':'原文 '+String(sourceIndex+1).padStart(2,'0')+'　“'+item.lines[sourceIndex]+'”';
  }
  function render(){
    const item=examples[select.value];
    find('#rs-source-meta').textContent=(select.value==='local'?'本地核对材料':'脱敏演示材料')+' · '+item.lines.length+' 条原文记录';
    const missing=item.fields.filter(f=>f[2]===null);
    find('#rs-gaps').textContent='待补资料 · '+missing.map(f=>f[1]).join(' ');
    lines.replaceChildren(...item.lines.map(text=>{const row=document.createElement('li');row.textContent=text;return row;}));
    choices.replaceChildren(...item.fields.map(([label],i)=>{const chip=document.createElement('button');chip.type='button';chip.className='rs-chip';chip.textContent=label;chip.addEventListener('click',()=>highlight(i));return chip;}));
    draft.value=drafts.get(select.value)??item.fields.map(([label,value])=>label+'：'+value).join('\n\n');
    status.textContent=drafts.has(select.value)?'已保留本次编辑':select.value==='local'?'本地摘录 · 草稿可编辑':'模拟记录 · 草稿可编辑';
    highlight(0);
  }
  select.addEventListener('change',render);
  draft.addEventListener('input',()=>{drafts.set(select.value,draft.value);status.textContent='已保留本次编辑';});
  const attachments=new Map();
  const upload=find('#rs-upload'),fileList=find('#rs-file-list'),preview=find('#rs-file-preview'),excerpt=find('#rs-excerpt'),intakeStatus=find('#rs-intake-status');
  find('#rs-import').addEventListener('click',()=>{
    find('#rs-intake').open=true;
    upload.focus();
    upload.click();
  });
  let sequence=0;
  function showFile(){
    const entry=attachments.get(fileList.value);preview.replaceChildren();
    if(!entry)return;
    let widget;
    if(entry.type==='text'){widget=document.createElement('pre');widget.textContent=entry.text;}
    else if(entry.type==='image'){widget=document.createElement('img');widget.alt=entry.name;widget.src=entry.url;}
    else if(entry.type==='audio'){widget=document.createElement('audio');widget.controls=true;widget.preload='metadata';widget.src=entry.url;}
    else {widget=document.createElement('a');widget.download=entry.name;widget.href=entry.url;widget.textContent='下载 PDF 至本机查看';}
    preview.append(widget);
  }
  fileList.addEventListener('change',showFile);
  upload.addEventListener('change',async()=>{
    let added=0,skipped=0;
    const files=Array.from(upload.files);upload.value='';
    for(const file of files){
      const ext=file.name.split('.').pop().toLowerCase();
      const type=ext==='txt'?'text':ext==='pdf'?'pdf':['png','jpg','jpeg','webp','gif'].includes(ext)?'image':['mp3','wav','m4a','ogg','aac','flac'].includes(ext)?'audio':'';
      if(!type || file.size>30*1024*1024 || (type==='text' && file.size>1024*1024)){skipped++;continue}
      try {
        const entry={type,name:file.name};
        if(type==='text')entry.text=await file.text();else entry.url=URL.createObjectURL(file);
        const id=String(++sequence);attachments.set(id,entry);
        const opt=document.createElement('option');opt.value=id;opt.textContent=file.name;fileList.append(opt);fileList.value=id;added++;
      }catch{skipped++}
    }
    showFile();intakeStatus.textContent='已读取 '+added+' 份材料。'+(skipped?'另有 '+skipped+' 份无法读取，请检查类型和大小（TXT 1 MB，其他 30 MB）。':'');
  });
  find('#rs-add-excerpt').addEventListener('click',()=>{
    const text=excerpt.value.trim();if(!text){intakeStatus.textContent='请先填写你已核对的摘录。';excerpt.focus();return}
    const name=attachments.get(fileList.value)?.name || '手动录入';
    const item=examples.local,index=item.lines.length;
    const section=find('#rs-section').value, location=find('#rs-locator').value.trim();
    const field=section+' '+(index+1), line='【'+name+(location?' · '+location:'')+'】'+text;
    item.lines.push(line);item.fields.push([field,line,index]);
    const draftText=drafts.get('local')??'待补信息：请核对个案编码、资料日期及检查依据。缺失内容可标为未提供。';
    drafts.set('local',draftText+'\n\n'+field+'：'+line);
    select.value='local';render();highlight(item.fields.length-1);excerpt.value='';find('#rs-locator').value='';intakeStatus.textContent='已加入本地病例草稿并标出来源。';
  });
  find('#rs-export').addEventListener('click',()=>{
    const content=draft.value.trim();
    if(!content){status.textContent='请先填写病例正文。';return;}
    const item=examples[select.value], name=select.options[select.selectedIndex].textContent;
    const sources=item.lines.map((line,i)=>(i+1)+'. '+line);
    const evidence=item.fields.filter(field=>field[2]!==null).map(field=>field[0]+' → 原文 '+(field[2]+1));
    const sections=['结构化病例草稿',name,content,'原始材料',sources.join('\n')||'尚未录入原文。','已摘录字段与原文对照',evidence.join('\n')||'尚未关联来源。'];
    const href=URL.createObjectURL(new Blob(['\uFEFF'+sections.join('\n\n')],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=href;link.download='结构化病例草稿_'+select.value+'.txt';
    scope.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(href),1000);
    status.textContent='已导出病例正文和原始出处。';
  });
  find('#rs-copy').addEventListener('click',async()=>{
    if(!draft.value.trim()){status.textContent='请先填写病例正文。';return;}
    try{await navigator.clipboard.writeText(draft.value);status.textContent='草稿已复制';}
    catch{draft.focus();draft.select();try{status.textContent=document.execCommand('copy')?'草稿已复制':'已选中草稿，可使用系统复制。';}catch{status.textContent='已选中草稿，可使用系统复制。';}}
  });
  render();
})();
