// Shared by local Chrome and Cloudflare Chromium.
export async function renderAutomationCard({ source, index, template, imageData = '' }) {
          const { renderTextCard, renderOverlayCard } = window.renderer;
          let canvas;
          if (source.template === 'stock' && template !== 'photo-text') {
            const image = new Image();
            image.src = imageData;
            await image.decode();
            canvas = renderOverlayCard({ kind:'cover', title:source.title || '', subtitle:source.subtitle || '',
              lines: (source.body || '').split(/\r?\n/).filter(Boolean) }, image, '3:4');
          } else {
            const kind = template === 'photo-text' ? (index === 0 ? 'cover' : 'content') : (source.template === 'cover' ? 'cover' : 'content');
            const title = kind === 'cover' ? [source.title, source.subtitle, source.body].filter(Boolean).join('\n') : source.title;
            const slide = window.cards.buildTextCardSlides({ title, body:[source.subtitle,source.body].filter(Boolean).join('\n'),
              count:1, template:kind, smash:false, pageNumber:index + 1 })[0];
            canvas = renderTextCard(slide, '3:4');
          }
          return canvas.toDataURL('image/jpeg', 0.92);
}
