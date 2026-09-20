import { renderAutomationCard } from '../../public/psychology-card-runtime.js';

// Load our own modules before starting billable time. Never navigate to user HTML.
export async function loadCardModules(env) {
  return Promise.all(['psychology-text-card.js', 'psychology-card-renderer.js', 'psychology-card-runtime.js'].map(async name => {
    const response = await env.ASSETS.fetch(new Request('https://factory.invalid/' + name));
    if (!response.ok) throw new Error('图片模板读取失败：' + name);
    return response.text();
  }));
}

export async function openCloudCardRenderer(env, sources, driver) {
  driver ||= (await import('@cloudflare/puppeteer')).default;
  const started = Date.now();
  const browser = await driver.launch(env.PHOTO_BROWSER);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.evaluate(async ([cardsSource, rendererSource, runtimeSource]) => {
      const cardsUrl = URL.createObjectURL(new Blob([cardsSource], {type:'text/javascript'}));
      const rendererUrl = URL.createObjectURL(new Blob([
        rendererSource.replace('"./psychology-text-card.js"', JSON.stringify(cardsUrl))
      ], {type:'text/javascript'}));
      window.cards = await import(cardsUrl);
      window.renderer = await import(rendererUrl);
      const runtimeUrl=URL.createObjectURL(new Blob([runtimeSource],{type:'text/javascript'}));
      window.cardRuntime=await import(runtimeUrl);URL.revokeObjectURL(runtimeUrl);
      await document.fonts.ready;
      URL.revokeObjectURL(cardsUrl); URL.revokeObjectURL(rendererUrl);
    }, sources);
    return {
      sessionId: browser.sessionId?.() || '',
      render(source, index, template, imageData = '') {
        return page.evaluate(renderAutomationCard, {source,index,template,imageData});
      },
      renderBatch(entries) {
        return page.evaluate(async jobs => {
          const images=[];
          for(const job of jobs)images.push(await window.cardRuntime.renderAutomationCard(job));
          return images;
        },entries);
      },
      async close() { await browser.close(); return Date.now() - started; },
    };
  } catch (error) { await browser.close().catch(() => {}); throw error; }
}
