const root=document.getElementById('websiteReceiving'),$=id=>document.getElementById(id),BASE='/api/psychology-website/receiving';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let model=null,busy=false;
const selected=()=>[...root.querySelectorAll('[data-wr-receiver]:checked')].map(n=>n.value);
const ctaDraft=()=>({mention:$('wrMention').value,self:$('wrSelf').value});
function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('ip-error',error);}
async function api(body){const response=await fetch(BASE,{cache:'no-store',...(body?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||'读取失败');return data;}
function preview(){
 const ids=selected(),accounts=new Map(model.accounts.map(a=>[a.connectionId,a]));
 root.querySelectorAll('[data-wr-link-row]').forEach(n=>n.hidden=!ids.includes(n.dataset.wrLinkRow));
 $('wrSelected').textContent='已勾选 '+ids.length+' 个承接账号';
 const old=$('wrPreviewAccount').value,publishers=[...new Set([...(model.publisherIds||[]),...ids])];
 $('wrPreviewAccount').innerHTML='<option value="example">普通发布账号（示例）</option>'+publishers.map(id=>'<option value="'+esc(id)+'">'+esc('@'+(accounts.get(id)?.username||id))+'</option>').join('');
 if(publishers.includes(old))$('wrPreviewAccount').value=old;
 const from=$('wrPreviewAccount').value,to=ids.includes(from)?from:ids.includes(model.routes?.[from])?model.routes[from]:ids[0],receiver=accounts.get(to),self=from===to,copy=ctaDraft();
 const tail=self?copy.self:copy.mention.replace('{account}',receiver?'@'+receiver.username:'@承接账号');
 const base=$('wrOriginalPreview').value.trim(),final=base.endsWith(tail)?base:[base,tail.trim()].filter(Boolean).join('\n\n');
 $('wrFinalPreview').textContent=final;
 message('wrPreviewHint',(receiver?'当前示例引导至 @'+receiver.username+(self?'，使用“承接账号自己发布”文案。':'。'):'请先选择承接账号。')+'共 '+final.length+' / 2200 字。预览使用当前草稿，实际发布使用已保存配置。',final.length>2200);
 const names=id=>accounts.get(id)?.username?'@'+accounts.get(id).username:id;
 $('wrRoutes').innerHTML=(model.publisherIds||[]).map(id=>'<li>'+esc(names(id))+' → '+esc(model.routes?.[id]?names(model.routes[id]):'待配置承接账号')+'</li>').join('')||'<li>在自动运营中保存发布账号后，这里会显示分配关系。</li>';
}
function render(){
 const chosen=new Map(model.config.receivers.map(r=>[r.connectionId,r])),cta=model.config.cta;
 const accounts=model.accounts.filter(a=>a.candidate&&a.canPublish||chosen.has(a.connectionId));
 $('wrContent').innerHTML='<div class="wr-grid"><section class="wr-section"><h3>承接账号</h3><p class="ip-help">选择已挂测试链接的千粉账号。多个账号会均衡承接，每条内容引导至一个账号。</p><div class="ip-tools"><input id="wrSearch" type="search" aria-label="搜索承接账号" placeholder="搜索承接账号"></div><div class="ip-list">'+accounts.map(a=>{const id=esc(a.connectionId),saved=chosen.get(a.connectionId);return '<div class="ip-account" data-wr-search="'+esc((a.username+' '+a.name).toLowerCase())+'"><label><input type="checkbox" data-wr-receiver value="'+id+'" '+(saved?'checked':'')+'><span><b>'+esc('@'+a.username)+'</b> · '+esc(a.followers??'未同步')+' 粉丝'+(!a.canPublish||!a.candidate?' · 当前不可用':'')+'</span></label><label class="ip-link-check" data-wr-link-row="'+id+'" '+(!saved?'hidden':'')+'><input type="checkbox" data-wr-link value="'+id+'" '+(saved?.linkReady?'checked':'')+'>主页已挂测试链接</label></div>';}).join('')+(accounts.length?'':'<p class="ip-help">暂无符合条件的账号，请先授权账号并同步粉丝数据。</p>')+'</div><p class="wr-selected" id="wrSelected"></p><button type="button" id="wrSaveReceivers" class="primary-link">保存承接账号</button><p id="wrReceiversStatus" class="wr-status" role="status"></p><p class="wr-help">保存承接账号不会启动自动发布。</p></section><section class="wr-section"><h3>引导文案</h3><p class="ip-help">图文的原发布文案保留，在末尾空一行追加这里的引导。</p><label class="wr-field">普通发布账号使用<textarea id="wrMention" maxlength="1000" rows="4">'+esc(cta.mention)+'</textarea></label><p class="wr-help">保留一个 {account}，发布时自动替换为分配好的 @承接账号。</p><label class="wr-field">承接账号自己发布时使用<textarea id="wrSelf" maxlength="1000" rows="3">'+esc(cta.self)+'</textarea></label><p class="wr-help">例如引导“点击我的主页链接”，不再 @ 其他账号。</p><div class="wr-form-actions"><button type="button" id="wrSaveCta" class="primary-link">保存引导文案</button><button type="button" id="wrRestoreCta">恢复默认文案</button></div><p id="wrCtaStatus" class="wr-status" role="status"></p></section></div><section class="wr-section wr-preview-section"><h3>最终发布文案预览</h3><p class="wr-preview-label">图文原发布文案 + 引导文案（自动填入 @承接账号）</p><div class="wr-preview-controls"><label class="wr-field">图文原发布文案（仅用于预览）<textarea id="wrOriginalPreview" rows="3">[这里是已导入图文的发布文案]</textarea></label><label class="wr-field">发布账号<select id="wrPreviewAccount"></select><span class="wr-help">选择承接账号自身，可查看“我的主页链接”文案。</span></label></div><div class="ip-preview" id="wrFinalPreview"></div><p id="wrPreviewHint" class="wr-help"></p><details><summary>已保存的发布账号 → 承接账号关系</summary><ul id="wrRoutes" class="wr-routes"></ul></details><p class="wr-help">修改设置只用于之后新建的任务。任务创建后保存完整描述，重复执行不会再追加引导；已有任务继续使用创建时的文案。</p><a href="/psychology-autopilot">前往自动运营设置发布账号与排期 →</a></section>';
 preview();message('wrStatus','');
}
async function load(){if(busy)return;busy=true;$('wrReload').disabled=true;try{model=await api();render();}catch(e){message('wrStatus',e.message,true);}finally{busy=false;$('wrReload').disabled=false;}}
async function save(section){if(busy||!model)return;const target=section==='receivers'?'wrReceiversStatus':'wrCtaStatus';
 const body={revision:model.revision,section,...(section==='cta'?{cta:ctaDraft()}:{receivers:selected().map(connectionId=>({connectionId,linkReady:[...root.querySelectorAll('[data-wr-link]:checked')].some(n=>n.value===connectionId)}))})};
 const controls=[...$('wrContent').querySelectorAll('input,textarea,button,select'),$('wrReload')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);busy=true;message(target,'正在保存…');
 try{model=await api(body);window.dispatchEvent(new CustomEvent('website-receiving-saved'));if(section==='cta'){$('wrMention').value=model.config.cta.mention;$('wrSelf').value=model.config.cta.self;}preview();message(target,section==='cta'?'引导文案已保存，新建任务将使用此文案。':'承接账号已保存，发布账号对应关系已更新。');}
 catch(e){message(target,e.message,true);}finally{busy=false;controls.forEach(([n,disabled])=>n.disabled=disabled);}
}
root.addEventListener('input',e=>{if(e.target.id==='wrSearch'){const q=e.target.value.trim().toLowerCase();root.querySelectorAll('[data-wr-search]').forEach(n=>n.hidden=!n.dataset.wrSearch.includes(q));return;}if(!busy&&model&&$('wrContent').contains(e.target))preview();});
root.addEventListener('change',e=>{if(!busy&&model&&$('wrContent').contains(e.target))preview();});
root.addEventListener('click',e=>{const id=e.target.closest('button')?.id;if(id==='wrReload')load();else if(id==='wrSaveReceivers')save('receivers');else if(id==='wrSaveCta')save('cta');else if(id==='wrRestoreCta'&&!busy){$('wrMention').value=model.ctaDefaults.mention;$('wrSelf').value=model.ctaDefaults.self;preview();message('wrCtaStatus','已恢复默认草稿，点击“保存引导文案”后生效。');}});
window.addEventListener('website-tab',e=>{if(e.detail==='receiving'&&!model)load();});
if(!root.hidden)load();
