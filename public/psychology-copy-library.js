const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let copyPage=1,originalPage=1,originalItems=[],requestVersion=0;
async function api(path,method='GET',body){const r=await fetch('/api/psychology-creative'+path,{method,cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'请求失败');return d;}
const typeLabel=t=>t==='video'?'视频':'图文';
function exportRow(r){const c=r.content||{};return {sourceKey:r.sourceKey,mediaType:r.media_type,title:c.title||r.title,caption:c.caption||'',pages:(c.pages||[]).map(p=>p.text),transcript:c.transcript||'',onScreenText:c.onScreenText||[],sourceUrl:r.source_url};}
function fullText(r){const c=r.content||{};return ['标题：'+(c.title||r.title),'发布文案：'+(c.caption||'（无）'),r.media_type==='photo'?(c.pages||[]).map(p=>'第'+p.index+'张\n'+(p.text||'（无可识别文字）')).join('\n\n'):'口播：\n'+(c.transcript||'（无可识别口播）')+'\n\n画面文字：\n'+((c.onScreenText||[]).join('\n')||'（无可识别文字）'),c.notes?'识别说明：'+c.notes:''].filter(Boolean).join('\n\n');}
async function loadOriginals(){
 const version=++requestVersion;$('#originalMessage').textContent='正在读取…';
 try{
  const params=new URLSearchParams({page:originalPage,mediaType:$('#originalMedia').value,q:$('#originalQuery').value});
  const r=await fetch('/api/psychology-copy-library?'+params,{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error||'读取失败');if(version!==requestVersion)return;
  originalPage=d.page;originalItems=d.items;
  const counts={video:0,photo:0};for(const row of d.counts)counts[row.media_type]+=row.n;
  $('#originalSummary').textContent=`已提取视频 ${counts.video} 篇 · 图文 ${counts.photo} 篇`;
  $('#originalList').innerHTML=d.items.map(r=>`<article class="copy-record"><div class="copy-record-head"><span class="copy-kind">${typeLabel(r.media_type)}</span><strong>${esc(r.title||'未命名内容')}</strong></div><p><a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">打开原帖</a></p><details><summary>查看完整文案</summary><pre>${esc(fullText(r))}</pre><button type="button" data-copy="${r.id}">复制全文</button></details></article>`).join('')||'<p>暂无已提取的同行原文。后续新导入的同行爆款提取完成后会自动显示在这里。</p>';
  $('#originalPage').textContent=`共 ${d.total} 篇 · 第 ${d.page} / ${d.pages} 页 · 每页20篇`;$('#originalPrev').disabled=d.page<=1;$('#originalNext').disabled=d.page>=d.pages;$('#originalMessage').textContent='';
 }catch(e){if(version===requestVersion)$('#originalMessage').textContent=e.message;}
}
$('#originalSearchForm').onsubmit=e=>{e.preventDefault();originalPage=1;loadOriginals();};
$('#originalMedia').onchange=()=>{originalPage=1;loadOriginals();};
$('#originalRefresh').onclick=loadOriginals;$('#originalPrev').onclick=()=>{originalPage--;loadOriginals();};$('#originalNext').onclick=()=>{originalPage++;loadOriginals();};
$('#exportOriginalPage').onclick=()=>download('psychology-originals-'+originalPage+'.json',originalItems.filter(r=>r.status==='done').map(exportRow));
$('#originalList').onclick=async e=>{const b=e.target.closest('button');if(!b)return;b.disabled=true;try{
 if(b.dataset.copy){await navigator.clipboard.writeText(fullText(originalItems.find(r=>r.id===b.dataset.copy)));$('#originalMessage').textContent='已复制完整文案。';}
 }catch(error){$('#originalMessage').textContent=error.message;}finally{b.disabled=false;}};
function tab(reviewed){$('#originals').hidden=reviewed;$('#copies').hidden=!reviewed;$('#originalTab').setAttribute('aria-pressed',String(!reviewed));$('#reviewedTab').setAttribute('aria-pressed',String(reviewed));}
$('#originalTab').onclick=()=>tab(false);$('#reviewedTab').onclick=()=>tab(true);tab(location.hash==='#copies');
loadOriginals();
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#downloadExample').onclick=()=>download('grok-photo-copy-example.json',[{externalId:'attachment-001-v1',sourceKey:'attachment-001',title:'When closeness feels overwhelming',caption:'A reflection on asking for space and staying connected.',pages:['When closeness feels overwhelming','You can need space and still care about someone.','Try saying: I need a quiet evening. Can we talk tomorrow?']}]);
$('#copyFile').onchange=async()=>{const f=$('#copyFile').files[0];if(f){if(f.size>1500000){$('#copyStatus').textContent='文件超过1.5MB，请拆分导入。';return;}$('#copyJson').value=await f.text();}};
$('#importForm').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{const d=await api('/copies','POST',JSON.parse($('#copyJson').value));$('#copyStatus').textContent=`已导入${d.created}篇，跳过${d.duplicates}篇重复编号。`;copyPage=1;await loadCopies();}catch(e){$('#copyStatus').textContent=e.message;}finally{e.submitter.disabled=false;}};
async function loadCopies(){const d=await api('/copies?'+new URLSearchParams({page:copyPage,q:$('#copySearch').value}));$('#copyList').innerHTML=d.items.map(r=>`<details><summary>${esc(r.title)} · ${r.enabled?'已启用':'已停用'} · ${r.pages.length}页</summary><p>来源：${esc(r.source_key)} · 版本：${esc(r.external_id)}</p><pre>发布文案：${esc(r.caption)}

${r.pages.map((p,i)=>'第'+(i+1)+'页：'+esc(p)).join('\n\n')}</pre><button type="button" data-id="${r.id}" data-enabled="${r.enabled?'0':'1'}">${r.enabled?'停用':'启用'}</button></details>`).join('')||'<p>尚无文案。先下载示例，再导入已审核的 Grokbot 改写结果。</p>';$('#copyPage').textContent=`共${d.total}篇 · 第${copyPage}页`;$('#copyPrev').disabled=copyPage===1;$('#copyNext').disabled=copyPage*20>=d.total;}
$('#copyList').onclick=async e=>{const b=e.target.closest('[data-id]');if(!b)return;b.disabled=true;try{await api('/copies/'+b.dataset.id,'PATCH',{enabled:b.dataset.enabled==='1'});await loadCopies();}catch(e){$('#copyStatus').textContent=e.message;b.disabled=false;}};
$('#copySearchForm').onsubmit=e=>{e.preventDefault();copyPage=1;loadCopies().catch(e=>$('#copyStatus').textContent=e.message);};$('#copyPrev').onclick=()=>{copyPage--;loadCopies();};$('#copyNext').onclick=()=>{copyPage++;loadCopies();};
loadCopies().catch(e=>$('#copyStatus').textContent=e.message);
