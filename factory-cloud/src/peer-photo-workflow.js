import { buildPhotoStoryPrompt, parsePhotoStory } from '../../scripts/psychology-peer-production.js';
import { createKieClient } from './kie.js';
import { withProductionPatch, compactProduction } from '../../scripts/production-timeline.js';

// Paid submissions are never blindly retried after an ambiguous provider error.
const SUBMIT = { retries: { limit: 0, delay: '1 second' }, timeout: '2 minutes' };
const READ = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' };

export async function runPeerPhotoWorkflow(env, event, step) {
  const id = event.payload.jobId;
  const row = await step.do('load-source', READ, () => env.DB.prepare("SELECT * FROM factory_jobs WHERE id = ? AND type = 'psychology-photo-story'").bind(id).first());
  if (!row || ['done', 'failed', 'canceled', 'cancelled'].includes(row.status)) return { skipped: true };
  const payload = JSON.parse(row.payload_json);
  const kie = createKieClient({ apiKey: env.KIE_API_KEY, fetchImpl: env.fetch || fetch });
  let plan = null;
  const results = [];
  let state = {};
  async function save(name, status, percent, message, error = '', patch = {}) {
    const at = await step.do(`${name}-time`, () => Date.now());
    state = withProductionPatch(state, {status,message,...patch}, at);
    await step.do(name, READ, () => env.DB.prepare(`UPDATE factory_jobs SET status=?, percent=?, message=?, result_json=?, error=?, worker_id='cloud-photo', updated_at=?, completed_at=? WHERE id=?`)
      .bind(status, percent, message, JSON.stringify({ plan, results, production:compactProduction(state.production), execution: 'cloud', progressCurrent: results.length, progressTotal: 6 }), error, at, ['done','failed'].includes(status) ? at : 0, id).run());
  }
  try {
    await save('starting', 'running', 3, '云端正在改编文案和拆分分镜…', '', {productionStage:'script'});
    let validationError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await step.do(`story-${attempt}`, SUBMIT, () => kie.createChat(buildPhotoStoryPrompt(payload) + (validationError ? `\nCorrect this validation error: ${validationError}` : '')));
      try { plan = parsePhotoStory(text); break; } catch (error) { validationError = error.message; }
    }
    if (!plan) throw new Error(validationError);
    await save('story-ready', 'running', 15, '六页分镜已完成，云端开始生图…', '', {productionStage:'images'});
    for (let index = 0; index < plan.scenes.length; index++) {
      const scene = plan.scenes[index];
      await save(`image-${index}-starting`, 'running', 15 + results.length * 13, `云端正在生成第 ${index+1}/6 页…`, '', {productionScene:{index,text:scene.text,imagePrompt:scene.visualPrompt,imageStatus:'running'}});
      const task = await step.do(`image-${index}-submit`, SUBMIT, () => kie.createKieMediaTask('image', scene.visualPrompt, { imageModel: 'z-image', aspectRatio: '9:16', noImageText: true }));
      let remote;
      for (let poll = 0; poll < 60; poll++) {
        remote = await step.do(`image-${index}-poll-${poll}`, READ, () => kie.getKieTask(task.taskId));
        if (['success', 'fail'].includes(remote.state)) break;
        await step.sleep(`image-${index}-wait-${poll}`, '10 seconds');
      }
      if (remote?.state !== 'success' || !remote.resultUrls?.[0]?.startsWith('https://')) {
        throw new Error(remote?.error || `第 ${index + 1} 页生图失败或超时，已保留已完成的内容。`);
      }
      results.push({ title: scene.text, imageUrl: remote.resultUrls[0], imageModel: 'z-image', template: 'psychology-photo-story', sceneIndex: index, visualPrompt: scene.visualPrompt });
      await save(`image-${index}-saved`, 'running', 15 + results.length * 13, `云端已完成 ${results.length}/6 页图片。`, '', {productionScene:{index,imageUrl:remote.resultUrls[0],imageStatus:'done'}});
    }
    await save('completed', 'done', 100, '云端已生成六页图片和对应文案。');
    return { jobId: id, count: results.length };
  } catch (error) {
    await save('failed', 'failed', 15 + results.length * 13, '图文生成失败，已保留完成的分镜和图片。', String(error.message || error).slice(0, 1000));
    throw error;
  }
}
