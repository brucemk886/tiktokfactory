// Original photo pages that must not become cards: bare page numbers or
// symbols, and long photographed book pages (operator rule, 2026-09-24).
export const PAGE_FILTER = Object.freeze({ maxChars: 500 });
export const NO_USABLE_PAGES = '图片页都是页码或长段落截图，已跳过这篇。';

export function keepPhotoPage(text) {
  const value = String(text ?? '').trim();
  return /\p{L}{2}/u.test(value) && value.length <= PAGE_FILTER.maxChars;
}

export function filterPhotoPageTexts(texts) {
  return texts.map(text => String(text ?? '').trim()).filter(keepPhotoPage);
}
