import {
  BATCH_AUDIO_MIN_SOURCE,
  batchOpeningStyleIds,
  openingVariantScriptPayloads,
  remainingAudioVersionCount,
  uniqueNovelIds
} from "./novel-batch-audio.js";

export async function planLocalBatchAudioVersions({
  novelIds,
  count = 3,
  novelContentLibrary
}) {
  const items = [];
  for (const novelId of uniqueNovelIds(novelIds)) {
    let novel;
    try {
      novel = novelContentLibrary.getNovel(novelId);
    } catch {
      items.push({ novelId, skipped: true, reason: "没有找到该小说。" });
      continue;
    }
    if (String(novel.sourceContent || "").trim().length < BATCH_AUDIO_MIN_SOURCE) {
      items.push({ novelId, title: novel.title, skipped: true, reason: "免费章节太短，先补章节再出。" });
      continue;
    }
    const needed = remainingAudioVersionCount(novel.scripts, count);
    if (!needed) {
      items.push({ novelId, title: novel.title, skipped: true, reason: "已经有足够的保存文案。", needed: 0 });
      continue;
    }
    items.push({ novelId: novel.id, title: novel.title, skipped: false, needed, styles: batchOpeningStyleIds(needed) });
  }
  return items;
}

export async function runLocalBatchAudioVersions({
  items,
  model = "gpt-5.6-sol",
  reasoningEffort = "medium",
  voiceId = "",
  speechSpeed,
  speakOpeningTitle = false,
  novelContentLibrary,
  generateOpeningVariants,
  generateAudio = null
}) {
  const results = [];
  for (const item of items.filter((row) => !row.skipped)) {
    try {
      const novel = novelContentLibrary.getNovel(item.novelId);
      const generated = await generateOpeningVariants({
        title: novel.title,
        language: "English",
        sourceText: novel.sourceContent,
        category: novel.category,
        platform: novel.platform,
        promotionCode: novel.promotionCode,
        sellingPoint: novel.sellingPoint,
        baseOpening: "",
        styles: item.styles,
        model,
        reasoningEffort
      });
      const scripts = [];
      const rejected = [];
      for (const payload of openingVariantScriptPayloads(novel, generated.variants, { speakOpeningTitle })) {
        try {
          scripts.push(novelContentLibrary.createScript(novel.id, payload));
        } catch (error) {
          // Near-duplicates of an existing version and CTAs pointing at the
          // wrong code/app are dropped; the remaining variants still ship.
          if (error?.code !== "DUPLICATE_SCRIPT" && error?.code !== "CTA_MISMATCH") throw error;
          rejected.push({ reason: error.code, message: String(error.message || "") });
        }
      }
      if (!scripts.length) {
        throw new Error(rejected.length
          ? `生成的版本全部被拦下（${rejected.map((item) => item.message).join("；")}）。`
          : "生成了开头，但没有可保存的文案。");
      }
      let audioCount = 0;
      if (typeof generateAudio === "function") {
        const audio = await generateAudio({
          novelTitle: novel.title,
          voiceId,
          speechSpeed,
          items: scripts.map((script) => ({
            novelId: novel.id,
            novelTitle: novel.title,
            scriptId: script.id,
            title: script.title,
            script: script.text,
            openingTitle: script.openingTitle,
            speakOpeningTitle: script.speakOpeningTitle === true,
            voiceId,
            speechSpeed,
            sourceType: script.sourceType
          }))
        });
        audioCount = Array.isArray(audio?.items) ? audio.items.length : 0;
      }
      results.push({
        novelId: novel.id,
        title: novel.title,
        scriptCount: scripts.length,
        rejectedCount: rejected.length,
        rejected,
        audioCount
      });
    } catch (error) {
      results.push({
        novelId: item.novelId,
        title: item.title,
        error: error.message || "这本批量写文案失败。"
      });
    }
  }
  return results;
}
