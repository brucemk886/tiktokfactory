import {serveUiAsset,versionPageAssets} from './ui-assets.js';
import {handlePsychologyManagement,MANAGEMENT_API} from './psychology-management-api.js';
import {PSYCHOLOGY_COPY_API} from './psychology-copy-integration.js';
import {handlePhotoFactory} from './photo-factory.js';
import {PHOTO_IMPORT} from './photo-factory-domain.js';
import {handlePsychologyCopyLibrary,dispatchCopyExtractions} from './psychology-copy-library.js';
import { handlePsychologyCreative } from './psychology-creative.js';
import {handlePsychologyAutoReplies,dispatchAutoReplies,consumeAutoReplies} from './psychology-auto-replies.js';
import { handlePsychologyComments, runScheduledComments } from './psychology-comments.js';
import { reconcilePsychologyGroups } from './psychology-publish-groups.js';
import { handlePsychologyTopicBank, PSYCHOLOGY_TOPIC_API } from './psychology-topic-bank.js';
import { handlePsychologyOperations } from "./psychology-operations.js";
import { handlePsychologyAutopilot } from "./psychology-autopilot.js";
import { handlePsychologyOne } from './psychology-tiktok-one.js';
import { handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { handlePsychologyPeerHits, PSYCHOLOGY_PEER_API } from "./psychology-peer-hits.js";
import { handleAi } from "./ai.js";
import { handleGeminiVideoAnalysis } from "./gemini-video-analysis.js";
import { GEMINI_VIDEO_SOURCE_PATH, handleGeminiVideoSource } from "./gemini-video-source.js";
import { KIE_PHOTO_SOURCE_PATH, handleKiePhotoSource } from "./peer-photo-convert.js";
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
import { handleNovelExceptions, reconcileNovelExceptions } from "./novel-exceptions.js";
import { isPublicPath, pageFileFor, rewriteAssetRequest } from "./pages.js";
import { canAccessPath, homePathForUser } from "./sidebar.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "tiktok-factory", time: Date.now() });
      }

      const staticResponse = await serveUiAsset(request, env, url);
      if (staticResponse) return staticResponse;

      const authResponse = await handleAuth(request, env, url);
      if (authResponse) return authResponse;

      if (url.pathname === MANAGEMENT_API || url.pathname.startsWith(MANAGEMENT_API + '/')) return await handlePsychologyManagement(request,env,url,null);
      if (url.pathname === PHOTO_IMPORT) return await handlePhotoFactory(request,env,url,null);
      if (url.pathname === PSYCHOLOGY_PEER_API || url.pathname === PSYCHOLOGY_COPY_API || url.pathname.startsWith(PSYCHOLOGY_COPY_API + '/')) return await handlePsychologyPeerHits(request, env, url, null);
      if (url.pathname === PSYCHOLOGY_TOPIC_API || url.pathname.startsWith(PSYCHOLOGY_TOPIC_API + '/')) return await handlePsychologyTopicBank(request, env, url, null);

      if (url.pathname.startsWith(GEMINI_VIDEO_SOURCE_PATH)) return await handleGeminiVideoSource(request, env, url);
      if (url.pathname.startsWith(KIE_PHOTO_SOURCE_PATH)) return await handleKiePhotoSource(request, env, url);

      if (url.pathname.startsWith("/api/integrations/signal-desk/")) {
        return await handleSignalDeskIntegration(request, env, url);
      }

      if (url.pathname.startsWith("/api/")) {
        const session = await getSession(request, env.DB);
        if (!session && !url.pathname.startsWith("/api/worker/")) {
          return errorJson("请先登录。", 401);
        }
        const handlers = [handlePsychologyManagement,handlePsychologyOne,handlePhotoFactory,handlePsychologyCopyLibrary,handlePsychologyCreative,handlePsychologyAutoReplies,handlePsychologyComments, handlePsychologyTopicBank, handlePsychologyOperations, handlePsychologyAutopilot, handlePsychologyAutoPublish, handlePsychologyPeerHits, handleGeminiVideoAnalysis, handleAi, handleJobs, handleAccounts, handleOfficial, handleNovels, handlePeerHits, handleJournal, handleGeeLark, handleNovelExceptions, handleCompat];
        for (const handler of handlers) {
          const response = await handler(request, env, url, session, ctx);
          if (response) return response;
        }
        return errorJson("此接口尚未迁到工厂云，或需要工人机处理。", 501);
      }

      if (!["GET","HEAD"].includes(request.method)) return errorJson("Method not allowed",405);
      if (!isPublicPath(url.pathname)) {
        const session = await getSession(request, env.DB);
        if (!session) return redirect(await hasUsers(env.DB) ? "/login" : "/setup");
        if (!canAccessPath(session.user, url.pathname)) {
          const home = homePathForUser(session.user);
          if (home && home !== url.pathname) return redirect(home);
          return redirect("/login");
        }
      }

      if (url.pathname === '/psychology-peer-hits' || url.pathname === '/psychology-peer-hits.html') return redirect('/psychology-copy-library'+url.search);
      if (url.pathname === '/psychology-production' || url.pathname === '/psychology-production.html') {
        const params = new URLSearchParams(url.search);
        params.set('view', 'manual');
        return redirect('/psychology-publish-sources?' + params);
      }
      if (url.pathname === "/psychology-topics" || url.pathname === "/psychology-topics.html") return redirect("/psychology");
      if (url.pathname === "/psychology-topics.js" || url.pathname === "/psychology-topics.css") return errorJson("心理学题库已移除。", 410);
      if (url.pathname === "/asset-usage" || url.pathname === "/asset-usage.html") {
        return redirect("/tasks");
      }
      if (!env.ASSETS) return errorJson("静态资源未绑定。", 500);
      const page = pageFileFor(url.pathname);
      const assetRequest = page ? rewriteAssetRequest(request,url,page) : new Request(request);
      assetRequest.headers.delete("If-None-Match");
      assetRequest.headers.delete("If-Modified-Since");
      return versionPageAssets(await env.ASSETS.fetch(assetRequest),request);
    } catch (error) {
      const status = Number(error.statusCode || error.status) || 500;
      return errorJson(error.message || "工厂云处理失败。", status);
    }
  },

  async queue(batch,env) {
    if(batch.queue==='factory-psychology-replies')return consumeAutoReplies(batch,env);
    return (await import('./psychology-cloud-queue.js')).consumeCloudPhotos(batch,env);
  },

  async scheduled(controller, env, ctx) {
    if(controller.cron==='* * * * *'){await runScheduledSteps(controller.cron,[['cloud-photos',async()=> (await import('./psychology-cloud-queue.js')).dispatchCloudPhotos(env)],['psychology-comments',()=>runScheduledComments(env)],['psychology-auto-replies',()=>dispatchAutoReplies(env)],['psychology-copy-library',()=>dispatchCopyExtractions(env)],['ops-report-facts',async()=> (await import('./psychology-report-facts.js')).backfillReportFacts(env)],['photo-factory',async()=> (await import('./photo-factory-execution.js')).tickPhotoFactory(env)]]);return;}
    if(controller.cron==='*/5 * * * *'){await reconcilePsychologyGroups(env);return;}
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
      ["novel-exceptions-reconcile", () => reconcileNovelExceptions(env.DB)],
      ["psychology-copy-performance", async () => (await import("./psychology-copy-evolution.js")).refreshCopyPerformance(env)],
      // After the rollup, so each day's draws use fresh performance data.
      ["psychology-autopilot", async () => (await import("./psychology-autopilot.js")).runAutopilots(env)],
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
