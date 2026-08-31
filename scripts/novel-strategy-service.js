import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_NOVEL_STRATEGY = Object.freeze({
  diagnosis: {
    sampleMinViews: 0,
    sampleMinHours: 0,
    earlyWindowSeconds: 3,
    earlyDropPoints: 30,
    comparisonDeltaPoints: 15,
    setupDropPoints: 20,
    middleWatchRatioThreshold: 35,
    compressMinPercent: 20,
    compressMaxPercent: 30
  },
  rewrite: {
    enabled: true,
    maxVariants: 2,
    preserveCharacters: true,
    preserveFacts: true,
    preserveEnding: true,
    localRewriteFirst: true,
    openingConflictWithinSeconds: 3,
    allowInventedPlot: false,
    evidenceRequired: true
  },
  audio: {
    enabled: true,
    provider: "kokoro",
    generateAfterRewrite: true,
    outputDirectory: "",
    keepOriginal: true
  },
  evaluation: {
    checkpointsHours: [24, 72, 168],
    baselineDays: 30,
    confidenceMinTests: 3,
    autoPromoteEnabled: true,
    autoDemoteEnabled: true
  },
  model: {
    primary: "sol",
    fallback: "deepseek-v4-flash",
    externalProviderEnabled: false,
    externalProviderBaseUrl: "",
    externalProviderModel: ""
  }
});

export function createNovelStrategyService({ statePath, now = () => new Date() } = {}) {
  if (!statePath) throw new Error("statePath is required");
  const read = () => normalizeState(readJson(statePath), now);
  const write = (state) => {
    const normalized = normalizeState(state, now);
    atomicWriteJson(statePath, normalized);
    return normalized;
  };

  return {
    getState: read,
    getActivePolicy() {
      const state = read();
      const active = state.versions.find((entry) => entry.id === state.activeVersionId);
      return clone(active?.policy || state.draft || DEFAULT_NOVEL_STRATEGY);
    },
    updateDraft(patch = {}) {
      const state = read();
      state.draft = sanitizePolicy(deepMerge(state.draft, patch));
      state.draftUpdatedAt = now().toISOString();
      return write(state);
    },
    activate({ label = "", note = "" } = {}) {
      const state = read();
      const activatedAt = now().toISOString();
      const version = {
        id: `strategy_${activatedAt.replace(/\D/g, "")}_${crypto.randomUUID().slice(0, 8)}`,
        label: String(label || `策略 ${state.versions.length + 1}`).slice(0, 80),
        note: String(note || "").slice(0, 500),
        activatedAt,
        policy: sanitizePolicy(state.draft)
      };
      state.versions.unshift(version);
      state.activeVersionId = version.id;
      return write(state);
    },
    rollback(versionId) {
      const state = read();
      const version = state.versions.find((entry) => entry.id === String(versionId || ""));
      if (!version) throw new Error("strategy version not found");
      state.activeVersionId = version.id;
      state.draft = clone(version.policy);
      state.draftUpdatedAt = now().toISOString();
      return write(state);
    }
  };
}

function normalizeState(raw, now) {
  const state = raw && typeof raw === "object" ? raw : {};
  const versions = Array.isArray(state.versions)
    ? state.versions.filter(Boolean).map((entry) => ({
        id: String(entry.id || ""),
        label: String(entry.label || ""),
        note: String(entry.note || ""),
        activatedAt: String(entry.activatedAt || ""),
        policy: sanitizePolicy(entry.policy)
      })).filter((entry) => entry.id)
    : [];
  return {
    schemaVersion: 1,
    activeVersionId: versions.some((entry) => entry.id === state.activeVersionId) ? state.activeVersionId : null,
    draft: sanitizePolicy(state.draft),
    draftUpdatedAt: String(state.draftUpdatedAt || now().toISOString()),
    versions
  };
}

function sanitizePolicy(policy) {
  const merged = deepMerge(DEFAULT_NOVEL_STRATEGY, policy && typeof policy === "object" ? policy : {});
  const number = (value, fallback, min = 0, max = 100000) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
  const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
  const text = (value, fallback = "") => String(value ?? fallback).slice(0, 500);
  return {
    diagnosis: {
      sampleMinViews: number(merged.diagnosis.sampleMinViews, 0),
      sampleMinHours: number(merged.diagnosis.sampleMinHours, 0),
      earlyWindowSeconds: number(merged.diagnosis.earlyWindowSeconds, 3, 1, 30),
      earlyDropPoints: number(merged.diagnosis.earlyDropPoints, 30, 0, 100),
      comparisonDeltaPoints: number(merged.diagnosis.comparisonDeltaPoints, 15, 0, 100),
      setupDropPoints: number(merged.diagnosis.setupDropPoints, 20, 0, 100),
      middleWatchRatioThreshold: number(merged.diagnosis.middleWatchRatioThreshold, 35, 0, 100),
      compressMinPercent: number(merged.diagnosis.compressMinPercent, 20, 0, 100),
      compressMaxPercent: number(merged.diagnosis.compressMaxPercent, 30, 0, 100)
    },
    rewrite: {
      enabled: bool(merged.rewrite.enabled, true),
      maxVariants: number(merged.rewrite.maxVariants, 2, 1, 10),
      preserveCharacters: bool(merged.rewrite.preserveCharacters, true),
      preserveFacts: bool(merged.rewrite.preserveFacts, true),
      preserveEnding: bool(merged.rewrite.preserveEnding, true),
      localRewriteFirst: bool(merged.rewrite.localRewriteFirst, true),
      openingConflictWithinSeconds: number(merged.rewrite.openingConflictWithinSeconds, 3, 1, 30),
      allowInventedPlot: bool(merged.rewrite.allowInventedPlot, false),
      evidenceRequired: bool(merged.rewrite.evidenceRequired, true)
    },
    audio: {
      enabled: bool(merged.audio.enabled, true),
      provider: text(merged.audio.provider, "kokoro"),
      generateAfterRewrite: bool(merged.audio.generateAfterRewrite, true),
      voiceId: text(merged.audio.voiceId),
      outputDirectory: text(merged.audio.outputDirectory),
      keepOriginal: bool(merged.audio.keepOriginal, true)
    },
    evaluation: {
      checkpointsHours: [...new Set((Array.isArray(merged.evaluation.checkpointsHours) ? merged.evaluation.checkpointsHours : [24, 72, 168]).map((value) => number(value, 24, 1, 8760)))].sort((a, b) => a - b),
      baselineDays: number(merged.evaluation.baselineDays, 30, 1, 365),
      confidenceMinTests: number(merged.evaluation.confidenceMinTests, 3, 1, 100),
      autoPromoteEnabled: bool(merged.evaluation.autoPromoteEnabled, true),
      autoDemoteEnabled: bool(merged.evaluation.autoDemoteEnabled, true)
    },
    model: {
      primary: text(merged.model.primary, "sol"),
      fallback: text(merged.model.fallback, "deepseek-v4-flash"),
      externalProviderEnabled: bool(merged.model.externalProviderEnabled, false),
      externalProviderBaseUrl: text(merged.model.externalProviderBaseUrl),
      externalProviderModel: text(merged.model.externalProviderModel)
    }
  };
}

function deepMerge(base, patch) {
  const output = clone(base);
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = clone(value);
    }
  }
  return output;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}
