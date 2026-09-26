import {VISUAL_STYLES,currentStyleId} from '../../public/psychology-visual-styles.js';
import {json,errorJson,sha256Hex} from './http.js';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export const STYLE_FIELDS=['label','coverBg','coverInk','bg','ink','accent','layout'];
export async function managedStyles(db,owner){
 const rows=(await db.prepare('SELECT * FROM psychology_managed_styles WHERE owner=? ORDER BY created_at,id').bind(owner).all()).results;
 const byId=new Map(rows.map(r=>[r.id,r]));
 const stored=r=>({...JSON.parse(r.definition_json),id:r.id,enabled:!!r.enabled,revision:r.revision,builtin:VISUAL_STYLES.some(s=>s.id===r.id)});
 return [...VISUAL_STYLES.map(s=>byId.has(s.id)?stored(byId.get(s.id)):{...s,enabled:true,revision:0,builtin:true}),...rows.filter(r=>!VISUAL_STYLES.some(s=>s.id===r.id)).map(stored)];
}
export function selectManagedStyle(styles,mode,fixed){
 if(mode==='legacy')return null;
 const active=styles.filter(s=>s.enabled),chosen=mode==='fixed'?active.find(s=>s.id===currentStyleId(fixed)):active[Math.floor(Math.random()*active.length)];
 if(!chosen)fail('没有可用的图文样式，请启用样式或重新选择。',409);
 return Object.fromEntries(['id',...STYLE_FIELDS,'revision'].map(k=>[k,chosen[k]]));
}
function definition(input,base){
 const out={...base};
 for(const field of STYLE_FIELDS)if(Object.hasOwn(input,field))out[field]=input[field];
 if(typeof out.label!=='string'||!out.label.trim()||out.label.length>60)fail('label 须为 1–60 字符的样式名称。');
 out.label=out.label.trim();
 for(const field of ['coverBg','coverInk','bg','ink','accent'])if(!/^#[a-f0-9]{6}$/i.test(out[field]||''))fail(field+' 须为 #RRGGBB 颜色。');
 if(!VISUAL_STYLES.some(s=>s.layout===out.layout))fail('layout 须使用读取返回的 layouts 之一。');
 return Object.fromEntries(STYLE_FIELDS.map(k=>[k,out[k]]));
}
export async function styleApi(db,user,path,method,input){
 const items=await managedStyles(db,user.username);
 if(method==='GET'){
  if(!path)return json({items,total:items.length,active:items.filter(s=>s.enabled).length,layouts:[...new Set(VISUAL_STYLES.map(s=>s.layout))]});
  const item=items.find(s=>s.id===path);return item?json({item}):errorJson('样式不存在。',404);
 }
 if(!['POST','PATCH'].includes(method)||((method==='POST')===!!path))return errorJson('使用 POST 新增或 PATCH /样式ID 修改。',405);
 if(!input||typeof input!=='object'||Array.isArray(input))fail('请提交样式对象。');
 const allowed=[...STYLE_FIELDS,'enabled',...(method==='POST'?['requestId','baseStyleId']:['revision'])];
 if(Object.keys(input).some(k=>!allowed.includes(k)))fail('包含未知或不可修改的样式字段。');
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')fail('enabled 须为布尔值。');
 let id=path,old,createHash='';
 if(method==='POST'){
  if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))fail('新增须填写 UUID requestId，重试沿用同一值。');
  id='style-'+(await sha256Hex(user.username+':'+input.requestId)).slice(0,32);
  const base=items.find(s=>s.id===input.baseStyleId);if(!base)fail('baseStyleId 须为现有样式 ID。');
  old={...base,enabled:false,revision:0};
  // Hash explicit input, not an editable base style, so an identical retry remains idempotent.
  createHash=await sha256Hex(JSON.stringify(Object.keys(input).sort().map(k=>[k,input[k]])));
  const prior=await db.prepare('SELECT creation_hash FROM psychology_managed_styles WHERE owner=? AND id=?').bind(user.username,id).first();
  if(prior){if(prior.creation_hash!==createHash)fail('requestId 已用于不同内容。',409);return json({duplicate:true,item:items.find(s=>s.id===id)});}
  if(items.length>=100)fail('每个账号最多保存 100 套样式。');
 }else{
  old=items.find(s=>s.id===id);if(!old)fail('样式不存在。',404);
  if(!Number.isInteger(input.revision)||input.revision!==old.revision)fail('revision 缺失或样式已修改，请重新读取。',409);
  if(Object.keys(input).length===1)fail('请至少提交一个修改字段。');
 }
 const value=definition(input,old),enabled=input.enabled??old.enabled,now=Date.now();
 // This guarded SQL also protects concurrent attempts to disable the last active style.
 const others=`((SELECT count(*) FROM json_each(?) b WHERE b.value<>? AND NOT EXISTS (SELECT 1 FROM psychology_managed_styles s WHERE s.owner=? AND s.id=b.value AND s.enabled=0))+(SELECT count(*) FROM psychology_managed_styles s WHERE s.owner=? AND s.id<>? AND s.id NOT IN (SELECT value FROM json_each(?)) AND s.enabled=1))>0`;
 const builtins=JSON.stringify(VISUAL_STYLES.map(s=>s.id)),guardArgs=[builtins,id,user.username,user.username,id,builtins];
 const changed=await db.prepare(`INSERT INTO psychology_managed_styles(owner,id,definition_json,enabled,revision,creation_hash,created_at,updated_at)
 SELECT ?,?,?,?,1,?,?,? WHERE (?=1 OR ${others}) AND (?=0 OR EXISTS(SELECT 1 FROM psychology_managed_styles WHERE owner=? AND id=?)) AND (EXISTS(SELECT 1 FROM json_each(?) WHERE value=?) OR EXISTS(SELECT 1 FROM psychology_managed_styles WHERE owner=? AND id=?) OR (SELECT count(*) FROM psychology_managed_styles WHERE owner=? AND id NOT IN (SELECT value FROM json_each(?)))<80)
 ON CONFLICT(owner,id) DO UPDATE SET definition_json=excluded.definition_json,enabled=excluded.enabled,revision=revision+1,updated_at=excluded.updated_at WHERE revision=?`)
 .bind(user.username,id,JSON.stringify(value),enabled?1:0,createHash,now,now,enabled?1:0,...guardArgs,old.revision,user.username,id,builtins,id,user.username,id,user.username,builtins,old.revision).run();
 if(!changed.meta?.changes)fail('样式已变化或不能停用最后一套可用样式，请重新读取。',409);
 return json({item:(await managedStyles(db,user.username)).find(s=>s.id===id)},method==='POST'?201:200);
}
