const $ = selector => document.querySelector(selector);
const integrated = document.body.classList.contains("copy-library-page");
const API = "/api/psychology-peer-hits";
const state = { page: 1, totalPages: 1, keyConfigured: false, loading: false, mediaType: "video" };
let controller, searchTimer;
const time = value => value ? new Date(value).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai",hour12:false}) : "—";
const metric = value => value == null ? "—" : Number(value).toLocaleString("zh-CN");
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const text = value => typeof value === "string" && value.trim() ? value.trim() : "";
const titleOf = item => text(item.title) || text(item.videoData?.标题) || "—";
const copyOf = item => text(item.videoData?.文案) || text(item.videoData?.caption) || text(item.videoData?.copy) || "—";
const message = (id, text, error=false) => { $(id).textContent=text; $(id).classList.toggle("is-error",error); };
const headerPanels = [...document.querySelectorAll(".hits-header-panel")];
headerPanels.forEach(panel=>panel.addEventListener("toggle",()=>{
  if(panel.open)headerPanels.forEach(other=>{if(other!==panel)other.open=false;});
}));
document.addEventListener("click",event=>{if(!event.target.closest(".hits-header-panel"))headerPanels.forEach(panel=>{panel.open=false;});});
document.addEventListener("keydown",event=>{if(event.key==="Escape")headerPanels.forEach(panel=>{panel.open=false;});});
async function api(url, options={}) {
  const res = await fetch(url, {cache:"no-store",...options}); const data=await res.json();
  if(!res.ok) throw new Error(data.error || "请求失败，请稍后重试。"); return data;
}
function pager() { $("#previousBtn").disabled=state.loading||state.page<=1; $("#nextBtn").disabled=state.loading||state.page>=state.totalPages; }

function libraryRow(item){
 const row=item.library,content=row.content||{},done=row.status==='done',manage=document.body.dataset.sourceAccess==='true',hasPeer=!!row.peer;
 const status=done?'已提取':!row.auto_extract?'历史待补全':({queued:'等待提取',running:'提取中',failed:'提取失败'}[row.status]||'未提取');
 const title=content.title||titleOf(item);
 const cell=(v,cls='')=>'<td class="'+cls+'" title="'+escape(v)+'"><span>'+escape(v)+'</span></td>';
 return '<tr>'+cell('','library-select').replace('<span></span>',manage?'<input type="checkbox" data-can-produce="'+hasPeer+'" class="peer-select" data-peer-id="'+escape(item.id)+'" aria-label="选择 '+escape(title)+'" />':'—')+
 '<td class="hits-title" title="'+escape(title)+'"><span>'+escape(title)+'</span><small>'+escape(item.accountUsername||item.accountName||'—')+(item.rising?' · 还在涨':'')+'</small><small>'+escape((item.topics||[]).map(id=>({anxious:'焦虑型依恋',avoidant:'回避型依恋',breakup:'分手',situationship:'暧昧',boundaries:'边界感','self-worth':'自我价值'}[id]||id)).join('、')||'未打题材')+'</small><small class="library-copy-id">文案 ID：<code>'+escape(row.id)+'</code></small></td>'+
 '<td class="library-metrics"><strong>'+metric(item.playCount)+' 播放</strong><small>赞 '+metric(item.likeCount)+' · 评 '+metric(item.commentCount)+'</small><small>藏 '+metric(item.favoriteCount)+' · 分享 '+metric(item.shareCount)+'</small></td>'+
 '<td class="hits-time">'+time(item.publishedAt)+'<small>导入 '+time(item.createdAt)+'</small></td>'+
 '<td class="library-status"><span class="copy-status'+(done?'':' is-off')+'" title="'+escape(row.error||status)+'">'+status+'</span>'+(row.error?'<details><summary>原因</summary><p>'+escape(row.error)+'</p></details>':'')+(!done&&row.auto_extract&&row.status==='failed'?'<button type="button" data-retry-copy="'+escape(row.id)+'">重试提取</button>':'')+'</td>'+
 '<td>'+Number(row.variantCount||0)+' 个版本<small>启用 '+Number(row.enabledVariantCount||0)+' 个</small></td>'+
 '<td class="hits-voice">'+(manage&&hasPeer?'<select class="voice-gender-select" data-id="'+escape(item.id)+'" data-current="'+escape(item.voiceGender||'male')+'" aria-label="音色性别"><option value="male"'+(item.voiceGender!=='female'?' selected':'')+'>男</option><option value="female"'+(item.voiceGender==='female'?' selected':'')+'>女</option></select>':'—')+'</td>'+
 '<td class="hits-video"><a href="'+escape(item.videoUrl)+'" target="_blank" rel="noopener noreferrer">打开原帖</a></td>'+
 '<td class="library-actions">'+(done?'<button type="button" data-view-original="'+escape(item.id)+'">查看文案</button><button type="button" data-create-variant="'+escape(item.id)+'">新增改写</button><button type="button" data-rewrite-original="'+escape(item.id)+'">改写详情</button>':'')+(manage?'<button type="button" class="hits-delete" data-id="'+escape(item.id)+'">删除文案</button>':'')+'</td></tr>';
}

