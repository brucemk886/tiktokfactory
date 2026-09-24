(() => {
  const selected = new Set();
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const endpoint = '/api/psychology-peer-hits/production';
  let busy = false, requestId = '', timer;
  const library = document.body.classList.contains('copy-library-page');

  const notify = (text, error = false) => {
    $('#productionStatus').textContent = text;
    $('#productionStatus').classList.toggle('is-error', error);
  };
  function sync() {
    document.querySelectorAll('.peer-select').forEach(input => {
      input.checked = selected.has(input.dataset.peerId);
      input.disabled = busy;
    });
    $('#selectionCount').textContent = `已选 ${selected.size} 条`;
    const visible=[...document.querySelectorAll('.peer-select')];
    const canManage=!library||document.body.dataset.sourceAccess==='true';
    const selectPage=$('#selectPageCheckbox');
    if(selectPage){selectPage.disabled=busy||!canManage||!visible.length;selectPage.checked=visible.length>0&&visible.every(input=>selected.has(input.dataset.peerId));selectPage.indeterminate=selected.size>0&&!selectPage.checked;}
    if($('#selectPageBtn'))$('#selectPageBtn').disabled=busy||!canManage||!visible.length;
    if($('#deleteSelectedBtn'))$('#deleteSelectedBtn').disabled=busy||!canManage||!selected.size;
    if($('#batchRewriteBtn'))$('#batchRewriteBtn').disabled=busy||!selected.size;
    const moveButton = $('#moveSelectedBtn');
    const targetPhoto = (document.body.dataset.mediaType || 'video') === 'video';
    if (moveButton) {
      moveButton.textContent = targetPhoto ? '移动到图文爆款' : '移动到视频爆款';
      moveButton.disabled = busy || !selected.size;
    }
    $('#clearSelectionBtn').disabled = busy;
  }
  async function api(url = endpoint, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  }
  document.addEventListener('peer-list-loaded', () => {const visible=new Set([...document.querySelectorAll('.peer-select')].map(n=>n.dataset.peerId));for(const id of selected)if(!visible.has(id)){selected.delete(id);requestId='';}sync();});
  document.addEventListener('peer-selection-clear',()=>{selected.clear();requestId='';sync();});
  let accessLoaded=false;
  document.addEventListener('library-source-access',event=>{if(event.detail.canManage&&!accessLoaded){accessLoaded=true;refresh();}});
  document.addEventListener('peer-voice-gender-changed', () => { requestId = ''; });
  document.addEventListener('peer-media-type-changed', event => {
    selected.clear();
    requestId = '';
    const photo = event.detail?.mediaType === 'photo';
    notify(document.body.classList.contains('copy-library-page')
      ? '使用已提取文案批量生成，请进入右上角的自动发布。'
      : photo
      ? '每次最多选择 5 条；每条图文按原帖顺序处理，最多 6 张。封面尽量 1:1 对上原图，可以有情侣和人脸；详情固定用海景/云彩这类明亮空镜，每次生成自动换一批，越亮的图越先用。叠字保留空格、按词换行。不走 AI 生图。'
      : '每次最多选择 5 条；云端会自动解析视频、拆解分镜并生成图片和配音，按每条记录的音色性别使用默认男声或女声，原视频在分析结束后立即删除。');
    sync();
    refresh();
  });
  $('#hitRows').addEventListener('change', event => {
    if (!event.target.matches('.peer-select')) return;
    const id = event.target.dataset.peerId;
    if(busy){sync();return;}
    if (!library && event.target.checked && selected.size >= 5) {
      event.target.checked = false;
      notify('每批最多选择 5 条。', true);
    } else if (event.target.checked) selected.add(id);
    else selected.delete(id);
    requestId = '';
    sync();
  });
  function selectPage(checked){
    if(busy||document.body.dataset.sourceAccess!=='true')return;
    for(const input of document.querySelectorAll('.peer-select')){if(checked)selected.add(input.dataset.peerId);else selected.delete(input.dataset.peerId);}
    requestId='';sync();
  }
  $('#selectPageBtn')?.addEventListener('click',()=>selectPage(true));
  $('#selectPageCheckbox')?.addEventListener('change',event=>selectPage(event.target.checked));
  $('#deleteSelectedBtn')?.addEventListener('click',async()=>{
    if(busy||!selected.size||document.body.dataset.sourceAccess!=='true')return;
    const ids=[...selected];
    if(!confirm('确定删除选中的 '+ids.length+' 条文案、同行来源及关联改写？已创建的生成和发布任务会保留。删除后无法恢复。'))return;
    busy=true;sync();notify('正在删除 '+ids.length+' 条文案…');
    try{
      const data=await api('/api/psychology-copy-library',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
      ids.forEach(id=>selected.delete(id));requestId='';notify('已删除 '+data.deleted+' 条文案及对应来源、关联改写。');
      document.dispatchEvent(new CustomEvent('peer-list-refresh-request'));
    }catch(error){notify(error.message,true);}
    finally{busy=false;sync();}
  });
  // One request per post; two posts at a time keeps the page responsive.
  $('#batchRewriteBtn')?.addEventListener('click',async()=>{
    if(busy||!selected.size)return;
    const ids=[...selected],model=$('#batchModel').value,count=Number($('#batchCount').value)||5,label=$('#batchModel').selectedOptions?.[0]?.textContent||model;
    if(!confirm('用 '+label+' 为选中的 '+ids.length+' 篇各生成 '+count+' 个改写？生成的版本会通过质量检查后直接保存并启用，可在改写详情里删除。'))return;
    busy=true;sync();
    let done=0,created=0,skipped=0;const failed=[];
    const run=async id=>{
      try{const data=await api('/api/psychology-creative/copies/generate-batch?sourceId='+encodeURIComponent(id)+'&model='+encodeURIComponent(model)+'&count='+count,{method:'POST'});created+=data.created;skipped+=data.skipped.length;selected.delete(id);}
      catch(error){failed.push(error.message);}
      done++;notify('正在生成改写：'+done+' / '+ids.length+' 篇，已保存 '+created+' 个版本…');
    };
    notify('正在生成改写：0 / '+ids.length+' 篇…');
    const queue=[...ids];await Promise.all([0,1].map(async()=>{while(queue.length)await run(queue.shift());}));
    busy=false;requestId='';sync();
    notify('完成：保存 '+created+' 个改写版本'+(skipped?'，'+skipped+' 个未通过质量检查':'')+(failed.length?'；'+failed.length+' 篇失败：'+[...new Set(failed)].join('；'):'')+'。',failed.length>0);
    document.dispatchEvent(new CustomEvent('peer-list-refresh-request'));
  });
  $('#clearSelectionBtn').addEventListener('click', () => {
    selected.clear();
    requestId = '';
    sync();
  });
  $('#moveSelectedBtn')?.addEventListener('click', async () => {
    if (busy || !selected.size) return;
    const ids = [...selected];
    const currentType = document.body.dataset.mediaType || 'video';
    const targetType = currentType === 'photo' ? 'video' : 'photo';
    busy = true;
    sync();
    notify(`正在移动 ${ids.length} 条内容…`);
    const results = await Promise.allSettled(ids.map(id => api(`/api/psychology-peer-hits/${encodeURIComponent(id)}`, {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ mediaType:targetType })
    }).then(() => id)));
    const moved = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    moved.forEach(id => selected.delete(id));
    requestId = '';
    const failed = results.length - moved.length;
    notify(failed
      ? `已移动 ${moved.length} 条，${failed} 条移动失败，请重试。`
      : `已移动 ${moved.length} 条到${targetType === 'photo' ? '图文' : '视频'}爆款。`, failed > 0);
    busy = false;
    sync();
    document.dispatchEvent(new CustomEvent('peer-list-refresh-request'));
  });
  async function refresh() {
    if (!$('#productionPanel')) return;
    if(document.body.classList.contains('copy-library-page')&&document.body.dataset.sourceAccess!=='true')return;
    clearTimeout(timer);
    try {
      const mediaType = document.body.dataset.mediaType || 'video';
      const { jobs } = await api(endpoint + '?mediaType=' + encodeURIComponent(mediaType));
      $('#jobsStatus').textContent = jobs.length ? '最近 30 个复刻任务；运行中的任务每 10 秒更新。' : '尚无爆款复刻任务。';
      $('#productionJobs').innerHTML = jobs.map(job => {
        const result = job.result || {};
        const plan = result.plan || {};
        const scenes = Array.isArray(result.scenes) ? result.scenes : Array.isArray(plan.scenes) ? plan.scenes : [];
        const photo = job.type === 'psychology-photo-story';
        const ready = photo
          ? (result.results || []).length
          : scenes.filter(scene => scene.imageStatus === 'done' && scene.audioStatus === 'done').length;
        return `<article class="peer-job">
          <h3><a href="/psychology-publish-sources?view=manual&job=${encodeURIComponent(job.jobId)}">${escape(job.title || job.source?.title)}</a></h3>
          <p>${escape(job.message || job.status)} · ${Number(job.percent) || 0}%</p>
          ${job.error ? `<p class="is-error">${escape(job.error)}</p>` : ''}
          <p>分镜 ${scenes.length || '等待分析'}${scenes.length ? ` · ${photo ? '页面' : '图片与配音'}完成 ${ready}/${scenes.length}` : ''}</p>
          <a href="/psychology-publish-sources?view=manual&job=${encodeURIComponent(job.jobId)}">查看分镜和素材 →</a>
        </article>`;
      }).join('');
      if (jobs.some(job => !['done','failed','cancelled','canceled'].includes(job.status))) timer = setTimeout(refresh, 10000);
    } catch (error) {
      $('#jobsStatus').textContent = error.message;
    }
  }

  $('#refreshProductionBtn')?.addEventListener('click', refresh);
  refresh();
  sync();
})();
