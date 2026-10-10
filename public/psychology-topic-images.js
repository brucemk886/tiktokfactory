const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setupTopicImages({api,fileDataUrl,onChanged}){
 let loadSequence=0,topic=null,page=1,busy=false,requestId=crypto.randomUUID(),submitted=null;
 const base=()=>'/api/psychology-template-topics/'+topic.id;
 const note=(text,error=false)=>{$('#poolMessage').textContent=text;$('#poolMessage').classList.toggle('error',error);};
 function lock(v){busy=v;$('#poolControls').inert=v;$('#poolGrid').inert=v;$('#poolClose').disabled=v;}
 async function load(){
  const seq=++loadSequence,id=topic.id;const data=await api(base()+'/images?page='+page);if(seq!==loadSequence||topic.id!==id)return;topic.revision=data.revision;
  $('#poolGrid').innerHTML=data.items.map(i=>'<article class="pool-image"><a href="'+esc(i.previewUrl)+'" target="_blank" rel="noopener"><img src="'+esc(i.previewUrl)+'" alt="题目配图" loading="lazy"></a><strong>'+({used:'已抽取 · 不再使用',available:'可用',disabled:'未启用'})[i.status]+'</strong>'+(i.drawnAt?'<small>'+esc(new Date(i.drawnAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))+'</small>':'')+(i.status!=='used'?'<button type="button" data-pool-toggle="'+esc(i.id)+'" data-enabled="'+(!i.enabled)+'">'+(i.enabled?'停用':'启用图片')+'</button>':'')+'</article>').join('')||'<p>暂无图片，请补充。</p>';
  $('#poolPage').textContent='共 '+data.total+' 张 · 第 '+page+' 页';$('#poolPrev').disabled=page<=1;$('#poolNext').disabled=!data.hasMore;
 }
 async function generations(){
  const id=topic.id;const data=await api(base()+'/image-generation');if(topic.id!==id)return;
  const labels={pending:'等待生成',generating:'正在生成',unknown:'结果待确认',completed:'已入库，请预览图片',failed:'生成失败'};
  $('#poolGenerations').innerHTML=data.items.map(i=>'<p>'+esc(labels[i.status]||i.status)+' · '+esc(new Date(i.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))+(i.errorCode?' · '+esc(i.errorCode):'')+(['pending','generating','unknown'].includes(i.status)?' <button type="button" data-resume-image="'+esc(i.requestId)+'">检查／恢复此任务</button>':'')+'</p>').join('');
 }
 $('#poolGenerations').onclick=async e=>{
  const button=e.target.closest('[data-resume-image]');if(!button||busy)return;lock(true);
  try{await api(base()+'/image-generation','POST',{requestId:button.dataset.resumeImage,resume:true});await Promise.all([load(),generations()]);note('已检查原任务，不会重复提交生图请求。');}catch(e){note(e.message,true);}finally{lock(false);}
 };
 $('#poolClose').onclick=()=>{if(!busy){$('#poolDialog').close();onChanged();}};
 $('#poolDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else onChanged();});
 $('#poolPrev').onclick=async()=>{if(busy)return;page--;try{await load();}catch(e){note(e.message,true);}};
 $('#poolNext').onclick=async()=>{if(busy)return;page++;try{await load();}catch(e){note(e.message,true);}};
 $('#poolRefresh').onclick=async()=>{if(busy)return;try{await Promise.all([load(),generations()]);}catch(e){note(e.message,true);}};
 $('#poolGrid').onclick=async e=>{
  const b=e.target.closest('[data-pool-toggle]');if(!b||busy)return;
  lock(true);try{await api(base()+'/images/'+b.dataset.poolToggle,'PATCH',{revision:topic.revision,enabled:b.dataset.enabled==='true'});await load();note('图片状态已更新。');}catch(e){note(e.message,true);}finally{lock(false);}
 };
 $('#poolUpload').onclick=async()=>{
  if(busy)return;const files=[...$('#poolFiles').files];
  if(!files.length||files.length>50){note('请选择 1–50 张图片。',true);return;}
  lock(true);let created=0,skipped=0,done=0;
  try{
   for(const file of files){
    note('正在导入 '+(done+1)+' / '+files.length+'…');
    const uploaded=await api('/api/psychology-template-topics/assets','POST',{imageBase64:await fileDataUrl(file),contentType:file.type});
    const result=await api(base()+'/images','POST',{revision:topic.revision,images:[{imageKey:uploaded.key}]});
    created+=result.created;skipped+=result.skipped;done++;
   }
   $('#poolFiles').value='';page=1;await load();note('新增 '+created+' 张，重复跳过 '+skipped+' 张。');
  }catch(e){note('已处理 '+done+' 张，新增 '+created+' 张。'+e.message+' 可重新提交，重复图片会跳过。',true);}
  finally{lock(false);}
 };
 $('#poolPrompt').oninput=()=>{requestId=crypto.randomUUID();submitted=null;$('#poolGenerate').textContent='AI 生图 · 生成 1 张';};
 $('#poolGenerate').onclick=async()=>{
  if(busy)return;
  const prompt=$('#poolPrompt').value.trim();if(!prompt){note('请填写画面要求。',true);return;}
  lock(true);
  try{
   submitted=submitted||{requestId,revision:topic.revision,prompt};
   const result=await api(base()+'/image-generation','POST',submitted);
   note('生图任务已提交，关闭页面后仍会继续。点击“刷新图片与生图状态”查看结果。');
   await generations();
   if(['completed','failed'].includes(result.status)){submitted=null;requestId=crypto.randomUUID();$('#poolGenerate').textContent='AI 生图 · 再生成 1 张';await load();}
   else $('#poolGenerate').textContent='检查此生图任务';
  }catch(e){note(e.message+' 重试会沿用同一提交编号。',true);}
  finally{lock(false);}
 };
 return async(value,generate=false)=>{
  topic={...value};page=1;submitted=null;requestId=crypto.randomUUID();
  $('#poolTitle').textContent='图片管理 · '+topic.title;$('#poolTopicId').textContent='题目 ID：'+topic.id;
  $('#poolPrompt').value='绘制新的生活场景和构图，保持四个选项的含义和顺序一致。';
  $('#poolGenerate').textContent='AI 生图 · 生成 1 张';$('#poolAi').open=generate;
  $('#poolFiles').value='';$('#poolGrid').innerHTML='<p>正在读取图片…</p>';$('#poolGenerations').innerHTML='';note('');
  $('#poolDialog').showModal();
  lock(true);try{await Promise.all([load(),generations()]);}catch(e){note(e.message,true);}finally{lock(false);}
 };
}

