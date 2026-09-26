// Optional project-linked publication. Cached membership is keyed by brand/project/account.
export function mountPsychologyOne({api,accounts,media,changed}){
 const $=id=>document.getElementById(id),base='/api/psychology-tiktok-one';
 const cache=new Map();let brands=[],loaded=false,loadVersion=0,checkVersion=0,timer;
 const option=(text,value)=>new Option(text,value);
 const status=(text,error=false)=>{$('oneStatus').textContent=text;$('oneStatus').classList.toggle('error',error);};
 function context(){
  if(media()!=='video'||!$('oneEnabled').checked)return null;
  const brand=brands[Number($('oneBrand').value)],campaignId=$('oneProject').value;
  if(!brand||!campaignId)throw new Error('请先选择 TikTok One 品牌账号和带锚点的项目。');
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
   const unique=[...new Map(rows.filter(c=>c.anchor_id).map(c=>[c.campaign_id,c])).values()];
   $('oneProject').replaceChildren(option('请选择挂锚点的项目',''),...unique.map(c=>option((c.campaign_name||c.campaign_id)+' · '+c.campaign_id,c.campaign_id)));
   status(unique.length?'选择项目后自动检查所选账号。':'此品牌账号没有带锚点的项目。',!unique.length);
  }catch(e){if(version===loadVersion){$('oneProject').replaceChildren(option('读取失败，请刷新项目',''));status(e.message,true);}}
  finally{if(version===loadVersion)$('oneProject').disabled=false;}
 }
 async function check(force=false){
  clearTimeout(timer);const version=++checkVersion;
  let project;try{project=context();}catch{return;}
  if(!project){$('oneAccounts').replaceChildren();return;}
  const selected=accounts();$('oneAccounts').replaceChildren();
  if(!selected.length){status('请选择发布账号，创建任务时会检查并申请加入所选项目。');return;}
  const entries=selected.map(a=>{const id=String(a.connectionId||a.id),row=document.createElement('p');row.textContent=(a.username||a.displayName||id)+'：检查中…';$('oneAccounts').append(row);return {id,row,a};});
  for(const {id,row,a} of entries){
   if(version!==checkVersion)return;
   const key=JSON.stringify([project.connectionId,project.accountId,project.campaignId,id]);
   try{
    const data=!force&&cache.has(key)?cache.get(key):await api(base+'?'+new URLSearchParams({...project,resource:'prepare',creatorConnectionId:id,refresh:force?'1':'0'}));
    if(version!==checkVersion)return;
    cache.set(key,data);row.textContent=(a.username||a.displayName||id)+'：'+(data.joinStatus==='success'?'已加入当前项目':'尚未确认加入，创建时将申请加入');
   }catch(e){if(version!==checkVersion)return;row.textContent=(a.username||a.displayName||id)+'：'+e.message;row.classList.add('error');}
  }
  if(version===checkVersion)status('创建任务时会校验账号与所选项目；加入失败会显示原因并阻止创建。');
 }
 function selectionChanged(){clearTimeout(timer);checkVersion++;timer=setTimeout(()=>check().catch(e=>status(e.message,true)),300);}
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
 function markJoined(project,ids){if(!project)return;for(const id of ids){const key=JSON.stringify([project.connectionId,project.accountId,project.campaignId,id]);cache.set(key,{joinStatus:'success'});}}
 return {context,sync,selectionChanged,markJoined};
}
