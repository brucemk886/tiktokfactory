export const DEEPSEEK_PHOTO_MODEL = 'deepseek-flash';
export const DEEPSEEK_API_ROOT = 'https://api.deepseek.com';

function providerError(message, status = 502) {
  return Object.assign(new Error(message), { statusCode: status });
}

export function createDeepSeekClient({ apiKey, fetchImpl = fetch } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw providerError('DeepSeek API Key 尚未配置。', 503);

  return {
    async createChat(prompt, { imageUrls = [] } = {}) {
      const images = imageUrls.map((value) => String(value || '').trim());
      if (images.length > 35 || images.some((value) => !isDeepSeekChatImage(value))) {
        throw providerError('多模态图片地址无效。', 400);
      }
      const response = await fetchImpl(`${DEEPSEEK_API_ROOT}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(110000),
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: DEEPSEEK_PHOTO_MODEL,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: String(prompt || '') },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
            ]
          }],
          stream: false,
          thinking: { type: 'disabled' }
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) {
        const detail = data?.error?.message || data?.message || data?.msg || `HTTP ${response.status}`;
        throw providerError(`DeepSeek 看图失败：${safeDetail(detail, key)}`, Number(response.status) || 502);
      }
      const text = chatText(data);
      if (!text.trim()) {
        const reason = data?.choices?.[0]?.finish_reason || '空响应';
        throw providerError(`DeepSeek 没有返回内容：${String(reason).slice(0, 180)}。`);
      }
      return text;
    }
  };
}

export function isDeepSeekChatImage(value) {
  const text = String(value || '').trim();
  if (/^https:\/\/[^\s]+$/i.test(text)) return true;
  return /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(text);
}

function chatText(payload) {
  const message = payload?.choices?.[0]?.message || {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && part.thought !== true && part.type !== 'thought')
      .map((part) => part.text || '')
      .join('');
  }
  return String(message.reasoning_content || message.text || payload?.text || '');
}

function safeDetail(detail, key) {
  return String(detail || '').split(key).join('***').slice(0, 1000);
}
