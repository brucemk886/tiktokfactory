import { handleAi } from "./ai.js";
import { handleAccounts, handleAuth, getSession, hasUsers } from "./auth.js";
import { handleCompat } from "./compat.js";
import { handleGeeLark } from "./geelark.js";
import { errorJson, json, redirect } from "./http.js";
import { handleJournal } from "./journal.js";
import { handleJobs, pruneFactoryJobs } from "./jobs.js";
import { pruneAutoTasks } from "./auto-tasks-store.js";
import { backfillMissingAudioDurations, handleNovels } from "./novels.js";
import { handlePeerHits } from "./peer-hits.js";
import { handleOfficial, loadGroupStore } from "./official.js";
import { recomputeArchiveMeta } from "./official-archive-store.js";
import { collectFactoryStorageSample, handleSignalDeskIntegration } from "./factory-storage.js";
import { persistOpsSnapshots, pruneOfficialOpsReports } from "./ops-report-store.js";
import { prunePublishReceipts, prunePublishRecords } from "./publish-records-store.js";
import { ensurePublishWebhook } from "./publish-webhook.js";
import { isPublicPath, pageFileFor, rewriteAssetRequest } from "./pages.js";
import { canAccessPath, homePathForUser } from "./sidebar.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "tiktok-factory", time: Date.now() });
      }

      const authResponse = await handleAuth(request, env, url);
      if (authResponse) return authResponse;

      if (url.pathname.startsWith("/api/integrations/signal-desk/")) {
        return handleSignalDeskIntegration(request, env, url);
      }

      if (url.pathname.startsWith("/api/")) {
        const session = await getSession(request, env.DB);
        if (!session && !url.pathname.startsWith("/api/worker/")) {
          return errorJson("请先登录。", 401);
        }
        const handlers = [handleAi, handleJobs, handleAccounts, handleOfficial, handleNovels, handlePeerHits, handleJournal, handleGeeLark, handleCompat];
        for (const handler of handlers) {
          const response = await handler(request, env, url, session, ctx);
          if (response) return response;
        }
        return errorJson("此接口尚未迁到工厂云，或需要工人机处理。", 501);
      }

      const session = await getSession(request, env.DB);
      if (!isPublicPath(url.pathname) && request.method === "GET") {
        if (!(await hasUsers(env.DB))) return redirect("/setup");
        if (!session) return redirect("/login");
        if (!canAccessPath(session.user, url.pathname)) {
          const home = homePathForUser(session.user);
          if (home && home !== url.pathname) return redirect(home);
          return redirect("/login");
        }
      }

      if (!env.ASSETS) return errorJson("静态资源未绑定。", 500);
      const page = pageFileFor(url.pathname);
      if (page) return env.ASSETS.fetch(rewriteAssetRequest(request, url, page));
      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = Number(error.statusCode || error.status) || 500;
      return errorJson(error.message || "工厂云处理失败。", status);
    }
  },

  async scheduled(controller, env, ctx) {
    const results = await runScheduledSteps(controller.cron, [
      ["ops-report-persist", async () => persistOpsSnapshots(env, env.DB, await loadGroupStore(env.DB))],
      ["prune-ops-reports", () => pruneOfficialOpsReports(env.DB)],
      ["prune-factory-jobs", () => pruneFactoryJobs(env.DB)],
      ["prune-auto-tasks", () => pruneAutoTasks(env.DB)],
      ["prune-publish-receipts", () => prunePublishReceipts(env.DB)],
      ["prune-publish-records", () => prunePublishRecords(env.DB)],
      ["recompute-archive-meta", () => recomputeArchiveMeta(env.DB)],
      // Self-heals the hub webhook registration (first deploy, URL change,
      // endpoint deactivated by the hub after a long outage).
      ["publish-webhook-register", () => ensurePublishWebhook(env, env.DB, { verify: true })],
      ["factory-storage-sample", () => collectFactoryStorageSample(env, env.DB)],
    ]);
    console.info(JSON.stringify({ event: "scheduled-steps-completed", cron: controller.cron, ...results }));
    ctx?.waitUntil?.(backfillMissingAudioDurations(env, env.DB, { limit: 40 }).catch(() => {}));
  }
};

// Each maintenance step gets its own try/catch so one failing step (for
// example a hub outage during snapshot persistence) cannot skip the pruning
// that keeps D1 small.
export async function runScheduledSteps(cron, steps) {
  const results = {};
  for (const [name, run] of steps) {
    try {
      const value = await run();
      results[name] = value && typeof value === "object" ? value : { ok: true };
    } catch (error) {
      results[name] = { ok: false, error: String(error?.message || error) };
      console.error(JSON.stringify({ event: "scheduled-step-failed", cron, step: name, error: String(error?.message || error) }));
    }
  }
  return results;
}
