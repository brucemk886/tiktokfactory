(() => {
  const selected = new Set();
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const endpoint = '/api/psychology-peer-hits/production';
  let busy = false, requestId = '', timer;
  const notify = (text, error = false) => { $('#productionStatus').textContent = text; $('#productionStatus').classList.toggle('is-error', error); };
  function sync() {
    document.querySelectorAll('.peer-select').forEach(input => { input.checked = selected.has(input.dataset.peerId); input.disabled = busy; });
    $('#selectionCount').textContent = `已选 ${selected.size} 条`;
    $('#produceBtn').disabled = busy || !selected.size;
    $('#productionTemplate').disabled = busy;
    $('#clearSelectionBtn').disabled = busy;
  }
  async function api(options) {
    const response = await fetch(endpoint, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  }
  document.addEventListener('peer-list-loaded', sync);
  $('#hitRows').addEventListener('change', event => {
    if (!event.target.matches('.peer-select')) return;
    const id = event.target.dataset.peerId;
    if (event.target.checked && selected.size >= 5) notify('每批最多选择 5 条。', true);
    else if (event.target.checked) selected.add(id);
    else selected.delete(id);
    requestId = ''; sync();
  });
  $('#clearSelectionBtn').addEventListener('click', () => { selected.clear(); requestId = ''; sync(); });
  $('#productionTemplate').addEventListener('change', () => { requestId = ''; });
  $('#produceBtn').addEventListener('click', async () => {
    if (busy || !selected.size) return;
    busy = true; requestId ||= crypto.randomUUID(); sync(); notify('正在加入画板队列…');
    try {
      const data = await api({ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ids:[...selected], template:$('#productionTemplate').value, requestId }) });
      notify(`已创建 ${data.jobIds.length} 个任务。可以关闭页面，${data.execution === 'cloud' ? '云端' : '视频工人机'}将继续制作。`);
      selected.clear(); requestId = ''; location.href = '/psychology-production?job=' + encodeURIComponent(data.jobIds[0]);
    } catch (error) { notify(error.message, true); }
    finally { busy = false; sync(); }
  });
  const safeImage = value => /^https:\/\//i.test(String(value || '')) ? escape(value) : '';
  async function refresh() {
    clearTimeout(timer);
    try {
      const { jobs } = await api();
      $('#jobsStatus').textContent = jobs.length ? '显示最近 30 个制作任务；运行中每 10 秒更新。' : '尚无制作任务。';
      $('#productionJobs').innerHTML = jobs.map(job => {
        const result = job.result || {};
        const plan = result.plan || job.plan || {};
        const scenes = plan.scenes || (plan.visualPrompt ? [{ text:plan.narration, visualPrompt:plan.visualPrompt }] : []);
        const images = (result.results || job.results || []).filter(item => safeImage(item.imageUrl));
        return `<article class="peer-job"><h3><a href="/psychology-production?job=${encodeURIComponent(job.jobId)}">${escape(job.title || job.source?.title)}</a></h3><p>${escape(job.message || job.status)} · ${Number(job.percent) || 0}%</p>${job.error ? `<p class="is-error">${escape(job.error)}</p>` : ''}
          <details><summary>来源文案</summary><p>${escape(job.source?.copy)}</p></details>
          ${scenes.length ? `<details><summary>改编文案、分镜与生图提示词 · ${scenes.length} 镜</summary>${scenes.map((scene,index) => `<section><h4>分镜 ${index+1}</h4><p>${escape(scene.text || scene.zh)}</p>${scene.en ? `<p>${escape(scene.en)}</p>` : ''}<pre>${escape(scene.visualPrompt)}</pre></section>`).join('')}</details>` : ''}
          ${images.length ? `<div class="peer-output-grid">${images.map(image => `<figure><a href="${safeImage(image.imageUrl)}" target="_blank" rel="noopener noreferrer"><img src="${safeImage(image.imageUrl)}" alt="分镜 ${Number(image.sceneIndex)+1}" loading="lazy"></a><figcaption>${escape(image.title)}</figcaption></figure>`).join('')}</div><a href="/psychology-photo?peerJob=${encodeURIComponent(job.jobId)}">使用这组图片和文案 →</a>` : ''}</article>`;
      }).join('');
      if (jobs.some(job => !['done','failed','cancelled','canceled'].includes(job.status))) timer = setTimeout(refresh, 10000);
    } catch (error) { $('#jobsStatus').textContent = error.message; }
  }
  $('#refreshProductionBtn').addEventListener('click', refresh);
  refresh(); sync();
})();
