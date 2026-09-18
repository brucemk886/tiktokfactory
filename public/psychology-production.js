(() => {
  const $ = s=>document.querySelector(s), esc = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const types={psychology:'四图测试模板','psychology-collage':'纸张拼贴模板','psychology-target-2':'互动测试模板','psychology-photo-story':'图文发布模板','psychology-recreation':'爆款复刻'};
  const labels={queued:'等待执行',running:'执行中',done:'已完成',failed:'失败',canceled:'已取消',cancelled:'已取消'};
  const stages={queued:'队列等待',download:'下载原视频',analyze:'视频分析',script:'文案与分镜',audio:'解说音频',images:'生成图片',review:'素材检查',render:'合成视频',verify:'成片检查',done:'成品'};
  let offset=0, selected=new URLSearchParams(location.search).get('job')||'', timer, refreshing=false, jobs=[];
  const stamp=v=>v?new Date(Number(v)).toLocaleString('zh-CN',{hour12:false}):'—';
  const seconds=v=>Number(v)>0?Number(v).toFixed(1)+' 秒':'待生成';
  const mediaUrl=v=>/^https:\/\//i.test(String(v||''))||String(v||'').startsWith('/api/')?esc(v):'';
  const imageUrl=mediaUrl;
  async function api(query='') {const response=await fetch('/api/psychology-peer-hits/production'+query,{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'读取失败');return data;}
  function scenesFor(job) {
    const r=job.result||{},p=r.production||{},plan=r.plan||job.plan||{};
    let base=Array.isArray(plan.scenes)?plan.scenes:plan.narration?[{text:plan.narration,visualPrompt:plan.visualPrompt}]:[];
    const count=Math.max(base.length,...(p.scenes||[]).map(s=>s.index+1),0);
    return Array.from({length:count},(_,index)=>{const b=base[index]||{},saved=(p.scenes||[]).find(s=>s.index===index)||{};const image=(r.results||[]).find(s=>s.sceneIndex===index);return {index,text:b.text||[b.title,b.subtitle,b.body].filter(Boolean).join('\n')||b.zh||'',translation:b.en||'',imagePrompt:b.stockQuery||b.visualPrompt||'',template:b.template||image?.template||'',imageModel:image?.imageModel||b.template||'',...saved,imageUrl:saved.imageUrl||image?.fileUrl||image?.imageUrl||''};});
  }
  function recreationDetail(job) {
    const result=job.result||{}, plan=result.plan||{}, scenes=Array.isArray(result.scenes)?result.scenes:[], sourceUrl=/^https:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(String(job.source?.videoUrl||''))?esc(job.source.videoUrl):'';
    const ready=scenes.length&&scenes.every(scene=>scene.imageStatus==='done'&&scene.audioStatus==='done');
    const provider=result.analysis?.provider==='kie'?'Kie Gemini 3.8 Flash':'Google Gemini 3.8 Flash';
    $('#boardDetail').innerHTML=`<span class="board-badge ${esc(job.status)}">${esc(labels[job.status]||job.status)}</span> <span class="muted">爆款复刻 · 云端执行</span>
      <h2>${esc(plan.title||job.title||job.source?.title||'TikTok 爆款复刻')}</h2>
      <p class="muted">提交 ${stamp(job.createdAt)} · 更新 ${stamp(job.updatedAt)} · 进度 ${Math.max(0,Math.min(100,Number(job.percent)||0))}%</p>
      <div class="recreation-progress" aria-label="任务进度"><span style="width:${Math.max(0,Math.min(100,Number(job.percent)||0))}%"></span></div>
      <p>${esc(job.message||'已进入云端复刻队列。')}</p>${job.error?`<p class="board-error">${esc(job.error)}</p>`:''}
      <section class="board-section recreation-summary"><h3>原视频与分析</h3>
        ${sourceUrl?`<p><a class="board-output-link" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">打开 TikTok 原视频 ↗</a></p>`:''}
        <p class="muted">${result.analysis?`分析：${provider} · 输入 ${Number(result.analysis.inputTokens||0).toLocaleString()} tokens · 输出 ${Number(result.analysis.outputTokens||0).toLocaleString()} tokens`:'等待下载并分析原视频'}${result.sourceDeleted?' · 临时源视频已删除':''}</p>
        ${plan.creativeDirection?`<p class="board-source"><b>复刻方向</b>　${esc(plan.creativeDirection)}</p>`:''}
      </section>
      <section class="board-section"><div class="scene-heading"><h3>分镜、图片与配音</h3><span class="board-badge ${ready?'done':'running'}">${ready?'素材待检查':`${scenes.length} 个分镜`}</span></div>
        ${scenes.length?`<div class="scene-grid recreation-grid">${scenes.map((scene,index)=>recreationScene(scene,index)).join('')}</div>`:`<div class="scene-placeholder">${job.status==='failed'?'视频尚未成功拆出分镜。':'视频分析完成后会在这里显示分镜。'}</div>`}
      </section>
      ${ready?'<section class="board-section review-notice"><h3>下一步</h3><p>请逐个检查分镜、图片和配音。当前版本不会自动合成或发布，确认素材后再进入合成。</p></section>':''}`;
  }
  function recreationScene(scene,index) {
    const image=mediaUrl(scene.imageUrl), audio=mediaUrl(scene.audioUrl), start=Number(scene.startSeconds??scene.start??0), end=Number(scene.endSeconds??scene.end??0);
    const time=end>start?`${start.toFixed(1)}–${end.toFixed(1)} 秒`:'时间待确认';
    return `<article class="scene-card recreation-scene"><div class="scene-title"><h4>分镜 ${index+1}</h4><span class="muted">原片 ${time}</span></div>
      ${image?`<img class="scene-image" src="${image}" alt="分镜 ${index+1} 生成图片" loading="lazy">`:`<div class="scene-placeholder">${scene.imageStatus==='failed'?'图片生成失败':scene.imageStatus==='running'?'正在生成图片…':'等待生成图片'}</div>`}
      <div class="scene-body">
        <span class="scene-label">原视频画面</span><p>${esc(scene.observedVisual||'等待视频分析')}</p>
        <span class="scene-label">本分镜口播</span><p>${esc(scene.narration||'等待生成')}</p>
        <details data-section="recreation-prompt-${index}" open><summary>Z-Image 分镜提示词</summary><pre>${esc(scene.visualPrompt||'等待生成')}</pre></details>
        <span class="scene-label">ElevenLabs 配音</span>
        ${audio?`<audio class="scene-audio" controls preload="none" src="${audio}"></audio><p class="muted">生成音频 ${seconds(scene.audioDuration)}</p>`:`<p class="material-state ${scene.audioStatus==='failed'?'failed':''}">${scene.audioStatus==='failed'?'配音失败':scene.audioStatus==='running'?'正在生成配音…':'等待生成配音'}</p>`}
        ${scene.imageError?`<p class="material-error">图片：${esc(scene.imageError)}</p>`:''}${scene.audioError?`<p class="material-error">配音：${esc(scene.audioError)}</p>`:''}
      </div></article>`;
  }
  function detail(job) {
    if(job.type==='psychology-recreation') return recreationDetail(job);
    const r=job.result||{},p=r.production||{},photo=job.type==='psychology-photo-story',scenes=scenesFor(job),events=p.events||[];
    const sequence=photo?['script','images','done']:job.type==='psychology'?['script','audio','images','render','done']:['script','audio','images','render','verify','done'];
    const visited=new Set(events.map(e=>e.stage));
    const stageHtml=['queued',...sequence].map(stage=>{const active=stage==='queued'?job.status==='queued':p.stage===stage;const cls=active?(job.status==='failed'?'failed':'active'):(stage==='queued'||visited.has(stage)?'visited':'');return `<li class="${cls}">${esc(stages[stage])}</li>`;}).join('');
    const duration=p.audio?.duration||p.video?.duration||0;
    const tracks=!photo&&scenes.some(s=>s.duration>0)?`<div class="timeline-tracks">${['画面','解说'].map((name,n)=>`<div class="timeline-track ${n?'audio':''}"><b>${name}</b><div>${scenes.map(s=>`<span style="flex:${Math.max(.1,Number(s.duration)||.1)}" title="${esc(s.start?.toFixed?.(1)||'0')}–${esc(s.end?.toFixed?.(1)||'?')} 秒">${s.index+1} · ${seconds(s.duration)}</span>`).join('')}</div><small>${seconds(duration)}</small></div>`).join('')}</div>`:'';
    const savedOpen=new Map([...$('#boardDetail').querySelectorAll('details')].map(e=>[e.dataset.section,e.open]));
    $('#boardDetail').innerHTML=`<span class="board-badge ${esc(job.status)}">${esc(labels[job.status]||job.status)}</span> <span class="muted">${esc(types[job.type]||job.type)} · ${photo?'云端分析匹配':'视频工人执行'}</span><h2>${esc(job.title||job.source?.title)}</h2><p class="muted">提交 ${stamp(job.createdAt)} · 更新 ${stamp(job.updatedAt)}</p><ol class="board-steps">${stageHtml}</ol><p>${esc(job.message||'已进入队列，等待执行。')}</p>${job.error?`<p class="board-error">${esc(job.error)}</p>`:''}
    <details data-section="source"><summary>来源文案</summary><p class="board-source">${esc(job.source?.copy)}</p></details>
    ${!photo&&p.audio?`<section class="board-section"><h3>解说音频</h3><div class="board-audio"><p class="muted">${esc(p.audio.provider||'待生成')} · ${esc(p.audio.voice||'模板音色')} · ${seconds(p.audio.duration)}</p><p>${esc(p.audio.description)}</p><p class="board-source">${esc(p.audio.text)}</p></div></section>`:''}
    <section class="board-section"><h3>${photo?'图文分镜':'分镜与视频时间线'}</h3>${tracks}${scenes.length?`<div class="scene-grid">${scenes.map(s=>`<article class="scene-card"><div class="scene-title"><h4>${photo?'第':'分镜 '}${s.index+1}${photo?' 页':''}</h4><span class="muted">${photo?(s.imageModel==='stock'||s.template==='stock'?'素材库底图':'文案卡片'):s.duration>0?`${Number(s.start||0).toFixed(1)}–${Number(s.end||s.duration).toFixed(1)} 秒`:'等待实测时长'}</span></div>${imageUrl(s.imageUrl)?`<img class="scene-image" src="${imageUrl(s.imageUrl)}" alt="分镜 ${s.index+1}" loading="lazy">`:`<div class="scene-placeholder">${photo?(s.imageStatus==='failed'?'素材匹配失败':s.imageStatus==='running'?'正在匹配素材…':'文案卡片，打开图文页后渲染'):(s.imageStatus==='failed'?'生图失败，查看执行记录':s.imageStatus==='running'?'正在生成图片…':'等待生图')}</div>`}<div class="scene-body"><span class="scene-label">${photo?'本页文案':'分镜解说'}</span><p>${esc(s.audioText||s.text||'等待文案')}</p>${s.translation?`<p class="muted">${esc(s.translation)}</p>`:''}<details data-section="prompt-${s.index}" open><summary>${photo?(s.imagePrompt?'底图搜索词':'页面类型'):'生图描述词'}</summary><pre>${esc(photo?(s.imagePrompt||(s.template==='cover'||s.textKind==='cover'?'封面文案卡片':'文案卡片')):(s.imagePrompt||'文案与分镜完成后显示'))}</pre></details>${!photo?`<span class="scene-label">音频 / 视频安排</span><p>${esc(s.audioDescription||p.audio?.description||'等待配音安排')}</p><p>${esc(s.videoDescription||p.video?.description||'等待合成安排')}</p>`:''}</div></article>`).join('')}</div>`:'<p class="muted">执行后将逐步显示改编文案、分镜及描述词。</p>'}</section>
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
      $('#boardQueue').innerHTML=jobs.length?jobs.map(job=>`<button type="button" class="queue-item" data-job="${esc(job.jobId)}" aria-pressed="${selected===job.jobId}"><span class="board-badge ${esc(job.status)}">${esc(labels[job.status]||job.status)}</span><strong>${esc(job.title)}</strong><small>${esc(types[job.type]||job.type)}</small><small>${stamp(job.createdAt)}</small></button>`).join(''):'<p class="muted">还没有复刻任务，先从同行爆款选择视频。</p>';
      let job=jobs.find(j=>j.jobId===selected);if(!job&&selected)job=(await api('?jobId='+encodeURIComponent(selected))).jobs[0];if(job)detail(job);
      $('#boardPrev').disabled=offset===0;$('#boardNext').disabled=!data.hasMore;$('#boardPage').textContent=`第 ${offset/30+1} 页`;
      $('#boardStatus').textContent='任务每 5 秒更新 · 原视频分析完成后立即删除临时文件';
    } catch(error){$('#boardStatus').textContent=error.message;}finally{refreshing=false;timer=setTimeout(refresh,5000);}
  }
  $('#boardQueue').addEventListener('click',event=>{const button=event.target.closest('[data-job]');if(!button)return;selected=button.dataset.job;history.replaceState(null,'','?job='+encodeURIComponent(selected));refresh();});
  $('#refreshBoard').addEventListener('click',refresh);$('#boardPrev').addEventListener('click',()=>{offset=Math.max(0,offset-30);refresh();});$('#boardNext').addEventListener('click',()=>{offset+=30;refresh();});
  refresh();
})();
