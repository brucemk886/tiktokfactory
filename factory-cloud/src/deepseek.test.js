import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeepSeekClient, DEEPSEEK_API_ROOT, DEEPSEEK_PHOTO_MODEL, isDeepSeekChatImage } from './deepseek.js';

test('DeepSeek photo chat uses V4.1 Flash with thinking disabled and inline images', async () => {
  const calls = [];
  const client = createDeepSeekClient({
    apiKey: 'sk-deepseek-test-key',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    }
  });
  const text = await client.createChat('Classify these pages.', {
    imageUrls: ['data:image/jpeg;base64,/9j/4AAQ']
  });
  assert.equal(text, '{"ok":true}');
  assert.equal(calls[0].url, `${DEEPSEEK_API_ROOT}/chat/completions`);
  assert.equal(calls[0].body.model, DEEPSEEK_PHOTO_MODEL);
  assert.equal(calls[0].body.thinking.type, 'disabled');
  assert.equal(calls[0].headers.Authorization, 'Bearer sk-deepseek-test-key');
  assert.equal(calls[0].body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,/9j/4AAQ');
});

test('DeepSeek photo chat surfaces provider errors without leaking the key', async () => {
  const client = createDeepSeekClient({
    apiKey: 'sk-secret-should-not-leak',
    fetchImpl: async () => Response.json({
      error: { message: 'quota exceeded for sk-secret-should-not-leak' }
    }, { status: 429 })
  });
  await assert.rejects(client.createChat('Classify these pages.', {
    imageUrls: ['https://cdn.example/photo.jpg']
  }), /quota exceeded for \*\*\*/);
});

test('DeepSeek photo chat rejects empty responses and invalid image payloads', async () => {
  const client = createDeepSeekClient({
    apiKey: 'sk-deepseek-test-key',
    fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] })
  });
  await assert.rejects(client.createChat('Classify these pages.'), /content_filter/);
  assert.equal(isDeepSeekChatImage('data:image/jpeg;base64,abc'), true);
  assert.equal(isDeepSeekChatImage('http://insecure.example/a.jpg'), false);
  await assert.rejects(
    createDeepSeekClient({ apiKey: 'sk-deepseek-test-key' }).createChat('x', { imageUrls: ['ftp://x'] }),
    /多模态图片地址无效/
  );
});
