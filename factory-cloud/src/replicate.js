// Replicate text models (e.g. anthropic/claude-sonnet-5). A prediction waits up
// to 60 s on creation, then is polled until it finishes or the budget runs out.
const API = 'https://api.replicate.com/v1';
const fail = (message, statusCode = 502) => { throw Object.assign(new Error(message), { statusCode }); };

export async function replicateText(env, { model, prompt, systemPrompt = '', maxTokens = 4096, effort = 'low' },
  { fetchImpl = env.fetch || fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), budgetMs = 120000, now = () => Date.now() } = {}) {
  const token = String(env.REPLICATE_API_TOKEN || '').trim();
  if (!token) fail('Replicate 密钥（REPLICATE_API_TOKEN）尚未配置。', 503);
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const started = now();
  const read = async response => {
    let data = {};
    try { data = await response.json(); } catch { /* reported below */ }
    if (!response.ok) fail('Replicate 请求失败（' + response.status + '）：' + String(data.detail || data.title || data.error || '').slice(0, 200));
    return data;
  };
  let prediction = await read(await fetchImpl(`${API}/models/${model}/predictions`, {
    method: 'POST', headers: { ...headers, Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, system_prompt: systemPrompt, max_tokens: maxTokens, effort } }),
  }));
  while (['starting', 'processing'].includes(prediction.status)) {
    if (now() - started > budgetMs || !prediction.urls?.get) fail('Replicate 生成超时，请稍后重试。', 504);
    await sleep(1500);
    prediction = await read(await fetchImpl(prediction.urls.get, { headers }));
  }
  if (prediction.status !== 'succeeded') fail('Replicate 生成失败：' + String(prediction.error || prediction.status || '未知错误').slice(0, 200));
  return Array.isArray(prediction.output) ? prediction.output.join('') : String(prediction.output ?? '');
}
