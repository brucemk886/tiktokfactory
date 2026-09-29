const ENDPOINT = 'https://api.kie.ai/claude/v1/messages';
const fail = (message, statusCode = 502) => { throw Object.assign(new Error(message), { statusCode }); };

// Claude Messages protocol; no implicit paid retries or provider fallbacks.
export async function kieClaudeText(env, { model, prompt, maxTokens = 4096 }) {
  const key = String(env.KIE_API_KEY || '').trim();
  if (!key) fail('Kie 密钥（KIE_API_KEY）尚未配置。', 503);
  let response;
  try {
    response = await (env.fetch || fetch)(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens, thinkingFlag: false, stream: false }),
    });
  } catch (error) {
    fail(error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'Kie 文案生成超时，请稍后重试。' : 'Kie 文案生成连接失败，请稍后重试。', 504);
  }
  if (!response.ok) {
    await response.body?.cancel();
    fail('Kie 文案生成请求失败（HTTP ' + response.status + '），请检查密钥、余额或稍后重试。');
  }
  const reader = response.body?.getReader();
  if (!reader) fail('Kie 未返回文案内容。');
  let text = '', size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) fail('Kie 文案响应超过大小限制。');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error.statusCode) throw error;
    fail('Kie 文案响应中断或超时，请稍后重试。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let data;
  try { data = JSON.parse(text); } catch { fail('Kie 返回的文案响应不是有效 JSON。'); }
  if (data?.error || data?.type === 'error' || (data?.code != null && ![0, 200].includes(Number(data.code)))) {
    fail('Kie 返回生成错误，请检查服务配置、余额或稍后重试。');
  }
  if (data?.stop_reason === 'max_tokens') fail('Kie 文案输出被截断，请减少每篇生成版本数后重试。');
  const output = Array.isArray(data?.content) ? data.content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('') : '';
  if (!output.trim()) fail('Kie 未返回可用的文案正文。');
  return output;
}
