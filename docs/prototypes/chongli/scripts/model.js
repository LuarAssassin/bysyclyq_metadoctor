(() => {
  const key='chongli-hospital-complete-demo-v1';
  const defaultSettings={focus:'膝关节',tone:'亲切自然',depth:'只说重点'};
  const clock=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false});
  const seed={
    release:{status:'submitted',version:'1.3',submissionId:1,note:'',settings:{...defaultSettings},snapshot:{version:'1.3',settings:{...defaultSettings},knowledgeIds:[]}},
    service:{active:true,version:'1.2',reason:'',settings:{...defaultSettings}},
    audit:[
      {time:'2026-11-19 09:10:00',actor:'陈医生',action:'提交版本审查',detail:'v1.3 · 送审单 1 · 运动医学科'},
      {time:'2026-11-18 15:20:00',actor:'陈医生',action:'医生授权启用',detail:'v1.2 · 演示服务'},
      {time:'2026-11-18 11:05:00',actor:'院方审核员',action:'院方审查通过',detail:'v1.2 · 演示记录'}
    ],reviewNotes:{},reviewOutcomes:{},invites:[],knowledgeIds:[],feedbackDone:0,replyActivity:[0,0,0]
  };
  const clone=x=>JSON.parse(JSON.stringify(x));
  function captureSubmission(s){
    return {version:s.release.version,settings:clone(s.release.settings),knowledgeIds:[...s.knowledgeIds]};
  }
  function read(){
    try{
      const v=JSON.parse(localStorage.getItem(key));
      if(v&&v.release&&v.service&&Array.isArray(v.audit)&&v.reviewNotes&&Array.isArray(v.knowledgeIds)){
        if(!Number.isSafeInteger(v.release.submissionId))v.release.submissionId=1;
        if(!v.release.snapshot&&v.release.status!=='draft')v.release.snapshot=captureSubmission(v);
        return v;
      }
    }catch{}
    return null;
  }
  let state=read()||clone(seed), channel;
  // Older saved demos predate the patient-side counters. Existing sample replies
  // remain in the base totals. Store only added counts, never a question or name.
  function recentReplies(s){
    return [0,1,2].map(i=>{
      const count=s.replyActivity?.[i];
      return Number.isSafeInteger(count)&&count>=0?count:0;
    });
  }
  const notice=()=>window.dispatchEvent(new CustomEvent('cl:change'));
  function synchronize(){const next=read();if(next&&JSON.stringify(next)!==JSON.stringify(state)){state=next;notice();}}
  try{channel=new BroadcastChannel(key);channel.onmessage=synchronize;}catch{}
  window.addEventListener('storage',e=>{if(e.key===key)synchronize()});
  window.addEventListener('focus',synchronize);
  function log(s,actor,action,detail){s.audit.unshift({time:clock(),actor,action,detail});s.audit=s.audit.slice(0,120);}
  function commit(requiredRole,apply){
    if(window.CL.currentRole?.()!==requiredRole)return false;
    const next=clone(read()||state);
    if(!apply(next)){synchronize();return false;}
    state=next;try{localStorage.setItem(key,JSON.stringify(next));channel?.postMessage('changed');}catch{}
    notice();return true;
  }
  function beginEdit(s){
    if(s.release.status==='live'){
      const [major,minor]=s.release.version.split('.').map(Number);
      s.release.version=major+'.'+(minor+1);
    }
    s.release.status='draft';s.release.note='';delete s.release.snapshot;
  }
  function updateKnowledge(ids,append){
    return commit('doctor',s=>{
      const values=Array.from(new Set(append?[...s.knowledgeIds,...ids]:ids)).filter(Number.isInteger).sort((a,b)=>a-b);
      if(JSON.stringify(values)===JSON.stringify(s.knowledgeIds))return false;
      s.knowledgeIds=values;beginEdit(s);log(s,'陈医生','更新知识库草稿','已选 '+values.length+' 项来源索引');return true;
    });
  }
  const submissionLabel=r=>'v'+r.version+' · 送审单 '+r.submissionId;
  function settingsOf(input){
    const allowed={focus:['膝关节','肩关节','运动损伤','术后康复'],tone:['亲切自然','简洁直接','专业严谨'],depth:['只说重点','分步说明']};
    return Object.fromEntries(Object.keys(allowed).map(k=>[k,allowed[k].includes(input?.[k])?input[k]:defaultSettings[k]]));
  }
  window.CL={
    get state(){return state},
    get photos(){
      const gallery=document.querySelector('#po-home .po-media');
      return Array.from(gallery.querySelectorAll('img[data-photo]'),image=>{
        const credit=gallery.querySelector('.po-credit[data-photo="'+image.dataset.photo+'"]');
        return {src:image.getAttribute('src'),title:credit.querySelector('.po-caption-title').textContent,source:credit.querySelector('a').href};
      });
    },
    logo:"assets/hospital-logo.png",
    metrics(){const done=Object.keys(state.reviewNotes).filter(k=>k==='A'||k==='B').length;return {pending:2-done,reviewed:4+done,totalFeedback:6,sent:8,replies:recentReplies(state).reduce((sum,n)=>sum+n,18),live:state.service.active?1:0};},
    directory(){
      const m=this.metrics(),s=state.service;
      return [
        {id:'chen',name:'陈医生',dept:'运动医学科',active:s.active,version:s.version,status:state.release.status,replies:m.replies,replyTopics:recentReplies(state).map((n,i)=>n+[6,7,5][i]),sent:m.sent,feedback:m.totalFeedback,pending:m.pending},
        {id:'lin',name:'林医生',dept:'康复医学科',active:true,version:'1.1',status:'live',replies:12,replyTopics:[2,4,6],sent:6,feedback:5,pending:1},
        {id:'zhou',name:'周医生',dept:'骨科',active:true,version:'1.0',status:'live',replies:9,replyTopics:[5,3,1],sent:5,feedback:4,pending:0}
      ];
    },
    hospitalMetrics(){
      const a=this.directory(), sum=field=>a.reduce((n,item)=>n+item[field],0);
      const pending=sum('pending'),feedback=sum('feedback'),replies=sum('replies');
      return {doctors:a.length,depts:new Set(a.map(x=>x.dept)).size,pending,reviewed:feedback-pending,totalFeedback:feedback,sent:sum('sent'),replies,live:a.filter(x=>x.active).length,trend:[22,27,23,31,30,36,replies]};
    },
    recordPatientReply(question){return commit('patient',s=>{
      const category={prep:0,contact:0,education:1,visit:2};
      if(!s.service.active||!Object.hasOwn(category,question))return false;
      const counts=recentReplies(s);
      counts[category[question]]++;
      s.replyActivity=counts;
      return true;
    });},
    invite(name,dept){return commit('admin',s=>{
      name=String(name||'').trim().slice(0,35);dept=String(dept||'').trim().slice(0,45);
      if(!name||!dept||s.invites.some(x=>x.name===name&&x.dept===dept)||this.directory().some(x=>x.name===name&&x.dept===dept))return false;
      s.invites.unshift({name,dept,time:clock()});
      log(s,'院方管理员','登记入驻邀请',dept+' · '+name);return true;
    });},
    saveSettings(input){return commit('doctor',s=>{
      const form=settingsOf(input);
      if(Object.keys(form).every(k=>s.release.settings[k]===form[k]))return false;
      beginEdit(s);s.release.settings=form;log(s,'陈医生','保存版本草稿','v'+s.release.version+' · 专业与表达');return true;
    });},
    setKnowledge(ids){return updateKnowledge(ids,false);},
    addKnowledge(ids){return updateKnowledge(ids,true);},
    reviewFeedback(id,note,outcome){return commit('doctor',s=>{
      id=String(id).toUpperCase();
      if(!['A','B'].includes(id)||Object.hasOwn(s.reviewNotes,id))return false;
      const followUp=['仅记录反馈','拟电话联系','拟复诊时沟通'];
      if(outcome!=null&&!followUp.includes(outcome))return false;
      s.reviewNotes[id]=String(note||'').trim().slice(0,1200);
      if(outcome!=null){
        s.reviewOutcomes??={};
        s.reviewOutcomes[id]=outcome;
      }
      s.feedbackDone=Object.keys(s.reviewNotes).length;
      log(s,'陈医生','完成随访复核','运动医学科 · 1 份反馈');return true;
    });},
    submit(){return commit('doctor',s=>{
      if(!['draft','changes'].includes(s.release.status))return false;
      s.release.submissionId++;s.release.snapshot=captureSubmission(s);
      s.release.status='submitted';s.release.note='';log(s,'陈医生','提交版本审查',submissionLabel(s.release)+' · 待院方复核');return true;
    });},
    approve(note,expected=state.release.submissionId){return commit('reviewer',s=>{
      if(s.release.status!=='submitted'||s.release.submissionId!==expected||!s.release.snapshot||!String(note||'').trim())return false;
      s.release.status='approved';s.release.note=String(note).trim().slice(0,1500);
      log(s,'院方审核员','院方审查通过',submissionLabel(s.release)+' · 待医生授权');s.audit[0].reviewNote=s.release.note;return true;
    });},
    returnForChanges(note,expected=state.release.submissionId){return commit('reviewer',s=>{
      if(s.release.status!=='submitted'||s.release.submissionId!==expected||!String(note||'').trim())return false;
      s.release.status='changes';s.release.note=String(note).trim().slice(0,1500);log(s,'院方审核员','退回版本修订',submissionLabel(s.release)+' · 已附意见');s.audit[0].reviewNote=s.release.note;return true;
    });},
    authorize(expected=state.release.submissionId){return commit('doctor',s=>{
      if(s.release.status!=='approved'||s.release.submissionId!==expected||!s.release.snapshot)return false;
      s.release.status='live';s.service={...clone(s.release.snapshot),submissionId:expected,active:true,reason:''};
      log(s,'陈医生','医生授权启用',submissionLabel(s.release)+' · 患者演示入口同步切换');return true;
    });},
    pause(reason,expected=state.service.version){return commit('admin',s=>{
      if(!s.service.active||s.service.version!==expected||!String(reason||'').trim())return false;
      s.service.active=false;s.service.reason=String(reason).trim().slice(0,1500);
      s.service.suspension=(s.service.suspension||0)+1;
      log(s,'院方管理员','暂停数字医生服务','v'+s.service.version+' · 暂停原因：'+s.service.reason);return true;
    });},
    resume(version=state.service.version,suspension=state.service.suspension||0){return commit('doctor',s=>{
      if(s.service.active||s.service.version!==version||(s.service.suspension||0)!==suspension)return false;s.service.active=true;s.service.reason='';
      log(s,'陈医生','重新授权服务','v'+s.service.version+' · 已恢复');return true;
    });},
    resetDemo(){if(window.CL.currentRole?.()!=='admin')return false;state=clone(seed);try{localStorage.setItem(key,JSON.stringify(state));channel?.postMessage('changed')}catch{}notice();}
  };
})();

