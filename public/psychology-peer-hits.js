const $ = selector => document.querySelector(selector);
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
async function loadList() {
  controller?.abort(); const current=new AbortController();controller=current;state.loading=true;pager();message("#listStatus","正在读取…");
  try {
    const query=new URLSearchParams({page:String(state.page),query:$("#query").value.trim(),sort:$("#sort").value,mediaType:state.mediaType});
    const data=await api(API+"?"+query,{signal:current.signal});
    if(current.signal.aborted)return;
    state.page=data.page;state.totalPages=data.totalPages;
    $("#hitRows").innerHTML=data.items.length?data.items.map(item=>`<tr>
      <td><input type="checkbox" class="peer-select" data-peer-id="${escape(item.id)}" aria-label="选择 ${escape(titleOf(item))}" /></td>
      <td>${metric(item.playCount)}</td><td>${metric(item.likeCount)}</td><td>${metric(item.commentCount)}</td><td>${metric(item.favoriteCount)}</td><td>${metric(item.shareCount)}</td><td>${item.durationSeconds==null?"—":metric(item.durationSeconds)+" 秒"}</td>
      <td class="hits-time">${time(item.publishedAt)}</td>
      <td class="hits-title" title="${escape(titleOf(item))}"><span>${escape(titleOf(item))}</span></td>
      <td class="hits-copy" title="${escape(copyOf(item))}"><span>${escape(copyOf(item))}</span></td>
      <td><select class="voice-gender-select" data-id="${escape(item.id)}" data-current="${escape(item.voiceGender || "male")}" aria-label="修改 ${escape(titleOf(item))} 的音色性别"><option value="male"${item.voiceGender !== "female" ? " selected" : ""}>男</option><option value="female"${item.voiceGender === "female" ? " selected" : ""}>女 · Lara</option></select></td>
      <td class="hits-video"><a href="${escape(item.videoUrl)}" target="_blank" rel="noopener noreferrer">${item.coverUrl?`<img alt="" src="${escape(item.coverUrl)}" />`:`打开${item.mediaType === "photo" ? "图文" : "视频"}`}</a></td>
      <td class="hits-actions-cell"><button class="hits-delete" type="button" data-id="${escape(item.id)}">删除</button></td>
    </tr>`).join(""):'<tr><td colspan="13">暂无记录，可手动添加或通过 grokbot 接口写入。</td></tr>';
    document.dispatchEvent(new CustomEvent('peer-list-loaded'));
    message("#listStatus",`共 ${data.total} 条${state.mediaType === "photo" ? "图文" : "视频"} · 未采集的数据以 — 显示`);
    $("#pageInfo").textContent=`第 ${data.page} / ${data.totalPages} 页 · 每页 ${data.pageSize} 条`;
    $("#hitRows").querySelectorAll("button[data-id]").forEach(button => button.addEventListener("click", () => deleteHit(button.dataset.id)));
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
  if (!id || !confirm("确定删除这条内容？删除后无法恢复。")) return;
  try {
    await api(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
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
$("#previousBtn").addEventListener("click",()=>{state.page--;loadList();});
$("#nextBtn").addEventListener("click",()=>{state.page++;loadList();});
$("#importForm").addEventListener("submit",async event=>{
  event.preventDefault();const data=Object.fromEntries(new FormData(event.target));
  try { data.videoData=data.videoData.trim()?JSON.parse(data.videoData):undefined;data.mediaType=state.mediaType;data.source="manual";$("#importBtn").disabled=true;
    const result=await api(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    message("#importStatus",`已保存 ${result.accepted} 条`);event.target.reset();state.page=1;await loadList();
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
const sample={items:[{mediaType:"video",voiceGender:"female",videoUrl:"https://www.tiktok.com/@example/video/1234567890123456789",title:"Which picture did you notice first?",accountName:"Psychology Example",accountUsername:"@example",playCount:128000,likeCount:8200,commentCount:460,favoriteCount:1800,shareCount:920,durationSeconds:18.5,videoData:{language:"en",hashtags:["psychology","test"]},source:"grokbot"}]};
const example=[`curl -X POST '${endpoint}'`, "  -H 'Authorization: Bearer YOUR_API_KEY'", "  -H 'Content-Type: application/json'", `  --data '${JSON.stringify(sample,null,2)}'`].join(" " + String.fromCharCode(92,10));
$("#apiExample").textContent=example;$("#copyExampleBtn").addEventListener("click",()=>copy(example));
applyMediaType("video");loadKey();
