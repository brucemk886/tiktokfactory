const state = { records: [], query: "", status: "" };

const listNode = document.querySelector("#recordList");
const emptyNode = document.querySelector("#recordEmpty");
const countNode = document.querySelector("#recordCount");
const statusNode = document.querySelector("#recordStatus");
const searchNode = document.querySelector("#recordSearch");
const filterNode = document.querySelector("#statusFilter");

document.querySelector("#refreshRecords")?.addEventListener("click", loadRecords);
searchNode?.addEventListener("input", () => {
  state.query = searchNode.value.trim().toLowerCase();
  render();
});
filterNode?.addEventListener("change", () => {
  state.status = filterNode.value;
  render();
});

await loadRecords();

async function loadRecords() {
  setStatus("正在读取官方 API 文案改写记录……");
  try {
    const response = await fetch("/api/rewrite-records", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `读取失败（${response.status}）`);
    state.records = Array.isArray(payload.records) ? payload.records : [];
    setStatus(`已更新，共读取 ${state.records.length} 条记录。`);
    render();
  } catch (error) {
    state.records = [];
    setStatus(error.message || "读取文案改写记录失败。", true);
    render();
  }
}

function render() {
  const records = state.records.filter((record) => {
    const statusMatches = !state.status || String(record.status || "").toLowerCase().includes(state.status);
    if (!statusMatches) return false;
    if (!state.query) return true;
    return [record.title, record.originalScript, record.rewrittenScript, record.diagnosis,
      record.evidenceSummary, record.sourceVideoId, record.sourceAudioId, record.planId]
      .some((value) => String(value || "").toLowerCase().includes(state.query));
  });

  countNode.textContent = `${records.length} 条记录`;
  listNode.replaceChildren(...records.map(createCard));
  emptyNode.hidden = records.length > 0;
}

function createCard(record) {
  const card = node("article", `rewrite-card${isFailed(record) ? " is-failed" : ""}`);
  const head = node("header", "record-head");
  const heading = node("div");
  const tags = node("div", "tag-row");
  tags.append(tag(statusLabel(record.status), "accent"), tag(record.planDate || "未标日期"), tag(formatTime(record.updatedAt)));
  heading.append(tags, textNode("h2", record.title || "未命名改写"));
  const meta = node("div", "record-meta");
  if (record.sourceVideoId) meta.append(tag(`视频 ${record.sourceVideoId}`));
  if (record.sourceAudioId) meta.append(tag(`音频 ${record.sourceAudioId}`));
  if (record.planId) meta.append(tag(`方案 ${record.planId}`));
  head.append(heading, meta);
  card.append(head);

  const diagnosisGrid = node("section", "diagnosis-grid");
  diagnosisGrid.append(
    infoBox("诊断结论", record.diagnosis || record.error || "暂无诊断说明"),
    infoBox("数据证据", record.evidenceSummary || "暂无证据摘要")
  );
  card.append(diagnosisGrid);

  const scripts = node("section", "script-grid");
  scripts.append(
    scriptPanel("原始文案", record.originalScript || "未保存原始文案"),
    scriptPanel("AI 改写版本", record.rewrittenScript || "尚未生成改写文案", true)
  );
  card.append(scripts);

  const details = node("section", "detail-grid");
  [["问题层级", record.problemLayer], ["改写范围", record.rewriteScope], ["目标秒段", record.targetSecondRange],
    ["对应原句", record.estimatedSourceSentence], ["改写目标", record.rewriteGoal], ["单一变量", record.singleVariable],
    ["保留事实", joinValue(record.preservedFacts)], ["修改记录", joinValue(record.changeLog)]]
    .filter(([, value]) => value)
    .forEach(([label, value]) => details.append(detailItem(label, value)));
  if (details.childElementCount) card.append(details);
  if (record.audio) card.append(audioBox(record.audio));
  return card;
}

function scriptPanel(title, content, rewritten = false) {
  const panel = node("section", `script-panel${rewritten ? " rewritten" : ""}`);
  panel.append(textNode("h3", title), textNode("p", content, "script-content"));
  if (rewritten && content && content !== "尚未生成改写文案") {
    const actions = node("div", "script-actions");
    const button = textNode("button", "复制改写文案", "copy-button");
    button.type = "button";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(content);
        button.textContent = "已复制";
        window.setTimeout(() => { button.textContent = "复制改写文案"; }, 1200);
      } catch {
        button.textContent = "复制失败";
      }
    });
    actions.append(button);
    panel.append(actions);
  }
  return panel;
}

function audioBox(audio) {
  const box = node("section", "audio-box");
  const value = String(audio.url || audio.path || "");
  box.append(textNode("strong", "生成音频"), textNode("div", value || String(audio.id || "已生成")));
  if (/^(https?:\/\/|\/)/i.test(value)) {
    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "none";
    player.src = value;
    box.append(player);
  }
  return box;
}

function infoBox(title, content) {
  const box = node("div", "diagnosis-box");
  box.append(textNode("h3", title), textNode("p", content));
  return box;
}

function detailItem(label, value) {
  const item = node("div", "detail-item");
  item.append(textNode("span", label), textNode("strong", String(value)));
  return item;
}

function tag(value, extra = "") { return textNode("span", value, `tag${extra ? ` ${extra}` : ""}`); }
function textNode(name, value, className = "") { const element = node(name, className); element.textContent = String(value ?? ""); return element; }
function node(name, className = "") { const element = document.createElement(name); if (className) element.className = className; return element; }
function joinValue(value) { return Array.isArray(value) ? value.filter(Boolean).join("；") : String(value || ""); }
function isFailed(record) { return /failed|error|失败/i.test(`${record.status || ""} ${record.error || ""}`); }

function statusLabel(value) {
  const status = String(value || "").toLowerCase();
  if (/fail|error/.test(status)) return "生成失败";
  if (/generated|audio/.test(status)) return "音频已生成";
  return "已改写";
}

function formatTime(value) {
  const time = Number(value || 0);
  return time ? new Date(time).toLocaleString("zh-CN", { hour12: false }) : "时间未记录";
}

function setStatus(message, failed = false) {
  statusNode.textContent = message;
  statusNode.style.color = failed ? "#ff8b91" : "#9ab0bd";
}
