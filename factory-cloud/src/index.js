import { handleAccounts, handleAuth, getSession, hasUsers } from "./auth.js";
import { handleCompat } from "./compat.js";
import { handleGeeLark } from "./geelark.js";
import { errorJson, json, redirect } from "./http.js";
import { handleJournal } from "./journal.js";
import { handleJobs } from "./jobs.js";
import { handleNovels } from "./novels.js";
import { handleOfficial } from "./official.js";
import { refreshOfficialArchive } from "./official-archive-store.js";
import { isPublicPath, pageFileFor, rewriteAssetRequest } from "./pages.js";
import { canAccessPath, homePathForUser } from "./sidebar.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "tiktok-factory", time: Date.now() });
      }

      const authResponse = await handleAuth(request, env, url);
      if (authResponse) return authResponse;

      if (url.pathname.startsWith("/api/")) {
        const session = await getSession(request, env.DB);
        if (!session && !url.pathname.startsWith("/api/worker/")) {
          return errorJson("请先登录。", 401);
        }
        const handlers = [handleJobs, handleAccounts, handleOfficial, handleNovels, handleJournal, handleGeeLark, handleCompat];
        for (const handler of handlers) {
          const response = await handler(request, env, url, session);
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
      const meta = await refreshOfficialArchive(env, env.DB);
      console.info(JSON.stringify({ event: "official-archive-prefetch", cron: controller.cron, ...meta }));
    } catch (error) {
      console.error(JSON.stringify({ event: "official-archive-prefetch-failed", cron: controller.cron, error: String(error?.message || error) }));
    }
  }
};
