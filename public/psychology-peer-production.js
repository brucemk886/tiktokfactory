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
    $('#produceBtn').disabled = busy || !selected.size || !$('#recreationVoice').value;
    $('#recreationVoice').disabled = busy;
    $('#clearSelectionBtn').disabled = busy;
  }
  async function api(url = endpoint, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  }
  async function loadVoices() {
    try {
      const data = await api('/api/elevenlabs/voices');
      const voices = Array.isArray(data.voices) ? data.voices : [];
      $('#recreationVoice').innerHTML = voices.length
        ? voices.map(voice => `<option value="${escape(voice.id)}">${escape(voice.name)}${voice.genderLabel ? ` · ${escape(voice.genderLabel)}` : ''}</option>`).join('')
        : '<option value="">没有可用声音</option>';
      const preferred = voices.find(voice => voice.id === data.defaultVoiceId) || voices[0];
      if (preferred) $('#recreationVoice').value = preferred.id;
      if (data.warning) notify(data.warning);
    } catch (error) {
      $('#recreationVoice').innerHTML = '<option value="">声音读取失败</option>';
      notify(error.message, true);
    }
    sync();
  }

  document.addEventListener('peer-list-loaded', sync);
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
  $('#recreationVoice').addEventListener('change', () => {
    requestId = '';
    sync();
  });
  $('#produceBtn').addEventListener('click', async () => {
    if (busy || !selected.size || !$('#recreationVoice').value) return;
    busy = true;
    requestId ||= crypto.randomUUID();
    sync();
    notify('正在创建爆款复刻任务…');
    try {
      const data = await api(endpoint, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ ids:[...selected], voiceId:$('#recreationVoice').value, requestId })
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
      const { jobs } = await api();
      $('#jobsStatus').textContent = jobs.length ? '最近 30 个复刻任务；运行中的任务每 10 秒更新。' : '尚无爆款复刻任务。';
      $('#productionJobs').innerHTML = jobs.map(job => {
        const result = job.result || {};
        const plan = result.plan || {};
        const scenes = Array.isArray(result.scenes) ? result.scenes : Array.isArray(plan.scenes) ? plan.scenes : [];
        const ready = scenes.filter(scene => scene.imageStatus === 'done' && scene.audioStatus === 'done').length;
        return `<article class="peer-job">
          <h3><a href="/psychology-production?job=${encodeURIComponent(job.jobId)}">${escape(job.title || job.source?.title)}</a></h3>
          <p>${escape(job.message || job.status)} · ${Number(job.percent) || 0}%</p>
          ${job.error ? `<p class="is-error">${escape(job.error)}</p>` : ''}
          <p>分镜 ${scenes.length || '等待分析'}${scenes.length ? ` · 图片与配音均完成 ${ready}/${scenes.length}` : ''}</p>
          <a href="/psychology-production?job=${encodeURIComponent(job.jobId)}">查看分镜和素材 →</a>
        </article>`;
      }).join('');
      if (jobs.some(job => !['done','failed','cancelled','canceled'].includes(job.status))) timer = setTimeout(refresh, 10000);
    } catch (error) {
      $('#jobsStatus').textContent = error.message;
    }
  }

  $('#refreshProductionBtn').addEventListener('click', refresh);
  loadVoices();
  refresh();
  sync();
})();
