import { buildPerImageCopySlides, buildStockOverlaySlides, buildTextCardSlides, cardCanvasSize, mergeTextCardSets, planCenteredBlock, wrapLines } from "./psychology-text-card.js?v=20260918-12";
import { pickCoverBackdrop, paintCoverBackdrop } from "./psychology-cover-backdrops.js";

const FINAL_STATES = new Set(["success", "fail"]);
const state = { mode: "zimage", textTemplate: "content", lastCoverBackdropId: "", accounts: [], groups: [], project: null, tasks: [], currentTaskIds: [], textCards: [], zimageCards: [], stockPhotos: [], selectedStock: [], selectedKeys: [], seenKeys: new Set(), overlaySlides: [], overlaying: false, pollTimer: 0, busy: false };
let peerJobPhotos = [];
const $ = (selector) => document.querySelector(selector);

$("#refreshBtn")?.addEventListener("click", loadPage);
$("#generateBtn")?.addEventListener("click", generateImages);
$("#renderCardBtn")?.addEventListener("click", generateTextCards);
$("#renderStockBtn")?.addEventListener("click", generateStockCards);
$("#searchStockBtn")?.addEventListener("click", searchStockPhotos);
$("#musicSoundId")?.addEventListener("input", syncMusicMode);
$("#publishBtn")?.addEventListener("click", publishPhotoPost);
$("#textModeTab")?.addEventListener("click", () => setPhotoMode("text"));
$("#stockModeTab")?.addEventListener("click", () => setPhotoMode("stock"));
$("#zimageModeTab")?.addEventListener("click", () => setPhotoMode("zimage"));
$("#coverTemplateTab")?.addEventListener("click", () => setTextTemplate("cover"));
$("#contentTemplateTab")?.addEventListener("click", () => setTextTemplate("content"));
$("#photoLightboxClose")?.addEventListener("click", closePhotoPreview);
$("#photoLightbox")?.addEventListener("click", (event) => {
  if (event.target === $("#photoLightbox")) closePhotoPreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePhotoPreview();
});
loadPage();

