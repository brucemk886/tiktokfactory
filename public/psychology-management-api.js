// Shared, admin-only entry for the four psychology management surfaces.
const pages=new Set(['/psychology-effects','/psychology-ops-report','/psychology-autopilot','/psychology-publish-designs']);
const names={effects:'数据概览',operations:'运营报表',autopilot:'自动运营',styles:'图文样式'};
const base='/api/psychology-management/api-key';
async function api(method='GET',body){const r=await fetch(base,{method,cache:'no-store',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'请求失败');return d;}
async function init(){
 if(!pages.has(location.pathname.replace(/\/$/,'')))return;
 const me=await fetch('/api/auth/me',{cache:'no-store'}).then(r=>r.json());
 if(me.user?.role!=='admin')return;
 const button=document.createElement('button');button.type='button';button.textContent='API 接口';
 const header=document.querySelector('header .page-links,header.official-data-header,header.page-head');if(!header)return;header.append(button);
 const dialog=document.createElement('dialog');dialog.className='management-api-dialog';
 dialog.innerHTML='<header><h2>心理学管理 API</h2><button type="button" data-close>关闭</button></header><p>独立管理密钥，沿用当前管理员的模块和分组权限。统计数据只读；数据概览与运营报表支持新增、修改查询方案。</p><p>自动运营新增后暂停；启用后会创建真实发布排期。图文样式新增默认停用，启用后参与后续随机抽取。</p><p data-state role="status"></p><fieldset><legend>密钥权限</legend><div data-scopes></div></fieldset><div class="management-api-actions"><button type="button" data-create>生成密钥</button><button type="button" data-revoke>撤销密钥</button></div><label data-secret-wrap hidden>新密钥（仅本次显示）<input data-secret type="password" readonly autocomplete="off"><button type="button" data-copy-key>复制密钥</button></label><h3>调用规则与示例</h3><textarea data-guide readonly aria-label="API 调用规则" rows="16"></textarea><button type="button" data-copy-guide>复制给 Grokbot 的调用规则</button>';
 document.body.append(dialog);
 const $=s=>dialog.querySelector(s),state=$('[data-state]');let configured=false,busy=false;
 const notify=message=>{state.textContent=message;};
 async function refresh(){
  const data=await api();configured=data.configured;notify(configured?'已配置密钥：'+data.prefix+'…':'尚未配置管理密钥');$('[data-create]').textContent=configured?'重新生成密钥':'生成密钥';$('[data-revoke]').disabled=!configured;
  $('[data-scopes]').replaceChildren();
  for(const module of data.available){
   const row=document.createElement('div');row.className='management-api-scope';
   const title=document.createElement('strong');title.textContent=names[module];row.append(title);
   for(const verb of ['read','write']){
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=module+':'+verb;check.checked=configured?data.scopes.includes(check.value):verb==='read';
    label.append(check,document.createTextNode(verb==='read'?'读取':(['effects','operations'].includes(module)?'新增 / 修改方案':'新增 / 修改')));row.append(label);
   }$('[data-scopes]').append(row);
  }
 }
 button.onclick=async()=>{dialog.showModal();notify('正在读取…');try{await refresh();const r=await fetch('/psychology-management-api-guide.txt',{cache:'no-store'});if(!r.ok)throw new Error('调用说明读取失败');$('[data-guide]').value=(await r.text()).replaceAll('https://factory.tiktokaitool.com',location.origin);}catch(e){notify(e.message);}};
 $('[data-close]').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{$('[data-secret]').value='';$('[data-secret-wrap]').hidden=true;});
 async function mutate(fn){if(busy)return;busy=true;$('[data-create]').disabled=true;$('[data-revoke]').disabled=true;try{await fn();}catch(e){notify(e.message);}finally{busy=false;$('[data-create]').disabled=false;$('[data-revoke]').disabled=!configured;}}
 $('[data-create]').onclick=()=>{if(configured&&!confirm('重新生成会使旧管理密钥立即失效，继续吗？'))return;mutate(async()=>{const scopes=[...dialog.querySelectorAll('[data-scopes] input:checked')].map(i=>i.value);const data=await api('POST',{scopes});await refresh();if(!dialog.open)return;$('[data-secret]').value=data.apiKey;$('[data-secret-wrap]').hidden=false;notify('新密钥已生成，请现在复制保存。');});};
 $('[data-revoke]').onclick=()=>{if(!confirm('撤销后，使用此管理密钥的外部调用将立即失效，继续吗？'))return;mutate(async()=>{await api('DELETE');$('[data-secret]').value='';$('[data-secret-wrap]').hidden=true;await refresh();});};
 for(const [action,target] of [['key','secret'],['guide','guide']])$('[data-copy-'+action+']').onclick=async()=>{try{await navigator.clipboard.writeText($('[data-'+target+']').value);notify('已复制。');}catch{notify('复制失败，请选中文字手动复制。');}};
}
init().catch(()=>{});
