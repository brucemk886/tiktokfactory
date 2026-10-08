export const FACTORY_API='/api/v1/factory';
export const FACTORY_API_ADMIN='/api/factory-api';
export const MODULE_NAMES={psychology:'心理学','photo-factory':'图文工厂'};
const copy=['psychology-copy-library','psychology-peer-hits'];
const publish=['psychology-publish'];
const op=(method,target,handler,grants,description,query=[],example={},notes='')=>({method,target,handler,grants,description,query,example,notes});
const manage=(resource,method,suffix,description,example={},query=[])=>op(method,'/api/integrations/psychology/manage/'+resource+suffix,'manage',[{effects:'psychology-effects',operations:'psychology-ops-report',styles:'psychology-publish-designs',autopilot:'psychology-autopilot'}[resource]],description,query,example);
const photo=(method,path,description,query=[],example={})=>op(method,'/api/photo-factory/'+path,'photo',['photo-factory'],description,path==='directions'?query:['directionId',...query],example);
export const CATALOG={
 psychology:{
  "videoHits.list":op("GET","/api/psychology-video-hits","videoHits",['psychology-video-hits'],"读取视频爆款列表",["page","q","sort"],{"query":{"page":1,"sort":"plays"}}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.create":op("POST","/api/psychology-video-hits","videoHits",['psychology-video-hits'],"保存视频来源、数据和原文",[],{"body":{"externalId":"tiktok-source-001","videoUrl":"https://www.tiktok.com/@example/video/123456789","title":"视频标题","caption":"发布文案","script":"完整原文","videoData":{"playCount":10000}}}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.get":op("GET","/api/psychology-video-hits/:id","videoHits",['psychology-video-hits'],"读取来源、revision和最多20个二创版本",[],{"id":"SOURCE_ID"}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.update":op("PATCH","/api/psychology-video-hits/:id","videoHits",['psychology-video-hits'],"按revision修改来源数据与原文",[],{"id":"SOURCE_ID","body":{"revision":1,"title":"更新标题"}}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.versions.get":op("GET","/api/psychology-video-hits/:id/versions/:version","videoHits",['psychology-video-hits'],"读取二创文案、启用状态和revision",[],{"id":"SOURCE_ID","version":"1"}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.versions.write":op("PUT","/api/psychology-video-hits/:id/versions/:version","videoHits",['psychology-video-hits'],"写入1–20号二创文案或启用/停用版本",[],{"id":"SOURCE_ID","version":"1","body":{"revision":0,"name":"二创1","title":"二创标题","caption":"二创发布文案","script":"完整配音文案","enabled":false}}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.frames.list":op("GET","/api/psychology-video-hits/:id/frames/:version","videoHits",['psychology-video-hits'],"分页读取原图或二创图，每页20帧",["page"],{"id":"SOURCE_ID","version":"0","query":{"page":1}}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.frames.write":op("PUT","/api/psychology-video-hits/:id/frames/:version","videoHits",['psychology-video-hits'],"逐帧写入原图或二创图片，每次1–100帧",[],{"id":"SOURCE_ID","version":"0","body":{"revision":1,"frames":[{"index":1,"assetId":"UPLOAD_UUID","text":"本帧文字","durationSeconds":3}]}}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.render":op("POST","/api/psychology-video-hits/:id/versions/:version/render","videoHits",['psychology-video-hits'],"合成此版本的图片、配音和字幕；不发布",[],{"id":"SOURCE_ID","version":"1","body":{"revision":3,"voiceGender":"female"}}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.publish":op("POST","/api/psychology-video-hits/:id/versions/:version/publish","videoHits",['psychology-video-hits'],"合成并排期官方自动发布；执行真实任务",[],{"id":"SOURCE_ID","version":"1","body":{"revision":3,"connectionIds":["ACCOUNT_ID"],"scheduleAt":1900000000,"intervalMinutes":60,"isAiGenerated":true,"voiceGender":"female"}}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),
  "videoHits.jobs":op("GET","/api/psychology-video-hits/:id/versions/:version/jobs","videoHits",['psychology-video-hits'],"读取本版本最近20个合成任务",[],{"id":"SOURCE_ID","version":"1"}, '图片上传：PUT /api/integrations/psychology/video-hits/assets/UUID，沿用项目Bearer密钥，body为PNG/JPEG/WebP字节，最多8MB。version=0原图；1–20二创。帧号连续1–300。补图停用版本，启用需覆盖全部原图。'),

  'website.read':op('GET','/api/psychology-website','website',['psychology-autopilot'],'读取 TikTok 渠道的独立站测试漏斗、成交订单和账号来源',['period','from','to','sourcePage','orderPage'],{query:{period:'7d'}},'仅转化项目负责人；仅 TikTok 归因，其他及未知来源排除；无渠道页面PV返回null；订单按付款时间，金额按币种且未扣退款/手续费。'),
  'topics.list':op('GET','/api/integrations/psychology/template-topics','topics',['psychology-topic-bank'],'读取各模板题库与题目',['template','page','pageSize','q','enabled','onlyUnused'],{query:{template:'all',page:1}}),
  'topics.get':op('GET','/api/integrations/psychology/template-topics/:id','topics',['psychology-topic-bank'],'读取题目及 revision',[],{id:'topic-ID'},'返回 coverAssetId/imageAssetIds 及关联素材元数据；素材 URL 需要登录工厂。'),
  'topics.import':op('POST','/api/integrations/psychology/template-topics','topics',['psychology-topic-bank'],'导入模板题目',[],{body:{template:'psychology-collage',items:[{title:'测试题目',content:'具体题目和完整内容',enabled:false}]}},'可选 coverAssetId 和 imageAssetIds（最多6个），须为当前账号所属的 ready 素材。单图模板 coverAssetId 自动绑定题图，仍需完整四个 choices。'),
  'topics.images.list':op('GET','/api/integrations/psychology/template-topics/:id/images','topics',['psychology-topic-bank'],'读取单图题目的图片池（每页20张）',['page'],{id:'topic-ID',query:{page:1}}),
  'topics.images.add':op('POST','/api/integrations/psychology/template-topics/:id/images','topics',['psychology-topic-bank'],'向已有单图题目补充图片',[],{id:'topic-ID',body:{revision:1,images:[{imageUrl:'https://example.com/new-image.png'}]}},'每次1–50张；可填imageKey、imageUrl或当前账号的assetId。共享题目和四个选项，确保图片含义一致。图片全局抽取一次，不能通过重新导入重置使用状态。'),
  'topics.images.update':op('PATCH','/api/integrations/psychology/template-topics/:id/images/:imageId','topics',['psychology-topic-bank'],'启用或停用图片；已抽取的图片不会恢复可用',[],{id:'topic-ID',imageId:'image-ID',body:{revision:1,enabled:false}}),
  'topics.update':op('PATCH','/api/integrations/psychology/template-topics/:id','topics',['psychology-topic-bank'],'按 revision 修改题目',[],{id:'topic-ID',body:{revision:1,title:'新的题目'}},'支持 coverAssetId/imageAssetIds；先读当前 revision。图片引用须属于当前账号，省略则保留。'),
  'copies.list':op('GET','/api/integrations/psychology/copy-library','copy',copy,'读取文案原文',['page','pageSize','mediaType','status','q'],{query:{mediaType:'all',page:1}}),
  'copies.get':op('GET','/api/integrations/psychology/copy-library/:id','copy',copy,'读取原文和 revision',[],{id:'psy-ID'}),
  'copies.update':op('PATCH','/api/integrations/psychology/copy-library/:id','copy',copy,'按 revision 修改已提取原文',[],{id:'psy-ID',body:{revision:'从读取结果取得',title:'新标题'}}),
  'rewrites.list':op('GET','/api/integrations/psychology/copy-library/:id/rewrites','copy',copy,'读取当前账号的改写版本',['page','pageSize','status'],{id:'psy-ID'}),
  'rewrites.get':op('GET','/api/integrations/psychology/copy-library/:id/rewrites/:variantId','copy',copy,'读取一个改写版本',[],{id:'psy-ID',variantId:'VERSION_ID'}),
  'rewrites.update':op('PATCH','/api/integrations/psychology/copy-library/:id/rewrites/:variantId','copy',copy,'按 revision 修改改写版本；保留现有质检规则',[],{id:'psy-ID',variantId:'VERSION_ID',body:{revision:'从读取结果取得',enabled:false}}),
  'rewrites.generate':op('POST','/api/psychology-creative/copies/generate-batch','creative',copy,'调用模型生成并保存 1–5 个改写版本',['sourceId','model','count'],{query:{sourceId:'psy-ID',count:1},body:{}},'会消耗模型额度；未通过质检的版本保持待审核。'),
  'rewrites.import':op('POST','/api/psychology-creative/copies','creative',copy,'导入已写好的改写版本',['sourceId'],{query:{sourceId:'psy-ID'},body:{items:[{externalId:'rewrite-001',title:'标题',caption:'文案',pages:['首图文字','正文文字']}]}}),
  'peers.list':op('GET','/api/psychology-peer-hits','peers',['psychology-peer-hits'],'读取同行爆款',['page','pageSize','mediaType','q','sort'],{query:{page:1}}),
  'peers.import':op('POST','/api/psychology-peer-hits','peers',['psychology-peer-hits'],'导入同行爆款及视频数据',[],{body:{items:[{videoUrl:'https://www.tiktok.com/@example/video/123456789',title:'标题',accountName:'example',playCount:10000,likeCount:100,shareCount:10,saveCount:20,mediaType:'video'}]}}),
  'publish.options':op('GET','/api/psychology-auto-publish/options','publish',publish,'读取模板及可用题库数量'),
  'publish.accounts':op('GET','/api/official-tiktok/publish-accounts','official',publish,'读取心理学可发布账号及分组',['media'],{query:{media:'video'}}),
  'publish.list':op('GET','/api/psychology-auto-publish','publish',publish,'读取本账号发布批次及状态',['page','attention','range','startDate','endDate'],{query:{range:'today',page:1}}),
  'publish.create':op('POST','/api/psychology-auto-publish','publish',publish,'生成素材并排期发布；可附加 tiktokOne 项目挂锚点',[],{body:{name:'AI 模板测试',mediaType:'video',sourceType:'topic-bank',template:'psychology',count:1,connectionIds:['ACCOUNT_ID'],scheduleAt:1900000000,intervalMinutes:60,selection:'random',onlyUnused:true}},'scheduleAt 为秒级 Unix 时间戳，必须留出生成时间；会创建真实任务。可选 tiktokOne:{connectionId,accountId,campaignId}。'),
  'publish.retry':op('POST','/api/psychology-auto-publish/:id/retry','publish',publish,'重试一个现有失败任务',[],{id:'ITEM_ID',body:{}}),
  'publish.groupRetry':op('POST','/api/psychology-auto-publish/groups/:id/retry','publish',publish,'重试一个发布合批',[],{id:'GROUP_ID',body:{}}),
  'tiktokOne.brands':op('GET','/api/psychology-tiktok-one','one',publish,'读取可用品牌账号'),
  'tiktokOne.projects':op('GET','/api/psychology-tiktok-one','one',publish,'读取品牌项目',['connectionId','accountId','page','refresh'],{query:{connectionId:'BRAND_CONNECTION',accountId:'BRAND_ACCOUNT'}}),
  'tiktokOne.check':op('GET','/api/psychology-tiktok-one','one',publish,'检查账号在指定项目的合作状态',['connectionId','accountId','campaignId','creatorConnectionId','refresh'],{query:{connectionId:'BRAND_CONNECTION',accountId:'BRAND_ACCOUNT',campaignId:'PROJECT_ID',creatorConnectionId:'ACCOUNT_ID'}}),
  'effects.get':manage('effects','GET','','读取数据概览',{query:{period:'today'}},['period','group','from','to','date','viewId']),
  'operations.get':manage('operations','GET','','读取运营报表',{query:{period:'today',media:'photo',panel:'overview'}},['period','group','from','to','media','panel','page','sort','filter','q','mode','key','viewId']),
  'styles.list':manage('styles','GET','','读取当前账号可用样式'),
  'styles.create':manage('styles','POST','','基于已有样式新建样式',{body:{label:'新样式',baseStyleId:'classic'}}),
  'styles.update':manage('styles','PATCH','/:id','按 revision 修改样式，仅影响未来任务',{id:'STYLE_ID',body:{revision:1,enabled:false}}),
  'autopilot.list':manage('autopilot','GET','','读取自动运营计划、分组及状态',{query:{period:'today',page:1}},['period','page','pageSize','refreshGroups','account']),
  'autopilot.get':manage('autopilot','GET','/:id','读取单个自动运营计划',{id:'pilot-UUID'},['period']),
  'autopilot.create':manage('autopilot','POST','','创建暂停的自动运营计划',{body:{groupId:'GROUP_ID',strategy:'original',days:7,slots:[{hour:0,minute:15},{hour:0,minute:45}]}}),
  'autopilot.update':manage('autopilot','PATCH','/:id','修改运营计划；status=active 启动真实自动运营',{id:'pilot-UUID',body:{revision:1,status:'active'}}),
  'autopilot.schedule':manage('autopilot','PATCH','/:id/schedule','修改未来生效的发布时间',{id:'pilot-UUID',body:{revision:1,slots:[{hour:0,minute:15},{hour:0,minute:45}]}}),
 },
 'photo-factory':{
  'directions.list':photo('GET','directions','读取内容方向、配置、模板及模型'),
  'directions.create':photo('POST','directions','创建内容方向',[],{body:{slug:'zodiac',name:'星座',config:{}}}),
  'directions.update':photo('PATCH','direction','按 revision 修改内容方向',[],{query:{directionId:'DIRECTION_ID'},body:{revision:1,name:'新名称'}}),
  'copies.list':photo('GET','copies','读取方向内原文与改写',['page','pageSize','kind','q'],{query:{directionId:'DIRECTION_ID',page:1}}),
  'copies.import':photo('POST','copies','导入原文或改写；最多 50 条',[],{query:{directionId:'DIRECTION_ID'},body:{items:[{externalId:'copy-001',title:'标题',caption:'文案',pages:['首图文字','正文文字'],kind:'original',enabled:true}]}}),
  'copies.update':photo('PATCH','copy','启用或停用指定文案',[],{query:{directionId:'DIRECTION_ID'},body:{id:'COPY_ID',enabled:false}}),
  'rewrites.generate':photo('POST','rewrite','按方向配置调用模型改写，保存为待启用版本',[],{query:{directionId:'DIRECTION_ID'},body:{sourceId:'COPY_ID'}}),
  'accounts.list':photo('GET','directory','读取可用分组及账号',['refresh'],{query:{directionId:'DIRECTION_ID'}}),
  'autopilot.list':photo('GET','pilots','读取方向内自动运营计划',[],{query:{directionId:'DIRECTION_ID'}}),
  'autopilot.create':photo('POST','pilots','创建自动运营草稿',[],{query:{directionId:'DIRECTION_ID'},body:{groupId:'GROUP_ID',strategy:'original',days:7,times:['00:15','00:45']}}),
  'autopilot.update':photo('PATCH','pilot','status=active 启动，paused 暂停，ended 结束',[],{query:{directionId:'DIRECTION_ID'},body:{id:'PILOT_ID',status:'active'}}),
  'reports.get':photo('GET','report','读取方向内运营报表',['period','page'],{query:{directionId:'DIRECTION_ID',period:'today'}}),
 }
};
for(const resource of ['effects','operations']){
 CATALOG.psychology[resource+'.views.list']=manage(resource,'GET','/views','读取已保存报表方案');
 CATALOG.psychology[resource+'.views.create']=manage(resource,'POST','/views','保存报表查询方案',{body:{name:'今日',query:{period:'today'}}});
 CATALOG.psychology[resource+'.views.update']=manage(resource,'PATCH','/views/:id','按 revision 修改报表方案',{id:'VIEW_ID',body:{revision:1,name:'新的名称'}});
}
export const allowed=(user,entry)=>user?.role==='admin'&&entry.grants.some(g=>user.sidebarModules?.includes(g));
export function publicCatalog(user,module){
 const modules=module?[module]:Object.keys(CATALOG);
 return modules.filter(m=>Object.hasOwn(CATALOG,m)).map(m=>({module:m,name:MODULE_NAMES[m],actions:Object.entries(CATALOG[m]).filter(([,entry])=>allowed(user,entry)).map(([action,e])=>({action,description:e.description,mutates:e.method!=='GET',params:{pathIds:[...e.target.matchAll(/:([A-Za-z]+)/g)].map(m=>m[1]),query:e.query,body:e.method!=='GET'?'JSON object per example':null},example:{module:m,action,...(e.method!=='GET'?{requestId:'GENERATE_A_UUID'}:{}),params:e.example},notes:e.notes}))})).filter(m=>m.actions.length);
}

CATALOG.psychology['rewrites.import'].notes='导入沿用现有文案启用与审核规则。需要停用时，读取版本后用 rewrites.update 提交 revision 和 enabled:false。';
