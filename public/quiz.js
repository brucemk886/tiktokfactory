const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "local-factory-quiz-settings-v1";
const ILLUSTRATIONS = [
  ["mountain", "山峰"], ["ocean", "海洋"], ["desert", "沙漠"], ["landmark", "建筑"],
  ["river", "河流"], ["globe", "地球"], ["boot", "版图"], ["planet", "星球"], ["leaf", "植物"]
];
const BANKS = {
  en: {
    title: "Geography Quiz",
    hook: "Which questions can you solve before the red marker reveals every answer?",
    cta: "What was your score? Comment below",
    questions: [
      q("Which mountain is the highest above sea level?", ["K2", "Mount Everest", "Kangchenjunga"], 1, "mountain"),
      q("Which is the largest ocean on Earth?", ["Atlantic Ocean", "Indian Ocean", "Pacific Ocean"], 2, "ocean"),
      q("Which is the largest hot desert?", ["Sahara Desert", "Gobi Desert", "Arabian Desert"], 0, "desert"),
      q("Which is the smallest country by area?", ["Monaco", "Vatican City", "San Marino"], 1, "landmark"),
      q("Which is the longest river in South America?", ["Amazon River", "Paraná River", "Orinoco River"], 0, "river"),
      q("Which is the largest continent by area?", ["Africa", "North America", "Asia"], 2, "globe"),
      q("Which country is famously shaped like a boot?", ["Greece", "Italy", "Portugal"], 1, "boot")
    ]
  },
  zh: {
    title: "地理知识测试",
    hook: "红笔揭晓答案前，你能答对几道？",
    cta: "你答对了几道？评论区留下分数",
    questions: [
      q("世界上海拔最高的山峰是哪一座？", ["乔戈里峰", "珠穆朗玛峰", "干城章嘉峰"], 1, "mountain"),
      q("地球上面积最大的海洋是哪一个？", ["大西洋", "印度洋", "太平洋"], 2, "ocean"),
      q("世界上面积最大的热带沙漠是哪一个？", ["撒哈拉沙漠", "戈壁沙漠", "阿拉伯沙漠"], 0, "desert"),
      q("世界上国土面积最小的国家是哪一个？", ["摩纳哥", "梵蒂冈", "圣马力诺"], 1, "landmark"),
      q("南美洲最长的河流是哪一条？", ["亚马孙河", "巴拉那河", "奥里诺科河"], 0, "river"),
      q("世界上面积最大的大洲是哪一个？", ["非洲", "北美洲", "亚洲"], 2, "globe"),
      q("哪个国家的版图常被形容为靴子？", ["希腊", "意大利", "葡萄牙"], 1, "boot")
    ]
  }
};
let questions = clone(BANKS.en.questions);
let currentJobId = "";
let pollTimer = null;

restore();
renderQuestions();
updateSummary();

$("#language").addEventListener("change", updateLoadLabel);
$("#loadDefaultsBtn").addEventListener("click", () => loadBank($("#language").value));
$("#randomSeedBtn").addEventListener("click", () => { $("#seed").value = String(Math.floor(Math.random() * 999999) + 1); save(); });
$("#addQuestionBtn").addEventListener("click", addQuestion);
$("#questionList").addEventListener("input", handleQuestionInput);
$("#questionList").addEventListener("change", handleQuestionInput);
$("#questionList").addEventListener("click", handleQuestionClick);
$("#generateBtn").addEventListener("click", generate);
["language", "secondsPerQuestion", "seed", "title", "hook", "cta"].forEach((id) => {
  $(`#${id}`).addEventListener("input", () => { save(); updateSummary(); });
  $(`#${id}`).addEventListener("change", () => { save(); updateSummary(); });
});

function q(prompt, options, answerIndex, illustration) { return { prompt, options, answerIndex, illustration }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function loadBank(language) {
  const bank = BANKS[language] || BANKS.en;
  $("#title").value = bank.title;
  $("#hook").value = bank.hook;
  $("#cta").value = bank.cta;
  questions = clone(bank.questions);
  renderQuestions();
  updateSummary();
  save();
  setStatus(language === "zh" ? "已载入中文示例题库。" : "已载入英文示例题库。");
}

function addQuestion() {
  if (questions.length >= 9) return setStatus("最多支持 9 道题。", true);
  const zh = $("#language").value === "zh";
  questions.push(q(zh ? "请输入新题目" : "Enter a new question", [zh ? "选项一" : "Option one", zh ? "选项二" : "Option two", zh ? "选项三" : "Option three"], 0, "globe"));
  renderQuestions(); updateSummary(); save();
}

function handleQuestionClick(event) {
  const button = event.target.closest("[data-remove-question]");
  if (!button) return;
  if (questions.length <= 6) return setStatus("至少保留 6 道题。", true);
  questions.splice(Number(button.dataset.removeQuestion), 1);
  renderQuestions(); updateSummary(); save();
}

function handleQuestionInput(event) {
  const field = event.target.dataset.field;
  const index = Number(event.target.dataset.index);
  if (!field || !questions[index]) return;
  if (field.startsWith("option-")) questions[index].options[Number(field.split("-")[1])] = event.target.value;
  else if (field === "answerIndex") questions[index].answerIndex = Number(event.target.value);
  else questions[index][field] = event.target.value;
  save();
}

function renderQuestions() {
  $("#questionList").innerHTML = questions.map((item, index) => `
    <article class="quiz-question-card">
      <div class="quiz-question-top">
        <span class="quiz-question-number">${index + 1}</span>
        <input data-index="${index}" data-field="prompt" maxlength="120" value="${escapeHtml(item.prompt)}" aria-label="第 ${index + 1} 题" />
        <select data-index="${index}" data-field="illustration" aria-label="第 ${index + 1} 题插图">
          ${ILLUSTRATIONS.map(([value,label]) => `<option value="${value}"${item.illustration === value ? " selected" : ""}>${label}插图</option>`).join("")}
        </select>
        <button class="module-button quiz-remove" type="button" data-remove-question="${index}" aria-label="删除第 ${index + 1} 题">×</button>
      </div>
      <div class="quiz-options">
        ${item.options.map((option, optionIndex) => `<label class="quiz-option"><span>${["A","B","C"][optionIndex]}</span><input data-index="${index}" data-field="option-${optionIndex}" maxlength="54" value="${escapeHtml(option)}" aria-label="第 ${index + 1} 题选项 ${optionIndex + 1}" /></label>`).join("")}
      </div>
      <label class="quiz-answer">正确答案
        <select data-index="${index}" data-field="answerIndex">
          ${[0,1,2].map((value) => `<option value="${value}"${item.answerIndex === value ? " selected" : ""}>${["A","B","C"][value]}</option>`).join("")}
        </select>
      </label>
    </article>
  `).join("");
}

async function generate() {
  if (questions.length < 6 || questions.length > 9) return setStatus("测试题需要 6–9 道题。", true);
  const payload = collectPayload();
  setBusy(true); setProgress(2); setStatus("正在创建测试题任务...");
  try {
    const response = await fetchWithTimeout("/api/quiz/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    }, 15000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建任务失败。");
    currentJobId = data.jobId;
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, 1200);
    await poll();
  } catch (error) {
    setBusy(false); setStatus(error.message || "创建任务失败。", true);
  }
}

