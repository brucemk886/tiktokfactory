const root=document.querySelector('#scheduleAssurance');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=(v,zone='America/Los_Angeles')=>v?new Intl.DateTimeFormat('zh-CN',{timeZone:zone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)):'—';
const state={created:'已建',skipped:'已跳过',pending:'待建',blocked:'待恢复',queued:'待制作',producing:'制作中',publishing:'提交 / 处理中',scheduled:'待平台发布',published:'已发布',production_failed:'制作失败',publish_failed:'发布失败',cancelled:'已停止'};
const api='/api/psychology-autopilot/scheduling';
let busy=false;
function render(data){
 const rounds=data.rounds||[],alerts=data.alerts||[],notification=data.notification||{};
 const heading='<div class="section-title"><div><h2>排期保障</h2><p class="section-hint">美西早 / 午 / 晚三轮 · 每批5个账号，进度自动保存，中断后续跑 · 5分钟核对遗漏与告警</p></div><button type="button" id="recoverScheduling">恢复未完成排期</button></div>';
 const channel=notification.reachable===false?'告警通道连接失败，尚未确认送达':notification.reason==='email-not-configured'?'管理员告警邮箱尚未配置':notification.reason==='no-recipients'?'管理员告警收件人尚未配置':notification.checkedAt?'告警通道最近核对 '+time(notification.checkedAt,'Asia/Shanghai')+' 北京时间':'告警通道等待首次核对';
 const banner=alerts.length?'<p class="schedule-alert" role="alert">'+alerts.length+' 项待处理：'+alerts.slice(0,4).map(a=>esc(a.message)).join('；')+'</p>':'<p class="section-hint">已读取的排期暂未触发告警。'+(rounds.length?'':'等待排期清单建立。')+'</p>';
 const rows=rounds.map(r=>{const c=r.counts,issues=r.details.filter(d=>d.status!=='created'||d.failed);
  return '<tr><td><strong>'+esc(r.date)+' '+esc(['早高峰','午高峰','晚高峰'][r.round]||'待核对轮次')+'</strong><br>'+esc(time(r.slotAt))+'–'+esc(time(r.endAt).split(' ').at(-1))+' 美西<br><small>'+esc(time(r.slotAt,'Asia/Shanghai'))+' 北京时间起</small></td>'+
  ['expected','created','skipped','pending','blocked','ready','submitted','published'].map(k=>'<td>'+esc(c[k]??'待核对')+'</td>').join('')+
  '<td>'+esc(r.status==='failed'?'需恢复':r.status==='done'?'清单已处理':'处理中')+
  '<details><summary>账号明细'+(issues.length?' · '+issues.length+' 项说明':'')+'</summary><div class="schedule-account-list">'+r.details.map(d=>'<p><strong>'+esc(d.account)+'</strong> · '+esc(state[d.status]||d.status)+' · '+esc(state[d.state]||'')+(d.reason?'<br>'+esc(d.reason):'')+'</p>').join('')+'</div></details></td></tr>';
 }).join('');
 root.innerHTML=heading+banner+'<p class="section-hint">'+esc(channel)+' · 数据核对 '+esc(time(data.asOf,'Asia/Shanghai'))+' 北京时间</p><div class="table-wrap"><table><thead><tr>'+['发布轮次','应处理账号','已建任务','已跳过','待建','待恢复','素材就绪','平台已接收','已发布','状态 / 明细'].map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div><p class="section-hint">'+esc(data.basis)+'；跳过不计为发布成功。策略仍每天检查三次，新账号次日生效。</p><p id="scheduleActionStatus" role="status"></p>';
 root.querySelector('#recoverScheduling').addEventListener('click',recover);
}
async function read(){if(!root||busy||document.hidden)return;busy=true;try{
 const response=await fetch(api,{credentials:'same-origin',cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'读取失败');render(data);root.setAttribute('aria-busy','false');
 }catch(error){root.innerHTML='<h2>排期保障</h2><p role="alert">排期状态读取失败，不能确认当前完整性。'+esc(error.message)+'</p><button id="retryScheduling" type="button">重试</button>';root.querySelector('#retryScheduling').addEventListener('click',read);}finally{busy=false;}}
async function recover(){if(busy)return;busy=true;const button=root.querySelector('#recoverScheduling');button.disabled=true;const status=root.querySelector('#scheduleActionStatus');status.textContent='正在提交恢复请求…';try{
 const response=await fetch(api+'/recover',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error||'恢复失败');status.textContent='已提交恢复请求，正在分批核对；已有任务保留。';setTimeout(read,2000);
 }catch(error){status.textContent='恢复请求失败：'+error.message;}finally{busy=false;button.disabled=false;}}
if(root){read();setInterval(read,30000);document.querySelector('#reload')?.addEventListener('click',read);}