async function loadPage() {
  showStatus("正在读取图文记录和心理学项目账号…");
  try {
    const [ai, accounts] = await Promise.all([
      requestJson(`/api/kie-ai?t=${Date.now()}`),
      requestJson(`/api/official-tiktok/publish-accounts?module=psychology&media=photo&t=${Date.now()}`),
    ]);
    state.tasks = (ai.tasks || []).filter((task) => task.kind === "image" && task.model === "z-image");
    state.project = accounts.project || null;
    state.groups = accounts.groups || [];
    state.accounts = accounts.accounts || [];
    const peerJobId = new URLSearchParams(location.search).get("peerJob");
    if (peerJobId && !peerJobPhotos.length) {
      const { jobs } = await requestJson("/api/psychology-peer-hits/production?jobId=" + encodeURIComponent(peerJobId));
      const job = jobs.find((item) => item.jobId === peerJobId && item.type === "psychology-photo-story");
      if (!job) throw new Error("未找到这组同行爆款图文。");
      const plan = job.result?.plan || job.plan || {};
      peerJobPhotos = (job.result?.results || job.results || []).filter((item) => item.imageModel === "z-image" && /^https:\/\//i.test(item.imageUrl || "")).map((item, index) => ({ key: `${peerJobId}:${index}`, peerJobId, resultIndex: index, url: item.imageUrl, prompt: item.title, createdAt: job.createdAt }));
      resetPhotoSelection();
      $("#photoTitle").value = plan.title || "";
      $("#publishCaption").value = plan.caption || "";
      setPhotoMode("zimage");
    } else {
      setPhotoMode(state.mode);
    }
    renderAll();
    watchPending();
    hideStatus();
  } catch (error) {
    renderGeneratedPhotos();
    showStatus(error.message || "页面数据读取失败");
  }
}

function setPhotoMode(mode) {
  state.mode = mode === "zimage" || mode === "stock" ? mode : "text";
  const isText = state.mode === "text";
  const isStock = state.mode === "stock";
  $("#textModeTab")?.classList.toggle("is-active", isText);
  $("#stockModeTab")?.classList.toggle("is-active", isStock);
  $("#zimageModeTab")?.classList.toggle("is-active", state.mode === "zimage");
  if ($("#textModeTab")) $("#textModeTab").setAttribute("aria-selected", String(isText));
  if ($("#stockModeTab")) $("#stockModeTab").setAttribute("aria-selected", String(isStock));
  if ($("#zimageModeTab")) $("#zimageModeTab").setAttribute("aria-selected", String(state.mode === "zimage"));
  if ($("#textPane")) $("#textPane").hidden = !isText;
  if ($("#stockPane")) $("#stockPane").hidden = !isStock;
  if ($("#zimagePane")) $("#zimagePane").hidden = state.mode !== "zimage";
  if ($("#createLead")) {
    $("#createLead").textContent = isText
      ? (state.textTemplate === "cover" ? "封面只生成 1 张，文案写在上面那一句里。" : "内容页数量不含封面。文案空一行就是下一张；标题只出现在第一张内容页。")
      : isStock
        ? "素材图和叠字一一对应。空一行就是下一张的文案；第一张标题只叠在第一张上。"
        : "生成几张就叠几段文案，空一行换下一张。不填叠字则只出图。";
  }
  if (isText) setTextTemplate(state.textTemplate);
  renderGeneratedPhotos();
}

function setTextTemplate(template) {
  state.textTemplate = template === "cover" ? "cover" : "content";
  const isCover = state.textTemplate === "cover";
  $("#coverTemplateTab")?.classList.toggle("is-active", isCover);
  $("#contentTemplateTab")?.classList.toggle("is-active", !isCover);
  if ($("#coverTemplateTab")) $("#coverTemplateTab").setAttribute("aria-selected", String(isCover));
  if ($("#contentTemplateTab")) $("#contentTemplateTab").setAttribute("aria-selected", String(!isCover));
  const titleLabel = $("#cardTitleField span");
  const titleInput = $("#cardTitle");
  if (titleLabel) titleLabel.textContent = isCover ? "封面文案" : "内容标题";
  if (titleInput) titleInput.placeholder = isCover ? "例如：i can fix her" : "例如：Signs of an Avoidant Attachment Style";
  if ($("#cardBodyField")) $("#cardBodyField").hidden = isCover;
  const countField = $("#cardCount")?.closest(".compact-field");
  if (countField) countField.hidden = isCover;
  if ($("#createLead") && state.mode === "text") $("#createLead").textContent = isCover ? "封面只生成 1 张，文案写在上面那一句里。" : "内容页数量不含封面。文案空一行就是下一张；标题只出现在第一张内容页。";
}

async function generateTextCards() {
  const button = $("#renderCardBtn");
  button.disabled = true;
  button.textContent = "正在出图…";
  try {
    const slides = buildTextCardSlides({
      title: $("#cardTitle").value,
      body: $("#cardBody").value,
      count: $("#cardCount").value,
      smash: false,
      template: state.textTemplate,
    });
    const aspectRatio = $("#cardAspect").value;
    const backdrop = state.textTemplate === "cover" ? pickCoverBackdrop({ excludeId: state.lastCoverBackdropId }) : null;
    if (backdrop) state.lastCoverBackdropId = backdrop.id;
    const cards = [];
    for (const [index, slide] of slides.entries()) {
      const blob = await canvasToJpeg(renderTextCard(slide, aspectRatio, backdrop));
      const url = URL.createObjectURL(blob);
      cards.push({
        key: `text:${slide.kind}:${Date.now()}:${index}`,
        kind: "text-card",
        template: slide.kind,
        resultIndex: index,
        url,
        blob,
        contentType: "image/jpeg",
        prompt: slide.title || slide.bullets[0] || "文案图片",
        createdAt: Date.now(),
      });
    }
    const merged = mergeTextCardSets(state.textCards, cards, state.textTemplate);
    forgetRemovedCards(merged.removed);
    state.textCards = merged.cards;
    peerJobPhotos = [];
    state.currentTaskIds = [];
    if (!$("#photoTitle").value.trim() && $("#cardTitle").value.trim()) $("#photoTitle").value = $("#cardTitle").value.trim().slice(0, 90);
    renderGeneratedPhotos();
    const label = state.textTemplate === "cover" ? "封面" : "内容";
    setGenerateMessage(`已生成 ${cards.length} 张${label}图片，图集共 ${state.textCards.length} 张，可勾选后发布。`);
  } catch (error) {
    setGenerateMessage(error.message || "生成文案图片失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "生成文案图片";
  }
}

function renderTextCard(slide, aspectRatio, backdrop) {
  return slide.kind === "cover" ? renderCoverCard(slide, aspectRatio, backdrop) : renderContentCard(slide, aspectRatio);
}

function renderCoverCard(slide, aspectRatio, backdrop) {
  const { width, height } = cardCanvasSize(aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const theme = backdrop || pickCoverBackdrop({ excludeId: state.lastCoverBackdropId });
  state.lastCoverBackdropId = theme.id;
  paintCoverBackdrop(ctx, width, height, theme);
  const pad = Math.round(width * 0.12);
  const family = '"Iowan Old Style","Palatino Linotype",Georgia,"Times New Roman",serif';
  let size = Math.round(width * 0.078);
  let lines = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    ctx.font = `600 ${size}px ${family}`;
    lines = wrapLines(slide.title, (text) => ctx.measureText(text).width, width - pad * 2);
    if (lines.length * size * 1.18 <= height - pad * 2 || attempt === 7) break;
    size = Math.max(28, Math.round(size * 0.9));
  }
  ctx.fillStyle = theme.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${size}px ${family}`;
  let y = planCenteredBlock(lines.length * size * 1.18, height, pad);
  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += size * 1.18;
  }
  return canvas;
}

function renderContentCard(slide, aspectRatio) {
  const { width, height } = cardCanvasSize(aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const pad = Math.round(width * 0.085);
  const maxWidth = width - pad * 2;
  const family = '"Avenir Next","Segoe UI",Helvetica,Arial,sans-serif';
  let titleSize = Math.round(width * 0.082);
  let bodySize = Math.round(width * 0.042);
  let pack = { titleLines: [], bullets: [], total: 0 };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    ctx.font = `800 ${titleSize}px ${family}`;
    const titleLines = slide.title ? wrapLines(slide.title, (text) => ctx.measureText(text).width, maxWidth) : [];
    ctx.font = `400 ${bodySize}px ${family}`;
    const mark = "•  ";
    const markWidth = ctx.measureText(mark).width;
    const bullets = [];
    for (const bullet of slide.bullets) {
      const lines = wrapLines(bullet, (text) => ctx.measureText(text).width, maxWidth - markWidth);
      bullets.push(lines);
    }
    const titleHeight = titleLines.length ? titleLines.length * titleSize * 1.08 + titleSize * 0.55 : 0;
    const bodyHeight = bullets.reduce((sum, lines) => sum + lines.length * bodySize * 1.42 + bodySize * 0.28, 0);
    pack = { titleLines, bullets, mark, markWidth, titleHeight, total: titleHeight + bodyHeight };
    if (pack.total <= height - pad * 2 || attempt === 7) break;
    titleSize = Math.max(36, Math.round(titleSize * 0.9));
    bodySize = Math.max(22, Math.round(bodySize * 0.9));
  }
  ctx.fillStyle = "#f6f3ee";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  let y = pad;
  ctx.textAlign = "left";
  ctx.fillStyle = "#111111";
  ctx.font = `800 ${titleSize}px ${family}`;
  for (const line of pack.titleLines) {
    ctx.fillText(line, pad, y);
    y += titleSize * 1.08;
  }
  if (pack.titleLines.length) y += titleSize * 0.55;
  const listTop = y;
  ctx.font = `400 ${bodySize}px ${family}`;
  for (const lines of pack.bullets) {
    lines.forEach((line, index) => {
      ctx.fillText(index === 0 ? `${pack.mark}${line}` : line, pad + (index === 0 ? 0 : pack.markWidth), y);
      y += bodySize * 1.42;
    });
    y += bodySize * 0.28;
  }
  if (slide.accent) {
    const accentSize = Math.max(24, Math.round(width * 0.038));
    ctx.fillStyle = "#e23b2e";
    ctx.font = `600 ${accentSize}px ${family}`;
    ctx.textAlign = "right";
    ctx.fillText(slide.accent, width - pad, listTop + bodySize * 1.2);
  }
  return canvas;
}

async function searchStockPhotos() {
  const query = $("#stockQuery").value.trim() || $("#stockTitle").value.trim();
  const button = $("#searchStockBtn");
  button.disabled = true;
  button.textContent = "搜索中…";
  try {
    const data = await requestJson(`/api/official-tiktok/stock-photos?q=${encodeURIComponent(query)}&count=12`);
    state.stockPhotos = data.photos || [];
    state.selectedStock = state.stockPhotos.slice(0, Math.max(1, Math.min(6, Number($("#stockCount").value) || 1))).map((photo) => photo.fileUrl);
    renderStockResults(data.configured === false ? (data.error || "还没有配置 Pexels，请改用图片链接。") : (state.stockPhotos.length ? "" : "没有搜到素材。换个词再试。"));
    if (data.configured === false) setGenerateMessage(data.error, true);
    else setGenerateMessage(state.stockPhotos.length ? `找到 ${state.stockPhotos.length} 张素材，已预选 ${state.selectedStock.length} 张。` : "没有搜到素材。");
  } catch (error) {
    setGenerateMessage(error.message || "搜索素材失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "搜索素材";
  }
}

function renderStockResults(emptyMessage = "") {
  const node = $("#stockResults");
  if (!node) return;
  if (!state.stockPhotos.length) {
    node.innerHTML = emptyMessage ? `<div class="generated-photo-empty">${escapeHtml(emptyMessage)}</div>` : "";
    return;
  }
  const selected = new Set(state.selectedStock);
  node.innerHTML = state.stockPhotos.map((photo) => `<button type="button" class="stock-thumb${selected.has(photo.fileUrl) ? " is-selected" : ""}" data-file-url="${escapeAttr(photo.fileUrl)}"><img src="${escapeAttr(photo.thumbUrl)}" alt="${escapeAttr(photo.author)}" loading="lazy"><span>${escapeHtml(photo.author)}</span></button>`).join("");
  node.querySelectorAll(".stock-thumb").forEach((button) => button.addEventListener("click", () => {
    const url = button.dataset.fileUrl;
    if (state.selectedStock.includes(url)) state.selectedStock = state.selectedStock.filter((item) => item !== url);
    else if (state.selectedStock.length < 6) state.selectedStock.push(url);
    renderStockResults();
  }));
}

function pastedStockUrls() {
  return String($("#stockUrls")?.value || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => /^https:\/\//i.test(line)).map((url) => `/api/official-tiktok/stock-photos/file?url=${encodeURIComponent(url)}`);
}

async function generateStockCards() {
  const button = $("#renderStockBtn");
  button.disabled = true;
  button.textContent = "正在出图…";
  try {
    const slides = buildStockOverlaySlides({
      title: $("#stockTitle").value,
      subtitle: $("#stockSubtitle").value,
      body: $("#stockBody").value,
      count: $("#stockCount").value,
      smash: false,
    });
    let images = state.selectedStock.length ? state.selectedStock : pastedStockUrls();
    if (!images.length) {
      const query = $("#stockQuery").value.trim() || $("#stockTitle").value.trim();
      if (query) await searchStockPhotos();
      images = state.selectedStock.length ? state.selectedStock : pastedStockUrls();
    }
    if (!images.length) throw new Error("请先搜索素材，或粘贴素材站图片链接。");
    if (images.length < slides.length) throw new Error(`图片数量是 ${slides.length}，请先选够 ${slides.length} 张素材图。`);
    const aspectRatio = $("#stockAspect").value;
    const grayscale = $("#stockGray").checked;
    const cards = [];
    for (const [index, slide] of slides.entries()) {
      const image = await loadImage(images[index]);
      const blob = await canvasToJpeg(renderOverlayCard(slide, image, aspectRatio, { grayscale }));
      const url = URL.createObjectURL(blob);
      cards.push({
        key: `stock:${Date.now()}:${index}`,
        kind: "text-card",
        template: "stock",
        resultIndex: index,
        url,
        blob,
        contentType: "image/jpeg",
        prompt: slide.title || slide.lines[0] || "素材库图片",
        createdAt: Date.now(),
      });
    }
    const merged = mergeTextCardSets(state.textCards, cards, "stock");
    forgetRemovedCards(merged.removed);
    state.textCards = merged.cards;
    peerJobPhotos = [];
    state.currentTaskIds = [];
    if (!$("#photoTitle").value.trim() && $("#stockTitle").value.trim()) $("#photoTitle").value = $("#stockTitle").value.trim().slice(0, 90);
    renderGeneratedPhotos();
    setGenerateMessage(`已生成 ${cards.length} 张素材库图片，可勾选后发布。`);
  } catch (error) {
    setGenerateMessage(error.message || "生成素材图失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "生成素材图";
  }
}

function copySlidesForCount(count) {
  const body = $("#imageCopy")?.value || "";
  if (!String(body).trim()) return [];
  return buildPerImageCopySlides({ body, count, smash: false });
}

async function overlayGeneratedPhotos() {
  if (state.overlaying || !state.overlaySlides.length || !state.currentTaskIds.length) return;
  const photos = currentGeneratedPhotos();
  if (!photos.length) return;
  state.overlaying = true;
  setGenerateMessage("图片已生成，正在按张叠字…");
  try {
    const aspectRatio = $("#aspectRatio").value;
    const cards = [];
    for (const photo of photos) {
      const slide = state.overlaySlides[photo.slideIndex] || { title: "", subtitle: "", lines: [] };
      const src = `/api/official-tiktok/generated-photos/file?generationId=${encodeURIComponent(photo.generationId)}&resultIndex=${encodeURIComponent(photo.resultIndex)}`;
      const image = await loadImage(src);
      const blob = await canvasToJpeg(renderOverlayCard(slide, image, aspectRatio));
      const url = URL.createObjectURL(blob);
      cards.push({
        key: `zimage-copy:${photo.generationId}:${photo.slideIndex}:${photo.resultIndex}`,
        kind: "text-card",
        template: "zimage",
        generationId: photo.generationId,
        resultIndex: photo.resultIndex,
        url,
        blob,
        contentType: "image/jpeg",
        prompt: slide.lines[0] || slide.title || photo.prompt,
        createdAt: Date.now(),
      });
    }
    forgetRemovedCards(state.zimageCards);
    state.zimageCards = cards;
    resetPhotoSelection();
    renderGeneratedPhotos();
    setGenerateMessage(`已生成 ${cards.length} 张图，并按顺序叠上每张文案。`);
  } catch (error) {
    setGenerateMessage(error.message || "叠字失败，仍可发布未叠字的原图。", true);
  } finally {
    state.overlaying = false;
  }
}

function currentGeneratedPhotos() {
  return state.currentTaskIds.flatMap((id, slideIndex) => {
    const task = state.tasks.find((item) => item.id === id);
    if (!task || task.status !== "success") return [];
    return (task.resultUrls || []).map((url, index) => ({
      key: `${task.id}:${index}`,
      generationId: task.id,
      resultIndex: index,
      slideIndex,
      url,
      prompt: task.prompt,
      createdAt: task.createdAt,
    }));
  });
}

async function loadImage(src) {
  const response = await fetch(src, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "图片读取失败。");
  }
  const url = URL.createObjectURL(await response.blob());
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片读取失败。"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderOverlayCard(slide, image, aspectRatio, { grayscale = false } = {}) {
  const { width, height } = cardCanvasSize(aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (grayscale) ctx.filter = "grayscale(1)";
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  ctx.restore();
  const pad = Math.round(width * 0.1);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#111111";
  let titleSize = Math.round(width * (slide.kind === "cover" ? 0.068 : 0.046));
  let bodySize = Math.round(width * 0.038);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const lines = [];
    if (slide.title) {
      ctx.font = `700 ${titleSize}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
      wrapLines(slide.title, (text) => ctx.measureText(text).width, width - pad * 2).forEach((line) => lines.push({ text: line, size: titleSize, weight: 700, gap: titleSize * 1.12 }));
    }
    if (slide.subtitle) {
      ctx.font = `400 ${bodySize}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
      wrapLines(slide.subtitle, (text) => ctx.measureText(text).width, width - pad * 2).forEach((line) => lines.push({ text: line, size: bodySize, weight: 400, gap: bodySize * 1.35 }));
    }
    ctx.font = `400 ${bodySize}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
    for (const line of slide.lines || []) {
      wrapLines(line, (text) => ctx.measureText(text).width, width - pad * 2).forEach((part, index) => {
        lines.push({ text: part, size: bodySize, weight: 400, gap: bodySize * 1.38 + (index === 0 ? bodySize * 0.18 : 0) });
      });
    }
    const total = lines.reduce((sum, line) => sum + line.gap, 0);
    if (total <= height - pad * 2 || attempt === 7) {
      let y = planCenteredBlock(total, height, pad);
      for (const line of lines) {
        ctx.font = `${line.weight} ${line.size}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
        ctx.fillText(line.text, width / 2, y);
        y += line.gap;
      }
      return canvas;
    }
    titleSize = Math.max(28, Math.round(titleSize * 0.9));
    bodySize = Math.max(20, Math.round(bodySize * 0.9));
  }
  return canvas;
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("卡片导出失败。")), "image/jpeg", 0.92);
  });
}

function revokeCardUrls(cards = []) {
  for (const card of cards) {
    if (card.url?.startsWith("blob:")) URL.revokeObjectURL(card.url);
  }
}

function forgetRemovedCards(cards = []) {
  const removedKeys = new Set(cards.map((card) => card.key));
  revokeCardUrls(cards);
  state.selectedKeys = state.selectedKeys.filter((key) => !removedKeys.has(key));
  removedKeys.forEach((key) => state.seenKeys.delete(key));
}

function clearTextCards() {
  forgetRemovedCards(state.textCards);
  state.textCards = [];
}

async function generateImages() {
  const prompt = $("#imagePrompt").value.trim();
  if (prompt.length < 2) return setGenerateMessage("请先填写画面描述。", true);
  const count = Math.max(1, Math.min(6, Number($("#imageCount").value) || 1));
  const button = $("#generateBtn");
  button.disabled = true;
  button.textContent = "正在提交…";
  setGenerateMessage(`正在提交 ${count} 个 Z-Image 任务…`);
  try {
    const results = await Promise.allSettled(Array.from({ length: count }, () => requestJson("/api/kie-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "image", prompt, imageModel: "z-image", aspectRatio: $("#aspectRatio").value, noImageText: $("#noImageText").checked }),
    })));
    const created = results.flatMap((result) => result.status === "fulfilled" ? [result.value.task] : []);
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason?.message || String(result.reason)] : []);
    if (!created.length) throw new Error(failures[0] || "Z-Image 任务提交失败。");
    resetPhotoSelection();
    peerJobPhotos = [];
    clearTextCards();
    forgetRemovedCards(state.zimageCards);
    state.zimageCards = [];
    state.overlaySlides = copySlidesForCount(count);
    state.currentTaskIds = created.map((task) => task.id);
    state.tasks = [...created, ...state.tasks];
    renderGeneratedPhotos();
    watchPending();
    setGenerateMessage(failures.length ? `已提交 ${created.length} 个任务，${failures.length} 个失败：${failures.join("；")}` : `已提交 ${created.length} 个任务，完成后会自动显示。`, failures.length > 0);
  } catch (error) {
    setGenerateMessage(error.message || "生成失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "生成图片";
  }
}

function watchPending() {
  clearInterval(state.pollTimer);
  const activeIds = state.tasks.filter((task) => !FINAL_STATES.has(task.status)).map((task) => task.id);
  updateGenerationState();
  if (!activeIds.length) return;
  state.pollTimer = window.setInterval(async () => {
    const refreshed = await Promise.all(activeIds.map((id) => requestJson(`/api/kie-ai?id=${encodeURIComponent(id)}`).then((data) => data.task).catch(() => null)));
    state.tasks = state.tasks.map((task) => refreshed.find((item) => item?.id === task.id) || task);
    renderGeneratedPhotos();
    updateGenerationState();
    if (state.tasks.every((task) => FINAL_STATES.has(task.status) || !activeIds.includes(task.id))) {
      clearInterval(state.pollTimer);
      overlayGeneratedPhotos();
    }
  }, 4000);
}

function generatedPhotos() {
  return [...peerJobPhotos, ...state.tasks.flatMap((task) => (task.status === "success" ? (task.resultUrls || []).map((url, index) => ({ key: `${task.id}:${index}`, generationId: task.id, resultIndex: index, url, prompt: task.prompt, createdAt: task.createdAt })) : []))];
}

function availablePhotos() {
  if (state.mode === "text") return state.textCards.filter((photo) => photo.template !== "stock" && photo.template !== "zimage").slice(0, 6);
  if (state.mode === "stock") return state.textCards.filter((photo) => photo.template === "stock").slice(0, 6);
  if (state.zimageCards.length) return state.zimageCards.slice(0, 6);
  if (peerJobPhotos.length) return peerJobPhotos.slice(0, 6);
  if (state.currentTaskIds.length) {
    const current = new Set(state.currentTaskIds);
    return generatedPhotos().filter((photo) => current.has(photo.generationId)).slice(0, 6);
  }
  return generatedPhotos().slice(0, 6);
}

function resetPhotoSelection() {
  state.selectedKeys = [];
  state.seenKeys = new Set();
}

function syncPhotoSelection(photos) {
  let selectedHere = photos.filter((photo) => state.selectedKeys.includes(photo.key)).length;
  for (const photo of photos) {
    if (state.seenKeys.has(photo.key)) continue;
    state.seenKeys.add(photo.key);
    if (selectedHere >= 6 || state.selectedKeys.includes(photo.key)) continue;
    state.selectedKeys.push(photo.key);
    selectedHere += 1;
  }
}

function toggleGeneratedPhoto(key) {
  if (state.selectedKeys.includes(key)) {
    state.selectedKeys = state.selectedKeys.filter((item) => item !== key);
  } else {
    const selectedHere = availablePhotos().filter((photo) => state.selectedKeys.includes(photo.key)).length;
    if (selectedHere < 6) state.selectedKeys.push(key);
  }
  renderGeneratedPhotos();
}

function openPhotoPreview(url) {
  const box = $("#photoLightbox");
  const image = $("#photoLightboxImage");
  if (!box || !image || !url) return;
  image.src = url;
  box.hidden = false;
}

function closePhotoPreview() {
  const box = $("#photoLightbox");
  const image = $("#photoLightboxImage");
  if (image) image.src = "";
  if (box) box.hidden = true;
}

function publicationPhotos() {
  return availablePhotos().filter((photo) => state.selectedKeys.includes(photo.key)).slice(0, 6);
}

function renderAll() {
  renderGeneratedPhotos();
  renderAccounts();
}

function renderGeneratedPhotos() {
  const photos = availablePhotos();
  syncPhotoSelection(photos);
  const selected = publicationPhotos();
  const selectedSet = new Set(selected.map((photo) => photo.key));
  const ratio = state.mode === "zimage" ? "9 / 16" : ((state.mode === "stock" ? $("#stockAspect")?.value : $("#cardAspect")?.value) || "1:1").replace(":", " / ");
  const empty = state.mode === "text"
    ? "还没有文案图片。先用封面模板出 1 张，再切到内容模板；空一行就是下一张内容页。"
    : state.mode === "stock"
      ? "还没有素材库图片。搜好素材后，按张写文案，空一行换下一张。"
      : "还没有可用图片。生成数量对应文案段数；空一行换下一张。";
  $("#photoList").innerHTML = photos.length ? photos.map((photo) => {
    const order = selected.findIndex((item) => item.key === photo.key);
    const checked = order >= 0;
    const label = checked ? `${order + 1}${order === 0 ? " · 封面" : ""}` : "未选";
    return `<article class="generated-photo-card${checked ? " is-selected" : ""}">
      <button type="button" class="photo-zoom" data-photo-url="${escapeAttr(photo.url)}" aria-label="放大查看">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <img src="${escapeAttr(photo.url)}" alt="${escapeAttr(photo.prompt || "生成图片")}" loading="lazy" style="aspect-ratio:${ratio}">
      <label class="photo-pick"><input type="checkbox" data-photo-key="${escapeAttr(photo.key)}" ${checked ? "checked" : ""}> ${label}</label>
    </article>`;
  }).join("") : `<div class="generated-photo-empty">${empty}</div>`;
  $("#photoList").querySelectorAll(".photo-pick input").forEach((input) => input.addEventListener("change", () => toggleGeneratedPhoto(input.dataset.photoKey)));
  $("#photoList").querySelectorAll(".photo-zoom").forEach((button) => button.addEventListener("click", () => openPhotoPreview(button.dataset.photoUrl)));
  updateGenerationState();
}

function renderAccounts() {
  $("#groupPanel").innerHTML = state.groups.map((group) => `<span class="group-chip">${escapeHtml(group.name)} · ${group.accountCount || 0} 个账号</span>`).join("");
  $("#accountCount").textContent = `${state.accounts.length} 个账号`;
  $("#accountList").innerHTML = state.accounts.length ? state.accounts.map((account, index) => {
    const id = account.connectionId || account.id || "";
    const name = account.displayName || account.label || account.username || id;
    return `<label class="check-row"><input class="publish-account" name="publishAccount" type="radio" value="${escapeAttr(id)}" ${index === 0 ? "checked" : ""}><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(account.username ? `@${account.username}` : id)} · ${escapeHtml(account.groupName || "未分组")}</small></span></label>`;
  }).join("") : '<div class="empty">心理学项目分组里还没有可发布的官方账号。</div>';
}

function syncMusicMode() {
  if (/^\d{1,30}$/.test($("#musicSoundId").value.trim())) $("#autoAddMusic").checked = false;
}

async function publishPhotoPost() {
  if (state.busy) return;
  const connectionId = document.querySelector(".publish-account:checked")?.value || "";
  const selections = publicationPhotos();
  if (!availablePhotos().length) return setPublishResult(state.mode === "zimage" ? "请先生成 1–6 张图片。" : "请先生成 1–6 张卡片。");
  if (!selections.length) return setPublishResult("请先勾选 1–6 张要发布的图片。");
  if (state.overlaying) return setPublishResult("正在按张叠字，请稍候。");
  if (state.mode === "zimage" && state.currentTaskIds.some((id) => !FINAL_STATES.has(state.tasks.find((task) => task.id === id)?.status))) return setPublishResult("本批图片仍在生成，请等待全部完成后发布。");
  if (!connectionId) return setPublishResult("请先选择发布账号。");
  const musicSoundId = $("#musicSoundId").value.trim();
  if (musicSoundId && !/^\d{1,30}$/.test(musicSoundId)) return setPublishResult("音乐 ID 只能包含数字。");
  const scheduleAt = $("#publishTime").value ? new Date($("#publishTime").value).getTime() : 0;
  state.busy = true;
  $("#publishBtn").disabled = true;
  try {
    const assets = [];
    for (let index = 0; index < selections.length; index += 1) {
      const photo = selections[index];
      if (photo.kind === "text-card") {
        setPublishResult(`正在上传第 ${index + 1} / ${selections.length} 张图片…`);
        assets.push(await requestJson("/api/official-tiktok/photo-assets/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: await blobToDataUrl(photo.blob),
            contentType: "image/jpeg",
            fileName: `psychology-text-card-${index + 1}.jpg`,
          }),
        }));
      } else {
        setPublishResult(`正在导入第 ${index + 1} / ${selections.length} 张 Z-Image 图片…`);
        assets.push(await requestJson("/api/official-tiktok/photo-assets/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId: photo.generationId, peerJobId: photo.peerJobId, resultIndex: photo.resultIndex }),
        }));
      }
    }
    setPublishResult("图片已导入，正在创建 TikTok 图文发布任务…");
    const data = await requestJson("/api/official-tiktok/photo-publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: crypto.randomUUID(), module: "psychology", connectionId, assets,
        title: $("#photoTitle").value.trim(), caption: $("#publishCaption").value,
        privacyLevel: $("#privacyLevel").value, disableComment: !$("#allowComments").checked,
        autoAddMusic: !musicSoundId && $("#autoAddMusic").checked, ...(musicSoundId ? { musicSoundId } : {}),
        photoCoverIndex: 0, scheduleAt,
      }),
    });
    setPublishResult(data.message || `图片帖子已提交，批次 ${data.batchId || ""}`);
  } catch (error) {
    setPublishResult(error.message || "图文发布失败，请重试。");
  } finally {
    state.busy = false;
    $("#publishBtn").disabled = false;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.readAsDataURL(blob);
  });
}

function updateGenerationState() {
  if (state.mode === "text" || state.mode === "stock") {
    $("#generationState").textContent = `${publicationPhotos().length} 张可用`;
    return;
  }
  const active = state.tasks.filter((task) => !FINAL_STATES.has(task.status)).length;
  const complete = publicationPhotos().length;
  $("#generationState").textContent = active ? `${active} 个任务生成中 · ${complete} 张可用` : `${complete} 张可用`;
}
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, cache: "no-store" }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`); return data; }
function setGenerateMessage(message, error = false) { $("#generateMessage").textContent = message; $("#generateMessage").classList.toggle("error", error); }
function setPublishResult(message) { $("#publishResult").textContent = message; }
function showStatus(message) { const node = $("#pageStatus"); node.textContent = message; node.classList.add("is-visible"); }
function hideStatus() { $("#pageStatus")?.classList.remove("is-visible"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }
function escapeAttr(value) { return escapeHtml(value); }