async function poll() {
  if (!currentJobId) return;
  try {
    const response = await fetch(`/api/quiz/progress/${encodeURIComponent(currentJobId)}`, { cache: "no-store" });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "读取进度失败。");
    setProgress(Number(job.percent) || 0);
    setStatus(job.message || "正在渲染...");
    if (job.status === "done") {
      clearInterval(pollTimer); pollTimer = null; setBusy(false); setProgress(100);
      showResult(job.result || {}); return;
    }
    if (["failed", "error", "cancelled"].includes(job.status)) {
      clearInterval(pollTimer); pollTimer = null; setBusy(false);
      setStatus(job.error || job.message || "渲染失败。", true);
    }
  } catch (error) {
    clearInterval(pollTimer); pollTimer = null; setBusy(false); setStatus(error.message || "读取进度失败。", true);
  }
}

function showResult(result) {
  result = result.renderedArtifact || result.result || result;
  const localHost = ["localhost", "127.0.0.1"].includes(location.hostname);
  const playable = /^https?:\/\//.test(result.videoUrl || "") || (localHost && String(result.videoUrl || "").startsWith("/outputs/"));
  $("#previewMeta").textContent = `${result.language === "zh" ? "中文" : "English"} · ${result.questionCount || questions.length} 题 · ${Math.round(result.durationSeconds || 0)} 秒 · 种子 ${result.seed || $("#seed").value}`;
  if (playable) {
    $("#previewVideo").src = `${result.videoUrl}?t=${Date.now()}`;
    $("#previewVideo").load();
    $("#previewVideo").closest(".quiz-player-frame").classList.add("has-video");
    $("#downloadLink").href = result.videoUrl;
    $("#downloadLink").classList.remove("is-hidden");
    $("#cloudHint").classList.add("is-hidden");
    setStatus("测试题视频生成完成，可以播放或下载。");
  } else {
    $("#cloudHint").classList.remove("is-hidden");
    setStatus(`测试题视频生成完成：${result.fileName || "已保存到本地输出目录"}`);
  }
}

function collectPayload() {
  return {
    language: $("#language").value,
    title: $("#title").value.trim(), hook: $("#hook").value.trim(), cta: $("#cta").value.trim(),
    secondsPerQuestion: Number($("#secondsPerQuestion").value), seed: Number($("#seed").value),
    backgroundMusicEnabled: true, backgroundMusicVolume: 0.18, questions: clone(questions)
  };
}

function updateSummary() {
  const duration = 3.5 + questions.length * Math.max(6, Math.min(12, Number($("#secondsPerQuestion").value) || 7.5)) + 4.5;
  $("#questionCount").textContent = String(questions.length);
  $("#durationText").textContent = `约 ${Math.round(duration)} 秒`;
  $("#addQuestionBtn").disabled = questions.length >= 9;
  updateLoadLabel();
}
function updateLoadLabel() { $("#loadDefaultsBtn").textContent = $("#language").value === "zh" ? "载入中文示例题库" : "载入英文示例题库"; }
function setBusy(busy) { $("#generateBtn").disabled = busy; $("#generateBtn").textContent = busy ? "正在生成..." : "生成测试题视频"; }
function setProgress(value) { $("#progressBar").style.width = `${Math.max(0, Math.min(100, value))}%`; }
function setStatus(message, error = false) { $("#statusText").textContent = message; $("#statusText").classList.toggle("error", error); }
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectPayload())); } catch { /* optional */ } }
function restore() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored || !Array.isArray(stored.questions) || stored.questions.length < 6 || stored.questions.length > 9) return;
    questions = stored.questions;
    ["language", "title", "hook", "cta", "secondsPerQuestion", "seed"].forEach((id) => { if (stored[id] !== undefined) $(`#${id}`).value = String(stored[id]); });
  } catch { /* ignore malformed local settings */ }
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]); }
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) { if (error.name === "AbortError") throw new Error("请求超时，请确认本地工人已启动。"); throw error; }
  finally { clearTimeout(timer); }
}
