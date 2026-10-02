import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('browser: report trend shows nearest-day values on hover, focus and touch without overflow or stale metrics', async t => {
 const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(p => fs.existsSync(p));
 if (!executablePath) { t.skip('Chrome unavailable'); return; }
 const {default: puppeteer} = await import('puppeteer-core');
 const browser = await puppeteer.launch({executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu']});
 t.after(() => browser.close());
 const page = await browser.newPage(), errors = [], external = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request', req => { external.push(req.url()); req.abort(); });
 const source = read('public/psychology-operations.js');
 const render = source.slice(source.indexOf('function renderTrend(){'), source.indexOf('function renderAccounts(){'));
 const helpers = source.slice(0, source.indexOf('const time ='));
 const rows = [
  {date:'2026-09-26', views:1234567890, completion:.125, averageWatch:6.25},
  {date:'2026-09-27<img src=unsafe>', views:null, completion:null, averageWatch:null},
  {date:'2026-09-28', views:0, completion:0, averageWatch:0},
  {date:'2026-09-29', views:1234, completion:1, averageWatch:10}
 ];
 await page.setViewport({width:1440, height:900, hasTouch:true});
 await page.setContent('<style>' + read('public/psychology-operations.css') + '</style><body class="ops-report-page"><select id="trendMetric"><option value="views">累计播放量</option><option value="completion">完播率</option><option value="averageWatch">平均播放时长</option></select><div id="trendChart" class="ops-chart"></div></body>');
 await page.addScriptTag({content: helpers + 'const state={data:{framework:{overview:{daily:' + JSON.stringify(rows) + '}}}};' + render + 'renderTrend();'});
 const bounds = () => page.$eval('#trendChart svg', el => { const r=el.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; });
 const tooltip = () => page.$eval('#trendTooltip', el => ({hidden:el.hidden,text:el.textContent}));
 const hover = async index => { const b=await bounds(); await page.mouse.move(b.left+(10+index*980/3)/1000*b.width, b.top+b.height*.65); };
 await hover(0); assert.deepEqual(await tooltip(), {hidden:false,text:'2026-09-26累计播放量：1,234,567,890'});
 await hover(1); assert.match((await tooltip()).text, /2026-09-27<img src=unsafe>累计播放量：—/); assert.equal(await page.$('#trendTooltip img'), null);
 await hover(2); assert.match((await tooltip()).text, /累计播放量：0$/);
 await page.mouse.move(0,0); assert.equal((await tooltip()).hidden,true);
 await page.focus('#trendMetric'); for(let i=0;i<6;i++){await page.keyboard.press('Tab');if(await page.evaluate(()=>document.activeElement?.getAttribute('data-trend-index')==='3'))break;}
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-trend-index')),'3'); await page.waitForFunction(()=>document.querySelector('#trendTooltip').textContent.includes('2026-09-29')); assert.match((await tooltip()).text, /2026-09-29累计播放量：1,234$/);
 await page.keyboard.press('Escape'); assert.equal((await tooltip()).hidden,true);
 await page.focus('#trendMetric'); assert.equal((await tooltip()).hidden,true);
 await page.select('#trendMetric','completion'); await page.evaluate(() => renderTrend());
 assert.equal((await tooltip()).hidden,true); await hover(3); assert.match((await tooltip()).text, /完播率：100\.0%$/);
 await page.select('#trendMetric','averageWatch'); await page.evaluate(() => renderTrend()); await hover(0); assert.match((await tooltip()).text, /平均播放时长：6\.3 秒$/);
 await page.select('#trendMetric','views'); await page.evaluate(() => renderTrend());
 for (const width of [1440,390,320]) {
  await page.setViewport({width,height:900,hasTouch:true});
  for (const index of [0,3]) {
   await hover(index);
   const geometry = await page.$eval('#trendTooltip', el => {const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return {inside:r.left>=p.left&&r.right<=p.right+.5&&r.top>=p.top&&r.bottom<=p.bottom+.5,document:document.documentElement.scrollWidth,viewport:innerWidth};});
   assert.equal(geometry.inside,true, 'tooltip remains inside plot at '+width); assert.ok(geometry.document<=geometry.viewport);
  }
 }
 await page.mouse.move(0,0);
 const b=await bounds();await page.touchscreen.tap(b.left+(10+2*980/3)/1000*b.width,b.top+b.height*.6);
 assert.deepEqual(await tooltip(), {hidden:false,text:'2026-09-28累计播放量：0'});
 await page.evaluate(() => {state.data.framework.overview.daily=[{date:'2026-10-02',views:0}];renderTrend();});
 const one=await bounds();await page.mouse.move(one.left+one.width*.9,one.top+one.height*.5);assert.match((await tooltip()).text,/2026-10-02累计播放量：0/);
 await page.evaluate(() => {state.data.framework.overview.daily=[{date:'2026-10-02',views:null}];renderTrend();});
 assert.equal(await page.$('#trendTooltip'),null);assert.match(await page.$eval('#trendChart',el=>el.innerText),/暂无已同步播放/);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
