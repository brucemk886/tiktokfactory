(() => {
  const $ = s=>document.querySelector(s), esc = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const types={psychology:'四图测试模板','psychology-collage':'纸张拼贴模板','psychology-target-2':'互动测试模板','psychology-photo-story':'图文发布模板'};
  const labels={queued:'等待执行',running:'执行中',done:'已完成',failed:'失败',canceled:'已取消',cancelled:'已取消'};
  const stages={queued:'队列等待',script:'文案与分镜',audio:'解说音频',images:'生成图片',render:'合成视频',verify:'成片检查',done:'成品'};
  let offset=0, selected=new URLSearchParams(location.search).get('job')||'', timer, refreshing=false, jobs=[];
  const stamp=v=>v?new Date(Number(v)).toLocaleString('zh-CN',{hour12:false}):'—';
  const seconds=v=>Number(v)>0?Number(v).toFixed(1)+' 秒':'待生成';
  const imageUrl=v=>/^https:\/\//i.test(String(v||''))?esc(v):'';
  async function api(query='') {const response=await fetch('/api/psychology-peer-hits/production'+query,{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'读取失败');return data;}
  function scenesFor(job) {
    const r=job.result||{},p=r.production||{},plan=r.plan||job.plan||{};
    let base=Array.isArray(plan.scenes)?plan.scenes:plan.narration?[{text:plan.narration,visualPrompt:plan.visualPrompt}]:[];
    const count=Math.max(base.length,...(p.scenes||[]).map(s=>s.index+1),0);
    return Array.from({length:count},(_,index)=>{const b=base[index]||{},saved=(p.scenes||[]).find(s=>s.index===index)||{};const image=(r.results||[]).find(s=>s.sceneIndex===index&&s.imageUrl);return {index,text:b.text||b.zh||'',translation:b.en||'',imagePrompt:b.visualPrompt||'',...saved,imageUrl:saved.imageUrl||image?.imageUrl||''};});
  }
  function detail(job) {
    const r=job.result||{},p=r.production||{},photo=job.type==='psychology-photo-story',scenes=scenesFor(job),events=p.events||[];
    const sequence=photo?['script','images','done']:job.type==='psychology'?['script','audio','images','render','done']:['script','audio','images','render','verify','done'];
    const visited=new Set(events.map(e=>e.stage));
    const stageHtml=['queued',...sequence].map(stage=>{const active=stage==='queued'?job.status==='queued':p.stage===stage;const cls=active?(job.status==='failed'?'failed':'active'):(stage==='queued'||visited.has(stage)?'visited':'');return `<li class="${cls}">${esc(stages[stage])}</li>`;}).join('');
    const duration=p.audio?.duration||p.video?.duration||0;
    const tracks=!photo&&scenes.some(s=>s.duration>0)?`<div class="timeline-tracks">${['画面','解说'].map((name,n)=>`<div class="timeline-track ${n?'audio':''}"><b>${name}</b><div>${scenes.map(s=>`<span style="flex:${Math.max(.1,Number(s.duration)||.1)}" title="${esc(s.start?.toFixed?.(1)||'0')}–${esc(s.end?.toFixed?.(1)||'?')} 秒">${s.index+1} · ${seconds(s.duration)}</span>`).join('')}</div><small>${seconds(duration)}</small></div>`).join('')}</div>`:'';
    const savedOpen=new Map([...$('#boardDetail').querySelectorAll('details')].map(e=>[e.dataset.section,e.open]));
    $('#boardDetail').innerHTML=`<span class="board-badge ${esc(job.status)}">${esc(labels[job.status]||job.status)}</span> <span class="muted">${esc(types[job.type]||job.type)} · ${photo?'云端生成':'视频工人执行'}</span><h2>${esc(job.title||job.source?.title)}</h2><p class="muted">提交 ${stamp(job.createdAt)} · 更新 ${stamp(job.updatedAt)}</p><ol class="board-steps">${stageHtml}</ol><p>${esc(job.message||'已进入队列，等待执行。')}</p>${job.error?`<p class="board-error">${esc(job.error)}</p>`:''}
    <details data-section="source"><summary>来源文案</summary><p class="board-source">${esc(job.source?.copy)}</p></details>
    ${!photo&&p.audio?`<section class="board-section"><h3>解说音频</h3><div class="board-audio"><p class="muted">${esc(p.audio.provider||'待生成')} · ${esc(p.audio.voice||'模板音色')} · ${seconds(p.audio.duration)}</p><p>${esc(p.audio.description)}</p><p class="board-source">${esc(p.audio.text)}</p></div></section>`:''}
    <section class="board-section"><h3>${photo?'图文分镜':'分镜与视频时间线'}</h3>${tracks}${scenes.length?`<div class="scene-grid">${scenes.map(s=>`<article class="scene-card"><div class="scene-title"><h4>${photo?'第':'分镜 '}${s.index+1}${photo?' 页':''}</h4><span class="muted">${photo?'':s.duration>0?`${Number(s.start||0).toFixed(1)}–${Number(s.end||s.duration).toFixed(1)} 秒`:'等待实测时长'}</span></div>${imageUrl(s.imageUrl)?`<img class="scene-image" src="${imageUrl(s.imageUrl)}" alt="分镜 ${s.index+1}" loading="lazy">`:`<div class="scene-placeholder">${s.imageStatus==='failed'?'生图失败，查看执行记录':s.imageStatus==='running'?'正在生成图片…':'等待生图'}</div>`}<div class="scene-body"><span class="scene-label">${photo?'本页文案':'分镜解说'}</span><p>${esc(s.audioText||s.text||'等待文案')}</p>${s.translation?`<p class="muted">${esc(s.translation)}</p>`:''}<details data-section="prompt-${s.index}" open><summary>生图描述词</summary><pre>${esc(s.imagePrompt||'文案与分镜完成后显示')}</pre></details>${!photo?`<span class="scene-label">音频 / 视频安排</span><p>${esc(s.audioDescription||p.audio?.description||'等待配音安排')}</p><p>${esc(s.videoDescription||p.video?.description||'等待合成安排')}</p>`:''}</div></article>`).join('')}</div>`:'<p class="muted">执行后将逐步显示改编文案、分镜及描述词。</p>'}</section>
    ${r.captionTimings?.length?`<details class="board-section" data-section="captions"><summary>字幕时间点</summary>${r.captionTimings.map(c=>`<p class="muted">${esc(c.start??c.startSeconds??'—')}–${esc(c.end??c.endSeconds??'—')} 秒　${esc(c.text||c.zh||'')}</p>`).join('')}</details>`:''}
    ${!photo&&p.video?`<section class="board-section"><h3>视频合成</h3><p>${esc(p.video.description)}</p><p class="muted">画幅 ${esc(p.video.aspectRatio)} · ${seconds(p.video.duration)}</p></section>`:''}
    <section class="board-section"><h3>执行记录</h3><ol class="board-events"><li><time>${stamp(job.createdAt)}</time>加入队列</li>${events.map(e=>`<li><time>${stamp(e.at)}</time>${esc(stages[e.stage]||e.stage)}${e.status==='failed'?' · 失败':''} — ${esc(e.message)}</li>`).join('')}</ol>${!events.length&&job.status!=='queued'?'<p class="muted">这条历史任务未记录分步骤事件。</p>':''}</section>
    ${job.status==='done'?`<section class="board-section"><h3>成品</h3><a class="board-output-link" href="${photo?'/psychology-photo?peerJob='+encodeURIComponent(job.jobId):'/psychology-publish'}">${photo?'使用这组图片和文案':'前往视频发布查看成片'} →</a>${(r.results||[]).filter(v=>v.fileName).map(v=>`<p class="muted">${esc(v.fileName)} · ${seconds(v.duration)}</p>`).join('')}</section>`:''}`;
    $('#boardDetail').querySelectorAll('details').forEach(e=>{if(savedOpen.has(e.dataset.section))e.open=savedOpen.get(e.dataset.section);});
  }
  async function refresh() {
    if(refreshing)return; refreshing=true;clearTimeout(timer);
    try {const data=await api('?offset='+offset);jobs=data.jobs;
      const counts=Object.fromEntries((data.counts||[]).map(item=>[item.status,item.count]));
      $('#boardCounts').innerHTML=['queued','running','done','failed'].map(s=>`<div class="board-count"><span>${labels[s]}</span><strong>${counts[s]||0}</strong></div>`).join('');
      if(!selected&&jobs.length)selected=jobs[0].jobId;
      $('#boardQueue').innerHTML=jobs.length?jobs.map(job=>`<button type="button" class="queue-item" data-job="${esc(job.jobId)}" aria-pressed="${selected===job.jobId}"><span class="board-badge ${esc(job.status)}">${esc(labels[job.status]||job.status)}</span><strong>${esc(job.title)}</strong><small>${esc(types[job.type]||job.type)}</small><small>${stamp(job.createdAt)}</small></button>`).join(''):'<p class="muted">还没有画板，先从同行爆款勾选选题。</p>';
      let job=jobs.find(j=>j.jobId===selected);if(!job&&selected)job=(await api('?jobId='+encodeURIComponent(selected))).jobs[0];if(job)detail(job);
      $('#boardPrev').disabled=offset===0;$('#boardNext').disabled=!data.hasMore;$('#boardPage').textContent=`第 ${offset/30+1} 页`;
      $('#boardStatus').textContent='队列每 5 秒更新 · 分镜时长以实际生成的音频为准';
    } catch(error){$('#boardStatus').textContent=error.message;}finally{refreshing=false;timer=setTimeout(refresh,5000);}
  }
  $('#boardQueue').addEventListener('click',event=>{const button=event.target.closest('[data-job]');if(!button)return;selected=button.dataset.job;history.replaceState(null,'','?job='+encodeURIComponent(selected));refresh();});
  $('#refreshBoard').addEventListener('click',refresh);$('#boardPrev').addEventListener('click',()=>{offset=Math.max(0,offset-30);refresh();});$('#boardNext').addEventListener('click',()=>{offset+=30;refresh();});
  refresh();
})();
