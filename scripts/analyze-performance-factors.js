import fs from "node:fs";
import path from "node:path";

const ANALYTICS_URL = "http://localhost:3010/api/tiktok-analytics?period=all";
const STORAGE_ROOT = process.env.LOCAL_FACTORY_WORK || "D:\\localfactory-data\\work";

const normalizeOutputId = (value) => {
  const fileName = path.basename(String(value || ""));
  return path.basename(fileName, path.extname(fileName)).toLowerCase();
};

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

function oneWayR2(rows, key) {
  const grandMean = mean(rows.map((row) => row.y));
  const total = rows.reduce((sum, row) => sum + (row.y - grandMean) ** 2, 0);
  const groups = new Map();
  for (const row of rows) {
    const group = String(row[key] || "unknown");
    const values = groups.get(group) || [];
    values.push(row.y);
    groups.set(group, values);
  }
  const explained = [...groups.values()].reduce((sum, values) => {
    return sum + values.length * (mean(values) - grandMean) ** 2;
  }, 0);
  return { r2: total ? explained / total : 0, groupCount: groups.size };
}

function additiveR2(rows, keys) {
  let intercept = mean(rows.map((row) => row.y));
  const effects = Object.fromEntries(keys.map((key) => [key, new Map()]));

  for (let iteration = 0; iteration < 200; iteration += 1) {
    for (const key of keys) {
      const totals = new Map();
      for (const row of rows) {
        const group = String(row[key] || "unknown");
        let residual = row.y - intercept;
        for (const otherKey of keys) {
          if (otherKey === key) continue;
          residual -= effects[otherKey].get(String(row[otherKey] || "unknown")) || 0;
        }
        const item = totals.get(group) || { sum: 0, count: 0 };
        item.sum += residual;
        item.count += 1;
        totals.set(group, item);
      }
      const next = new Map([...totals].map(([group, item]) => [group, item.sum / item.count]));
      const weightedCenter = rows.reduce((sum, row) => {
        return sum + (next.get(String(row[key] || "unknown")) || 0);
      }, 0) / rows.length;
      for (const [group, value] of next) next.set(group, value - weightedCenter);
      intercept += weightedCenter;
      effects[key] = next;
    }
  }

  const grandMean = mean(rows.map((row) => row.y));
  const total = rows.reduce((sum, row) => sum + (row.y - grandMean) ** 2, 0);
  const residual = rows.reduce((sum, row) => {
    const prediction = intercept + keys.reduce((value, key) => {
      return value + (effects[key].get(String(row[key] || "unknown")) || 0);
    }, 0);
    return sum + (row.y - prediction) ** 2;
  }, 0);
  return { r2: total ? 1 - residual / total : 0, intercept, effects };
}

function predictAdditive(model, row, keys) {
  return model.intercept + keys.reduce((value, key) => {
    return value + (model.effects[key].get(String(row[key] || "unknown")) || 0);
  }, 0);
}

function seededShuffle(values, seed) {
  const output = [...values];
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function crossValidatedR2(rows, keys, repeats = 20, folds = 5) {
  const grandMean = mean(rows.map((row) => row.y));
  let squaredError = 0;
  let baselineError = 0;
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const shuffled = seededShuffle(rows, 20260715 + repeat);
    for (let fold = 0; fold < folds; fold += 1) {
      const train = shuffled.filter((_, index) => index % folds !== fold);
      const test = shuffled.filter((_, index) => index % folds === fold);
      const model = additiveR2(train, keys);
      for (const row of test) {
        squaredError += (row.y - predictAdditive(model, row, keys)) ** 2;
        baselineError += (row.y - grandMean) ** 2;
      }
    }
  }
  return baselineError ? 1 - squaredError / baselineError : 0;
}

function weightedGroupStats(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const name = String(row[key] || "unknown");
    const item = groups.get(name) || { name, count: 0, views: 0, logs: [] };
    item.count += 1;
    item.views += row.views;
    item.logs.push(row.y);
    groups.set(name, item);
  }
  return [...groups.values()].map((item) => ({
    name: item.name,
    count: item.count,
    averageViews: Math.round(item.views / item.count),
    geometricViews: Math.round(Math.expm1(mean(item.logs)))
  }));
}

function firstRelativeFolder(asset, group) {
  if (!asset?.file || !group?.sourceDir) return "unknown";
  const relative = path.relative(group.sourceDir, asset.file);
  const parts = relative.split(path.sep).filter(Boolean);
  return parts.length > 1 ? parts[0] : "(根目录)";
}

const response = await fetch(`${ANALYTICS_URL}&t=${Date.now()}`);
if (!response.ok) throw new Error(`Analytics request failed: ${response.status}`);
const dashboard = await response.json();
const matched = (dashboard.videos || []).filter((video) => video.local?.fileName);

