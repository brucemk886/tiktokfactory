import { loadCardModules, openCloudCardRenderer } from './psychology-cloud-renderer.js';
import { json, readJson } from './http.js';

// Only invoked after the existing worker-token authentication. Never creates jobs or publishes.
export async function handleCloudPhotoProbe(request,env,url) {
  if(url.pathname!=='/api/worker/psychology-cloud-photo/probe')return null;
  if(request.method!=='POST')return json({error:'只支持 POST'},405);
  const body=await readJson(request);
  if(!Array.isArray(body.pages)||body.pages.length!==6||JSON.stringify(body).length>8000000)return json({error:'测试需要 6 页且不超过 8 MB'},400);
  if(body.pages.some(p=>['title','subtitle','body'].some(k=>String(p[k]||'').length>5000)||p.template==='stock'&&!/^data:image\/(jpeg|png|webp);base64,/.test(p.imageData||'')))return json({error:'测试图片或文案无效'},400);
  const driver=(await import('@cloudflare/puppeteer')).default;
  const limits=await driver.limits(env.PHOTO_BROWSER);
  const started=Date.now(),sources=await loadCardModules(env);let images=[];
  const renderer=await openCloudCardRenderer(env,sources,driver);
  let browserMs=0;
  try {images=await renderer.renderBatch(body.pages.map((source,index)=>({source,index,template:'photo-original',imageData:source.imageData||''})));}
  finally {browserMs=await renderer.close();}
  const history=await driver.history(env.PHOTO_BROWSER).catch(()=>[]);
  const session=history.find(item=>item.sessionId===renderer.sessionId);
  const meteredBrowserMs=session?.endTime&&session?.startTime?session.endTime-session.startTime:null;
  return json({images,browserMs,meteredBrowserMs,elapsedMs:Date.now()-started,maxConcurrentSessions:limits.maxConcurrentSessions});
}
