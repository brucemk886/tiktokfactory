const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=value=>Number(value||0).toLocaleString('zh-CN');
const percent=value=>value===null||value===undefined?'—':(value*100).toFixed(1)+'%';
const money=(value,currency)=>{try{return new Intl.NumberFormat('en-US',{style:'currency',currency:String(currency).toUpperCase()}).format(value/100);}catch{return String(currency).toUpperCase()+' '+(value/100).toFixed(2);}};
const datetime=value=>{if(!value)return '—';const parsed=new Date(/Z$|[+-]\d\d:\d\d$/.test(value)?value:value.replace(' ','T')+'Z');return Number.isNaN(+parsed)?'—':parsed.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});};
const table=(heads,rows,empty)=>'<table><thead><tr>'+heads.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join(''):'<tr><td class="web-empty" colspan="'+heads.length+'">'+escape(empty||'所选时间暂无数据')+'</td></tr>')+'</tbody></table>';
let applied={period:'today',sourcePage:1,orderPage:1},draftPeriod='today',data=null,controller=null,sequence=0,receivingChanged=false;
function showTab(tab,{focus=false}={}){
 const openLinks=tab==='links',openSources=tab==='sources';if(openLinks)tab='receiving';if(openSources)tab='overview';
 const tabs=[...document.querySelectorAll('.web-tabs [data-tab]')];
 if(!tabs.some(button=>button.dataset.tab===tab))tab='overview';
 $('websiteAnalytics').hidden=tab==='receiving';
 tabs.forEach(button=>{const selected=button.dataset.tab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected&&focus)button.focus();});
 document.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==tab);
 const url=new URL(location.href);url.searchParams.set('tab',tab);history.replaceState(null,'',url);
 window.dispatchEvent(new CustomEvent('website-tab',{detail:tab}));
 if(openLinks)$('websiteLinks').open=true;if(openSources)$('sourceDetails').open=true;
 if(tab!=='receiving'&&(!data||receivingChanged)&&!$('refresh').disabled){receivingChanged=false;void load();}
}
function pager(prefix,value){$(prefix+'Page').textContent='第 '+value.page+' / '+Math.max(1,Math.ceil(value.total/value.pageSize))+' 页 · '+count(value.total)+' 条';$(prefix+'Prev').disabled=value.page<=1;$(prefix+'Next').disabled=value.page*value.pageSize>=value.total;}
function render(value){
 data=value;$('report').hidden=false;renderJourney();$('rangeLabel').textContent=value.window.from+' 至 '+value.window.to;
 const s=value.summary;
 $('metrics').innerHTML=[['开始测试',s.started,'所选时间开始的 TikTok 测试'],['完成测试',s.finished,'完成答题，含未提交邮箱'],['成交订单',s.orders,'按实际付款时间，含后续退款']].map(([label,n,note])=>'<article class="web-metric"><span>'+label+'</span><strong>'+count(n)+'</strong><small>'+note+'</small></article>').join('');
 $('revenue').textContent=value.currencies.length?value.currencies.map(c=>money(c.grossCents,c.currency)).join(' / '):'暂无成交金额';
 $('moneyNote').textContent='退款订单 '+count(s.refundedOrders)+' 笔。'+value.definitions.money;
 $('funnel').innerHTML=[['开始测试',s.started],['完成答题',s.finished],['提交邮箱',s.submitted],['到达收银台',s.checkout],['基础报告付款',s.paidSessions]].map(([label,n])=>'<div class="web-funnel-row"><span>'+label+'</span><div class="web-funnel-track"><i style="width:'+(s.started?Math.max(0,Math.min(100,n/s.started*100)):0)+'%"></i></div><strong>'+count(n)+'</strong></div>').join('');
 $('rates').textContent='答题完成率 '+percent(s.completionRate)+' · 测试付款率 '+percent(s.paymentRate)+'（付款测试会话 ÷ 开始测试会话）';
 $('attribution').innerHTML='<div class="web-attribution"><div><strong>'+count(value.attribution.attributedStarted)+'</strong><span>已归到承接账号的测试</span></div><div><strong>'+count(value.attribution.attributedOrders)+'</strong><span>已归到承接账号的订单</span></div></div><p class="web-muted">已识别为 TikTok、尚未归到当前项目账号：'+count(value.attribution.unattributedStarted)+' 次测试，'+count(value.attribution.unattributedOrders)+' 笔订单。</p>';
 $('days').innerHTML=table(['日期','开始测试','完成答题','成交订单'],value.days.map(r=>[escape(r.day),count(r.started),count(r.finished),count(r.orders)]));
 $('sources').innerHTML=table(['来源','承接账号 / 活动','媒介','内容参数','开始','完成','收银台','付款会话','成交订单'],value.sources.rows.map(r=>[escape(r.source),escape(r.account?'@'+(r.account.username||r.account.name):r.campaign||'未归因'),escape(r.medium||'—'),escape(r.content||'—'),count(r.started),count(r.finished),count(r.checkout),count(r.paidSessions),count(r.orders)]));pager('source',value.sources);
 $('orders').innerHTML=table(['付款时间','订单号','产品','金额','状态','支付平台','来源 / 承接账号'],value.orders.rows.map(r=>[escape(datetime(r.paid_at)),escape(r.id),escape(r.testTitle)+'<small>'+(r.kind==='deep'?'深度报告':'基础报告')+'</small>',escape(money(r.amount_cents,r.currency)),r.status==='refunded'?'已退款':'已付款',escape(r.provider==='unknown'?'未知':r.provider),escape(r.account?'@'+(r.account.username||r.account.name):r.source)+'<small>'+escape(r.campaign||'无账号参数')+'</small>']));pager('order',value.orders);
 $('definitions').innerHTML=Object.values(value.definitions).map(text=>'<p>'+escape(text)+'</p>').join('');
 $('status').textContent='已连接 DeepPersona · 仅 TikTok 渠道 · 更新于 '+datetime(value.updatedAt);
}
function renderJourney(){
 const f=data?.funnel,selected=$('journeyAccount').value;
 const rows=f?.rows||[];
 $('journeyAccount').innerHTML='<option value="">全部主页账号</option>'+rows.map(row=>'<option value="'+escape(row.connectionId)+'">'+escape('@'+(row.username||row.name))+'</option>').join('');
 if(rows.some(row=>row.connectionId===selected))$('journeyAccount').value=selected;
 const active=rows.find(row=>row.connectionId===$('journeyAccount').value),summary=active?.summary||f?.summary||{};
 const metric=value=>value==null?'暂无':count(value);
 $('journeyScope').textContent=f?f.window.from+' 至 '+f.window.to+' · 网站转化按北京时间（UTC+8） · '+(active?'当前承接账号':count(rows.length)+' 个主页账号'):'正在准备漏斗数据';
 const official=f?.profileWindow||f?.window,latest=active?active.profileLatestDay:f?.profileLatestDay;
 $('profileScope').textContent=official?'主页访问：'+official.from+' 至 '+official.to+'（UTC 日报，北京时间每日 08:00 切日）。'+(latest?'已同步日报最新日期：'+latest+'（UTC）。':'暂无已同步的主页访问日报。')+'所选日期缺少数据时显示“暂无”，不代表访问为零。':'';
 const cards=[['主页访问',summary.profileViews,'TikTok UTC 日报，非实时'],['链接点击',summary.clicks,'到达短链接的请求'],['成功进站',summary.arrived,'网页确认或已开始测试'],['开始测试',summary.started,'同次访问最多计一次'],['完成测试',summary.finished,'同次访问最多计一次'],['付款',summary.paid,'基础报告付款访问']];
 $('journeyStages').innerHTML=cards.map(([label,value,note])=>'<article><span>'+label+'</span><strong>'+metric(value)+'</strong><small>'+note+'</small></article>').join('');
 $('profileClickHint').textContent='主页 → 链接参考点击率：'+percent(summary.profileClickRate)+'。'+(summary.profileWindowAligned===false?'主页访问为 UTC 日报，链接点击为北京时间，时间范围不同，不计算比率。':summary.profileClickRate==null?'数据或时间覆盖不足时不计算；主页访问与链接点击无法逐人匹配。':'这是同账号同期汇总比值，不是逐人流失率。')+' 主页数据覆盖 '+count(summary.profileAccounts)+' / '+count(summary.accounts)+' 个账号。';
 const losses=summary.losses||{};
 $('journeyLosses').innerHTML=[['点击 → 进站','未确认进站',losses.arrival],['进站 → 开始','未开始测试',losses.start],['开始 → 完成','尚未完成',losses.finish],['完成 → 付款','尚未付款',losses.payment]].map(([title,label,value])=>'<article><span>'+title+'</span><strong>'+metric(value?.lost)+' <small>次</small></strong><p>'+label+' · 流失率 '+percent(value?.rate)+'</p><small>进入下一步 '+percent(value?.conversion)+'</small></article>').join('');
 const since=f?.startedAt?datetime(new Date(f.startedAt).toISOString())+' 北京时间':'尚未启用';
 $('journeyNote').textContent='进站追踪启用时间：'+since+'。漏斗只计算启用后经过 TikTok 推广短链接的访问；刷新去重，多次做题或购买也只计一次。未确认进站可能包含加载失败、用户退出或上报被拦截。';
 const shown=active?[active]:rows;
 const lossText=value=>value?.lost==null?'暂无':count(value.lost)+' / '+percent(value.rate);
 $('journeyAccounts').innerHTML=table(['主页账号','主页访问（UTC）','链接点击','成功进站','开始测试','完成测试','付款','点击→进站流失','进站→开始流失','开始→完成流失','完成→付款流失'],shown.map(row=>[
 escape('@'+(row.username||row.name)),metric(row.profileViews)+'<small>'+count(row.profileDays)+'/'+count(row.expectedDays)+' 天'+(row.profileLatestDay?' · 最新 '+escape(row.profileLatestDay):'')+'</small>',
 ...['clicks','arrived','started','finished','paid'].map(key=>metric(row[key])),
 ...['arrival','start','finish','payment'].map(key=>lossText(row.summary?.losses?.[key]))
 ]),'生成账号主页短链接后，这里会按账号显示转化链路。');
 $('journeyDefinition').textContent=f?.definition||'尚未取得漏斗数据。';
}
async function load(query={...applied}){
 const id=++sequence;controller?.abort();controller=new AbortController();
 $('status').textContent=data?'正在刷新，当前仍显示上次查询的数据…':'正在读取网站数据…';$('refresh').disabled=true;
 try{
  const response=await fetch('/api/psychology-website?'+new URLSearchParams(query),{signal:controller.signal,cache:'no-store'});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'读取失败');
  if(id!==sequence)return;applied={...query};$('failure').hidden=true;render(result);
 }catch(error){if(error.name==='AbortError'||id!==sequence)return;$('failure').hidden=false;$('failure').textContent=error.message;$('status').textContent=data?'刷新失败，以下保留上次成功查询的数据（'+data.window.from+' 至 '+data.window.to+'）。':'尚未取得数据，暂无可显示的统计。';}
 finally{if(id===sequence){$('refresh').disabled=false;}}
}
document.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{
 draftPeriod=button.dataset.period;document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 $('customDates').hidden=draftPeriod!=='range';
 if(draftPeriod!=='range')void load({period:draftPeriod,sourcePage:1,orderPage:1});
}));
$('filters').addEventListener('submit',event=>{event.preventDefault();if(draftPeriod==='range')void load({period:'range',from:$('from').value,to:$('to').value,sourcePage:1,orderPage:1});});
$('refresh').addEventListener('click',()=>void load());
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>showTab(button.dataset.tab)));
document.querySelector('.web-tabs').addEventListener('keydown',event=>{
 const tabs=[...document.querySelectorAll('.web-tabs [data-tab]')],index=tabs.indexOf(event.target);if(index<0)return;
 const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;
 if(next<0)return;event.preventDefault();showTab(tabs[next].dataset.tab,{focus:true});
});
document.querySelector('[data-open-links]').addEventListener('click',()=>showTab('links'));
for(const [prefix,key] of [['source','sourcePage'],['order','orderPage']])for(const [suffix,delta] of [['Prev',-1],['Next',1]])$(prefix+suffix).addEventListener('click',()=>void load({...applied,[key]:Math.max(1,Number(applied[key]||1)+delta)}));
$('journeyAccount').addEventListener('change',renderJourney);
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);$('from').value=today;$('to').value=today;$('from').max=today;$('to').max=today;
setInterval(()=>{if(!document.hidden&&!$('websiteAnalytics').hidden&&!$('refresh').disabled)void load();},60000);
window.addEventListener('website-receiving-saved',()=>{receivingChanged=true;});
showTab(new URLSearchParams(location.search).get('tab')||'overview');
