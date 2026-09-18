(() => {
  const selected = new Set();
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const endpoint = '/api/psychology-peer-hits/production';
  let busy = false, requestId = '', timer;

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
    $('#produceBtn').disabled = busy || !selected.size;
    const moveButton = $('#moveSelectedBtn');
    const targetPhoto = (document.body.dataset.mediaType || 'video') === 'video';
    moveButton.textContent = targetPhoto ? '移动到图文爆款' : '移动到视频爆款';
    moveButton.disabled = busy || !selected.size;
    $('#clearSelectionBtn').disabled = busy;
  }
  async function api(url = endpoint, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  }
  document.addEventListener('peer-list-loaded', sync);
  document.addEventListener('peer-voice-gender-changed', () => { requestId = ''; });
  document.addEventListener('peer-media-type-changed', event => {
    selected.clear();
    requestId = '';
    const photo = event.detail?.mediaType === 'photo';
    const rewriteField = $('#rewriteCopyField');
    if (rewriteField) rewriteField.hidden = !photo;
    notify(photo
      ? '每次最多选择 5 条；每条图文按原帖顺序处理，最多 6 张。封面和详情分开搜底图：封面尽量 1:1 对上原图，可以有情侣和人脸；详情按多数派风格统一搜一次，越亮的图越先用。叠字保留空格、按词换行。不走 AI 生图。'
      : '每次最多选择 5 条；云端会自动解析视频、拆解分镜并生成图片和配音，按每条记录的音色性别使用默认男声或女声，原视频在分析结束后立即删除。');
    sync();
    refresh();
  });
  $('#hitRows').addEventListener('change', event => {
    if (!event.target.matches('.peer-select')) return;
    const id = event.target.dataset.peerId;
    if (event.target.checked && selected.size >= 5) {
      event.target.checked = false;
      notify('每批最多选择 5 条。', true);
    } else if (event.target.checked) selected.add(id);
    else selected.delete(id);
    requestId = '';
    sync();
  });
  $('#clearSelectionBtn').addEventListener('click', () => {
    selected.clear();
    requestId = '';
    sync();
  });
  $('#moveSelectedBtn').addEventListener('click', async () => {
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
  $('#produceBtn').addEventListener('click', async () => {
    if (busy || !selected.size) return;
    busy = true;
    requestId ||= crypto.randomUUID();
    sync();
    notify('正在创建爆款复刻任务…');
    try {
      const data = await api(endpoint, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({
          ids:[...selected],
          mediaType:document.body.dataset.mediaType || 'video',
          requestId,
          ...((document.body.dataset.mediaType || 'video') === 'photo' ? { rewriteCopy: $('#rewriteCopy')?.checked !== false } : {})
        })
      });
      notify(`已创建 ${data.jobIds.length} 个云端复刻任务，可以关闭页面继续运行。`);
      selected.clear();
      requestId = '';
      location.href = '/psychology-production?job=' + encodeURIComponent(data.jobIds[0]);
    } catch (error) {
      notify(error.message, true);
    } finally {
      busy = false;
      sync();
    }
  });

  async function refresh() {
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
          <h3><a href="/psychology-production?job=${encodeURIComponent(job.jobId)}">${escape(job.title || job.source?.title)}</a></h3>
          <p>${escape(job.message || job.status)} · ${Number(job.percent) || 0}%</p>
          ${job.error ? `<p class="is-error">${escape(job.error)}</p>` : ''}
          <p>分镜 ${scenes.length || '等待分析'}${scenes.length ? ` · ${photo ? '页面' : '图片与配音'}完成 ${ready}/${scenes.length}` : ''}</p>
          <a href="/psychology-production?job=${encodeURIComponent(job.jobId)}">查看分镜和素材 →</a>
        </article>`;
      }).join('');
      if (jobs.some(job => !['done','failed','cancelled','canceled'].includes(job.status))) timer = setTimeout(refresh, 10000);
    } catch (error) {
      $('#jobsStatus').textContent = error.message;
    }
  }

  $('#refreshProductionBtn').addEventListener('click', refresh);
  refresh();
  sync();
})();
