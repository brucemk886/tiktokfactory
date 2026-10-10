import {sourceDayWindow} from './report-time.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
const pct=v=>v==null?'—':(v*100).toFixed(1)+'%';
const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未同步';
const table=(heads,rows)=>'<div class="receiving-table"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const coverage=s=>s.coverageComplete?'': '<small class="receiving-warning">部分日期 / 账号未覆盖</small>';
export function mountReceivingReport(standard,header){
 const params=new URLSearchParams(location.search);standard.hidden=true;
 for(const id of ['status','methodToggle','methodPanel']){const el=document.getElementById(id);if(el)el.hidden=true;}
 header.querySelector('.page-lead').textContent='按天查看引流图文与承接账号表现，跟踪从主页链接到进站、测试的转化。';
 const root=document.createElement('section');root.className='receiving-report';root.setAttribute('aria-label','承接引流报表');standard.after(root);
 root.innerHTML=`<form class="receiving-filters"><div class="receiving-presets" aria-label="统计日期">${[['today','今天'],['yesterday','昨天'],['7d','近 7 天'],['30d','近 30 天'],['range','自定义']].map(([v,t])=>'<button type="button" data-period="'+v+'">'+t+'</button>').join('')}</div><div class="receiving-dates" hidden><label>开始日期<input name="from" type="date"></label><span>至</span><label>结束日期<input name="to" type="date"></label></div><label class="receiving-account">承接账号<select name="receiver"><option value="">全部承接账号</option></select></label><button type="submit" class="receiving-refresh">刷新数据</button></form><p class="receiving-status" role="status" aria-live="polite"></p><div class="receiving-content" hidden></div>`;
 const form=root.querySelector('form'),status=root.querySelector('[role=status]'),content=root.querySelector('.receiving-content'),field=k=>form.elements.namedItem(k);
 let period=['today','yesterday','7d','30d','range'].includes(params.get('receivingPeriod'))?params.get('receivingPeriod'):'today',receiver=params.get('receivingReceiver')||'',controller,revision=0,applied;
 for(const key of ['from','to'])field(key).value=params.get('receiving'+key[0].toUpperCase()+key.slice(1))||'';
 if(receiver){field('receiver').add(new Option(receiver,receiver));field('receiver').value=receiver;}
 function dates(){root.querySelectorAll('[data-period]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.period===period));b.classList.toggle('is-active',b.dataset.period===period);});root.querySelector('.receiving-dates').hidden=period!=='range';field('from').required=field('to').required=period==='range';}
 dates();root.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{period=b.dataset.period;dates();if(period!=='range')load();});field('receiver').onchange=()=>load();form.onsubmit=e=>{e.preventDefault();load();};
 async function load(page=1){
  controller?.abort();controller=new AbortController();const own=controller,id=++revision;
  const query={period,receiver:field('receiver').value,from:field('from').value,to:field('to').value,page};
  status.textContent='正在读取引流图文、承接主页与独立站数据…';content.hidden=true;root.setAttribute('aria-busy','true');
  try{
   const response=await fetch('/api/psychology-receiving-report?'+new URLSearchParams(query),{cache:'no-store',signal:own.signal}),data=await response.json();if(!response.ok)throw Error(data.error||'读取失败');if(id!==revision)return;
   applied={...query,from:data.window.from,to:data.window.to};field('from').value=data.window.from;field('to').value=data.window.to;
   field('receiver').innerHTML='<option value="">全部承接账号</option>'+data.choices.map(a=>'<option value="'+esc(a.connectionId)+'">@'+esc(a.username)+'</option>').join('');field('receiver').value=data.receiver;
   const url=new URL(location.href);for(const key of ['period','receiver','from','to'])url.searchParams.set('receiving'+key[0].toUpperCase()+key.slice(1),applied[key]);history.replaceState({},'',url);
   status.textContent=data.window.from+' 至 '+data.window.to+' · 图文发布日 / 链接点击日：北京时间 · 读取于 '+time(data.updatedAt);
   render(data);content.hidden=false;
  }catch(e){if(id===revision&&e.name!=='AbortError')status.textContent=e.message+' 请点击“刷新数据”重试。';}
  finally{if(id===revision)root.setAttribute('aria-busy','false');}
 }
 function render(d){
  const s=d.summary,profileNote=(s.profileComplete?'日报完整 · ':'日报未齐 · ')+sourceDayWindow(d.window.from,d.window.to)+(d.profileLatestDay?' · 最新日报 '+sourceDayWindow(d.profileLatestDay):'');
  const cards=[['01','引流图文累计曝光',s.views,'本期发布 '+fmt(s.posts)+' 条 · 播放已同步 '+fmt(s.synced)+' 条','TikTok 累计播放参考'],['02','承接主页访问',s.profileViews,profileNote,'承接账号整体访问'],['03','主页链接点击',s.clicks,'短链接有效访问'+(s.coverageComplete?'':' · 统计覆盖不完整'),'北京时间 · 点击日'],['04','成功进站',s.arrived,'点击 → 进站 '+pct(s.losses.arrival.conversion),'与短链接点击关联'],['05','开始测试',s.started,'进站 → 测试 '+pct(s.losses.start.conversion),'与同一次点击关联']];
  content.innerHTML=(d.siteError||!d.siteReady?'<p class="receiving-alert">独立站点击 / 进站数据暂不可用，显示为 —。已读取的图文和主页访问仍可查看。</p>':'')+
   '<div class="receiving-summary"><span><b>'+fmt(s.posts)+'</b> 条引流图文</span><span><b>'+fmt(s.publishers)+'</b> 个发布账号</span><span><b>'+fmt(s.receivers)+'</b> 个承接账号</span><span>@引导 '+fmt(s.mentions)+' 条 · 自己主页引导 '+fmt(s.selfBio)+' 条</span></div>'+
   '<div class="receiving-funnel">'+cards.map(([i,label,value,note,basis])=>'<article><div class="receiving-step"><span>'+i+'</span>'+label+'</div><strong>'+fmt(value)+'</strong><p>'+esc(note)+'</p><small>'+esc(basis)+'</small></article>').join('')+'</div>'+
   '<div class="receiving-funnel-note"><span>图文与主页是账号层面的观察指标，无法逐人串联；可关联的漏斗从短链接点击开始。</span><span>完成测试 <b>'+fmt(s.finished)+'</b> · 付款 <b>'+fmt(s.paid)+'</b></span></div>'+
   '<section class="receiving-panel"><div class="receiving-heading"><div><h2>每天的引流表现</h2><p>曝光按北京时间实际发布日归属，显示当前累计值；主页访问按平台日报提供，折合北京时间当日 08:00 至次日 08:00。</p></div><span class="receiving-chip">'+d.daily.length+' 天</span></div>'+table(['日期','已发布图文','图文累计曝光','主页访问 · 北京 08:00 切日','主页链接点击','成功进站','点击 → 进站','开始 / 完成测试'],d.daily.map(r=>[esc(r.day),fmt(r.posts),fmt(r.views)+'<small>已同步 '+fmt(r.synced)+' / '+fmt(r.posts)+' 条</small>',fmt(r.summary.profileViews)+'<small>'+esc(sourceDayWindow(r.day))+'</small>'+(r.summary.profileComplete?'':'<small>日报未齐</small>'),fmt(r.summary.clicks)+coverage(r.summary),fmt(r.summary.arrived),pct(r.summary.losses.arrival.conversion),fmt(r.summary.started)+' / '+fmt(r.summary.finished)]))+'</section>'+
   '<section class="receiving-panel"><div class="receiving-heading"><div><h2>承接账号表现</h2><p>同一承接账号的主页及链接指标只计一次。展开账号可看哪些发布账号为它引流。</p></div></div>'+(d.receivers.length?table(['承接账号 / 引流来源','图文数 / 发布账号','图文累计曝光','主页访问 · 北京 08:00 切日','主页链接点击','成功进站','点击 → 进站'],d.receivers.map(r=>['<details><summary>@'+esc(r.username||r.connectionId)+'</summary><div class="receiving-sources">'+(r.sourceAccounts.length?r.sourceAccounts.map(a=>'<p>@'+esc(a.username)+'<small>'+fmt(a.posts)+' 条 · 累计 '+fmt(a.views)+' 播放</small></p>').join(''):'本期暂无已发布引流图文')+'</div></details>',fmt(r.posts)+' 条 / '+fmt(r.publishers)+' 个',fmt(r.views)+'<small>已同步 '+fmt(r.synced)+' 条</small>',fmt(r.summary.profileViews)+(r.summary.profileComplete?'':'<small>日报未齐</small>'),fmt(r.summary.clicks)+(r.tracking==='no-link'?'<small>未生成主页短链接</small>':coverage(r.summary)),fmt(r.summary.arrived),pct(r.summary.losses.arrival.conversion)])):'<div class="receiving-empty">暂无承接账号记录。保存承接配置，或发布带 @承接账号的图文后，可在这里查看。</div>')+'</section>'+
   '<details class="receiving-panel receiving-posts"><summary>引流图文明细 <span>'+fmt(d.pagination.total)+' 条</span></summary><p>实际发布时保存的承接关系；每页 20 条。</p><div class="receiving-post-content">'+(d.details.length?table(['图文 / 发布账号','引导账号','实际发布时间（北京时间）','累计曝光','发布时引导文案'],d.details.map(r=>['<b>'+esc(r.title)+'</b><small>@'+esc(r.publisher)+'</small>',r.selfBio?'自己的主页':'@'+esc(r.publishedHandle||r.receiver),esc(time(r.publishedAt)),fmt(r.views),esc(r.cta||'历史任务仅保留承接关系')])):'<div class="receiving-empty">本期暂无已发布的引流图文。已排期、待提交的任务暂不计入曝光。</div>')+'</div><footer class="receiving-pager"><span>共 '+d.pagination.total+' 条 · 第 '+d.pagination.page+' / '+d.pagination.pages+' 页</span><button data-page="'+(d.pagination.page-1)+'" '+(d.pagination.page<=1?'disabled':'')+'>上一页</button><button data-page="'+(d.pagination.page+1)+'" '+(d.pagination.page>=d.pagination.pages?'disabled':'')+'>下一页</button></footer></details>'+
   '<details class="receiving-definitions"><summary>统计口径与数据覆盖</summary>'+Object.values(d.definitions).map(text=>'<p>'+esc(text)+'</p>').join('')+'<p>图文指标最近同步：'+esc(time(d.photoSyncedAt))+'。'+(s.unmappedPosts?'本期另有 '+fmt(s.unmappedPosts)+' 条图文未保存承接关系，未计入此报表；不会根据当前设置猜测历史归属。':'')+'</p></details>';
  content.querySelectorAll('[data-page]').forEach(b=>b.onclick=async()=>{await load(Number(b.dataset.page));const details=content.querySelector('.receiving-posts');if(details){details.open=true;details.scrollIntoView({block:'start'});}});
 }
 load();
}
