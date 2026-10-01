(function(){
 const host=document.querySelector('#transitionDay');
 if(!host)return;
 const endpoint='/api/psychology-autopilot/transition-day',date='2026-10-01';
 const state={data:null,busy:false,error:'',sequence:0};
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>value==null?'—':Number(value).toLocaleString('zh-CN');
 const time=(value,zone)=>!value?'—':new Date(value).toLocaleString('zh-CN',{timeZone:zone,hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 const statuses={pending:'待启用',enabled:'已启用',active:'已启用',created:'已创建',creating:'正在创建',running:'排期中',complete:'过渡任务已创建',completed:'过渡任务已创建',expired:'过渡窗口已结束',skipped:'已跳过',failed:'排期失败','not-enabled':'尚未创建'};
 function paint(){
  const data=state.data||{},enabled=data.enabled===true;
  const status=data.status?(statuses[data.status]||data.status):enabled?'已启用':'未启用';
  const rounds=data.rounds||[];
  const totals=rounds.reduce((sum,r)=>{for(const key of ['created','published','skipped'])sum[key]+=(Number(r[key])||0);return sum;},{created:0,published:0,skipped:0});
  const counts=rounds.length?'<div class="transition-counts">'+[['created','已创建任务'],['published','已发布'],['skipped','跳过账号次']].map(([key,label])=>'<div><strong>'+number(totals[key])+'</strong><small>'+label+'</small></div>').join('')+'</div>':'';
  const roundRows=rounds.map(round=>{return '<tr><td>'+escape(round.label||'过渡轮次')+'</td><td>'+escape(time(round.slotAt,'America/Los_Angeles'))+'<small>美西时间</small></td><td>'+escape(time(round.slotAt,'Asia/Shanghai'))+(round.lastSlotAt&&round.lastSlotAt!==round.slotAt?' – '+escape(time(round.lastSlotAt,'Asia/Shanghai')):'')+'<small>北京时间 · 账号错峰</small></td><td>'+escape(time(round.generationStartAt,'Asia/Shanghai'))+(round.generationEndAt?' – '+escape(time(round.generationEndAt,'Asia/Shanghai')):'')+'<small>实际生成时间以任务明细为准</small></td><td>'+escape(statuses[round.status]||round.status||'待排期')+'<small>已创建 '+number(round.created)+' · 已发布 '+number(round.published)+'</small>'+(round.detail?'<small>'+escape(round.detail)+'</small>':'')+'</td></tr>';}).join('');
  const reasonCounts=new Map();for(const row of data.preview?.excluded||[]){const reason=typeof row==='string'?row:row.reason||'不符合过渡资格';reasonCounts.set(reason,(reasonCounts.get(reason)||0)+(Number(row.accounts)||1));}
  const reasons=[...reasonCounts].map(([reason,count])=>'<li>'+escape(reason)+'（'+number(count)+'个账号）</li>').join('');
  host.setAttribute('aria-busy',String(state.busy));
  host.innerHTML='<div class="transition-head"><div><h2 id="transitionDayTitle">单日过渡排期</h2><p>美西10月1日午间、晚间轮，接续10月2日起的正式运营周期。</p></div><strong class="transition-badge">'+escape(state.busy?'正在处理…':status)+'</strong></div>'+
   (data.preview?'<p class="transition-note">符合过渡条件 '+number(data.preview.eligible)+' 个账号 · 评审 '+number(data.preview.review)+' · 常规运营 '+number(data.preview.normal)+'</p>':'')+
   '<p class="transition-schedule">午间：美西10/1 11:30 → 北京10/2 02:30起；晚间：美西10/1 20:00 → 北京10/2 11:00起。</p>'+
   '<p class="transition-note">存量中强号优先补测固定文案与样式；新账号次日起加入。救援账号缺少合格基准时等待。生成根据积压提前2–3小时，保持账号错峰。</p>'+counts+
   (roundRows?'<div class="transition-table"><table><thead><tr><th>轮次</th><th>发布时间</th><th>发布时间</th><th>生成窗口（北京）</th><th>执行状态</th></tr></thead><tbody>'+roundRows+'</tbody></table></div>':'<p class="transition-note">'+(state.data?'当前尚无已创建的过渡任务。':'正在读取过渡排期…')+'</p>')+
   (reasons?'<details class="transition-reasons"><summary>匹配不足与跳过原因</summary><ul>'+reasons+'</ul></details>':'')+
   (data.lastRunError?'<p class="transition-error">最近检查：'+escape(data.lastRunError)+'</p>':'')+
   '<p class="transition-note">正式周期：美西10月2–9日，首次复评10月5日。'+(data.lastRunAt?' 最近检查：北京'+escape(time(data.lastRunAt,'Asia/Shanghai'))+'。':'')+(data.nextCheckAt?' 下次检查：北京'+escape(time(data.nextCheckAt,'Asia/Shanghai'))+'。':'')+'</p>'+
   '<div class="transition-actions">'+(state.data&&!enabled&&data.canEnable===true?'<button type="button" class="primary-link" id="enableTransitionDay" data-transition-action="enable" '+(state.busy?'disabled':'')+'>启用今日两轮过渡</button>':'')+(enabled&&data.canRun===true?'<button type="button" id="runTransitionDay" data-transition-action="run" '+(state.busy?'disabled':'')+'>检查过渡排期</button>':'')+'<button type="button" data-transition-action="refresh" '+(state.busy?'disabled':'')+'>刷新过渡状态</button><span id="transitionDayStatus" class="'+(state.error?'transition-error':'transition-note')+'" role="status">'+escape(state.error||(enabled?'已启用过渡，仅在符合账号与内容资格时创建任务。':''))+'</span></div>';
 }
 async function request(method='GET',suffix=''){
  const response=await fetch(endpoint+suffix,{method,credentials:'same-origin',cache:'no-store',...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify(suffix?{date}:{date,revision:state.data?.formal?.revision})}:{})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'过渡排期请求失败');
  return result;
 }
 async function load(){
  if(state.busy)return;
  const sequence=++state.sequence;
  try{const data=await request();if(sequence!==state.sequence)return;state.data=data;state.error='';paint();}
  catch(error){if(sequence!==state.sequence)return;state.error=(state.data?'保留上次状态；':'')+'读取失败：'+error.message;paint();}
 }
 async function mutate(action){
  if(state.busy||!state.data)return;
  if(action==='enable'&&!(state.data.canEnable===true&&state.data.enabled!==true))return;
  if(action==='run'&&!(state.data.canRun===true&&state.data.enabled===true))return;
  state.busy=true;state.error='';state.sequence++;paint();
  try{state.data=await request('POST',action==='run'?'/run':'');}
  catch(error){state.error='操作尚未确认成功：'+error.message;}
  finally{state.busy=false;paint();if(!state.error)void load();}
 }
 host.addEventListener('click',event=>{const button=event.target.closest('[data-transition-action]');if(!button)return;const action=button.dataset.transitionAction;if(action==='refresh')void load();else void mutate(action);});
 document.querySelector('#reload')?.addEventListener('click',()=>void load());
 setInterval(()=>{if(!document.hidden&&!state.busy)void load();},30000);
 paint();void load();
})();
