const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=value=>Number(value||0).toLocaleString('zh-CN');
const percent=value=>value===null||value===undefined?'—':(value*100).toFixed(1)+'%';
const money=(value,currency)=>{try{return new Intl.NumberFormat('en-US',{style:'currency',currency:String(currency).toUpperCase()}).format(value/100);}catch{return String(currency).toUpperCase()+' '+(value/100).toFixed(2);}};
const datetime=value=>{if(!value)return '—';const parsed=new Date(/Z$|[+-]\d\d:\d\d$/.test(value)?value:value.replace(' ','T')+'Z');return Number.isNaN(+parsed)?'—':parsed.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});};
const table=(heads,rows,empty)=>'<table><thead><tr>'+heads.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join(''):'<tr><td class="web-empty" colspan="'+heads.length+'">'+escape(empty||'所选时间暂无数据')+'</td></tr>')+'</tbody></table>';
let applied={period:'7d',sourcePage:1,orderPage:1},draftPeriod='7d',data=null,controller=null,sequence=0;
function showTab(tab){document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==tab);}
function pager(prefix,value){$(prefix+'Page').textContent='第 '+value.page+' / '+Math.max(1,Math.ceil(value.total/value.pageSize))+' 页 · '+count(value.total)+' 条';$(prefix+'Prev').disabled=value.page<=1;$(prefix+'Next').disabled=value.page*value.pageSize>=value.total;}
function render(value){
 data=value;$('report').hidden=false;$('rangeLabel').textContent=value.window.from+' 至 '+value.window.to;
 const s=value.summary;
 $('metrics').innerHTML=[['页面访问',s.pageviews,'全站 PV，刷新会重复计数'],['开始测试',s.started,'所选时间开始的测试'],['完成测试',s.finished,'完成答题，含未提交邮箱'],['成交订单',s.orders,'按实际付款时间，含后续退款']].map(([label,n,note])=>'<article class="web-metric"><span>'+label+'</span><strong>'+count(n)+'</strong><small>'+note+'</small></article>').join('');
 $('revenue').textContent=value.currencies.length?value.currencies.map(c=>money(c.grossCents,c.currency)).join(' / '):'暂无成交金额';
 $('moneyNote').textContent='退款订单 '+count(s.refundedOrders)+' 笔。'+value.definitions.money;
 $('funnel').innerHTML=[['开始测试',s.started],['完成答题',s.finished],['提交邮箱',s.submitted],['到达收银台',s.checkout],['基础报告付款',s.paidSessions]].map(([label,n])=>'<div class="web-funnel-row"><span>'+label+'</span><div class="web-funnel-track"><i style="width:'+(s.started?Math.max(0,Math.min(100,n/s.started*100)):0)+'%"></i></div><strong>'+count(n)+'</strong></div>').join('');
 $('rates').textContent='答题完成率 '+percent(s.completionRate)+' · 测试付款率 '+percent(s.paymentRate)+'（付款测试会话 ÷ 开始测试会话）';
 $('attribution').innerHTML='<div class="web-attribution"><div><strong>'+count(value.attribution.attributedStarted)+'</strong><span>已归到承接账号的测试</span></div><div><strong>'+count(value.attribution.attributedOrders)+'</strong><span>已归到承接账号的订单</span></div></div><p class="web-muted">尚未归到当前项目账号：'+count(value.attribution.unattributedStarted)+' 次测试，'+count(value.attribution.unattributedOrders)+' 笔订单。</p>';
 $('days').innerHTML=table(['日期','页面访问','开始测试','完成答题','成交订单'],value.days.map(r=>[escape(r.day),count(r.pageviews),count(r.started),count(r.finished),count(r.orders)]));
 $('accounts').innerHTML=table(['承接账号','开始测试','完成答题','付款测试会话','期间成交订单'],value.accounts.map(r=>[escape(r.username?'@'+r.username:r.name),count(r.started),count(r.finished),count(r.paidSessions),count(r.orders)]),'暂无可归因账号数据。请将专属推广链接设置到承接账号主页。');
 $('sources').innerHTML=table(['来源','承接账号 / 活动','媒介','内容参数','开始','完成','收银台','付款会话','成交订单'],value.sources.rows.map(r=>[escape(r.source),escape(r.account?'@'+(r.account.username||r.account.name):r.campaign||'未归因'),escape(r.medium||'—'),escape(r.content||'—'),count(r.started),count(r.finished),count(r.checkout),count(r.paidSessions),count(r.orders)]));pager('source',value.sources);
 $('orders').innerHTML=table(['付款时间','订单号','产品','金额','状态','支付平台','来源 / 承接账号'],value.orders.rows.map(r=>[escape(datetime(r.paid_at)),escape(r.id),escape(r.testTitle)+'<small>'+(r.kind==='deep'?'深度报告':'基础报告')+'</small>',escape(money(r.amount_cents,r.currency)),r.status==='refunded'?'已退款':'已付款',escape(r.provider==='unknown'?'未知':r.provider),escape(r.account?'@'+(r.account.username||r.account.name):r.source)+'<small>'+escape(r.campaign||'无账号参数')+'</small>']));pager('order',value.orders);
 const selected=$('receiver').value;
 $('receiver').innerHTML=value.receivers.length?value.receivers.map(a=>'<option value="'+escape(a.connectionId)+'">'+escape('@'+a.username+(a.configured?' · 已设承接':' · 待设承接'))+'</option>').join(''):'<option value="">暂无已同步的千粉账号</option>';
 if(value.receivers.some(a=>a.connectionId===selected))$('receiver').value=selected;
 $('campaignNote').textContent='当前已确认 '+count(value.campaign.configuredReceivers)+' 个承接账号。'+(value.campaign.configuredReceivers===0?'转化发布会等待承接配置；复制链接不会自动确认主页已设置。':'主页链接需手动设置，复制不代表已设置。');
 updateLink();
 $('definitions').innerHTML=Object.values(value.definitions).map(text=>'<p>'+escape(text)+'</p>').join('');
 $('status').textContent='已连接 DeepPersona · 更新于 '+datetime(value.updatedAt);
}
function updateLink(){const a=data?.receivers.find(a=>a.connectionId===$('receiver').value);$('trackingUrl').value=a?.trackingUrl||'';$('copyLink').disabled=!a?.trackingUrl;$('linkNote').textContent=a?.trackingUrl?'设置后，来自此链接的测试和订单会自动出现在账号来源中。':'绑定并同步千粉账号后，这里会提供其专属链接。';}
async function load(query={...applied}){
 const id=++sequence;controller?.abort();controller=new AbortController();
 $('status').textContent=data?'正在刷新，当前仍显示上次查询的数据…':'正在读取网站数据…';$('refresh').disabled=true;
 try{
  const response=await fetch('/api/psychology-website?'+new URLSearchParams(query),{signal:controller.signal,cache:'no-store'});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'读取失败');
  if(id!==sequence)return;applied={...query};$('failure').hidden=true;render(result);
 }catch(error){if(error.name==='AbortError'||id!==sequence)return;$('failure').hidden=false;$('failure').textContent=error.message;$('status').textContent=data?'刷新失败，以下保留上次成功查询的数据（'+data.window.from+' 至 '+data.window.to+'）。':'尚未取得数据，暂无可显示的统计。';}
 finally{if(id===sequence)$('refresh').disabled=false;}
}
document.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{
 draftPeriod=button.dataset.period;document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 $('customDates').hidden=draftPeriod!=='range';
 if(draftPeriod!=='range')void load({period:draftPeriod,sourcePage:1,orderPage:1});
}));
$('filters').addEventListener('submit',event=>{event.preventDefault();if(draftPeriod==='range')void load({period:'range',from:$('from').value,to:$('to').value,sourcePage:1,orderPage:1});});
$('refresh').addEventListener('click',()=>void load());
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>showTab(button.dataset.tab)));
document.querySelector('[data-open-links]').addEventListener('click',()=>showTab('links'));
for(const [prefix,key] of [['source','sourcePage'],['order','orderPage']])for(const [suffix,delta] of [['Prev',-1],['Next',1]])$(prefix+suffix).addEventListener('click',()=>void load({...applied,[key]:Math.max(1,Number(applied[key]||1)+delta)}));
$('receiver').addEventListener('change',updateLink);
$('copyLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('trackingUrl').value);$('linkNote').textContent='已复制，请粘贴到对应承接账号的主页链接。';}catch{$('trackingUrl').select();$('linkNote').textContent='浏览器未允许自动复制，链接已选中，请手动复制。';}});
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);$('from').value=today;$('to').value=today;$('from').max=today;$('to').max=today;
setInterval(()=>{if(!document.hidden&&!$('refresh').disabled)void load();},60000);
void load();
