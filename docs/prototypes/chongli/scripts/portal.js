(()=>{
 const root=document.getElementById('view-portal'), home=root.querySelector('#po-home'), about=root.querySelector('#po-about'), media=root.querySelector('.po-media'), photo=media.querySelector('.po-image'), art=media.querySelector('.po-landscape'), caption=media.querySelector('.po-caption-title'), source=media.querySelector('.po-source'), track=media.querySelector('.po-page-track'), toggle=media.querySelector('.po-pause'), playback=media.querySelector('.po-playback');
 root.addEventListener('click',e=>{
   if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return;
   const link=e.target.closest('a');
   if(!link)return;
   if(link.classList.contains('po-role-scroll')){
     e.preventDefault();
     home.querySelector('#po-role-entries').scrollIntoView({block:'start'});
     home.querySelector('#po-directory-title').focus({preventScroll:true});
     return;
   }
   if(link.dataset.roleEntry&&window.CL?.enterRole){e.preventDefault();CL.enterRole(link.dataset.roleEntry);return;}
   if(link.dataset.poroute&&window.CL?.go){e.preventDefault();CL.go(link.dataset.poroute);}
 });
 const copyIntro=document.getElementById('po-copy-intro'), copyStatus=document.getElementById('po-copy-status'), intro=document.getElementById('po-official-intro');
 copyIntro.addEventListener('click',async()=>{
   try{await navigator.clipboard.writeText(intro.textContent.trim());copyStatus.textContent='平台简介已复制';}
   catch{
     const range=document.createRange(),selection=window.getSelection();
     range.selectNodeContents(intro);selection.removeAllRanges();selection.addRange(range);
     let copied=false;try{copied=document.execCommand('copy')}catch{}
     copyStatus.textContent=copied?'平台简介已复制':'已选中简介，可使用系统复制';
     if(copied)selection.removeAllRanges();
   }
 });
 const slides=(window.CL?.photos||[]).filter(x=>x&&x.src);
 let active=0,visible=true,timer=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const validLink=s=>typeof s==='string'&&/^https?:\/\//i.test(s);
 function controls(){const label=paused?'播放轮播':'暂停轮播';toggle.setAttribute('aria-label',label);toggle.title=label;toggle.innerHTML=paused?'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.5 13 8l-9 5.5z"/></svg>':'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 3h2.5v10H4zm5.5 0H12v10H9.5z"/></svg>'}
 function showSlide(i){
  if(!slides.length)return;active=i%slides.length;const o=slides[active];
  art.hidden=false;photo.hidden=true;
  photo.onload=()=>{photo.hidden=false;art.hidden=true};
  photo.onerror=()=>{art.hidden=false;photo.hidden=true;caption.textContent='崇礼山形意象';source.hidden=true};
  caption.textContent=o.title||'院区影像';photo.alt=o.title||'崇礼院区影像';photo.src=o.src;
  if(validLink(o.source)){source.href=o.source;source.hidden=false}else source.hidden=true;
  Array.from(track.children).forEach((b,n)=>{b.setAttribute('aria-current',String(n===active))});
 }
 function clock(){clearInterval(timer);if(!paused&&visible&&!document.hidden&&slides.length>1)timer=setInterval(()=>showSlide(active+1),6500)}
 if(slides.length){
  if(slides.length>1){slides.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.className='po-pip';b.setAttribute('aria-label','显示第 '+(i+1)+' 张，'+(s.title||'院区影像'));b.onclick=()=>{showSlide(i);clock()};track.appendChild(b)});playback.hidden=false;toggle.onclick=()=>{paused=!paused;controls();clock()};controls()}
  showSlide(0);clock();
 }
 window.addEventListener('cl:view',e=>{const key=e.detail;visible=key==='portal';if(visible||key==='about'){home.hidden=!visible;about.hidden=visible}clock()});
 document.addEventListener('visibilitychange',clock);
})();
