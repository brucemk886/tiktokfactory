// Read-only projection of DeepPersona. Never exports emails, answers, customer IDs or report access links.
const DAY=86400000, OFFSET=8*3600000;
const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
const dayKey=time=>new Date(time+OFFSET).toISOString().slice(0,10);
export function websiteWindow(params,now=Date.now()){
 const period=params.get('period')||'7d';let from,to;
 if(period==='range'){
  from=params.get('from');to=params.get('to');
  for(const value of [from,to]){
   const parsed=Date.parse(value+'T00:00:00Z');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==value)fail('日期格式无效。');
  }
 }else{
  if(!['today','yesterday','7d','30d'].includes(period))fail('统计时间无效。');
  to=dayKey(now-(period==='yesterday'?DAY:0));from=period==='7d'?dayKey(now-6*DAY):period==='30d'?dayKey(now-29*DAY):to;
 }
 const start=Date.parse(from+'T00:00:00+08:00'),end=Date.parse(to+'T00:00:00+08:00')+DAY;
 if(end<=start||end-start>90*DAY||to>dayKey(now))fail('请选择截至今天、最多90天的有效日期范围。');
 return {period,from,to,start:new Date(start).toISOString(),end:new Date(end).toISOString(),timeZone:'Asia/Shanghai'};
}
export function websitePage(params,key){
 const raw=params.get(key)||'1';if(!/^[1-9]\d{0,5}$/.test(raw))fail('页码无效。');return Number(raw);
}
// Exclusions match DeepPersona admin traffic-stats.ts.
export const PRODUCTION_SESSION=`s.id NOT IN (SELECT session_id FROM admin_test_sessions)
 AND NOT EXISTS(SELECT 1 FROM quiz_reports xr JOIN payment_orders xo ON xo.report_id=xr.id
 WHERE xr.session_id=s.id AND (xo.livemode=0 OR substr(xo.id,1,8)='preview_'))`;
const SOURCE=`COALESCE(a.source,CASE WHEN s.source IN ('deeppersonaai.com','www.deeppersonaai.com') THEN 'unknown' ELSE s.source END,'unknown')`;
const ATTRIBUTION=`${SOURCE} AS source,COALESCE(a.campaign,s.campaign,'') AS campaign,COALESCE(a.medium,'') AS medium,COALESCE(a.content,'') AS content`;
const COHORT=`cohort AS (SELECT s.id,s.started_at,${ATTRIBUTION},
 CASE WHEN s.completed_at IS NOT NULL OR EXISTS(SELECT 1 FROM quiz_events e WHERE e.session_id=s.id AND e.event_name='email_gate_viewed') THEN 1 ELSE 0 END finished,
 CASE WHEN s.completed_at IS NOT NULL AND s.email IS NOT NULL THEN 1 ELSE 0 END submitted,
 CASE WHEN EXISTS(SELECT 1 FROM quiz_reports r JOIN payment_orders o ON o.report_id=r.id WHERE r.session_id=s.id AND o.livemode=1
 AND (o.stripe_session_id IS NOT NULL OR o.paid_at IS NOT NULL OR EXISTS(SELECT 1 FROM lemon_payments lp WHERE lp.order_id=o.id AND lp.prepared=0 AND lp.checkout_url IS NOT NULL))) THEN 1 ELSE 0 END checkout,
 CASE WHEN EXISTS(SELECT 1 FROM quiz_reports r JOIN payment_orders o ON o.report_id=r.id WHERE r.session_id=s.id AND o.livemode=1 AND o.amount_cents>0 AND o.paid_at IS NOT NULL AND o.status IN ('paid','refunded')) THEN 1 ELSE 0 END paid
 FROM quiz_sessions s LEFT JOIN quiz_attribution a ON a.session_id=s.id
 WHERE ${PRODUCTION_SESSION} AND datetime(s.started_at)>=datetime(?) AND datetime(s.started_at)<datetime(?))`;