const usage = JSON.parse(fs.readFileSync(path.join(STORAGE_ROOT, "asset-library", "usage.json"), "utf8"));
const groupStore = JSON.parse(fs.readFileSync(path.join(STORAGE_ROOT, "asset-library", "groups.json"), "utf8"));
const groupsById = new Map((groupStore.groups || []).map((group) => [group.id, group]));
const assetsById = new Map();
for (const group of groupStore.groups || []) {
  for (const asset of group.assets || []) assetsById.set(asset.id, { asset, group });
}
const generatedByOutput = new Map((usage.generated || []).map((item) => [normalizeOutputId(item.outputId), item]));

const rows = matched.map((video) => {
  const generated = generatedByOutput.get(normalizeOutputId(video.local.fileName));
  const folderSeconds = new Map();
  for (const clip of generated?.clips || []) {
    const linked = assetsById.get(clip.assetId);
    const folder = firstRelativeFolder(linked?.asset, linked?.group);
    folderSeconds.set(folder, (folderSeconds.get(folder) || 0) + (Number(clip.duration) || 0));
  }
  const dominantFolder = [...folderSeconds].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
  const views = Math.max(0, Number(video.views) || 0);
  return {
    account: video.username || video.account?.username || video.accountUsername || video.local.accountName || "unknown",
    audio: video.local.audioName || "unknown",
    materialGroup: generated?.groupId || "unknown",
    materialFolder: generated ? `${generated.groupId}/${dominantFolder}` : "unknown",
    clipCount: (generated?.clips || []).length,
    views,
    y: Math.log1p(views),
    hasMaterial: Boolean(generated)
  };
});

const materialRows = rows.filter((row) => row.hasMaterial);
const account = oneWayR2(rows, "account");
const audio = oneWayR2(rows, "audio");
const accountAudio = additiveR2(rows, ["account", "audio"]);
const materialFolder = oneWayR2(materialRows, "materialFolder");
const accountAudioMaterial = additiveR2(materialRows, ["account", "audio", "materialFolder"]);
const accountAudioMaterialBase = additiveR2(materialRows, ["account", "audio"]);
const accountCv = crossValidatedR2(rows, ["account"]);
const audioCv = crossValidatedR2(rows, ["audio"]);
const accountAudioCv = crossValidatedR2(rows, ["account", "audio"]);
const accountAudioMaterialBaseCv = crossValidatedR2(materialRows, ["account", "audio"]);
const accountAudioMaterialCv = crossValidatedR2(materialRows, ["account", "audio", "materialFolder"]);

const accountUnique = accountAudio.r2 - audio.r2;
const audioUnique = accountAudio.r2 - account.r2;
const shared = account.r2 + audio.r2 - accountAudio.r2;
const materialIncremental = accountAudioMaterial.r2 - accountAudioMaterialBase.r2;

const accounts = weightedGroupStats(rows, "account").filter((item) => item.count >= 3);
const audios = weightedGroupStats(rows, "audio").filter((item) => item.count >= 3);

const output = {
  generatedAt: new Date().toISOString(),
  sample: {
    matchedVideos: rows.length,
    totalViews: rows.reduce((sum, row) => sum + row.views, 0),
    accounts: new Set(rows.map((row) => row.account)).size,
    audios: new Set(rows.map((row) => row.audio)).size,
    materialLinked: materialRows.length,
    materialCoverage: materialRows.length / Math.max(1, rows.length),
    materialGroups: new Set(materialRows.map((row) => row.materialGroup)).size,
    materialFolders: new Set(materialRows.map((row) => row.materialFolder)).size
  },
  explainedVarianceLogViews: {
    accountOnly: account.r2,
    audioOnly: audio.r2,
    accountAndAudio: accountAudio.r2,
    accountUniqueBeyondAudio: accountUnique,
    audioUniqueBeyondAccount: audioUnique,
    accountAudioShared: shared,
    unexplainedAfterAccountAudio: 1 - accountAudio.r2,
    materialFolderOnlyOnLinkedSample: materialFolder.r2,
    materialFolderIncrementBeyondAccountAudio: materialIncremental,
    allThreeOnLinkedSample: accountAudioMaterial.r2
  },
  crossValidatedLogViews: {
    account: accountCv,
    audio: audioCv,
    accountAndAudio: accountAudioCv,
    audioIncrementBeyondAccount: accountAudioCv - accountCv,
    materialIncrementBeyondAccountAudio: accountAudioMaterialCv - accountAudioMaterialBaseCv,
    allThreeOnLinkedSample: accountAudioMaterialCv
  },
  topAccounts: [...accounts].sort((a, b) => b.geometricViews - a.geometricViews).slice(0, 8),
  bottomAccounts: [...accounts].sort((a, b) => a.geometricViews - b.geometricViews).slice(0, 8),
  topAudios: [...audios].sort((a, b) => b.geometricViews - a.geometricViews).slice(0, 8),
  bottomAudios: [...audios].sort((a, b) => a.geometricViews - b.geometricViews).slice(0, 8)
};

console.log(JSON.stringify(output, null, 2));