async function loadList() {
  controller?.abort(); const current=new AbortController();controller=current;state.loading=true;pager();message("#listStatus","正在读取…");
  try {
    const query=new URLSearchParams({page:String(state.page),query:$("#query").value.trim(),sort:$("#sort").value,mediaType:state.mediaType});
    if(integrated){query.set('q',$('#query').value.trim());query.set('status',$('#libraryStatus').value);}
    let data=await api((integrated?'/api/psychology-copy-library':API)+"?"+query,{signal:current.signal});
    if(current.signal.aborted)return;
    if(integrated){
      const canManage=data.canManageSources===true;document.body.dataset.sourceAccess=String(canManage);
      for(const id of ['apiPanel','manualPanel','moveSelectedBtn','clearSelectionBtn','selectPageBtn','selectPageCheckbox','deleteSelectedBtn','selectionCount','productionStatus','productionPanel'])if($('#'+id))$('#'+id).hidden=!canManage;
      if(canManage&&!state.keyLoaded){state.keyLoaded=true;loadKey();}
      document.dispatchEvent(new CustomEvent('library-source-access',{detail:{canManage}}));
      const rows=data.items;data={...data,totalPages:data.pages,pageSize:20,items:rows.map(row=>({...row.peer,id:row.id,mediaType:row.media_type,title:row.title,videoUrl:row.source_url,createdAt:row.created_at,library:row}))};
    }
    state.page=data.page;state.totalPages=data.totalPages;
    $("#hitRows").innerHTML=data.items.length?data.items.map(item=>integrated?libraryRow(item):`<tr>
      <td><input type="checkbox" class="peer-select" data-peer-id="${escape(item.id)}" aria-label="选择 ${escape(titleOf(item))}" /></td>
      <td>${metric(item.playCount)}</td><td>${metric(item.likeCount)}</td><td>${metric(item.commentCount)}</td><td>${metric(item.favoriteCount)}</td><td>${metric(item.shareCount)}</td><td>${item.durationSeconds==null?"—":metric(item.durationSeconds)+" 秒"}</td>
      <td class="hits-time">${time(item.publishedAt)}</td>
      <td class="hits-time">${time(item.createdAt)}</td>
      <td class="hits-title" title="${escape(titleOf(item))}"><span>${escape(titleOf(item))}</span></td>
      <td class="hits-copy" title="${escape(copyOf(item))}"><span>${escape(copyOf(item))}</span></td>
      <td class="hits-voice"><select class="voice-gender-select" data-id="${escape(item.id)}" data-current="${escape(item.voiceGender || "male")}" aria-label="修改 ${escape(titleOf(item))} 的音色性别"><option value="male"${item.voiceGender !== "female" ? " selected" : ""}>男</option><option value="female"${item.voiceGender === "female" ? " selected" : ""}>女</option></select></td>
      <td class="hits-video"><a href="${escape(item.videoUrl)}" target="_blank" rel="noopener noreferrer">${item.coverUrl?`<img alt="" src="${escape(item.coverUrl)}" />`:`打开${item.mediaType === "photo" ? "图文" : "视频"}`}</a></td>
      <td class="hits-actions-cell"><button class="hits-delete" type="button" data-id="${escape(item.id)}">删除</button></td>
    </tr>`).join(""):'<tr><td colspan="'+(integrated?9:14)+'">'+(integrated?'当前分类没有符合条件的文案，可切换图文/视频或展示范围。':'暂无记录，可手动添加或通过 grokbot 接口写入。')+'</td></tr>';
    document.dispatchEvent(new CustomEvent('peer-list-loaded',{detail:{items:data.items.map(item=>item.library).filter(Boolean)}}));
    message("#listStatus",`共 ${data.total} 条${state.mediaType === "photo" ? "图文" : "视频"} · 未采集的数据以 — 显示`);
    $("#pageInfo").textContent=`第 ${data.page} / ${data.totalPages} 页 · 每页 ${data.pageSize} 条`;
  } catch(error) { if(error.name!=="AbortError")message("#listStatus",error.message,true); }
  finally { if(controller===current){state.loading=false;pager();} }
}
async function loadKey() {
  try { const data=await api(API+"/api-key");state.keyConfigured=data.configured;$("#createKeyBtn").textContent=data.configured?"重新生成密钥":"生成 API Key";$("#revokeKeyBtn").hidden=!data.configured;message("#keyStatus",data.configured?`已启用 ${data.prefix}… · 创建于 ${time(data.createdAt)}`:"尚未生成密钥"); }
  catch(error){message("#keyStatus",error.message,true);}
}
$("#query").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.page=1;loadList();},250);});
$("#sort").addEventListener("change",()=>{state.page=1;loadList();});
$("#refreshBtn").addEventListener("click",loadList);
function applyMediaType(mediaType) {
  state.mediaType=mediaType;
  if(integrated){const url=new URL(location.href);url.searchParams.set('mediaType',mediaType);history.replaceState(null,'',url);}
  state.page=1;
  document.body.dataset.mediaType=mediaType;
  document.querySelectorAll(".hits-tab").forEach(tab=>{
    const active=tab.dataset.mediaType===mediaType;
    tab.classList.toggle("is-active",active);
    tab.setAttribute("aria-selected",String(active));
  });
  const photo=mediaType==="photo";
  $("#manualSummary").textContent=photo?"手动添加图文":"手动添加视频";
  $("#sourceUrlLabel").textContent=photo?"图文链接":"视频链接";
  $("#sourceUrlInput").placeholder=photo?"https://www.tiktok.com/@creator/photo/...":"https://www.tiktok.com/@creator/video/...";
  $("#importBtn").textContent=photo?"保存图文":"保存视频";
  $("#durationField").hidden=photo;
  $("#mediaColumnLabel").textContent=photo?"图文":"视频";
  document.dispatchEvent(new CustomEvent("peer-media-type-changed",{detail:{mediaType}}));
  loadList();
}
document.querySelectorAll(".hits-tab").forEach(tab=>tab.addEventListener("click",()=>{
  if(tab.dataset.mediaType!==state.mediaType)applyMediaType(tab.dataset.mediaType);
}));
async function deleteHit(id) {
  if (!id || !confirm(integrated?"删除这条文案、同行来源及关联改写？已创建的生成和发布任务会保留。删除后无法恢复。":"确定删除这条内容？删除后无法恢复。")) return;
  try {
    await api(integrated?'/api/psychology-copy-library':API+'/'+encodeURIComponent(id), { method: "DELETE",...(integrated?{headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})}:{}) });
    await loadList();
  } catch (error) {
    message("#listStatus", error.message, true);
  }
}
async function updateVoiceGender(select) {
  const previous = select.dataset.current || "male";
  select.disabled = true;
  try {
    const result = await api(`${API}/${encodeURIComponent(select.dataset.id)}`, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({voiceGender:select.value})});
    select.dataset.current = result.voiceGender;
    message("#listStatus",result.voiceGender === "female" ? "已改为女性音色 Lara。" : "已改为默认男性音色。");
    document.dispatchEvent(new CustomEvent("peer-voice-gender-changed",{detail:result}));
  } catch (error) {
    select.value = previous;
    message("#listStatus",error.message,true);
  } finally {
    select.disabled = false;
  }
}
$("#hitRows").addEventListener("change",event=>{if(event.target.matches(".voice-gender-select"))updateVoiceGender(event.target);});
$("#hitRows").addEventListener("click",event=>{
  const remove=event.target.closest(".hits-delete");
  if(remove)deleteHit(remove.dataset.id);
});
document.addEventListener("peer-list-refresh-request",loadList);
$("#previousBtn").addEventListener("click",()=>{state.page--;loadList();});
$("#nextBtn").addEventListener("click",()=>{state.page++;loadList();});
($("#sourceImportForm")||$("#importForm")).addEventListener("submit",async event=>{
  event.preventDefault();const data=Object.fromEntries(new FormData(event.target));
  try { data.videoData=data.videoData.trim()?JSON.parse(data.videoData):undefined;data.mediaType=state.mediaType;data.source="manual";$("#importBtn").disabled=true;
    const result=await api(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    message("#importStatus",`已保存 ${result.accepted} 条`);event.target.reset();state.page=1;if(integrated)$("#libraryStatus").value="all";await loadList();
  } catch(error){message("#importStatus",error.message,true);}finally{$("#importBtn").disabled=false;}
});
$("#createKeyBtn").addEventListener("click",async()=>{
  if(state.keyConfigured&&!confirm("重新生成后旧密钥会立即失效，需要更新 grokbot 配置。继续吗？"))return;
  $("#createKeyBtn").disabled=true;
  try{const data=await api(API+"/api-key",{method:"POST"});$("#newApiKey").value=data.apiKey;$("#newKeyPanel").hidden=false;await loadKey();}
  catch(error){message("#keyStatus",error.message,true);}finally{$("#createKeyBtn").disabled=false;}
});
$("#revokeKeyBtn").addEventListener("click",async()=>{
  if(!confirm("停用后 grokbot 将无法继续写入。确定停用吗？"))return;
  $("#revokeKeyBtn").disabled=true;
  try{await api(API+"/api-key",{method:"DELETE"});$("#newApiKey").value="";$("#newKeyPanel").hidden=true;await loadKey();}
  catch(error){message("#keyStatus",error.message,true);}finally{$("#revokeKeyBtn").disabled=false;}
});
async function copy(value){try{await navigator.clipboard.writeText(value);message("#keyStatus","已复制");}catch{message("#keyStatus","自动复制失败，请选中文本手动复制。",true);}}
$("#copyKeyBtn").addEventListener("click",()=>copy($("#newApiKey").value));
const endpoint=location.origin+"/api/integrations/psychology/peer-hits";$("#endpoint").value=endpoint;
const sample={
  "items": [
    {
      "mediaType": "photo",
      "videoUrl": "https://www.tiktok.com/@example/photo/1234567890123456789",
      "title": "Signs you are anxiously attached",
      "playCount": 128000,
      "likeCount": 9400,
      "commentCount": 210,
      "favoriteCount": 1800,
      "shareCount": 520,
      "publishedAt": "2026-09-01T14:30:00Z",
      "accountUsername": "example",
      "source": "grokbot",
      "videoData": {
        "language": "en",
        "caption": "Small texting habits can reveal what makes you feel safe.",
        "pageTexts": [
          "Signs you are anxiously attached",
          "You reread their texts looking for hidden meaning"
        ]
      },
      "topics": ["anxious"],
      "topComments": [
        {"text": "this is literally me with my ex", "likes": 2400},
        {"text": "why do I always apologize first", "likes": 980}
      ]
    }
  ]
};
const example=[`curl -X POST '${endpoint}'`, "  -H 'Authorization: Bearer YOUR_API_KEY'", "  -H 'Content-Type: application/json'", `  --data '${JSON.stringify(sample,null,2)}'`].join(" " + String.fromCharCode(92,10));
$("#apiExample").textContent=example;$("#copyExampleBtn").addEventListener("click",()=>copy(example));
// Same text as the grokbot sourcing instruction in docs/psychology-peer-hits-api.md.
const rewriteRules=`You find and submit English psychology photo posts (TikTok photo carousels) to our factory's peer-hits API. Do NOT write rewrites: the factory writes them itself with its own model. Leave the "rewrites" field out.
1. Which posts: only English photo posts about relationships, attachment (anxious / avoidant), emotional dependency, breakups, situationships, dating, boundaries or self-worth. Skip off-topic posts (character lore, product promos, pure jokes) and posts whose page text you cannot read clearly. Prefer recent posts that are clearly performing.
2. Required on every new post: playCount, likeCount, commentCount, favoriteCount, shareCount (use 0 when a count is zero), publishedAt (ISO with timezone or Unix timestamp) and accountUsername (or accountName). The factory rejects posts without them.
3. videoData.pageTexts: the clean, complete visible text of each image, in order, one item per image (max 6). Fix OCR noise and stray characters; remove watermarks, author names, book-list and "link in bio" pages. Leave out pages that are only a page number or symbols, and long photographed book/article pages (over 500 characters). Always include pageTexts: without it the factory has to run paid image recognition.
4. videoData.caption: the post's own caption, unchanged. title: the post's cover hook (not a string of hashtags).
5. topics: 1 to 3 labels, using these ids only: anxious (焦虑型依恋), avoidant (回避型依恋), breakup (分手), situationship (暧昧), boundaries (边界感), self-worth (自我价值).
6. topComments: the 10 to 20 comments with the most likes, as {"text","likes"}. Keep the commenter's original wording. If the post has fewer than 10 visible comments, send every one you can see. If commentCount is 0, send an empty array. These comments are reference for the factory's rewrite model.
7. Once a week, GET this same endpoint with the Bearer key. It returns three lists:
   - watchAccounts: accounts to check for new posts. Submit new performing photo posts the same way as any other post.
   - refresh: posts whose play numbers are older than 7 days. Resubmit the same videoUrl with the current playCount, likeCount, commentCount, favoriteCount and shareCount only. Leave out pageTexts, topics, topComments and any timestamp of when you collected it.
   - enrich: posts still missing topics or topComments. Resubmit the same videoUrl with just those fields.
8. Do not resubmit posts that are already in the library except for the refresh and enrich lists above.
9. Submit 10-20 posts per request. If the factory rejects a request, read the error (item number and reason), fix only that item and resubmit.`;
$("#copyRulesBtn")?.addEventListener("click",()=>copy(rewriteRules));
async function loadWatch(){
  if(!$("#watchList"))return;
  const data=await api(API+"/watch-accounts");
  $("#watchList").innerHTML=data.accounts.length?data.accounts.map(a=>'<li>@'+escape(a.username)+(a.note?' · '+escape(a.note):'')+' <button type="button" data-unwatch="'+escape(a.username)+'">移除</button></li>').join(""):"<li>还没有对标账号。</li>";
}
$("#watchForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  try{await api(API+"/watch-accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("#watchUsername").value,note:$("#watchNote").value})});$("#watchUsername").value="";$("#watchNote").value="";await loadWatch();}
  catch(error){message("#keyStatus",error.message,true);}
});
$("#watchList")?.addEventListener("click",async event=>{
  const name=event.target.dataset?.unwatch;if(!name)return;
  try{await api(API+"/watch-accounts?username="+encodeURIComponent(name),{method:"DELETE"});await loadWatch();}catch(error){message("#keyStatus",error.message,true);}
});
if($("#watchList"))loadWatch().catch(error=>message("#keyStatus",error.message,true));
if(integrated)$('#libraryStatus').addEventListener('change',()=>{state.page=1;document.dispatchEvent(new CustomEvent('peer-selection-clear'));loadList();});
applyMediaType(new URLSearchParams(location.search).get('mediaType')==='photo'?'photo':'video');if(!integrated)loadKey();
