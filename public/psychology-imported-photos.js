const root=document.querySelector('#importedPhotoMode'),$=id=>document.getElementById(id),BASE='/api/psychology-autopilot/imported-photos';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
let data=null,dirty=false,busy=false;
async function api(body){const r=await fetch(BASE,{cache:'no-store',...(body?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'读取失败');return d;}
function message(text,error=false){$('ipMessage').textContent=text;$('ipMessage').classList.toggle('ip-error',error);}
function checked(kind){return [...root.querySelectorAll('[data-'+kind+']:checked')].map(n=>n.value);}
function summary(){
 const publishers=checked('publisher'),receivers=data.config.receivers.map(r=>r.connectionId);$('ipSelectedSummary').textContent='已选 '+publishers.length+' 个发布账号 · 每日目标 '+publishers.length*3+' 条 · '+receivers.length+' 个承接账号';
 const r=data.config.receivers[0];$('ipCaptionPreview').textContent='已导入图文的发布文案\n\n'+(data.config.cta?.mention||'').replace('{account}',r?'@'+r.username:'@承接账号');
}
function render(){
 const config=data.config,publishers=new Set(config.connectionIds);
 const choices=()=>data.accounts.map(a=>{const selected=publishers.has(a.connectionId),available=a.canPublish,id=esc(a.connectionId);return '<div class="ip-account" data-search="'+esc((a.username+' '+a.name).toLowerCase())+'"><label><input type="checkbox" data-publisher value="'+id+'" '+(selected?'checked ':'')+(!available&&!selected?'disabled ':'')+'><span><b>'+esc(a.username?'@'+a.username:a.name)+'</b>'+(available?'':' · 当前不可用')+'</span></label><small>'+esc(a.name)+'</small></div>';}).join('')||'<p class="ip-help">当前权限范围内没有账号，请先授权并分配到心理学项目。</p>';
 const names=new Map(data.accounts.map(a=>[a.connectionId,a.username?'@'+a.username:a.name]));
 const state=r=>r.publishState==='published'?'已发布':r.jobStatus==='failed'?'发布失败':r.jobStatus==='cancelled'?'已取消':r.jobStatus==='running'?'处理中':'已排期 / 等待发布';
 $('ipContent').innerHTML='<div class="ip-stats"><div class="ip-stat">运营状态<strong>'+(data.enabled?'已启用':'未启用')+'</strong></div><div class="ip-stat">已启用图文候选<strong>'+data.inventory+' 条</strong></div><div class="ip-stat">每号每天 · 北京时间<strong>3 条</strong></div></div><div class="ip-next"><span>22:30</span><span>01:30（凌晨）</span><span>03:30（凌晨）</span></div><p class="ip-help">最近未来时段：'+data.nextSlots.map(time).join(' / ')+'（中国时间 UTC+8）。提前 60 分钟准备，距离发布不足 10 分钟不新增。错过时段不补发。</p><div class="ip-columns"><div class="ip-column"><h3>① 选择发布账号</h3><p class="ip-help">内容优先分给近 7 天安排较少的账号。</p><div class="ip-tools"><input type="search" data-filter="publishers" aria-label="搜索发布账号" placeholder="搜索发布账号"><button type="button" id="ipSelectAll">全选</button><button type="button" id="ipClearAll">清空</button></div><div id="ipPublishers" class="ip-list">'+choices()+'</div></div><div class="ip-column"><h3>独立站承接</h3><p class="ip-help">承接账号和引导文案在独立站转化中单独保存。创建任务时，将已导入图文文案与对应账号的测试引导拼接。</p><p>'+data.config.receivers.map(r=>esc('@'+r.username)).join('、')+'</p><a class="primary-link" href="/psychology-website?tab=receiving">设置承接账号与引导文案 →</a></div></div><p id="ipSelectedSummary" class="ip-mode-summary"></p><h3>发布文案 = 已导入图文文案 + 承接引导</h3><div id="ipCaptionPreview" class="ip-preview"></div><p class="ip-help">多个承接账号均衡分配，每条只 @ 一个账号；承接账号自己发布时使用 “link in my bio”。原图片与文案保留，任务中保存最终描述。</p><label><input type="checkbox" id="ipAi" '+(config.isAiGenerated?'checked':'')+'>图文包含 AI 生成内容</label><div class="ip-actions"><button type="button" id="ipSave">'+(data.enabled?'保存修改':'保存配置')+'</button><button type="button" class="primary-link" id="ipEnable" '+(data.enabled?'hidden':'')+'>保存并启用</button><button type="button" id="ipPause" '+(!data.enabled?'hidden':'')+'>暂停新增排期</button><a href="/psychology-video-hits?inputMode=frames">管理图文素材 ↗</a><a href="/psychology-publish">查看发布任务 ↗</a></div><p class="ip-help">只抽取已启用、未发布的完整 1–15 张图文，不合成视频。每个二创只发布一次；同一账号 14 天内不重复原选题。素材不足时等待补充，发布确认满 24 小时后清理二创，保留原选题。</p><details><summary>最近 30 条排期</summary><div class="ip-recent-wrap"><table class="ip-recent"><thead><tr><th>北京时间</th><th>发布账号 → 承接账号</th><th>图文</th><th>状态</th></tr></thead><tbody>'+data.recent.map(r=>'<tr><td>'+time(r.slotAt)+'</td><td>'+esc(names.get(r.connectionId)||r.connectionId)+' → '+esc(names.get(r.receiverId)||r.receiverId)+'</td><td><a href="/psychology-video-hits/detail?id='+encodeURIComponent(r.sourceId)+'&version='+r.version+'">'+esc(r.title||'二创版本 '+r.version)+'</a></td><td title="'+esc(r.error)+'">'+state(r)+'</td></tr>').join('')+'</tbody></table></div></details>';
 summary();message(data.detail+(data.checkedAt?' · 上次检查 '+time(data.checkedAt):''));
}
async function load(){if(busy)return;busy=true;$('ipReload').disabled=true;try{data=await api();dirty=false;render();}catch(e){message(e.message,true);}finally{busy=false;$('ipReload').disabled=false;}}
async function save(mode){if(busy||!data)return;busy=true;const inputs=[...root.querySelectorAll('input')].map(n=>[n,n.disabled]);inputs.forEach(([n])=>n.disabled=true);root.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{let body={revision:data.revision,enabled:mode==='enable'||mode==='save'&&data.enabled};
  if(mode==='pause')body.pauseOnly=true;
  else body={...body,section:'publishing',connectionIds:checked('publisher'),isAiGenerated:$('ipAi').checked};
  message('正在保存…');const result=await api(body);dirty=false;
  if(mode==='pause'){data={...data,enabled:false,revision:result.revision,detail:'已暂停新增排期；已创建任务继续。'};}else data=result;
  render();
 }catch(e){message(e.message,true);}finally{busy=false;inputs.forEach(([n,disabled])=>n.disabled=disabled);root.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
root.addEventListener('change',e=>{if(busy)return;dirty=true;summary();});
root.addEventListener('input',e=>{const filter=e.target.dataset.filter;if(!filter)return;const list=$('ipPublishers'),q=e.target.value.trim().toLowerCase();list.querySelectorAll('[data-search]').forEach(row=>row.hidden=!row.dataset.search.includes(q));});
root.addEventListener('click',e=>{const id=e.target.closest('button')?.id;if(id==='ipReload')load();else if(id==='ipSave')save('save');else if(id==='ipEnable')save('enable');else if(id==='ipPause')save('pause');else if(['ipSelectAll','ipClearAll'].includes(id)&&!busy){root.querySelectorAll('[data-publisher]').forEach(n=>{if(!n.disabled&&!n.closest('[data-search]').hidden)n.checked=id==='ipSelectAll';});dirty=true;summary();}});
setInterval(()=>{if(!dirty&&!busy&&!document.hidden)load();},60000);
load();
