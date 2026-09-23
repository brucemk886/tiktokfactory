const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = value => value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
const pct = value => value === null || value === undefined ? "—" : (value * 100).toFixed(1) + "%";
const time = value => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const STATUS = { active: "运行中", paused: "已暂停", ended: "已结束" };
const SLOT = { creating: "创建中", created: "已排好", failed: "创建失败", skipped: "已跳过" };
const STAGES = { launch: "起号", normal: "普通", potential: "潜力", burst: "爆发" };
let data = null;

async function api(path = "", method = "GET", body) {
  const response = await fetch("/api/psychology-autopilot" + path, { method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}
function table(headers, rows) { return '<table class="ops-table"><thead><tr>' + headers.map(h => "<th>" + h + "</th>").join("") + "</tr></thead><tbody>" + rows.map(r => "<tr>" + r.map(c => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table>"; }

async function load() {
  $("#status").textContent = "正在读取…";
  try { data = await api(); render(); $("#status").textContent = data.pilots.length ? "" : "还没有自动运营。在上面选一个分组启动。"; }
  catch (error) { $("#status").textContent = error.message; }
}
function render() {
  const live = new Set(data.pilots.filter(p => p.status !== "ended").map(p => p.groupId));
  $("#groupId").innerHTML = data.groups.map(g => `<option value="${esc(g.id)}" ${live.has(g.id) ? "disabled" : ""}>${esc(g.name)}（${g.accounts} 个号）${live.has(g.id) ? " · 运营中" : ""}</option>`).join("");
  if (!$("#strategy").options.length) $("#strategy").innerHTML = Object.entries(data.strategies).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join("");
  const r = data.rules;
  $("#rules").innerHTML = [
    "每个号每天 3 条，北京时间 " + r.slots.map(s => String(s.hour).padStart(2, "0") + ":" + String(s.minute).padStart(2, "0")).join(" / ") + "，同一时段各号依次错开 " + r.staggerSeconds + " 秒。",
    "内容从文案库图文抽取，同一个号不会重复发同一篇爆款；每天 0 点、8 点各检查一次，提前排好未来一天的发布。",
    "配对抽取：同一时段所有自动运营的分组共用一份爆款排序，各组拿到同样的爆款，只按策略发不同版本，对比才公平。",
    "A 按表现进化：原版优先，数据够了 70% 用表现最好的版本；B 只发原版；C 改写版优先，没有改写时用原版。",
    `自动停发：自动运营开始后连续 ${r.lowPosts} 条满24小时都低于 ${r.lowViews} 播放，或连续 ${r.failStreak} 次发布失败。停发的号可以手动恢复。`,
  ].map(t => "<li>" + esc(t) + "</li>").join("");
  $("#compare").innerHTML = data.pilots.length ? table(["分组", "策略", "状态", "账号（发布中 / 停发）", "近7天满24小时", "中位播放", "破千率", "破万率", "完播率", "账号阶段", "分析时间"], data.pilots.map(p => {
    const o = p.latest?.overview, active = p.accounts.filter(a => a.status === "active").length;
    return [esc(p.groupName), esc(p.strategyLabel), STATUS[p.status] + (p.status === "active" ? "<small>到 " + time(p.endsAt) + "</small>" : ""), active + " / " + (p.accounts.length - active),
      fmt(o?.n), fmt(o?.medianViews), pct(o?.potentialRate), pct(o?.hitRate), pct(o?.completion),
      p.latest?.stages ? Object.entries(STAGES).map(([k, l]) => l + " " + (p.latest.stages[k] || 0)).join(" · ") : "—", p.latest ? time(p.latest.at) : "等待首次分析"];
  })) : "";
  $("#pilots").innerHTML = data.pilots.map(p => {
    const upcoming = [...p.schedule].sort((a, b) => a.slotAt - b.slotAt);
    const actions = p.status === "ended" ? "" : (p.status === "active" ? `<button class="table-action" data-run="${p.id}">立即检查并排期</button><button class="table-action" data-status="paused" data-pilot="${p.id}">暂停</button>` : `<button class="table-action" data-status="active" data-pilot="${p.id}">恢复</button>`) + `<button class="table-action" data-status="ended" data-pilot="${p.id}">结束</button>`;
    return `<section class="panel data-section pilot"><div class="section-title"><div><p>${esc(p.strategyLabel)}</p><h2>${esc(p.groupName)} <span class="ops-chip">${STATUS[p.status]}</span></h2></div><div class="pilot-actions">${actions}</div></div>
      ${p.latest?.findings?.length ? '<div class="ops-findings"><ul>' + p.latest.findings.map(f => "<li>" + esc(f) + "</li>").join("") + "</ul></div>" : ""}
      <h3>发布排期</h3>${upcoming.length ? table(["发布时间（北京）", "状态", "说明"], upcoming.map(s => [time(s.slotAt), SLOT[s.status] || s.status, esc(s.detail || (s.batchIds.length ? "批次 " + s.batchIds.length + " 个" : ""))])) : '<div class="empty">还没有排期。</div>'}
      <details class="ops-daily"><summary>账号（${p.accounts.length}）</summary>${table(["账号", "状态", "原因", "操作"], p.accounts.map(a => ["@" + esc(a.name), a.status === "active" ? "发布中" : "已停发", esc(a.reason || "—"),
        p.status === "ended" ? "" : `<button class="table-action" data-pilot="${p.id}" data-account="${esc(a.connectionId)}" data-account-status="${a.status === "active" ? "paused" : "active"}">${a.status === "active" ? "停发" : "恢复"}</button>`]))}</details>
      <details class="ops-daily" open><summary>运营日志</summary><ul class="pilot-log">${p.logs.map(l => `<li class="is-${esc(l.kind)}"><time>${time(l.at)}</time>${esc(l.message)}</li>`).join("")}</ul></details></section>`;
  }).join("");
}
$("#pilots").addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  const pilot = button.dataset.pilot || button.dataset.run;
  if (button.dataset.status === "ended" && !confirm("结束后不再创建新发布，已排好的发布照常进行，且不能重新启动。确定结束？")) return;
  button.disabled = true;
  try {
    if (button.dataset.run) { const r = await api("/" + pilot + "/run", "POST"); alert(`已检查：新排 ${r.batches.length} 个批次，新停发 ${r.paused.length} 个号${r.errors.length ? "，失败：" + r.errors.join("；") : ""}`); }
    else if (button.dataset.account) await api("/" + pilot + "/accounts/" + encodeURIComponent(button.dataset.account), "PATCH", { status: button.dataset.accountStatus });
    else await api("/" + pilot, "PATCH", { status: button.dataset.status });
    await load();
  } catch (error) { alert(error.message); button.disabled = false; }
});
$("#createForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#createButton").disabled = true; $("#createStatus").textContent = "正在启动并排第一批发布…";
  try {
    const r = await api("", "POST", { groupId: $("#groupId").value, strategy: $("#strategy").value, days: Number($("#days").value) });
    $("#createStatus").textContent = `已启动：排好 ${r.run.batches.length} 个批次` + (r.run.errors.length ? "；失败：" + r.run.errors.join("；") : "。");
    await load();
  } catch (error) { $("#createStatus").textContent = error.message; }
  finally { $("#createButton").disabled = false; }
});
$("#reload").addEventListener("click", load);
load();
