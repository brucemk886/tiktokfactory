import { matchFactoryNovel } from "./peer-hits.js";

export const HIT_MIN_VIEWS = 200;

export function audioFileKey(value) {
  const text = String(value || "").trim().replace(/\\/g, "/");
  if (!text) return "";
  return (text.split("/").pop() || "").trim().toLowerCase();
}

export function addAudioPlayCount(map, name, playCount) {
  const plays = Math.max(0, Number(playCount) || 0);
  if (!plays) return map;
  const key = audioFileKey(name);
  if (!key) return map;
  const keys = [key];
  if (!/\.[a-z0-9]{2,5}$/i.test(key)) keys.push(`${key}.mp3`);
  for (const item of keys) {
    map[item] = Math.max(map[item] || 0, plays);
  }
  return map;
}

export function peerStatsByNovelId(novels = [], peerHits = []) {
  const byId = new Map();
  for (const hit of Array.isArray(peerHits) ? peerHits : []) {
    const novel = matchFactoryNovel(hit, novels);
    if (!novel?.id) continue;
    const current = byId.get(novel.id) || { playCount: 0, maxViews: 0, videoCount: 0 };
    const plays = Math.max(0, Number(hit.playCount) || 0);
    current.playCount += plays;
    current.maxViews = Math.max(current.maxViews, plays);
    current.videoCount += 1;
    byId.set(novel.id, current);
  }
  return byId;
}

export function attachNovelHitStats(novels = [], { peerHits = [], ownByNovelId = {} } = {}) {
  const peerById = peerStatsByNovelId(novels, peerHits);
  return (Array.isArray(novels) ? novels : []).map((novel) => {
    const own = ownByNovelId?.[novel.id] || {};
    const ownPlayCount = Math.max(0, Number(own.playCount ?? own.totalViews) || 0);
    const ownMaxViews = Math.max(0, Number(own.maxViews) || 0);
    const ownVideoCount = Math.max(0, Number(own.videoCount) || 0);
    const peer = peerById.get(novel.id) || { playCount: 0, maxViews: 0, videoCount: 0 };
    const hit = isHit({
      ownPlayCount,
      ownMaxViews,
      peerPlayCount: peer.playCount,
      peerMaxViews: peer.maxViews
    });
    const maxViews = Math.max(ownMaxViews, peer.maxViews);
    const totalViews = ownPlayCount + peer.playCount;
    const videoCount = ownVideoCount + peer.videoCount;
    return {
      ...novel,
      ownPlayCount,
      ownVideoCount,
      peerPlayCount: peer.playCount,
      peerVideoCount: peer.videoCount,
      hit,
      hitLabel: hitLabel({ ownPlayCount, ownMaxViews, peerPlayCount: peer.playCount, peerMaxViews: peer.maxViews, hit }),
      performance: {
        videoCount,
        totalViews,
        averageViews: videoCount ? Math.round(totalViews / videoCount) : 0,
        maxViews,
        comments: Math.max(0, Number(novel.performance?.comments) || 0)
      }
    };
  });
}

export function buildAudioHitWeights({
  scripts = [],
  peerHits = [],
  ownByAudioName = {}
} = {}) {
  const weights = {};
  for (const [name, playCount] of Object.entries(ownByAudioName || {})) {
    addAudioPlayCount(weights, name, playCount);
  }
  const hits = Array.isArray(peerHits) ? peerHits : [];
  for (const hit of hits) {
    addAudioPlayCount(weights, hit.audioName, hit.playCount);
  }
  const hitById = new Map(hits.map((hit) => [String(hit.id || "").trim(), hit]));
  for (const script of Array.isArray(scripts) ? scripts : []) {
    const hit = hitById.get(String(script.peerHitId || "").trim());
    const plays = Math.max(
      Number(hit?.playCount) || 0,
      Number(ownByAudioName[audioFileKey(script.audio?.fileName)]) || 0,
      Number(ownByAudioName[audioFileKey(script.audio?.targetAudioPath)]) || 0
    );
    if (!plays) continue;
    addAudioPlayCount(weights, script.audio?.fileName, plays);
    addAudioPlayCount(weights, script.audio?.targetAudioPath, plays);
  }
  return weights;
}

export function buildOwnHitSnapshot(overview = {}) {
  const ownByNovelId = {};
  const ownByAudioName = {};
  for (const novel of Array.isArray(overview.novels) ? overview.novels : []) {
    ownByNovelId[novel.id] = {
      playCount: Math.max(0, Number(novel.performance?.totalViews) || 0),
      maxViews: Math.max(0, Number(novel.performance?.maxViews) || 0),
      videoCount: Math.max(0, Number(novel.performance?.videoCount) || 0)
    };
    collectScriptAudioPlays(ownByAudioName, novel.scripts);
  }
  collectScriptAudioPlays(ownByAudioName, overview.unassignedScripts);
  return {
    updatedAt: new Date().toISOString(),
    ownByNovelId,
    ownByAudioName
  };
}

function collectScriptAudioPlays(map, scripts) {
  for (const script of Array.isArray(scripts) ? scripts : []) {
    const views = Math.max(0, Number(script?.performance?.totalViews) || 0);
    if (!views) continue;
    addAudioPlayCount(map, script.audio?.fileName, views);
    addAudioPlayCount(map, script.audio?.targetAudioPath, views);
  }
}

function isHit({ ownPlayCount, ownMaxViews, peerPlayCount, peerMaxViews }) {
  return ownPlayCount >= HIT_MIN_VIEWS
    || ownMaxViews >= HIT_MIN_VIEWS
    || peerPlayCount >= HIT_MIN_VIEWS
    || peerMaxViews >= HIT_MIN_VIEWS;
}

function hitLabel({ ownPlayCount, ownMaxViews, peerPlayCount, peerMaxViews, hit }) {
  if (!hit) return "";
  const own = ownPlayCount >= HIT_MIN_VIEWS || ownMaxViews >= HIT_MIN_VIEWS;
  const peer = peerPlayCount >= HIT_MIN_VIEWS || peerMaxViews >= HIT_MIN_VIEWS;
  if (own && peer) return "自有+同行";
  if (peer) return "同行爆款";
  return "自有爆款";
}
