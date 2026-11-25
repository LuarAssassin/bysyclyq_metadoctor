(()=>{
 const root=document.getElementById('view-portal');
 const home=root.querySelector('#po-home');
 const about=root.querySelector('#po-about');
 const media=home.querySelector('.po-media');
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
 const choices=Array.from(media.querySelectorAll('input[name="po-gallery"]'));
 const toggle=media.querySelector('.po-pause');
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 let paused=motion.matches;
 let hovered=false;
 let hasFocus=false;
 let visible=true;
 let timer;

 function refreshTimer(){
   window.clearInterval(timer);
   if(paused||hovered||hasFocus||!visible||document.hidden||loginDialog.open)return;
   timer=window.setInterval(()=>{
     const selected=choices.findIndex(choice=>choice.checked);
     choices[(selected+1)%choices.length].checked=true;
   },6500);
 }
 function setPaused(value){
   paused=value;
   const label=paused?'播放轮播':'暂停轮播';
   toggle.setAttribute('aria-label',label);
   toggle.title=label;
   const path=paused?'M4 2.5 13 8l-9 5.5z':'M4 3h2.5v10H4zm5.5 0H12v10H9.5z';
   toggle.querySelector('path').setAttribute('d',path);
   refreshTimer();
 }
 if(CSS.supports('selector(:has(*))')&&choices.length>1){
   toggle.hidden=false;
   setPaused(paused);
   for(const choice of choices)choice.addEventListener('change',()=>setPaused(true));
   toggle.addEventListener('click',()=>{
     // A keyboard user can explicitly start playback while focus stays on the button.
     hasFocus=false;
     setPaused(!paused);
   });
   media.addEventListener('pointerenter',event=>{
     if(event.pointerType==='touch')return;
     hovered=true;refreshTimer();
   });
   media.addEventListener('pointerleave',()=>{hovered=false;refreshTimer()});
   media.addEventListener('focusin',()=>{hasFocus=true;refreshTimer()});
   media.addEventListener('focusout',event=>{
     hasFocus=media.contains(event.relatedTarget);refreshTimer();
   });
   motion.addEventListener('change',event=>{if(event.matches)setPaused(true)});
   loginDialog.addEventListener('close',refreshTimer);
   window.addEventListener('cl:login-request',refreshTimer);
   document.addEventListener('visibilitychange',refreshTimer);
 }
 window.addEventListener('cl:view',event=>{
   const key=event.detail;
   visible=key==='portal';
   if(visible||key==='about'){home.hidden=!visible;about.hidden=visible}
   if(!toggle.hidden)refreshTimer();
 });
})();
