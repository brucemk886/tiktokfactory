import fs from "node:fs";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";

const CONNECTION_REPLY = "CODEX_CONNECTED";
const DEFAULT_TIMEOUT_MS = 120_000;

export function createCodexBrainService({
  root,
  CodexClass = Codex,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const codexPath = resolveCodexExecutable();
  let running = false;
  let connected = false;
  let lastTest = null;

  function getStatus() {
    return {
      sdkReady: true,
      authentication: "local-codex-session",
      executable: codexPath ? "codex-desktop" : "sdk-bundled",
      connected,
      running,
      lastTest
    };
  }

  async function testConnection() {
    if (running) {
      const error = new Error("Codex 连接测试正在执行，请稍后再试。");
      error.statusCode = 409;
      throw error;
    }

    running = true;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const codex = new CodexClass(codexPath ? { codexPathOverride: codexPath } : undefined);
      const thread = codex.startThread({
        workingDirectory: root,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled"
      });
      const result = await thread.run(
        `This is a connection test. Do not inspect files, run commands, or use tools. Reply with exactly ${CONNECTION_REPLY}.`,
        { signal: controller.signal }
      );
      const response = String(result.finalResponse || "").trim();
      if (response !== CONNECTION_REPLY) {
        throw new Error(`Codex 已响应，但连接校验内容不符合预期：${response.slice(0, 120) || "空响应"}`);
      }

      connected = true;
      lastTest = {
        ok: true,
        testedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        usage: result.usage || null
      };
      return { ok: true, ...getStatus(), running: false };
    } catch (error) {
      connected = false;
      const message = error?.name === "AbortError"
        ? `Codex 连接测试超过 ${Math.round(timeoutMs / 1000)} 秒，已停止。`
        : String(error?.message || error);
      lastTest = {
        ok: false,
        testedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: message
      };
      const wrapped = new Error(message);
      wrapped.statusCode = error?.statusCode || 502;
      throw wrapped;
    } finally {
      clearTimeout(timer);
      running = false;
    }
  }

  return { getStatus, testConnection };
}

function resolveCodexExecutable() {
  const explicitPath = String(process.env.CODEX_PATH || "").trim();
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) return "";
  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  if (!fs.existsSync(binRoot)) return "";

  try {
    return fs.readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binRoot, entry.name, "codex.exe"))
      .filter((candidate) => fs.existsSync(candidate))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || "";
  } catch {
    return "";
  }
}
