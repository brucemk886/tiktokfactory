import { renderTextCard, renderOverlayCard } from "./psychology-card-renderer.js?v=20260918-21";
import { buildPerImageCopySlides, buildStockOverlaySlides, buildTextCardSlides, mergeTextCardSets } from "./psychology-text-card.js?v=20260918-21";
const FINAL_STATES = new Set(["success", "fail"]);
const state = { mode: "zimage", textTemplate: "content", accounts: [], groups: [], project: null, tasks: [], currentTaskIds: [], textCards: [], zimageCards: [], recreationCards: [], stockPhotos: [], selectedStock: [], selectedKeys: [], seenKeys: new Set(), overlaySlides: [], overlaying: false, pollTimer: 0, busy: false };
let peerJobPhotos = [];
const $ = (selector) => document.querySelector(selector);

$("#refreshBtn")?.addEventListener("click", loadPage);
$("#generateBtn")?.addEventListener("click", generateImages);
$("#renderCardBtn")?.addEventListener("click", generateTextCards);
$("#renderStockBtn")?.addEventListener("click", generateStockCards);
$("#searchStockBtn")?.addEventListener("click", searchStockPhotos);
$("#clearAlbumBtn")?.addEventListener("click", clearCurrentAlbum);
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
    if (peerJobId && !peerJobPhotos.length && !state.recreationCards.length) {
      const { jobs } = await requestJson("/api/psychology-peer-hits/production?jobId=" + encodeURIComponent(peerJobId));
      const job = jobs.find((item) => item.jobId === peerJobId && item.type === "psychology-photo-story");
      if (!job) throw new Error("未找到这组同行爆款图文。");
      const plan = job.result?.plan || job.plan || {};
      const results = job.result?.results || job.results || [];
      $("#photoTitle").value = plan.title || "";
      $("#publishCaption").value = plan.caption || "";
      resetPhotoSelection();
      const legacy = results.filter((item) => item.imageModel === "z-image" && /^https:\/\//i.test(item.imageUrl || ""));
      if (legacy.length && results.every((item) => item.imageModel === "z-image")) {
        peerJobPhotos = legacy.map((item, index) => ({ key: `${peerJobId}:${index}`, peerJobId, resultIndex: index, url: item.imageUrl, prompt: item.title, createdAt: job.createdAt }));
        setPhotoMode("zimage");
      } else {
        await renderRecreationAlbum(results);
      }
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
      ? (state.textTemplate === "cover" ? "封面统一黑底白字。每次只生成 1 张，改文案后再点一次。" : "每次只生成 1 张内容页，标题和正文都只属于这一张。")
      : isStock
        ? "每次只选 1 张素材、填这一张的文案，生成 1 张。"
        : "每次只生成 1 张。画面和叠字都只属于这一张。";
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
  if ($("#createLead") && state.mode === "text") {
    $("#createLead").textContent = isCover
      ? "封面统一黑底白字。每次只生成 1 张，改文案后再点一次。"
      : "每次只生成 1 张内容页，标题和正文都只属于这一张。";
  }
}

async function generateTextCards() {
  const button = $("#renderCardBtn");
  button.disabled = true;
  button.textContent = "正在出图…";
  try {
    assertAlbumRoom(state.textCards.filter((photo) => photo.template !== "stock" && photo.template !== "zimage"));
    const slides = buildTextCardSlides({
      title: $("#cardTitle").value,
      copies: [$("#cardBody")?.value || ""],
      smash: false,
      template: state.textTemplate,
    });
    const aspectRatio = $("#cardAspect").value;
    const cards = [];
    for (const [index, slide] of slides.entries()) {
      const blob = await canvasToJpeg(renderTextCard(slide, aspectRatio));
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
    clearRecreationCards();
    peerJobPhotos = [];
    state.currentTaskIds = [];
    if (!$("#photoTitle").value.trim() && $("#cardTitle").value.trim()) $("#photoTitle").value = $("#cardTitle").value.trim().slice(0, 90);
    renderGeneratedPhotos();
    const label = state.textTemplate === "cover" ? "封面" : "内容";
    setGenerateMessage(`已生成 1 张${label}图片，图集共 ${state.textCards.filter((photo) => photo.template !== "stock" && photo.template !== "zimage").length} 张。改文案后再点，可继续加下一张。`);
  } catch (error) {
    setGenerateMessage(error.message || "生成文案图片失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "生成这张";
  }
}

async function searchStockPhotos() {
  const query = $("#stockQuery").value.trim() || $("#stockTitle")?.value.trim() || "";
  const button = $("#searchStockBtn");
  button.disabled = true;
  button.textContent = "搜索中…";
  try {
    const data = await requestJson(`/api/official-tiktok/stock-photos?q=${encodeURIComponent(query)}&count=12`);
    state.stockPhotos = data.photos || [];
    state.selectedStock = state.stockPhotos.slice(0, 1).map((photo) => photo.fileUrl);
    renderStockResults(data.configured === false ? (data.error || "还没有配置 Pexels，请改用图片链接。") : (state.stockPhotos.length ? "" : "没有搜到素材。换个词再试。"));
    if (data.configured === false) setGenerateMessage(data.error, true);
    else setGenerateMessage(state.stockPhotos.length ? `找到 ${state.stockPhotos.length} 张素材，已预选 1 张。` : "没有搜到素材。");
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
    if (state.selectedStock.includes(url)) state.selectedStock = [];
    else state.selectedStock = [url];
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
    assertAlbumRoom(state.textCards.filter((photo) => photo.template === "stock"));
    const slides = buildStockOverlaySlides({
      title: $("#stockTitle")?.value || "",
      subtitle: $("#stockSubtitle")?.value || "",
      copies: [$("#stockBody")?.value || ""],
      count: 1,
      smash: false,
    });
    let images = state.selectedStock.length ? state.selectedStock.slice(0, 1) : pastedStockUrls().slice(0, 1);
    if (!images.length) {
      const query = $("#stockQuery").value.trim() || $("#stockTitle")?.value.trim() || "";
      if (query) await searchStockPhotos();
      images = state.selectedStock.length ? state.selectedStock.slice(0, 1) : pastedStockUrls().slice(0, 1);
    }
    if (!images.length) throw new Error("请先选 1 张素材，或粘贴一张图片链接。");
    const aspectRatio = $("#stockAspect").value;
    const grayscale = $("#stockGray").checked;
    const cards = [];
    const slide = slides[0];
    const image = await loadImage(images[0]);
    const blob = await canvasToJpeg(renderOverlayCard(slide, image, aspectRatio, { grayscale }));
    const url = URL.createObjectURL(blob);
    cards.push({
      key: `stock:${Date.now()}:0`,
      kind: "text-card",
      template: "stock",
      resultIndex: 0,
      url,
      blob,
      contentType: "image/jpeg",
      prompt: slide.title || slide.lines[0] || "素材库图片",
      createdAt: Date.now(),
    });
    const merged = mergeTextCardSets(state.textCards, cards, "stock");
    forgetRemovedCards(merged.removed);
    state.textCards = merged.cards;
    clearRecreationCards();
    peerJobPhotos = [];
    state.currentTaskIds = [];
    if (!$("#photoTitle").value.trim() && $("#stockTitle")?.value?.trim()) $("#photoTitle").value = $("#stockTitle").value.trim().slice(0, 90);
    renderGeneratedPhotos();
    setGenerateMessage(`已生成 1 张素材图，图集共 ${state.textCards.filter((photo) => photo.template === "stock").length} 张。改文案后再点，可继续加下一张。`);
  } catch (error) {
    setGenerateMessage(error.message || "生成素材图失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "生成这张";
  }
}

function assertAlbumRoom(photos = []) {
  if ((photos || []).length >= 6) throw new Error("图集最多 6 张。先点清空图集，或去掉已生成的图后再出下一张。");
}

function thisImageCopySlide() {
  const body = $("#imageCopy")?.value || "";
  if (!String(body).trim()) return [];
  return buildPerImageCopySlides({ copies: [body], count: 1, smash: false });
}

async function overlayGeneratedPhotos() {
  if (state.overlaying || !state.overlaySlides.length || !state.currentTaskIds.length) return;
  const photos = currentGeneratedPhotos();
  if (!photos.length) return;
  state.overlaying = true;
  setGenerateMessage("图片已生成，正在叠字…");
  try {
    const aspectRatio = $("#aspectRatio").value;
    const cards = [];
    for (const photo of photos) {
      const slide = state.overlaySlides[0] || { title: "", subtitle: "", lines: [] };
      const src = `/api/official-tiktok/generated-photos/file?generationId=${encodeURIComponent(photo.generationId)}&resultIndex=${encodeURIComponent(photo.resultIndex)}`;
      const image = await loadImage(src);
      const blob = await canvasToJpeg(renderOverlayCard(slide, image, aspectRatio));
      const url = URL.createObjectURL(blob);
      cards.push({
        key: `zimage-copy:${photo.generationId}:${photo.resultIndex}`,
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
    const merged = [...state.zimageCards.filter((card) => !cards.some((item) => item.generationId === card.generationId && item.resultIndex === card.resultIndex)), ...cards].slice(0, 6);
    forgetRemovedCards(state.zimageCards.filter((card) => !merged.some((item) => item.key === card.key)));
    state.zimageCards = merged;
    renderGeneratedPhotos();
    setGenerateMessage("已生成 1 张图并叠上这张文案。改内容后再点，可继续加下一张。");
  } catch (error) {
    const photos = currentGeneratedPhotos();
    const existingKeys = new Set(state.zimageCards.map((card) => card.key));
    state.zimageCards = [...state.zimageCards, ...photos.filter((photo) => !existingKeys.has(photo.key))].slice(0, 6);
    renderGeneratedPhotos();
    setGenerateMessage(error.message || "叠字失败，已加入未叠字的原图。", true);
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

function clearRecreationCards() {
  if (!state.recreationCards.length) return;
  forgetRemovedCards(state.recreationCards);
  state.recreationCards = [];
}

async function renderRecreationAlbum(pages = []) {
  clearRecreationCards();
  peerJobPhotos = [];
  state.currentTaskIds = [];
  const cards = [];
  try {
    for (const [index, page] of (Array.isArray(pages) ? pages : []).slice(0, 6).entries()) {
      cards.push(await renderRecreationPage(page, index));
    }
    if (!cards.length) throw new Error("这组复刻还没有可渲染的页面。");
    state.recreationCards = cards;
    const first = cards[0];
    setPhotoMode(first.template === "stock" ? "stock" : first.template === "zimage" ? "zimage" : "text");
    if (first.template === "cover" || first.template === "content") setTextTemplate(first.template);
    const textCount = cards.filter((card) => card.template === "cover" || card.template === "content").length;
    const stockCount = cards.filter((card) => card.template === "stock").length;
    setGenerateMessage(`已按对标图文复刻 ${cards.length} 张：${textCount ? `${textCount} 张文案图片` : ""}${textCount && stockCount ? "，" : ""}${stockCount ? `${stockCount} 张素材库图片` : ""}。`);
  } catch (error) {
    forgetRemovedCards(cards);
    throw error;
  }
}

async function renderRecreationPage(page, index) {
  if (page.imageModel === "stock" || page.template === "stock") {
    const hasCopy = Boolean(String(page.title || page.subtitle || page.body || "").trim());
    const slides = hasCopy ? buildStockOverlaySlides({
      title: page.title || "",
      subtitle: page.subtitle || "",
      copies: [page.body || ""],
      count: 1,
      smash: true,
      kind: page.textKind === "cover" || index === 0 ? "cover" : "block",
    }) : [{ title: "", subtitle: "", lines: [] }];
    const src = page.fileUrl || `/api/official-tiktok/stock-photos/file?url=${encodeURIComponent(page.imageUrl || "")}`;
    const image = await loadImage(src);
    const blob = await canvasToJpeg(renderOverlayCard(slides[0], image, "9:16"));
    const url = URL.createObjectURL(blob);
    return {
      key: `recreate:stock:${index}`,
      kind: "text-card",
      template: "stock",
      resultIndex: index,
      url,
      blob,
      contentType: "image/jpeg",
      prompt: page.title || page.text || "素材库图片",
      createdAt: Date.now(),
    };
  }
  const kind = page.textKind === "cover" || page.template === "cover" ? "cover" : "content";
  const slides = buildTextCardSlides({
    title: page.title || page.text || "",
    copies: [page.body || ""],
    smash: false,
    template: kind,
  });
  const blob = await canvasToJpeg(renderTextCard(slides[0], "9:16"));
  const url = URL.createObjectURL(blob);
  return {
    key: `recreate:${kind}:${index}`,
    kind: "text-card",
    template: kind,
    resultIndex: index,
    url,
    blob,
    contentType: "image/jpeg",
    prompt: slides[0].title || page.text || "文案图片",
    createdAt: Date.now(),
  };
}

function clearCurrentAlbum() {
  if (state.recreationCards.length) {
    clearRecreationCards();
    resetPhotoSelection();
    renderGeneratedPhotos();
    setGenerateMessage("已清空当前图集。");
    return;
  }
  if (state.mode === "zimage") {
    forgetRemovedCards(state.zimageCards);
    state.zimageCards = [];
    peerJobPhotos = [];
    state.currentTaskIds = [];
  } else if (state.mode === "stock") {
    const removed = state.textCards.filter((card) => card.template === "stock");
    forgetRemovedCards(removed);
    state.textCards = state.textCards.filter((card) => card.template !== "stock");
  } else {
    const removed = state.textCards.filter((card) => card.template !== "stock" && card.template !== "zimage");
    forgetRemovedCards(removed);
    state.textCards = state.textCards.filter((card) => card.template === "stock" || card.template === "zimage");
  }
  resetPhotoSelection();
  renderGeneratedPhotos();
  setGenerateMessage("已清空当前图集。");
}

async function generateImages() {
  const prompt = $("#imagePrompt").value.trim();
  if (prompt.length < 2) return setGenerateMessage("请先填写画面描述。", true);
  const button = $("#generateBtn");
  button.disabled = true;
  button.textContent = "正在提交…";
  setGenerateMessage("正在提交 1 个 Z-Image 任务…");
  try {
    assertAlbumRoom(state.zimageCards);
    const created = await requestJson("/api/kie-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "image", prompt, imageModel: "z-image", aspectRatio: $("#aspectRatio").value, noImageText: $("#noImageText").checked }),
    });
    const task = created.task;
    if (!task?.id) throw new Error("Z-Image 任务提交失败。");
    clearRecreationCards();
    peerJobPhotos = [];
    state.overlaySlides = thisImageCopySlide();
    state.currentTaskIds = [task.id];
    state.tasks = [task, ...state.tasks];
    renderGeneratedPhotos();
    watchPending();
    setGenerateMessage("已提交 1 张，完成后会加入图集。");
  } catch (error) {
    setGenerateMessage(error.message || "生成失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "生成这张";
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
      finishGeneratedPhoto();
    }
  }, 4000);
}

function generatedPhotos() {
  return [...peerJobPhotos, ...state.tasks.flatMap((task) => (task.status === "success" ? (task.resultUrls || []).map((url, index) => ({ key: `${task.id}:${index}`, generationId: task.id, resultIndex: index, url, prompt: task.prompt, createdAt: task.createdAt })) : []))];
}

function finishGeneratedPhoto() {
  if (state.overlaySlides.length) {
    overlayGeneratedPhotos();
    return;
  }
  const photos = currentGeneratedPhotos();
  if (!photos.length) return;
  const existingKeys = new Set(state.zimageCards.map((card) => card.key));
  const incoming = photos.filter((photo) => !existingKeys.has(photo.key));
  state.zimageCards = [...state.zimageCards, ...incoming].slice(0, 6);
  renderGeneratedPhotos();
  setGenerateMessage("已生成 1 张图。改内容后再点，可继续加下一张。");
}

function availablePhotos() {
  if (state.recreationCards.length) return state.recreationCards.slice(0, 6);
  if (state.mode === "text") return state.textCards.filter((photo) => photo.template !== "stock" && photo.template !== "zimage").slice(0, 6);
  if (state.mode === "stock") return state.textCards.filter((photo) => photo.template === "stock").slice(0, 6);
  if (state.zimageCards.length) return state.zimageCards.slice(0, 6);
  if (peerJobPhotos.length) return peerJobPhotos.slice(0, 6);
  return [];
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
  const ratio = state.recreationCards.length || state.mode === "zimage" ? "9 / 16" : ((state.mode === "stock" ? $("#stockAspect")?.value : $("#cardAspect")?.value) || "1:1").replace(":", " / ");
  const empty = state.mode === "text"
    ? "还没有文案图片。每次生成 1 张，改文案后再点可加下一张。"
    : state.mode === "stock"
      ? "还没有素材库图片。选 1 张素材，填这一张的文案，点生成这张。"
      : "还没有可用图片。填这一张的画面和叠字，点生成这张。";
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
  if (state.recreationCards.length || state.mode === "text" || state.mode === "stock") {
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