const PURCHASES=`purchases AS (SELECT o.id,o.kind,o.amount_cents,o.currency,o.status,o.paid_at,r.test_id,${ATTRIBUTION},
 CASE WHEN o.stripe_session_id IS NOT NULL THEN 'stripe' WHEN lp.remote_order_id IS NOT NULL THEN 'lemonsqueezy' ELSE 'unknown' END provider
 FROM (SELECT id,report_id,amount_cents,currency,status,paid_at,livemode,stripe_session_id,'report' kind FROM payment_orders
 UNION ALL SELECT id,report_id,amount_cents,currency,status,paid_at,livemode,stripe_session_id,'deep' kind FROM deep_orders) o
 LEFT JOIN quiz_reports r ON r.id=o.report_id LEFT JOIN quiz_sessions s ON s.id=r.session_id
 LEFT JOIN quiz_attribution a ON a.session_id=r.session_id LEFT JOIN lemon_payments lp ON lp.order_id=o.id
 WHERE o.livemode=1 AND o.amount_cents>0 AND o.status IN ('paid','refunded') AND o.paid_at IS NOT NULL AND substr(o.id,1,8)!='preview_'
 AND NOT EXISTS(SELECT 1 FROM admin_test_sessions f WHERE f.session_id=r.session_id)
 AND datetime(o.paid_at)>=datetime(?) AND datetime(o.paid_at)<datetime(?))`;
const SOURCES=`source_rows AS (
 SELECT source,campaign,medium,content,COUNT(*) started,SUM(finished) finished,SUM(submitted) submitted,SUM(checkout) checkout,SUM(paid) paidSessions,0 orders FROM cohort GROUP BY source,campaign,medium,content
 UNION ALL SELECT source,campaign,medium,content,0,0,0,0,0,COUNT(*) FROM purchases GROUP BY source,campaign,medium,content),
 sources AS (SELECT source,campaign,medium,content,SUM(started) started,SUM(finished) finished,SUM(submitted) submitted,SUM(checkout) checkout,SUM(paidSessions) paidSessions,SUM(orders) orders FROM source_rows GROUP BY source,campaign,medium,content)`;
