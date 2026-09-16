import { createGeminiVideoClient, extractGeminiText, usageFromGemini } from "./gemini-video-client.js";
import { createGeminiVideoSourceUrl } from "./gemini-video-source.js";
import { createKieGeminiVideoClient } from "./kie-gemini-video-client.js";

const READ = { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" };
const WRITE = { retries: { limit: 0, delay: "1 second" }, timeout: "15 minutes" };

export async function runGeminiVideoWorkflow(env, event, step) {
  const id = event.payload.analysisId;
  const client = createGeminiVideoClient({ apiKey: env.GEMINI_API_KEY, fetchImpl: env.fetch || fetch });
  const kieClient = String(env.KIE_API_KEY || "").trim()
    ? createKieGeminiVideoClient({ apiKey: env.KIE_API_KEY, fetchImpl: env.fetch || fetch })
    : null;
  let row = await step.do("load-analysis", READ, () => env.DB.prepare("SELECT * FROM factory_video_analyses WHERE id=?").bind(id).first());
  if (!row || ["success", "fail"].includes(row.status)) return { skipped: true };
  let googleFile = null;
  const update = async (name, status, progress, patch = {}) => {
    const stamp = await step.do(`${name}-time`, () => Date.now());
    const provider = patch.provider ?? row.provider ?? "google";
    const providerCredits = Number(patch.creditsConsumed ?? row.provider_credits ?? 0);
    await step.do(name, READ, () => env.DB.prepare(`UPDATE factory_video_analyses SET status=?,progress=?,result_text=?,error=?,google_file_name=?,input_tokens=?,output_tokens=?,provider=?,provider_credits=?,updated_at=?,completed_at=? WHERE id=?`).bind(
      status, progress, patch.resultText || "", patch.error || "", patch.googleFileName || row.google_file_name || "",
      Number(patch.inputTokens || 0), Number(patch.outputTokens || 0), provider, providerCredits,
      stamp, ["success", "fail"].includes(status) ? stamp : 0, id
    ).run());
    row = { ...row, status, progress, provider, provider_credits: providerCredits, ...patch, updated_at: stamp };
  };
  try {
    let resultText = "";
    let usage = { inputTokens: 0, outputTokens: 0 };
    let provider = "google";
    let creditsConsumed = 0;
    try {
      await update("mark-uploading-to-google", "processing", 12);
      googleFile = await step.do("upload-video-to-google", WRITE, async () => {
        const object = await env.ARCHIVE.get(row.r2_key);
        if (!object?.body) throw new Error("临时视频已丢失，请重新上传。");
        return client.upload({ body: object.body, size: row.file_size, mimeType: row.mime_type, displayName: row.file_name });
      });
      await update("save-google-file", "processing", 35, { googleFileName: googleFile.name });
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const file = await step.do(`poll-google-file-${attempt}`, READ, () => client.getFile(googleFile.name));
        googleFile = file;
        if (file.state === "ACTIVE") break;
        if (file.state === "FAILED") throw new Error("Google 无法处理该视频，请检查文件编码后重试。");
        await step.sleep(`wait-google-file-${attempt}`, "10 seconds");
      }
      if (googleFile?.state !== "ACTIVE") throw new Error("Google 视频处理超时，请稍后重新上传。");
      await update("mark-analyzing", "processing", 58, { googleFileName: googleFile.name });
      const payload = await analyzeVideoWithRetry(client, {
        fileUri: googleFile.uri,
        mimeType: googleFile.mimeType || row.mime_type,
        prompt: row.prompt
      }, step);
      resultText = extractGeminiText(payload);
      usage = usageFromGemini(payload);
    } catch (googleError) {
      if (!isTransientGeminiError(googleError) || !kieClient) throw googleError;
      provider = "kie";
      await update("mark-kie-fallback", "processing", 72, { provider });
      const sourceUrl = await step.do("create-kie-source-url", () => createGeminiVideoSourceUrl({
        baseUrl: env.FACTORY_PUBLIC_BASE_URL || "https://factory.tiktokaitool.com",
        analysisId: id,
        secret: env.KIE_API_KEY,
        expiresAt: Date.now() + 60 * 60 * 1000
      }));
      try {
        const result = await step.do("analyze-video-with-kie", WRITE, () => kieClient.analyze({ videoUrl: sourceUrl, prompt: row.prompt }));
        resultText = result.text;
        usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
        creditsConsumed = result.creditsConsumed;
      } catch (kieError) {
        const error = new Error(`Google 官方服务暂时不可用，Kie 兜底也失败：${kieError?.message || kieError}`);
        error.statusCode = Number(kieError?.statusCode || 502);
        throw error;
      }
    }
    await update("save-analysis", "success", 100, { resultText, ...usage, provider, creditsConsumed, googleFileName: googleFile?.name || "" });
    return { analysisId: id, provider, creditsConsumed, ...usage };
  } catch (error) {
    await update("save-failure", "fail", Math.max(12, Number(row.progress || 0)), {
      error: String(error?.message || error).slice(0, 1500),
      googleFileName: googleFile?.name || row.google_file_name || ""
    });
    throw error;
  } finally {
    if (googleFile?.name) {
      await step.do("delete-google-file", READ, () => client.removeFile(googleFile.name).catch(() => null));
    }
    await step.do("delete-r2-video", READ, () => env.ARCHIVE.delete(row.r2_key));
  }
}

const RETRY_DELAYS = ["10 seconds", "20 seconds"];

export function isTransientGeminiError(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  const message = String(error?.message || error || "");
  return status === 429 || status >= 500 || /high demand|temporar(?:y|ily)|try again later|rate limit|overloaded|unavailable/i.test(message);
}

export async function analyzeVideoWithRetry(client, input, step) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
    try {
      return await step.do(`analyze-video-${attempt + 1}`, WRITE, () => client.analyze(input));
    } catch (error) {
      lastError = error;
      if (!isTransientGeminiError(error) || attempt === RETRY_DELAYS.length) throw error;
      await step.sleep(`wait-analysis-retry-${attempt + 1}`, RETRY_DELAYS[attempt]);
    }
  }
  throw lastError;
}
