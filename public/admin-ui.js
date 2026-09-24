/* Shared shell enhancement: no business requests or permission changes. */
(() => {
  const icon=name=>Object.assign(document.createElement('img'),{src:'/vendor/bootstrap-icons/'+name+'.svg',alt:'',className:'lf-icon'});
  function init(){
    const nav=document.querySelector('.side-tabs,.tasks-sidebar');
    if(!nav||document.querySelector('.lf-console-bar'))return;
    document.body.classList.add('lf-console');
    const title=document.querySelector('main h1')?.textContent?.trim()||document.title.split('·')[0].trim();
    const group=document.querySelector('.sidebar-group.is-open .sidebar-group-toggle span')?.textContent||'工作台';
    const bar=document.createElement('header');bar.className='lf-console-bar';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='lf-nav-toggle';toggle.append(icon('list'));toggle.setAttribute('aria-label','展开或收起导航');nav.id=nav.id||'lf-sidebar';toggle.setAttribute('aria-controls',nav.id);
    const crumb=document.createElement('nav');crumb.className='lf-breadcrumb';crumb.setAttribute('aria-label','当前位置');const parent=document.createElement('span');parent.textContent=group;const sep=document.createElement('span');sep.textContent='/';sep.setAttribute('aria-hidden','true');const current=document.createElement('strong');current.textContent=title;crumb.append(parent,sep,current);
    const date=document.createElement('time');date.className='lf-console-date';date.textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
    const avatar=document.createElement('span');avatar.className='lf-top-user';const username=document.querySelector('.sidebar-user b')?.textContent||'';avatar.textContent=username.slice(0,1).toUpperCase();avatar.title=username;
    bar.append(toggle,crumb,date,avatar);document.body.prepend(bar);
    const backdrop=document.createElement('button');backdrop.type='button';backdrop.className='lf-mobile-backdrop';backdrop.setAttribute('aria-label','关闭导航');document.body.append(backdrop);
    const mobile=matchMedia('(max-width:760px)');
    function sync(){const shown=mobile.matches?document.body.classList.contains('lf-nav-open'):!document.body.classList.contains('lf-nav-hidden');toggle.setAttribute('aria-expanded',String(shown));nav.inert=!shown;document.querySelector('main')?.toggleAttribute('inert',mobile.matches&&shown);}
    toggle.addEventListener('click',()=>{document.body.classList.toggle(mobile.matches?'lf-nav-open':'lf-nav-hidden');sync();if(mobile.matches&&document.body.classList.contains('lf-nav-open'))nav.querySelector('a,button')?.focus();});
    function closeNav(){document.body.classList.remove('lf-nav-open');sync();toggle.focus();}
    backdrop.addEventListener('click',closeNav);document.addEventListener('keydown',event=>{if(!mobile.matches||!document.body.classList.contains('lf-nav-open'))return;if(event.key==='Escape')closeNav();if(event.key==='Tab'){const nodes=[...Array.from(nav.querySelectorAll('a,button')).filter(n=>n.getClientRects().length),backdrop];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}};});mobile.addEventListener('change',()=>{document.body.classList.remove('lf-nav-open');sync();});sync();
    const groups={psychology:'heart-pulse',novel:'book','mid-video':'collection-play',official:'shield-check'};
    document.querySelectorAll('.sidebar-group-toggle').forEach(button=>{const id=button.parentElement.dataset.sidebarGroup||'';const name=Object.entries(groups).find(([key])=>id.includes(key))?.[1]||'collection-play';button.prepend(icon(name));});
    document.querySelectorAll('.side-tabs>a:not(.app-brand),.tasks-nav>a').forEach(link=>{link.prepend(icon(link.getAttribute('href')==='/'?'house-door':link.getAttribute('href')==='/accounts'?'people':'journal-text'));});
  }
  const host=document.createElement('div');host.className='lf-toasts';host.setAttribute('aria-live','polite');host.setAttribute('aria-atomic','false');document.body.append(host);
  function toast(text,error=false){if(Array.from(host.children).some(n=>n.firstChild?.textContent===text))return;const box=document.createElement('div');box.className='lf-toast'+(error?' is-error':'');box.setAttribute('role',error?'alert':'status');const content=document.createElement('span');content.textContent=text;const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','关闭通知');close.append(icon('x-lg'));close.onclick=()=>box.remove();box.append(content,close);host.append(box);while(host.children.length>3)host.firstChild.remove();if(!error)setTimeout(()=>box.remove(),6500);}
  globalThis.LFUI={...(globalThis.LFUI||{}),toast};
  if(document.documentElement.dataset.sidebarReady)init();else window.addEventListener('lf:sidebar-ready',init,{once:true});
})();
