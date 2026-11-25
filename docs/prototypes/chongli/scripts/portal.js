(()=>{
 const root=document.getElementById('view-portal'), home=root.querySelector('#po-home'), about=root.querySelector('#po-about'), media=root.querySelector('.po-media'), photo=media.querySelector('.po-image'), art=media.querySelector('.po-landscape'), caption=media.querySelector('.po-caption-title'), source=media.querySelector('.po-source'), track=media.querySelector('.po-page-track'), toggle=media.querySelector('.po-pause'), playback=media.querySelector('.po-playback');
 const loginDialog=document.getElementById('cl-login-dialog');
 const loginButton=document.getElementById('po-login-open');
 const loginForm=document.getElementById('cl-login-form');
 const accountInput=document.getElementById('cl-demo-account');
 const loginError=document.getElementById('cl-login-error');
 const notice=document.getElementById('cl-account-notice');
 const sampleList=document.getElementById('cl-account-samples');
 let noticeTimer;
 function clearError(){
   loginError.hidden=true;
   loginError.textContent='';
   accountInput.removeAttribute('aria-invalid');
 }
 function showLogin(){
   if(loginDialog.open)return;
   loginForm.reset();
   clearError();
   loginDialog.showModal();
   accountInput.focus({preventScroll:true});
 }
 function cancelLogin(){
   CL.cancelLogin();
   loginDialog.close();
   loginButton.focus({preventScroll:true});
 }
 function signIn(id){
   const result=CL.loginAccount(id);
   if(!result.ok){
     loginError.textContent=result.message||'请选择演示账号，或核对输入的编号。';
     loginError.hidden=false;
     accountInput.setAttribute('aria-invalid','true');
     accountInput.focus();
     return;
   }
   loginDialog.close();
   document.getElementById('cl-main').focus({preventScroll:true});
 }
 // Use the same displayed account examples in the interactive and read-only views.
 for(const sample of document.querySelectorAll('#read-accounts [data-sample-account]')){
   const interactiveSample=sample.cloneNode(true);
   interactiveSample.dataset.demoAccount=sample.dataset.sampleAccount;
   interactiveSample.removeAttribute('data-sample-account');
   interactiveSample.removeAttribute('popovertarget');
   sampleList.append(interactiveSample);
 }
 sampleList.addEventListener('click',event=>{
   const sample=event.target.closest('[data-demo-account]');
   if(sample)signIn(sample.dataset.demoAccount);
 });
 loginForm.addEventListener('submit',event=>{event.preventDefault();signIn(accountInput.value);});
 accountInput.addEventListener('input',clearError);
 document.getElementById('cl-login-close').addEventListener('click',cancelLogin);
 loginDialog.addEventListener('cancel',event=>{event.preventDefault();cancelLogin();});
 loginButton.addEventListener('click',()=>{
   const account=CL.currentAccount();
   if(account)CL.go(account.role);
   else CL.requestLogin();
 });
 window.addEventListener('cl:login-request',showLogin);
 window.addEventListener('cl:account-notice',event=>{
   clearTimeout(noticeTimer);
   notice.textContent=event.detail.message;
   noticeTimer=setTimeout(()=>{notice.textContent='';},6500);
 });
 window.addEventListener('cl:view',()=>{
   const account=CL.currentAccount?.();
   loginButton.querySelector('span').textContent=account?'进入我的工作区':'登录平台';
   document.getElementById('po-account-hint').textContent=account?'当前账号 · '+account.id:'支持患者与院内账号';
 });
 // Modified clicks and copied task links keep their destination in a new browser tab.
 for(const link of home.querySelectorAll('.ac-service[data-poroute]')){
   link.hash=link.dataset.poroute;
 }
 root.addEventListener('click',event=>{
   if(event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
   const link=event.target.closest('a[data-poroute]');
   if(link&&window.CL?.go){event.preventDefault();CL.go(link.dataset.poroute);}
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
  // Keep the current photograph in place while the next slide loads.
  if(!photo.naturalWidth){art.hidden=false;photo.hidden=true}
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
