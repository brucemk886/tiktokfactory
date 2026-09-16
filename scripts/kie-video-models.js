export const KIE_VIDEO_MODELS = {
  grok: "grok-imagine/text-to-video",
  "minimax-h3": "minimax-h3/text-to-video"
};

// MiniMax H3 text-to-video contract: https://docs.kie.ai/market/minimax-h3/text-to-video
export function buildKieVideoTaskInput({ videoModel = "grok", prompt, aspectRatio, duration, resolution } = {}) {
  const id = String(videoModel || "grok").trim();
  if (!Object.hasOwn(KIE_VIDEO_MODELS, id)) fail("不支持这个生视频模型。");
  const model = KIE_VIDEO_MODELS[id];
  if (id === "grok") {
    return { model, input: {
      prompt,
      aspect_ratio: String(aspectRatio || "9:16"),
      mode: "normal",
      duration: String(duration || "6"),
      resolution: String(resolution || "480p")
    } };
  }

  const text = String(prompt || "").trim();
  if (text.length < 2 || text.length > 7000) fail("MiniMax H3 的生成描述需要 2–7000 个字符。");
  const seconds = Number(duration ?? 6);
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 15) fail("MiniMax H3 的时长需要选择 4–15 秒的整数。");
  const ratio = String(aspectRatio || "9:16");
  if (!["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(ratio)) fail("MiniMax H3 不支持这个画幅。");
  const size = String(resolution || "768P").toUpperCase();
  if (!["768P", "2K"].includes(size)) fail("MiniMax H3 的清晰度需要选择 768P 或 2K。");
  return { model, input: { prompt: text, duration: seconds, aspect_ratio: ratio, resolution: size } };
}

function fail(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
