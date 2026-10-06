const mount=typeof document==='undefined'?null:document.getElementById('conversionCampaign');
const endpoint='/api/psychology-autopilot/conversion';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let model=null,busy=false;
const time=(value,zone)=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:zone||'America/Los_Angeles',dateStyle:'medium',timeStyle:'short'}).format(value):'待保存';
async function api(method='GET',body){
 const response=await fetch(endpoint,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'无法读取转化设置。');return data;
}
function draw(){
 const config=model.config,selected=new Map((config?.receivers||[]).map(a=>[a.connectionId,a]));
 const candidates=model.accounts.filter(a=>a.candidate&&a.canPublish||selected.has(a.connectionId)),ready=selected.size>0;
 const pending=Boolean(config?.effectiveAt>Date.now()),headline=config?.enabled?(pending?'转化目标已配置 · 等待生效':ready?'转化目标已开启':'转化目标已开启 · 等待配置承接账号'):'运营目标：独立站测试转化';
 mount.innerHTML=`<div class="conversion-card"><div class="conversion-heading"><div><h2>${esc(headline)}</h2><p>普通账号 → 千粉承接账号 → 主页链接 → 独立站测试</p></div><span class="conversion-badge">${selected.size} 个承接账号</span></div>
 <p class="conversion-site">测试独立站：<a href="${esc(model.websiteUrl)}" target="_blank" rel="noopener noreferrer">${esc(model.websiteUrl)}</a></p>
 <p class="conversion-state">${model.active?.enabled?'当前目标：独立站测试转化。':'当前排期继续原配置。'} ${config?.enabled&&!ready?'目标已设为转化，待绑定并确认主页测试链接的承接账号。生效后的新转化内容会等待配置完成。':config?.enabled?'生效后的新图文在末页和发布文案加入测试引导。':'保存转化目标后，按账号流量查看结果，后续内容以进站测试为目标。'}
 ${config?'配置从 '+esc(time(config.effectiveAt,config.timeZone))+'（美西时间）生效，已创建排期继续原配置。':''}</p>
 <details class="conversion-settings"><summary>配置承接账号与查看引导文案</summary>
 <form id="conversionForm"><label class="conversion-toggle"><input name="enabled" type="checkbox" ${config?.enabled!==false?'checked':''}>以独立站测试转化为目标</label>
 <label class="conversion-url">独立站地址<input name="websiteUrl" type="url" required value="${esc(model.websiteUrl)}"></label>
 <p>已同步的千粉账号：${model.summary.eligibleReceivers} 个。新绑定的千粉账号同步后会出现在这里。选中后请逐一确认已设置主页测试链接。</p>
 <div class="conversion-receivers">${candidates.length?candidates.map(a=>`<div class="conversion-receiver"><label><input type="checkbox" data-select="${esc(a.connectionId)}" ${selected.has(a.connectionId)?'checked':''} ${!a.candidate||!a.canPublish?'disabled':''}> <strong>@${esc(a.username||a.name)}</strong><span>${a.followers===null?'粉丝待同步':a.followers.toLocaleString()+' 粉丝'} · ${esc(a.groupName)}</span></label><label class="conversion-link-confirm"><input type="checkbox" data-link="${esc(a.connectionId)}" ${selected.get(a.connectionId)?.linkReady?'checked':''}>主页测试链接已设置</label></div>`).join(''):'<p class="conversion-empty">暂未找到可选的千粉账号。先绑定账号并同步粉丝数据，再确认主页测试链接。</p>'}</div>
 <div class="conversion-cta"><p><b>普通账号末尾</b><br>${esc(model.templates.ordinary)}</p><p><b>承接账号末尾</b><br>${esc(model.templates.receiver)}</p></div>
 ${config&&ready?'<div class="conversion-route-summary">'+[...selected.values()].map(a=>'<span>@'+esc(a.username)+' · '+Object.values(config.routes).filter(id=>id===a.connectionId).length+' 个账号引导</span>').join('')+'</div>':''}
 <p class="conversion-note">普通账号均匀分配承接账号，已有引导关系继续保留；承接账号引导自己的主页链接。网站访问与测试完成目前尚未接入。</p>
 <button type="submit" class="conversion-save">保存转化设置</button><p id="conversionStatus" role="status" aria-live="polite"></p></form></details></div>`;
 mount.querySelector('#conversionForm').addEventListener('submit',save);
}
async function save(event){
 event.preventDefault();if(busy)return;
 const form=event.currentTarget,status=mount.querySelector('#conversionStatus'),button=form.querySelector('button[type=submit]'),receivers=[];
 for(const input of form.querySelectorAll('[data-select]')){if(!input.checked||input.disabled)continue;const id=input.dataset.select,link=[...form.querySelectorAll('[data-link]')].find(a=>a.dataset.link===id);if(!link?.checked){status.textContent='请确认每个承接账号已设置主页测试链接。';return;}receivers.push({connectionId:id,linkReady:true});}
 busy=true;button.disabled=true;status.textContent='正在保存…';
 try{model=await api('PATCH',{revision:model.revision,enabled:form.elements.enabled.checked,websiteUrl:form.elements.websiteUrl.value,receivers});draw();mount.querySelector('details').open=true;mount.querySelector('#conversionStatus').textContent='已保存。生效时间：'+time(model.config.effectiveAt,model.config.timeZone)+'（美西时间）。';}
 catch(error){status.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.className='conversion-reload';retry.textContent='重新读取配置';retry.addEventListener('click',()=>{if(!busy)load();});status.append(' ',retry);}finally{busy=false;button.disabled=false;}
}
async function load(){try{model=await api();draw();}catch(error){mount.innerHTML='<div class="conversion-card"><h2>独立站测试转化</h2><p role="status">'+esc(error.message)+'</p><button type="button" id="conversionReload">重新读取</button></div>';mount.querySelector('button').addEventListener('click',load);}}
if(mount)load();
