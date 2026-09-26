const ID=/^asset-[0-9a-f-]{36}$/i;
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export function assetReferences(input){
 const coverAssetId=input.coverAssetId??input.cover_asset_id??'';
 const imageAssetIds=input.imageAssetIds??JSON.parse(input.image_asset_ids_json||'[]');
 if(typeof coverAssetId!=='string'||coverAssetId&&!ID.test(coverAssetId))fail('coverAssetId 无效。');
 if(!Array.isArray(imageAssetIds)||imageAssetIds.length>6||imageAssetIds.some(id=>typeof id!=='string'||!ID.test(id)))fail('imageAssetIds 须为最多6个素材ID。');
 const ids=[...new Set([...imageAssetIds,...(coverAssetId?[coverAssetId]:[])])];
 if(ids.length>6)fail('题目最多关联6张图片。');return {coverAssetId,imageAssetIds:ids};
}
export async function resolveTopicAssets(db,input,owner,template){
 const refs=assetReferences(input),assets=[];
 for(const id of refs.imageAssetIds){const row=await db.prepare("SELECT * FROM factory_assets WHERE id=? AND owner_id=? AND status='ready'").bind(id,owner).first();if(!row)fail('素材不存在、未就绪或不属于当前账号。',403);assets.push(row);}
 const cover=assets.find(a=>a.id===refs.coverAssetId);
 return {...input,...refs,...(template==='psychology-target-2'&&cover?{imageKey:cover.object_key,imageUrl:''}:{})};
}
export const publicAsset=(a,origin='')=>a&&({id:a.id,url:origin+'/api/psychology-template-topics/assets?key='+encodeURIComponent(a.object_key),mimeType:a.mime_type,bytes:a.bytes,width:a.width,height:a.height,sha256:a.sha256,model:a.generation_model});
export async function hydrateTopicAssets(db,items,origin=''){
 const ids=[...new Set(items.flatMap(i=>[i.coverAssetId,...(i.imageAssetIds||[])]).filter(Boolean))];
 if(!ids.length)return items;
 const rows=[];
 for(let start=0;start<ids.length;start+=80){const chunk=ids.slice(start,start+80);rows.push(...(await db.prepare("SELECT * FROM factory_assets WHERE status='ready' AND id IN ("+chunk.map(()=>'?').join(',')+")").bind(...chunk).all()).results);}
 const assets=new Map(rows.map(a=>[a.id,publicAsset(a,origin)]));
 return items.map(i=>({...i,coverAsset:assets.get(i.coverAssetId)||null,imageAssets:(i.imageAssetIds||[]).map(id=>assets.get(id)).filter(Boolean)}));
}