export function websiteQueries(db,window,{sourcePage=1,orderPage=1,pageSize=20}={}){
 const pair=[window.start,window.end],select=(sql,args=pair)=>db.prepare(sql).bind(...args);
 return [
  select(`SELECT COUNT(*) pageviews FROM traffic_anonymous_pages WHERE datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?)`),
  select(`WITH ${COHORT} SELECT COUNT(*) started,COALESCE(SUM(finished),0) finished,COALESCE(SUM(submitted),0) submitted,COALESCE(SUM(checkout),0) checkout,COALESCE(SUM(paid),0) paidSessions FROM cohort`),
  select(`WITH ${PURCHASES} SELECT COUNT(*) orders,COALESCE(SUM(status='refunded'),0) refundedOrders FROM purchases`),
  select(`WITH ${PURCHASES} SELECT currency,COUNT(*) orders,SUM(amount_cents) grossCents,SUM(CASE WHEN status='refunded' THEN 1 ELSE 0 END) refundedOrders FROM purchases GROUP BY currency ORDER BY currency`),
  select(`WITH ${COHORT},${PURCHASES},daily_rows AS (
   SELECT date(started_at,'+8 hours') day,COUNT(*) started,SUM(finished) finished,0 pageviews,0 orders FROM cohort GROUP BY day
   UNION ALL SELECT date(paid_at,'+8 hours'),0,0,0,COUNT(*) FROM purchases GROUP BY date(paid_at,'+8 hours')
   UNION ALL SELECT date(created_at,'+8 hours'),0,0,COUNT(*),0 FROM traffic_anonymous_pages WHERE datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?) GROUP BY date(created_at,'+8 hours'))
   SELECT day,SUM(started) started,SUM(finished) finished,SUM(pageviews) pageviews,SUM(orders) orders FROM daily_rows GROUP BY day ORDER BY day`,[...pair,...pair,...pair]),
  select(`WITH ${COHORT},${PURCHASES},${SOURCES} SELECT COUNT(*) total FROM sources`,[...pair,...pair]),
  select(`WITH ${COHORT},${PURCHASES},${SOURCES} SELECT * FROM sources ORDER BY orders DESC,started DESC,source,campaign,medium,content LIMIT ? OFFSET ?`,[...pair,...pair,pageSize,(sourcePage-1)*pageSize]),
  select(`WITH ${PURCHASES} SELECT p.*,COALESCE(t.title,p.test_id,'未知测试') testTitle FROM purchases p LEFT JOIN quiz_tests t ON t.id=p.test_id ORDER BY p.paid_at DESC,p.kind,p.id LIMIT ? OFFSET ?`,[...pair,pageSize,(orderPage-1)*pageSize]),
  select(`WITH ${COHORT},${PURCHASES} SELECT 'cohort' kind,source,campaign,COUNT(*) started,SUM(finished) finished,SUM(paid) paidSessions,0 orders FROM cohort GROUP BY source,campaign
   UNION ALL SELECT 'orders',source,campaign,0,0,0,COUNT(*) FROM purchases GROUP BY source,campaign`,[...pair,...pair])
 ];
}
export function trackedWebsiteLink(account){
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(account.connectionId||''))return null;
 const url=new URL('https://deeppersonaai.com/');
 url.search=new URLSearchParams({utm_source:'tiktok',utm_medium:'bio',utm_campaign:'factory-'+account.connectionId}).toString();return url.href;
}
export function accountForSource(row,accounts){
 if(row.source!=='tiktok'||!row.campaign?.startsWith('factory-'))return null;
 return accounts.find(account=>account.connectionId===row.campaign.slice(8))||null;
}
export async function readWebsiteAnalytics(db,window,context,paging={},now=Date.now()){
 const pageSize=20,sourcePage=paging.sourcePage||1,orderPage=paging.orderPage||1;
 const results=await db.batch(websiteQueries(db,window,{sourcePage,orderPage,pageSize}));
 if(results.some(result=>result.success===false||!Array.isArray(result.results)))throw new Error('独立站数据查询未完成。');
 const rows=results.map(result=>result.results),acquisition=rows[1][0],payments=rows[2][0],accounts=context.accounts||[];
 const identify=row=>{const a=accountForSource(row,accounts);return {...row,account:a?{connectionId:a.connectionId,username:a.username,name:a.name}:null};};
 const byDay=new Map(rows[4].map(row=>[row.day,row])),days=[];
 for(let at=Date.parse(window.start);at<Date.parse(window.end);at+=DAY){const day=dayKey(at);days.push(byDay.get(day)||{day,started:0,finished:0,pageviews:0,orders:0});}
 const byAccount=new Map();let attributedStarted=0,attributedOrders=0;
 for(const row of rows[8]){
  const a=accountForSource(row,accounts);if(!a)continue;
  const value=byAccount.get(a.connectionId)||{connectionId:a.connectionId,username:a.username,name:a.name,started:0,finished:0,paidSessions:0,orders:0};
  for(const key of ['started','finished','paidSessions','orders'])value[key]+=Number(row[key])||0;
  byAccount.set(a.connectionId,value);attributedStarted+=Number(row.started)||0;attributedOrders+=Number(row.orders)||0;
 }
 return {
  version:1,connected:true,updatedAt:new Date(now).toISOString(),site:'https://deeppersonaai.com/',window,
  summary:{pageviews:rows[0][0].pageviews,...acquisition,...payments,completionRate:acquisition.started?acquisition.finished/acquisition.started:null,paymentRate:acquisition.started?acquisition.paidSessions/acquisition.started:null},
  currencies:rows[3],days,sources:{rows:rows[6].map(identify),total:rows[5][0].total,page:sourcePage,pageSize},
  orders:{rows:rows[7].map(identify),total:payments.orders,page:orderPage,pageSize},
  attribution:{attributedStarted,attributedOrders,unattributedStarted:acquisition.started-attributedStarted,unattributedOrders:payments.orders-attributedOrders,accountPageviews:null,originalVideoAttribution:false},
  accounts:[...byAccount.values()].sort((a,b)=>b.orders-a.orders||b.started-a.started||a.connectionId.localeCompare(b.connectionId)),
  receivers:accounts.filter(a=>a.candidate&&a.canPublish).map(a=>({connectionId:a.connectionId,username:a.username,name:a.name,trackingUrl:trackedWebsiteLink(a),configured:(context.config?.receivers||[]).some(r=>r.connectionId===a.connectionId&&r.linkReady)})),
  campaign:{configuredReceivers:context.summary?.selectedReceivers||0,effectiveAt:context.config?.effectiveAt||null,enabled:context.config?.enabled||false},
  definitions:{
   pageviews:'全站匿名页面访问次数，刷新重复计数；不是独立访客，也没有账号级访问记录。',
   acquisition:'按开始测试时间选取会话，展示这些会话截至当前的完成、邮箱提交、收银台和基础报告付款情况；与网站后台流量口径一致。',
   orders:'按实际付款时间统计正式基础报告与深度报告订单；排除测试环境、预览和管理员标记的测试订单。后续退款仍保留原成交记录。',
   money:'成交金额为订单原价，按币种分列；未扣退款、税费或支付平台手续费，不代表实际到账。',
   attribution:'推广参数识别承接账号；共用主页链接无法追溯上游视频或引流账号。历史无参数来源保留未归因。'
  }
 };
}
