export const materialId=ref=>ref.sourceId+':v'+ref.version;
export function mountMaterialDelete(onDeleted){
 const dialog=document.createElement('dialog');dialog.className='vh-delete-dialog';dialog.setAttribute('aria-label','删除二创素材');
 dialog.innerHTML='<h2>删除二创素材</h2><p class="vh-delete-summary"></p><p>删除后将移出素材库，不能恢复。原选题和原图保留。</p><ul class="vh-delete-items"></ul><p class="vh-delete-status" role="status" aria-live="polite"></p><div class="vh-actions"><button type="button" class="vh-delete-cancel">取消</button><button type="button" class="vh-danger vh-delete-confirm">确认删除</button></div>';
 document.body.append(dialog);const status=dialog.querySelector('.vh-delete-status'),confirm=dialog.querySelector('.vh-delete-confirm'),cancel=dialog.querySelector('.vh-delete-cancel'),pending=new Map();let rows=[],busy=false;
 cancel.onclick=()=>dialog.close();dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 confirm.onclick=async()=>{
  if(busy)return;busy=true;confirm.disabled=cancel.disabled=true;status.textContent='正在删除…';
  const items=rows.map(r=>({...r.ref})),key=JSON.stringify(items);if(!pending.has(key))pending.set(key,crypto.randomUUID());
  try{const response=await fetch('/api/psychology-video-hits/versions/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:pending.get(key),items})});const data=await response.json();if(!response.ok)throw Error(data.error||'删除失败，请重试。');pending.delete(key);dialog.close();await onDeleted(data,rows);}
  catch(e){status.textContent=e.message;}
  finally{busy=false;confirm.disabled=cancel.disabled=false;}
 };
 return selection=>{
  if(busy||!selection.length)return;rows=selection.map(r=>({title:r.title,ref:{...r.ref}}));status.textContent='';
  dialog.querySelector('.vh-delete-summary').textContent='已选 '+rows.length+' 条，请核对素材 ID 和标题。';
  const list=dialog.querySelector('.vh-delete-items');list.replaceChildren();for(const r of rows){const li=document.createElement('li'),title=document.createElement('strong'),id=document.createElement('code');title.textContent=r.title;id.textContent=materialId(r.ref);li.append(title,id);list.append(li);}
  confirm.textContent='确认删除 '+rows.length+' 条';dialog.showModal();cancel.focus();
 };
}