(() => {
  'use strict';
  const asOf = '2026-11-19';
  const dayMs = 86400000;
  const end = Date.parse(asOf + 'T00:00:00Z');
  const dates = Array.from({length: 60}, (_, i) => dateAt(i - 59));
  const dept = ['运动医学科', '康复医学科', '骨科'];
  const doctorsByDept = {
    '运动医学科': ['运动医学 AI 01', '运动医学 AI 02'],
    '康复医学科': ['康复医学 AI 01', '康复医学 AI 02'],
    '骨科': ['骨科 AI 01', '骨科 AI 02']
  };
  const symptom = ['膝痛', '肩痛', '腰痛', '活动受限', '局部肿胀', '未记录'];
  const disease = ['膝骨关节炎', '半月板损伤', '前交叉韧带损伤', '肩袖损伤', '腰椎间盘突出症', '骨折', '未记录'];
  const region = ['崇礼区', '张家口市其他区县', '河北省其他地区', '北京市', '其他省份', '未记录'];
  const channel = ['院内门诊', '基层转诊', '线上自主进入', '住院后随访'];
  const scene = ['就诊准备', '科普宣教', '智能随访'];
  const options = {dept, doctor: Object.values(doctorsByDept).flat(), symptom, disease, region, channel, scene};
  const dimensions = Object.keys(options);

  function dateAt(offset) {
    return new Date(end + offset * dayMs).toISOString().slice(0, 10);
  }
  function shortDate(iso) { return iso.slice(5).replace('-', '/'); }

  // Deterministic training fixtures. Numbered AI profiles and internal integers
  // are synthetic; no identifiable person or medical record is represented.
  function makeRecords() {
    let seed = 112319;
    function draw() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
    function weighted(weights) {
      let point = draw() * weights.reduce((a,b) => a+b, 0);
      for (let i = 0; i < weights.length; i++) { point -= weights[i]; if (point < 0) return i; }
      return weights.length - 1;
    }
    const patients = [], regulars = [], records = [];
    function newPatient(first) {
      const person = {id: patients.length, first, region: region[weighted([46,23,12,11,6,2])]};
      patients.push(person);
      return person;
    }
    for(let i = 0; i < 230; i++) regulars.push(newPatient(-1)); // known use preceding the displayed 60 days
    const diagnosisWeights = [[19,31,23,12,0,0,15], [33,10,11,12,18,0,16], [27,0,0,5,24,29,15]];
    const symptomWeights = [[36,15,2,24,15,8], [24,16,12,29,8,11], [21,9,24,18,17,11]];
    const weekdayWeight = [.77,1.14,1.06,1.01,1.11,.95,.82];
    for(let i = 0; i < dates.length; i++) {
      const weekday = new Date(dates[i] + 'T00:00:00Z').getUTCDay();
      const volume = Math.round((48 + .43*i + draw()*17) * weekdayWeight[weekday]);
      for(let j = 0; j < volume; j++) {
        const person = draw() < .58 ? regulars[Math.floor(draw()*regulars.length)] : newPatient(i);
        if (person.first === i && regulars[regulars.length - 1] !== person && !person.enrolled) {
          person.enrolled = true; regulars.push(person);
        }
        const d = weighted([32 + .19*i, 29 + .035*i, 28]);
        const department = dept[d], agent = weighted([56,44]);
        const sceneIndex = weighted([[36,39,25],[20,31,49],[38,31,31]][d]);
        // Disease is a separate simulated encounter field. It is drawn independently
        // of the stated symptom, never derived from free text or an inferred diagnosis.
        const diagnosis = [...diagnosisWeights[d]];
        if (d === 0) diagnosis[1] += i*.25;
        const rounds = 1 + weighted([13,30,29,15,9,4]);
        const escalationDue = draw() < ([.09,.12,.1][d] + (rounds >= 5 ? .09 : 0));
        const handed = draw() < (escalationDue ? .967 : .035);
        const closed = handed && draw() < [.88,.82,.90][d];
        const completed = handed ? closed : draw() < [.92,.89,.94][d];
        const followup = sceneIndex === 2;
        const audited = draw() < .18;
        const cited = audited && draw() < [.94,.96,.90][d];
        const passed = audited && draw() < [.92,.95,.89][d] - (agent ? .017 : 0);
        records.push({
          day:i, patient:person.id, first:person.first, dept:department, doctor:doctorsByDept[department][agent],
          symptom:symptom[weighted(symptomWeights[d])], disease:disease[weighted(diagnosis)], region:person.region,
          channel:channel[weighted(followup ? [16,21,8,55] : [47,18,30,5])], scene:scene[sceneIndex],
          rounds, completed, audited, cited, passed, followup, ontime:followup && completed && draw()<.946,
          escalationDue, escalationTimely:escalationDue && handed && draw()<.94, handed, closed
        });
      }
    }
    return records;
  }
  const records = makeRecords();

  const counters = {completed:'completed', audited:'audited', passed:'passed', cited:'cited',
    followups:'followup', ontime:'ontime', handoffs:'handed', closed:'closed',
    escalationDue:'escalationDue', escalationTimely:'escalationTimely'};
  function summarize(rows, start) {
    const visits = new Map();
    const s = {patients:0, services:rows.length, rounds:0, newPatients:0, returning:0, repeatPatients:0,
      completed:0, audited:0, passed:0, cited:0, followups:0, ontime:0, handoffs:0, closed:0,
      escalationDue:0, escalationTimely:0, unresolved:0, repeatRounds:0};
    for(const row of rows) {
      const n = (visits.get(row.patient) || 0) + 1;
      visits.set(row.patient, n);
      if(n === 1) { s.patients++; if(row.first < start) s.returning++; else s.newPatients++; }
      if(n === 2) s.repeatPatients++;
      if(row.rounds >= 5) s.repeatRounds++;
      s.rounds += row.rounds;
      for(const key in counters) if(row[counters[key]]) s[key]++;
    }
    s.unresolved = s.handoffs - s.closed;
    return s;
  }
  function grouped(rows, key) {
    const map = new Map();
    for(const r of rows) {
      let group = map.get(r[key]);
      if(!group) { group=[]; map.set(r[key],group); }
      group.push(r);
    }
    return map;
  }
  function sortRows(rows, key) { return rows.sort((a,b) => b[key]-a[key] || a.name.localeCompare(b.name, 'zh-CN')); }
  function daily(rows, start, size) {
    const sets = grouped(rows,'day');
    return Array.from({length:size}, (_,i) => {
      const date = dates[start+i];
      return {date, label:shortDate(date), ...summarize(sets.get(start+i) || [],start)};
    });
  }

  function allocate(entries, total) {
    const parts=entries.map(([name,weight])=>({name,value:Math.floor(weight),fraction:weight-Math.floor(weight)}));
    const remain=total-parts.reduce((n,item)=>n+item.value,0);
    parts.sort((a,b)=>b.fraction-a.fraction || a.name.localeCompare(b.name,'zh-CN'));
    for(let i=0;i<remain && i<parts.length;i++) parts[i].value++;
    return parts;
  }
  function forecast(rows) {
    const reference = rows.filter(r=>r.day>=32);
    const byDay=grouped(reference,'day');
    const info={eligible:reference.length>=12 && byDay.size>=4, sample:reference.length, activeDays:byDay.size,
      referenceStart:dates[32],referenceEnd:asOf,total:null,low:null,high:null,days:[],byDept:[],byDisease:[],
      method:'使用截止统计日的近28日服务记录，与所选科室、标签和来源筛选一致。每个未来日期取前四个同星期几的服务量，按1、1、2、3由远及近加权估算。每日上下界取四次观测的最低量和最高量。七天范围分别加总每日上下界。样本至少12次服务且覆盖4个活跃日。'};
    if(!info.eligible) return info;
    const base=53;
    const projected={dept:new Map(),disease:new Map()};
    for(let offset=0;offset<7;offset++){
      // day index 60 corresponds to the day after the sample closes.
      const samples = [32+offset,39+offset,46+offset,53+offset].map(idx=>byDay.get(idx)||[]);
      const weights=[1,1,2,3], counts=samples.map(r=>r.length);
      const value=Math.round(counts.reduce((n,count,i)=>n+count*weights[i],0)/7);
      const date=dateAt(offset+1);
      info.days.push({date,label:shortDate(date),value,low:Math.min(...counts),high:Math.max(...counts)});
      for(const key of ['dept','disease']) {
        const bucket=new Map();
        samples.forEach((sample,i)=> sample.forEach(r=>bucket.set(r[key],(bucket.get(r[key])||0)+weights[i])));
        const allocations=allocate([...bucket].map(([name,weight])=>[name,weight/7]),value);
        for(const piece of allocations) projected[key].set(piece.name,(projected[key].get(piece.name)||0)+piece.value);
      }
    }
    info.total=info.days.reduce((n,x)=>n+x.value,0);
    info.low=info.days.reduce((n,x)=>n+x.low,0);
    info.high=info.days.reduce((n,x)=>n+x.high,0);
    const lastWeek=reference.filter(r=>r.day>=base);
    for(const [key,target] of [['dept','byDept'],['disease','byDisease']]) {
      const previous=grouped(lastWeek,key);
      info[target]=sortRows([...projected[key]].map(([name,value])=>{
        const last=(previous.get(name)||[]).length;
        return {name,value,last,change:value-last};
      }),'value');
    }
    return info;
  }
  const cache = new Map();
  function query(input = {}) {
    const requestedDays=Number(input.days);
    const filters={days:requestedDays===1 || requestedDays===7 ? requestedDays : 30};
    for(const key of dimensions) filters[key]=typeof input[key]==='string' ? input[key].trim() : '';
    const serial=JSON.stringify(filters);
    if(cache.has(serial)) return cache.get(serial);
    const active=dimensions.filter(key=>filters[key]);
    const selected=active.length?records.filter(row=>active.every(key=>row[key]===filters[key])):records;
    const start=60-filters.days, prior=start-filters.days;
    const now=selected.filter(r=>r.day>=start), before=selected.filter(r=>r.day>=prior&&r.day<start);
    const groups={};
    for(const key of dimensions) {
      groups[key]=sortRows([...grouped(now,key)].map(([name,rows])=>({name,...summarize(rows,start)})),'services');
    }
    const f=forecast(selected);
    const quality=groups.dept.filter(x=>x.audited>=5&&x.audited>x.passed)
      .map(x=>({name:x.name,audited:x.audited,passed:x.passed,failed:x.audited-x.passed}))
      .sort((a,b)=>b.failed-a.failed)[0] || null;
    const demand=f.byDisease.filter(x=>x.name!=='未记录'&&x.change>0).sort((a,b)=>b.change-a.change)[0] || null;
    const result = {filters,period:{start:dates[start],end:asOf,priorStart:dates[prior],priorEnd:dates[start-1]},
      current:summarize(now,start),previous:summarize(before,prior),days:daily(now,start,filters.days),
      prevDays:daily(before,prior,filters.days),groups,forecast:f,focus:{demand,quality}};
    if(cache.size>=100) cache.clear();
    cache.set(serial,result);
    return result;
  }
  window.LeadData={asOf,options,doctorsByDept,query};
})();
