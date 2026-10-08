// Optional project-linked publication. Cached membership is keyed by brand/project/account.
const PSYCHOLOGY_ANCHOR_PROJECT_IDS = new Set([
 '7693454687705595917',
 '7584639271164739598',
]);
export function mountPsychologyOne({api,accounts,media,changed,isBusy=()=>false,setBusy=()=>{}}){
 const $=id=>document.getElementById(id),base='/api/psychology-tiktok-one';
 const cache=new Map();let brands=[],loaded=false,loadVersion=0,checkVersion=0,timer,joining=false;
 const option=(text,value)=>new Option(text,value);
 const status=(text,error=false)=>{$('oneStatus').textContent=text;$('oneStatus').classList.toggle('error',error);};
 function context(){
  if(media()!=='video'||!$('oneEnabled').checked)return null;
  const brand=$('oneBrand').value===''?null:brands[Number($('oneBrand').value)],campaignId=$('oneProject').value;
  if(!brand||!PSYCHOLOGY_ANCHOR_PROJECT_IDS.has(campaignId))throw new Error('请先选择 TikTok One 品牌账号和带锚点的项目。');
  return {connectionId:brand.connectionId,accountId:brand.accountId,campaignId};
 }
 async function loadBrands(){
  if(loaded)return;
  const data=await api(base+'?resource=connections');
  brands=(data.connections||[]).flatMap(c=>(c.accountIds||[]).map(accountId=>({connectionId:c.id,accountId,owner:c.ownerEmail})));
  $('oneBrand').replaceChildren(option('请选择品牌账号',''),...brands.map((b,i)=>option(b.accountId+' · '+b.owner,String(i))));
  loaded=true;
  if(!brands.length)status('尚未连接 TikTok One 品牌账号，请先到中台连接。',true);
  if(brands.length===1){$('oneBrand').value='0';await loadProjects();}
 }
 async function loadProjects(refresh=false){
  if(joining||isBusy())return;
  $('oneJoinSelected').disabled=true;
  const version=++loadVersion;checkVersion++;$('oneAccounts').replaceChildren();
  $('oneProject').replaceChildren(option('正在读取项目…',''));$('oneProject').disabled=true;changed();
  const brand=$('oneBrand').value===''?null:brands[Number($('oneBrand').value)];
  if(!brand){$('oneProject').replaceChildren(option('请先选择品牌账号',''));return;}
  try{
   const rows=[];let page=1,total=1;
   do{const data=await api(base+'?'+new URLSearchParams({resource:'projects',connectionId:brand.connectionId,accountId:brand.accountId,page:String(page),refresh:refresh?'1':'0'}));
    if(version!==loadVersion)return;
    rows.push(...(data.campaigns||[]));total=Number(data.page_info?.total_page||1);
    if(!Number.isInteger(total)||total>200)throw new Error('项目列表分页异常，请在中台检查。');page++;
   }while(page<=total);
   const unique=[...new Map(rows.filter(c=>c.anchor_id&&PSYCHOLOGY_ANCHOR_PROJECT_IDS.has(String(c.campaign_id))).map(c=>[c.campaign_id,c])).values()];
   $('oneProject').replaceChildren(option('请选择挂锚点的项目',''),...unique.map(c=>option((c.campaign_name||c.campaign_id)+' · '+c.campaign_id,c.campaign_id)));
   status(unique.length?'选择项目后自动检查所选账号。':'此品牌账号下暂未找到指定的心理学锚点项目。',!unique.length);
  }catch(e){if(version===loadVersion){$('oneProject').replaceChildren(option('读取失败，请刷新项目',''));status(e.message,true);}}
  finally{if(version===loadVersion)$('oneProject').disabled=false;}
 }
 const accountId=a=>String(a.connectionId||a.id);
 const memberKey=(project,id)=>JSON.stringify([project.connectionId,project.accountId,project.campaignId,id]);
 function renderMembers(project,selected){
  $('oneAccounts').replaceChildren();
  return selected.map(a=>{
   const id=accountId(a),row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');
   row.className='one-account-row';row.dataset.oneAccount=id;button.type='button';button.dataset.oneJoin=id;
   button.onclick=()=>join([id]).catch(e=>status(e.message,true));row.append(label,button);$('oneAccounts').append(row);
   const update=(working=false)=>{
    const data=cache.get(memberKey(project,id)),joined=data?.joinStatus==='success';
    row.dataset.memberState=working?'joining':joined?'joined':data?.error?'error':data?'unknown':'checking';
    label.textContent=(a.username||a.displayName||id)+'：'+(working?'正在申请加入…':joined?'已确认加入当前项目':data?.error?'加入未确认：'+data.error:data?'尚未确认加入当前项目':'检查中…');
    label.classList.toggle('error',Boolean(data?.error));button.textContent=joined?'已加入':data?.error?'重试加入':'加入项目';
    button.disabled=joining||isBusy()||joined||!data;
   };
   update();return {id,update};
  });
 }
 function membershipSummary(project,selected){
  const joined=selected.filter(a=>cache.get(memberKey(project,accountId(a)))?.joinStatus==='success').length;
  const errors=selected.filter(a=>cache.get(memberKey(project,accountId(a)))?.error).length;
  $('oneJoinSelected').disabled=joining||isBusy()||!selected.length||joined===selected.length;
  status(selected.length?`已确认加入 ${joined} / ${selected.length} 个账号${errors?' · '+errors+' 个未确认，请查看原因后重试':''}。加入项目不会发布视频，最后确认发布时仍会校验。`:'请选择发布账号，再检查并加入项目。',errors>0);
 }
 async function check(force=false){
  if(joining||isBusy())return;
  clearTimeout(timer);const version=++checkVersion;
  let project;try{project=context();}catch{$('oneJoinSelected').disabled=true;return;}
  if(!project){$('oneAccounts').replaceChildren();$('oneJoinSelected').disabled=true;return;}
  const selected=accounts(),entries=renderMembers(project,selected);$('oneJoinSelected').disabled=true;
  if(!selected.length){membershipSummary(project,selected);return;}
  for(const {id,update} of entries){
   if(version!==checkVersion)return;
   const key=memberKey(project,id);
   try{
    const data=!force&&cache.has(key)?cache.get(key):await api(base+'?'+new URLSearchParams({...project,resource:'prepare',creatorConnectionId:id,refresh:force?'1':'0'}));
    if(version!==checkVersion)return;
    cache.set(key,data);update();
   }catch(e){if(version!==checkVersion)return;cache.set(key,{error:e.message});update();}
  }
  if(version===checkVersion)membershipSummary(project,selected);
 }
 async function join(ids){
  if(joining||isBusy())return;
  const project=context();if(!project)throw new Error('请先选择 TikTok One 项目。');
  const selected=accounts(),pending=selected.filter(a=>(!ids||ids.includes(accountId(a)))&&cache.get(memberKey(project,accountId(a)))?.joinStatus!=='success');
  if(!pending.length){membershipSummary(project,selected);return;}
  if(!confirm(`确认将 ${pending.length} 个账号加入项目 ${project.campaignId}？\n只申请加入项目，不会发布视频。`))return;
  clearTimeout(timer);checkVersion++;joining=true;
  const entries=renderMembers(project,selected),controls=[...$('batchForm').querySelectorAll('input,select,textarea,button')].map(node=>({node,disabled:node.disabled}));
  setBusy(true);controls.forEach(({node})=>node.disabled=true);
  try{
   for(let index=0;index<pending.length;index++){
    const id=accountId(pending[index]),entry=entries.find(e=>e.id===id),key=memberKey(project,id);
    entry.update(true);status(`正在处理 ${index+1} / ${pending.length} 个账号，请等待结果。`);
    try{
     const data=await api(base,{...project,creatorConnectionId:id,action:'ensure'});
     if(data.joined!==true)throw new Error('尚未确认加入，请重新检查账号。');
     cache.set(key,{...data,joinStatus:'success'});
    }catch(e){cache.set(key,{error:e.message});}
    entry.update();
   }
  }finally{
   joining=false;controls.forEach(({node,disabled})=>node.disabled=disabled);setBusy(false);
   renderMembers(project,selected);membershipSummary(project,selected);
  }
 }
 function selectionChanged(){
  if(joining)return;
  clearTimeout(timer);checkVersion++;$('oneJoinSelected').disabled=true;$('oneAccounts').replaceChildren();
  timer=setTimeout(()=>check().catch(e=>status(e.message,true)),300);
 }
 function sync(){
  $('oneSection').hidden=media()!=='video';$('oneFields').hidden=!$('oneEnabled').checked;
  if(media()!=='video'){checkVersion++;clearTimeout(timer);return;}
  if($('oneEnabled').checked)loadBrands().then(()=>selectionChanged()).catch(e=>status(e.message,true));
 }
 $('oneEnabled').onchange=()=>{changed();sync();};
 $('oneBrand').onchange=()=>loadProjects().catch(e=>status(e.message,true));
 $('oneProject').onchange=()=>{changed();selectionChanged();};
 $('oneRefreshProjects').onclick=()=>loadProjects(true).catch(e=>status(e.message,true));
 $('oneRecheck').onclick=()=>check(true).catch(e=>status(e.message,true));
 $('oneJoinSelected').onclick=()=>join().catch(e=>status(e.message,true));
 function markJoined(project,ids){if(!project)return;for(const id of ids){const key=JSON.stringify([project.connectionId,project.accountId,project.campaignId,id]);cache.set(key,{joinStatus:'success'});}}
 return {context,sync,selectionChanged,markJoined};
}
