const $ = selector => document.querySelector(selector);
const API = "/api/psychology-peer-hits";
const state = { page: 1, totalPages: 1, keyConfigured: false, loading: false };
let controller, searchTimer;
const time = value => value ? new Date(value).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai",hour12:false}) : "—";
const metric = value => value == null ? "—" : Number(value).toLocaleString("zh-CN");
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const text = value => typeof value === "string" && value.trim() ? value.trim() : "";
const titleOf = item => text(item.title) || text(item.videoData?.标题) || "—";
const copyOf = item => text(item.videoData?.文案) || text(item.videoData?.caption) || text(item.videoData?.copy) || "—";
const message = (id, text, error=false) => { $(id).textContent=text; $(id).classList.toggle("is-error",error); };
async function api(url, options={}) {
  const res = await fetch(url, {cache:"no-store",...options}); const data=await res.json();
  if(!res.ok) throw new Error(data.error || "请求失败，请稍后重试。"); return data;
}
function pager() { $("#previousBtn").disabled=state.loading||state.page<=1; $("#nextBtn").disabled=state.loading||state.page>=state.totalPages; }
async function loadList() {
  controller?.abort(); const current=new AbortController();controller=current;state.loading=true;pager();message("#listStatus","正在读取…");
  try {
    const query=new URLSearchParams({page:String(state.page),query:$("#query").value.trim(),sort:$("#sort").value});
    const data=await api(API+"?"+query,{signal:current.signal});
    if(current.signal.aborted)return;
    state.page=data.page;state.totalPages=data.totalPages;
    $("#hitRows").innerHTML=data.items.length?data.items.map(item=>`<tr>
      <td>${metric(item.playCount)}</td><td>${metric(item.likeCount)}</td><td>${metric(item.commentCount)}</td><td>${metric(item.favoriteCount)}</td><td>${metric(item.shareCount)}</td><td>${item.durationSeconds==null?"—":metric(item.durationSeconds)+" 秒"}</td>
      <td class="hits-time">${time(item.publishedAt)}</td>
      <td class="hits-title" title="${escape(titleOf(item))}"><span>${escape(titleOf(item))}</span></td>
      <td class="hits-copy" title="${escape(copyOf(item))}"><span>${escape(copyOf(item))}</span></td>
      <td class="hits-video"><a href="${escape(item.videoUrl)}" target="_blank" rel="noopener noreferrer">${item.coverUrl?`<img alt="" src="${escape(item.coverUrl)}" />`:"打开视频"}</a></td>
      <td class="hits-actions-cell"><button class="hits-delete" type="button" data-id="${escape(item.id)}">删除</button></td>
    </tr>`).join(""):'<tr><td colspan="11">暂无记录，可手动添加或通过 grokbot 接口写入。</td></tr>';
    message("#listStatus",`共 ${data.total} 条视频 · 未采集的数据以 — 显示`);
    $("#pageInfo").textContent=`第 ${data.page} / ${data.totalPages} 页 · 每页 ${data.pageSize} 条`;
    $("#hitRows").querySelectorAll("[data-id]").forEach(button => button.addEventListener("click", () => deleteHit(button.dataset.id)));
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
async function deleteHit(id) {
  if (!id || !confirm("确定删除这条视频？删除后无法恢复。")) return;
  try {
    await api(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadList();
  } catch (error) {
    message("#listStatus", error.message, true);
  }
}
$("#previousBtn").addEventListener("click",()=>{state.page--;loadList();});
$("#nextBtn").addEventListener("click",()=>{state.page++;loadList();});
$("#importForm").addEventListener("submit",async event=>{
  event.preventDefault();const data=Object.fromEntries(new FormData(event.target));
  try { data.videoData=data.videoData.trim()?JSON.parse(data.videoData):undefined;data.source="manual";$("#importBtn").disabled=true;
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
const sample={items:[{videoUrl:"https://www.tiktok.com/@example/video/1234567890123456789",title:"Which picture did you notice first?",accountName:"Psychology Example",accountUsername:"@example",playCount:128000,likeCount:8200,commentCount:460,favoriteCount:1800,shareCount:920,durationSeconds:18.5,videoData:{language:"en",hashtags:["psychology","test"]},source:"grokbot"}]};
const example=[`curl -X POST '${endpoint}'`, "  -H 'Authorization: Bearer YOUR_API_KEY'", "  -H 'Content-Type: application/json'", `  --data '${JSON.stringify(sample,null,2)}'`].join(" " + String.fromCharCode(92,10));
$("#apiExample").textContent=example;$("#copyExampleBtn").addEventListener("click",()=>copy(example));
loadList();loadKey();
