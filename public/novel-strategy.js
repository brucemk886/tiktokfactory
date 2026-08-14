const form = document.querySelector("#strategyForm");
const statusNode = document.querySelector("#saveStatus");
const versionList = document.querySelector("#versionList");
const activeVersion = document.querySelector("#activeVersion");
const dialog = document.querySelector("#activateDialog");
let state = null;

document.querySelector("#saveDraft").addEventListener("click", saveDraft);
document.querySelector("#openActivate").addEventListener("click", () => dialog.showModal());
document.querySelector("#activateForm").addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  await saveDraft(false);
  await request("/api/novel-strategy/activate", {
    method: "POST",
    body: JSON.stringify({ label: document.querySelector("#versionLabel").value, note: document.querySelector("#versionNote").value })
  });
  dialog.close();
  document.querySelector("#activateForm").reset();
  setStatus("新版本已激活。", "success");
  await load();
});
versionList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-rollback]");
  if (!button || !confirm("确认回滚并立即启用这个策略版本？")) return;
  await request("/api/novel-strategy/rollback", { method: "POST", body: JSON.stringify({ versionId: button.dataset.rollback }) });
  setStatus("已回滚到所选版本。", "success");
  await load();
});

async function load() {
  try {
    state = await request("/api/novel-strategy");
    fillForm(state.draft);
    renderVersions();
  } catch (error) { setStatus(error.message, "error"); }
}

async function saveDraft(showMessage = true) {
  try {
    state = await request("/api/novel-strategy/draft", { method: "PUT", body: JSON.stringify({ policy: readForm() }) });
    if (showMessage) setStatus("草稿已保存，当前生效版本未改变。", "success");
  } catch (error) { setStatus(error.message, "error"); throw error; }
}

function fillForm(policy) {
  form.querySelectorAll("[data-path]").forEach((input) => {
    const value = getPath(policy, input.dataset.path);
    if (input.dataset.type === "boolean") input.checked = Boolean(value);
    else if (input.dataset.type === "number-array") input.value = Array.isArray(value) ? value.join(", ") : "";
    else input.value = value ?? "";
  });
}

function readForm() {
  const policy = {};
  form.querySelectorAll("[data-path]").forEach((input) => {
    let value = input.value;
    if (input.dataset.type === "boolean") value = input.checked;
    if (input.dataset.type === "number") value = Number(value);
    if (input.dataset.type === "number-array") value = String(value).split(/[,，\s]+/).map(Number).filter(Number.isFinite);
    setPath(policy, input.dataset.path, value);
  });
  policy.diagnosis.sampleMinViews = 0;
  policy.diagnosis.sampleMinHours = 0;
  return policy;
}

function renderVersions() {
  const versions = Array.isArray(state.versions) ? state.versions : [];
  const active = versions.find((item) => item.id === state.activeVersionId);
  activeVersion.textContent = active?.label || "尚未激活版本";
  versionList.replaceChildren();
  if (!versions.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "还没有已激活版本。保存草稿后点击“激活新版本”。"; versionList.append(empty); return;
  }
  versions.forEach((version) => {
    const row = document.createElement("article"); row.className = `version-row${version.id === state.activeVersionId ? " active" : ""}`;
    const info = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = version.label;
    const meta = document.createElement("p"); meta.textContent = `${formatDate(version.activatedAt)}${version.note ? ` · ${version.note}` : ""}`;
    info.append(title, meta); row.append(info);
    if (version.id === state.activeVersionId) { const badge = document.createElement("span"); badge.className = "current-tag"; badge.textContent = "当前生效"; row.append(badge); }
    else { const button = document.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.dataset.rollback = version.id; button.textContent = "回滚到此版本"; row.append(button); }
    versionList.append(row);
  });
}

function getPath(object, path) { return path.split(".").reduce((value, key) => value?.[key], object); }
function setPath(object, path, value) { const keys = path.split("."); const last = keys.pop(); const target = keys.reduce((node, key) => (node[key] ||= {}), object); target[last] = value; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false }); }
function setStatus(message, type = "") { statusNode.className = type; statusNode.textContent = message || ""; }
async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload;
}

load();
