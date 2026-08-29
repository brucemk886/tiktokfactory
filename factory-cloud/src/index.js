import { handleAccounts, handleAuth, getSession, hasUsers } from "./auth.js";
import { handleCompat } from "./compat.js";
import { handleGeeLark } from "./geelark.js";
import { errorJson, json, redirect } from "./http.js";
import { handleJournal } from "./journal.js";
import { handleJobs, pruneFactoryJobs } from "./jobs.js";
import { handleNovels } from "./novels.js";
import { handlePeerHits } from "./peer-hits.js";
import { handleOfficial, loadGroupStore } from "./official.js";
import { collectFactoryStorageSample, handleSignalDeskIntegration } from "./factory-storage.js";
import { persistOpsSnapshots, pruneOfficialOpsReports } from "./ops-report-store.js";
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
        const handlers = [handleJobs, handleAccounts, handleOfficial, handleNovels, handlePeerHits, handleJournal, handleGeeLark, handleCompat];
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

  async scheduled(controller, env) {
    try {
      const store = await loadGroupStore(env.DB);
      const persisted = await persistOpsSnapshots(env, env.DB, store);
      await pruneOfficialOpsReports(env.DB);
      await pruneFactoryJobs(env.DB);
      console.info(JSON.stringify({ event: "ops-report-persist", cron: controller.cron, ...persisted }));
    } catch (error) {
      console.error(JSON.stringify({ event: "ops-report-persist-failed", cron: controller.cron, error: String(error?.message || error) }));
    }
    try {
      await collectFactoryStorageSample(env, env.DB);
    } catch (error) {
      console.error(JSON.stringify({ event: "factory-storage-sample-failed", cron: controller.cron, error: String(error?.message || error) }));
    }
  }
};
