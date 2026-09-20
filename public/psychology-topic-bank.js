import {parseTopicImport} from "/psychology-topic-import.js";
const $=s=>document.querySelector(s),BASE="/api/psychology-template-topics";
const state={template:"psychology",page:1,items:[],templates:[],editing:null,requestId:crypto.randomUUID(),importId:crypto.randomUUID(),busy:false,loadId:0};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,method="GET",body){
  const r=await fetch(path,{method,...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||"请求失败");return data;
}
function message(text,error=false){$("#message").textContent=text;$("#message").classList.toggle("error",error);}
function bank(){return state.templates.find(t=>t.id===state.template);}
async function load(){
  const id=++state.loadId;
  state.items=[];$("#topicList").innerHTML='<div class="empty-state">正在读取题目…</div>';
  const q=new URLSearchParams({template:state.template,page:String(state.page),query:$("#search").value.trim(),enabled:$("#enabledFilter").value});
  const data=await api(BASE+"?"+q);
  if(id!==state.loadId)return;
  if(!data.items.length&&data.total&&state.page>1){state.page=Math.ceil(data.total/20);return load();}
  state.items=data.items;state.templates=data.templates;
  $("#bankTabs").innerHTML=data.templates.map(t=>'<button type="button" data-bank="'+esc(t.id)+'" class="'+(t.id===state.template?"active":"")+'" aria-pressed="'+(t.id===state.template)+'">'+esc(t.label)+'</button>').join("");
  $("#bankHint").textContent=bank().hint;
  const c=data.counts[state.template];
  $("#bankCounts").innerHTML="<span>全部题目 <b>"+c.total+"</b></span><span>已启用 <b>"+c.enabled+"</b></span><span>未使用且启用 <b>"+c.unused+"</b></span>";
  $("#topicList").innerHTML=data.items.length?'<table class="queue-table"><thead><tr><th>题目与内容</th><th>分类</th><th>优先级</th><th>状态</th><th>已抽取</th><th>操作</th></tr></thead><tbody>'+data.items.map(t=>'<tr><td><div class="topic-title">'+esc(t.title)+'</div><div class="topic-copy">'+esc(t.content||"未填写内容，将根据题目生成")+'</div></td><td>'+esc(t.category||"—")+'</td><td>'+t.priority+'</td><td>'+(t.enabled?"已启用":"已停用")+'</td><td>'+t.usageCount+' 次<small>'+(t.lastUsedAt?esc(new Date(t.lastUsedAt).toLocaleString("zh-CN")):"尚未抽取")+'</small></td><td><div class="bank-actions"><button data-edit="'+t.id+'">编辑</button><button data-toggle="'+t.id+'">'+(t.enabled?"停用":"启用")+'</button><button data-delete="'+t.id+'">删除</button></div></td></tr>').join("")+'</tbody></table>':'<div class="empty-state">'+(c.total?"没有符合筛选条件的题目。":"此模板题库还是空的。新增题目或批量导入后，即可用于自动发布。")+"</div>";
  $("#pageInfo").textContent="共 "+data.total+" 条 · 第 "+state.page+" / "+Math.max(1,Math.ceil(data.total/20))+" 页";
  $("#prevPage").disabled=state.page<=1;$("#nextPage").disabled=state.page*20>=data.total;
}
function showEditor(topic=null){
  state.editing=topic;state.requestId=crypto.randomUUID();
  $("#editTitle").textContent=topic?"编辑题目":"新增题目";$("#editBank").textContent=bank().label;
  $("#topicTitle").value=topic?.title||"";$("#topicContent").value=topic?.content||"";$("#topicCategory").value=topic?.category||"";
  $("#topicPriority").value=topic?.priority??50;$("#topicEnabled").checked=topic?.enabled??true;$("#editError").textContent="";
  $("#editDialog").showModal();
}
function lock(form,busy){state.busy=busy;form.querySelectorAll("input,textarea,button").forEach(n=>n.disabled=busy);}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>{if(!state.busy)$("#"+b.dataset.close).close();});
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("cancel",e=>{if(state.busy)e.preventDefault();}));
$("#bankTabs").onclick=e=>{const b=e.target.closest("[data-bank]");if(!b||state.busy)return;state.template=b.dataset.bank;state.page=1;message("");load().catch(e=>message(e.message,true));};
$("#searchForm").onsubmit=e=>{e.preventDefault();state.page=1;load().catch(e=>message(e.message,true));};
$("#prevPage").onclick=()=>{state.page--;load().catch(e=>message(e.message,true));};
$("#nextPage").onclick=()=>{state.page++;load().catch(e=>message(e.message,true));};
$("#newTopic").onclick=()=>{if(bank())showEditor();};
$("#editForm").oninput=()=>state.requestId=crypto.randomUUID();
$("#editForm").onsubmit=async e=>{
  e.preventDefault();if(state.busy)return;
  const body={title:$("#topicTitle").value,content:$("#topicContent").value,category:$("#topicCategory").value,priority:Number($("#topicPriority").value),enabled:$("#topicEnabled").checked};
  lock(e.target,true);
  try{
    if(state.editing)await api(BASE+"/"+state.editing.id,"PATCH",{...body,revision:state.editing.revision});
    else await api(BASE+"/import","POST",{requestId:state.requestId,template:state.template,items:[body]});
    $("#editDialog").close();message("题目已保存。");await load();
  }catch(error){$("#editError").textContent=error.message;}finally{lock(e.target,false);}
};
$("#topicList").onclick=async e=>{
  const button=e.target.closest("button");if(!button||state.busy)return;
  const id=button.dataset.edit||button.dataset.toggle||button.dataset.delete,topic=state.items.find(t=>t.id===id);if(!topic)return;
  if(button.dataset.edit){showEditor(topic);return;}
  if(button.dataset.delete&&!confirm("删除题目「"+topic.title+"」？已创建的任务不受影响。"))return;
  state.busy=true;button.disabled=true;
  try{await api(BASE+"/"+id,button.dataset.delete?"DELETE":"PATCH",{revision:topic.revision,enabled:!topic.enabled});message(button.dataset.delete?"题目已删除。":"题目状态已更新。");await load();}
  catch(error){message(error.message,true);button.disabled=false;}finally{state.busy=false;}
};
$("#importTopics").onclick=()=>{if(!bank())return;state.importId=crypto.randomUUID();$("#importBank").textContent="导入到："+bank().label;$("#importText").value="";$("#importFile").value="";$("#importError").textContent="";$("#importDialog").showModal();};
$("#importText").oninput=()=>state.importId=crypto.randomUUID();
$("#importFile").onchange=async()=>{
  const file=$("#importFile").files[0];if(!file)return;
  try{if(file.size>2*1024*1024)throw new Error("文件不能超过 2 MB。");$("#importText").value=await file.text();state.importId=crypto.randomUUID();$("#importError").textContent="";}
  catch(error){$("#importError").textContent=error.message;}
};
$("#downloadTemplate").onclick=()=>{
  const url=URL.createObjectURL(new Blob(["\uFEFF题目,内容,分类,优先级,启用\r\n"],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");
  a.href=url;a.download=state.template+"-题库模板.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$("#importForm").onsubmit=async e=>{
  e.preventDefault();if(state.busy)return;
  lock(e.target,true);
  try{
    const items=parseTopicImport($("#importText").value),result=await api(BASE+"/import","POST",{requestId:state.importId,template:state.template,items});
    $("#importDialog").close();message(result.duplicate?"本次导入已经完成，未重复添加。":"导入完成：新增 "+result.created+" 条，跳过重复 "+result.skipped+" 条。");state.page=1;await load();
  }catch(error){$("#importError").textContent=error.message;}finally{lock(e.target,false);}
};
await load().catch(e=>message(e.message,true));
const endpoint=location.origin+"/api/integrations/psychology/template-topics";
if($("#endpoint"))$("#endpoint").value=endpoint;
const sample={items:[{template:"psychology",title:"Which picture did you notice first?",content:"A: eyes\nB: hands\nC: mouth\nD: background",category:"attention",priority:80,enabled:true,source:"grokbot"}]};
if($("#apiExample"))$("#apiExample").textContent=["curl -X POST '"+endpoint+"'","  -H 'Authorization: Bearer YOUR_API_KEY'","  -H 'Content-Type: application/json'","  --data '"+JSON.stringify(sample,null,2)+"'"].join(" \\\n");
async function loadKey(){
  if(!$("#keyStatus"))return;
  try{
    const data=await api(BASE+"/api-key");
    $("#createKeyBtn").textContent=data.configured?"重新生成密钥":"生成 API Key";
    $("#revokeKeyBtn").hidden=!data.configured;
    $("#keyStatus").textContent=data.configured?"已启用 "+data.prefix+"… · 创建于 "+new Date(data.createdAt).toLocaleString("zh-CN"):"尚未生成密钥";
    $("#keyStatus").classList.remove("is-error");
  }catch(error){$("#keyStatus").textContent=error.message;$("#keyStatus").classList.add("is-error");}
}
async function copyText(value,ok){
  try{await navigator.clipboard.writeText(value);$("#keyStatus").textContent=ok;$("#keyStatus").classList.remove("is-error");}
  catch{$("#keyStatus").textContent="自动复制失败，请选中文本手动复制。";$("#keyStatus").classList.add("is-error");}
}
$("#apiPanel")?.addEventListener("toggle",()=>{if($("#apiPanel").open)loadKey();});
document.addEventListener("click",event=>{if($("#apiPanel")&&!$("#apiPanel").contains(event.target))$("#apiPanel").open=false;});
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&$("#apiPanel"))$("#apiPanel").open=false;});
$("#createKeyBtn")?.addEventListener("click",async()=>{
  if($("#createKeyBtn").textContent.includes("重新")&&!confirm("重新生成后旧密钥会立即失效，需要更新 grokbot 配置。继续吗？"))return;
  $("#createKeyBtn").disabled=true;
  try{const data=await api(BASE+"/api-key","POST");$("#newApiKey").value=data.apiKey;$("#newKeyPanel").hidden=false;await loadKey();}
  catch(error){$("#keyStatus").textContent=error.message;$("#keyStatus").classList.add("is-error");}
  finally{$("#createKeyBtn").disabled=false;}
});
$("#revokeKeyBtn")?.addEventListener("click",async()=>{
  if(!confirm("停用后 grokbot 将无法继续写入题库。确定停用吗？"))return;
  $("#revokeKeyBtn").disabled=true;
  try{await api(BASE+"/api-key","DELETE");$("#newApiKey").value="";$("#newKeyPanel").hidden=true;await loadKey();}
  catch(error){$("#keyStatus").textContent=error.message;$("#keyStatus").classList.add("is-error");}
  finally{$("#revokeKeyBtn").disabled=false;}
});
$("#copyKeyBtn")?.addEventListener("click",()=>copyText($("#newApiKey").value,"已复制密钥"));
$("#copyExampleBtn")?.addEventListener("click",()=>copyText($("#apiExample").textContent,"已复制请求示例"));
loadKey();
