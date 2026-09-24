(()=>{
  const $=selector=>document.querySelector(selector);
  if(!$('#watchAccountsDialog'))return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let originals=[],saving=false,watchVersion=0;
  const endpoint='/api/psychology-peer-hits/watch-accounts';
  async function request(url,method='GET',body){const response=await fetch(url,{method,cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data;}
  document.addEventListener('peer-list-loaded',event=>{originals=event.detail?.items||[];});
  document.addEventListener('library-source-access',event=>{$('#watchAccountsButton').hidden=event.detail?.canManage!==true;});
  async function loadAccounts(){
    const version=++watchVersion;$('#watchList').innerHTML='<tr><td colspan="4">正在读取…</td></tr>';
    const data=await request(endpoint);if(version!==watchVersion)return;
    $('#watchList').innerHTML=data.accounts.length?data.accounts.map(a=>'<tr><td><a href="https://www.tiktok.com/@'+encodeURIComponent(a.username)+'" target="_blank" rel="noopener noreferrer">@'+esc(a.username)+'</a></td><td>'+esc(a.note||'—')+'</td><td><span class="copy-status is-off">待抓取</span></td><td><button type="button" data-unwatch="'+esc(a.username)+'">移除</button></td></tr>').join(''):'<tr><td colspan="4">还没有待抓取账号，可以在上方批量添加。</td></tr>';
    return data.accounts.length;
  }
  $('#watchAccountsButton').onclick=async()=>{$('#watchAccountsDialog').showModal();$('#watchStatus').textContent='';try{const count=await loadAccounts();$('#watchStatus').textContent='共 '+count+' 个待抓取账号';}catch(error){$('#watchStatus').textContent=error.message;$('#watchList').innerHTML='<tr><td colspan="4">读取失败，请关闭后重试。</td></tr>';}};
  $('#closeWatchAccounts').onclick=()=>{if(!saving)$('#watchAccountsDialog').close();};
  $('#watchAccountsDialog').addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  $('#watchForm').onsubmit=async event=>{
    event.preventDefault();if(saving)return;
    const usernames=$('#watchUsernames').value.split(/[\n\r,，]+/).map(v=>v.trim()).filter(Boolean);
    if(!usernames.length||usernames.length>100){$('#watchStatus').textContent='每次填写 1–100 个账号。';return;}
    saving=true;$('#saveWatchAccounts').disabled=true;$('#closeWatchAccounts').disabled=true;
    try{const data=await request(endpoint,'POST',{usernames,note:$('#watchNote').value.trim()});$('#watchUsernames').value='';$('#watchNote').value='';await loadAccounts();$('#watchStatus').textContent='已新增 '+data.created+' 个待抓取账号，跳过 '+data.skipped+' 个重复账号。';}
    catch(error){$('#watchStatus').textContent=error.message;}
    finally{saving=false;$('#saveWatchAccounts').disabled=false;$('#closeWatchAccounts').disabled=false;}
  };
  $('#watchList').addEventListener('click',async event=>{
    const button=event.target.closest('[data-unwatch]');if(!button||saving)return;button.disabled=true;
    try{await request(endpoint+'?username='+encodeURIComponent(button.dataset.unwatch),'DELETE');await loadAccounts();$('#watchStatus').textContent='已移除该账号。';}catch(error){$('#watchStatus').textContent=error.message;button.disabled=false;}
  });
  $('#hitRows').addEventListener('click',event=>{
    const button=event.target.closest('[data-hot-comments]');if(!button)return;
    const row=originals.find(item=>item.id===button.dataset.hotComments);if(!row)return;
    const peer=row.peer||{},comments=(peer.topComments||[]).filter(c=>Number(c.likes)>0).slice().sort((a,b)=>Number(b.likes)-Number(a.likes)).slice(0,20);
    $('#hotCommentsContext').textContent=row.content?.title||row.title||'未命名文案';
    const target=Math.min(10,Number(peer.commentCount)||10);
    $('#hotCommentsStatus').textContent=(comments.length?'已保存 '+comments.length+' 条有赞评论，按点赞从高到低排列。':peer.commentCount===0?'原帖暂无评论。':'尚未导入热门评论。')+(peer.topCommentsNote?' '+peer.topCommentsNote:comments.length<target&&peer.commentCount!==0?' 待 Grokbot 补全高赞评论；本页不会自动抓取。':'');
    $('#hotCommentsList').innerHTML=comments.length?comments.map((c,i)=>'<tr><td>'+(i+1)+'</td><td class="peer-comment-text">'+esc(c.text)+'</td><td>'+Number(c.likes).toLocaleString('zh-CN')+'</td></tr>').join(''):'<tr><td colspan="3">暂无已保存的高赞评论</td></tr>';
    $('#hotCommentsDialog').showModal();
  });
  $('#closeHotComments').onclick=()=>$('#hotCommentsDialog').close();
})();
