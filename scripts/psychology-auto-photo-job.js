import { renderAutomationCard } from '../public/psychology-card-runtime.js';
import { publishErrorMessage } from './publish-error-message.js';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer-core';

export async function openCardRenderer(root) {
  const allowed = new Set(['psychology-card-renderer.js','psychology-text-card.js']);
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!name) { res.setHeader('Content-Type','text/html'); return res.end('<!doctype html><html><body></body></html>'); }
    if (!allowed.has(name)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, 'public', name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(file => fs.existsSync(file));
  if (!executablePath) { server.close(); throw new Error('图文自动渲染需要工人机安装 Chrome 或设置 CHROME_PATH。'); }
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.evaluate(async () => {
      window.renderer = await import('/psychology-card-renderer.js');
      window.cards = await import('/psychology-text-card.js');
    });
    return {
      async render(source, index, template, imageData = '') {
        return page.evaluate(renderAutomationCard, { source, index, template, imageData });
      },
      async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); },
    };
  } catch (error) { await browser?.close(); server.close(); throw error; }
}

export async function runAutoPhotoJob({ root, workDir, payload, patchJob }) {
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(path.join(workDir,'factory-cloud-worker.json'),'utf8')); } catch {}
  const base = String(process.env.FACTORY_CLOUD_URL || settings.url || '').replace(/\/+$/,'');
  const token = String(process.env.FACTORY_WORKER_TOKEN || settings.token || '');
  if (!base || !token) throw new Error('工厂云连接尚未配置。');
  let workerId = '';
  const headers = () => ({ Authorization:'Bearer ' + token, 'x-factory-worker':workerId });
  async function call(endpoint, body) {
    const phase=endpoint.endsWith('/upload')?'图片上传':endpoint.endsWith('/publish')?'提交中台':'读取任务状态';
    try {
    const response = await fetch(base + endpoint, { method: body ? 'POST':'GET',
      headers:{ ...headers(), ...(body ? {'Content-Type':'application/json'} : {}) },
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(180000) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '工厂云图文请求失败'),{statusCode:response.status});
    return data;
    }catch(error){throw new Error(publishErrorMessage(error,phase),{cause:error});}
  }
  const current = await call('/api/worker/jobs/' + encodeURIComponent(payload.jobId));
  if (current.cancelled) throw new Error('任务已取消。');
  workerId = current.job.workerId;
  const api = '/api/worker/psychology-auto/' + encodeURIComponent(payload.jobId);
  const state = await call(api + '/state');
  if (state.receipt?.batchId) {
    patchJob({status:'done',percent:100,message:'图文已提交官方发布中台',results:[],publishSummary:state.receipt});
    return;
  }
  patchJob({status:'running',percent:15,message:'正在渲染图文卡片…'});
  const renderer = await openCardRenderer(root);
  try {
    for (let index=0; index < payload.pages.length; index++) {
      if (state.assets[index]) continue;
      const source = payload.pages[index];
      let imageData = '';
      if (source.template === 'stock' && payload.psychologyAutomation.template !== 'photo-text') {
        const response = await fetch(base + api + '/image/' + index, {headers:headers(),signal:AbortSignal.timeout(60000)});
        if (!response.ok) throw new Error('素材底图读取失败：' + response.status);
        imageData = 'data:' + response.headers.get('content-type') + ';base64,' + Buffer.from(await response.arrayBuffer()).toString('base64');
      }
      const dataUrl = await renderer.render(source,index,payload.psychologyAutomation.template,imageData);
      await call(api + '/upload', {index,dataUrl});
      patchJob({status:'running',percent:Math.round(20+65*(index+1)/payload.pages.length),message:`已上传 ${index+1}/${payload.pages.length} 张图片`});
    }
    patchJob({status:'running',percent:92,message:'图片上传完成，正在确认发布分组…'});
    const receipt = await call(api + '/publish', {});
    patchJob({status:'done',percent:100,message:receipt.batchId?'图文已提交官方发布中台':'图文已上传，等待同组内容就绪',results:[],groupReady:!receipt.batchId,publishSummary:receipt});
  } finally { await renderer.close(); }
}
