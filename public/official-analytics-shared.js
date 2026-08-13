(function () {
  const $ = (selector) => document.querySelector(selector);

  async function fetchDashboard(values = {}) {
    const params = new URLSearchParams({ ...values, t: String(Date.now()) });
    const response = await fetch(`/api/official-analytics?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取失败");
    return data;
  }

  function drawChart(container, rows, key = "views", options = {}) {
    if (!container) return;
    if (rows.length < 2) {
      const snapshot = rows[0];
      container.innerHTML = `<div class="chart-empty"><strong>${snapshot ? `当前快照：${format(snapshot[key])}` : "暂无历史快照"}</strong><span>${snapshot ? `${escapeHtml(snapshot.dateKey || "")} 已归档；形成第二个快照后展示变化曲线。` : "同步后会在这里展示历史变化。"}</span></div>`;
      return;
    }
    const width = 1200, height = 260, pad = 38;
    const values = rows.map((row) => Number(row[key] || 0));
    const max = Math.max(...values, 1), step = (width - pad * 2) / (rows.length - 1);
    const points = values.map((value, index) => `${pad + index * step},${height - pad - (value / max) * (height - pad * 2)}`).join(" ");
    const labels = rows.map((row, index) => index === 0 || index === rows.length - 1 ? `<text class="chart-label" x="${pad + index * step}" y="${height - 8}" text-anchor="${index === 0 ? "start" : "end"}">${escapeHtml(row.dateKey)}</text>` : "").join("");
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "历史变化")}"><line class="chart-grid" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"/><polygon class="chart-area" points="${pad},${height - pad} ${points} ${width - pad},${height - pad}"/><polyline class="chart-line" points="${points}"/>${labels}<text class="chart-label" x="${pad}" y="18">峰值 ${format(max)}</text></svg>`;
  }

  function parseObject(value) {
    if (value && typeof value === "object") return value;
    try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
  }
  function pick(source, ...keys) {
    for (const key of keys) if (source?.[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
    return null;
  }
  function distribution(value) {
    const raw = parseObject(value);
    const rows = Array.isArray(raw) ? raw.map((item, index) => {
      if (typeof item === "number") return { label: String(index), value: item };
      if (typeof item === "string") return { label: item, value: 0 };
      return { label: String(pick(item, "label", "name", "key", "country", "country_name", "city", "city_name", "age", "gender", "source", "type", "impressionSource", "impression_source", "trafficSource", "traffic_source") ?? index), value: Number(pick(item, "percentage", "percent", "value", "ratio", "share", "count") || 0) };
    }) : Object.entries(raw).filter(([key]) => !key.startsWith("_")).map(([label, value]) => ({ label, value: Number(typeof value === "object" ? pick(value, "percentage", "percent", "value", "ratio", "share", "count") : value) || 0 }));
    const max = Math.max(...rows.map((row) => row.value), 0);
    return rows.map((row) => ({ ...row, value: max <= 1 ? row.value * 100 : row.value })).sort((a, b) => b.value - a.value);
  }
  const trafficSourceLabels = { "0": "Direct Message", "1": "Search", "2": "Others", "3": "For You", "4": "Personal Profile", "5": "Sound", "6": "Follow" };
  function renderDistribution(container, value, empty = "当前授权暂未返回", options = {}) {
    if (!container) return;
    const rows = distribution(value).map((row) => ({ ...row, label: options.trafficSources ? (trafficSourceLabels[String(row.label)] || row.label) : row.label }));
    container.innerHTML = rows.length ? `<div class="distribution-list">${rows.slice(0, 30).map((row) => `<div class="distribution-row"><span>${escapeHtml(row.label)}</span><i><b style="width:${Math.max(.6, Math.min(100, row.value))}%"></b></i><strong>${row.value.toFixed(1).replace(/\.0$/, "")}%</strong></div>`).join("")}</div>` : `<div class="empty compact-empty">${escapeHtml(empty)}</div>`;
  }
  function parseRetention(value) {
    const raw = parseObject(value);
    const array = Array.isArray(raw) ? raw : Object.entries(raw).map(([second, percentage]) => ({ second, percentage }));
    return array.map((item, index) => {
      const percentage = Number(typeof item === "number" ? item : pick(item, "percentage", "percent", "value", "retention") || 0);
      return { second: Number(typeof item === "number" ? index : pick(item, "second", "time", "index") ?? index), percentage: percentage <= 1 ? percentage * 100 : percentage };
    }).filter((item) => Number.isFinite(item.second) && Number.isFinite(item.percentage)).sort((a, b) => a.second - b.second);
  }
  function drawRetention(container, value) {
    if (!container) return;
    const rows = parseRetention(value);
    if (!rows.length) { container.innerHTML = '<div class="chart-empty"><strong>暂无逐秒留存数据</strong><span>当前视频或授权接口暂未返回该字段。</span></div>'; return; }
    const width = 1200, height = 300, pad = 42, maxSecond = Math.max(rows.at(-1).second, 1);
    const x = (second) => maxSecond <= 10 ? pad + (second / maxSecond) * (width - pad * 2) : second <= 10 ? pad + (second / 10) * (width - pad * 2) * .5 : pad + (width - pad * 2) * .5 + ((second - 10) / (maxSecond - 10)) * (width - pad * 2) * .5;
    const y = (value) => height - pad - (Math.max(0, Math.min(100, value)) / 100) * (height - pad * 2);
    const points = rows.map((row) => `${x(row.second)},${y(row.percentage)}`).join(" ");
    const dots = rows.map((row) => `<circle cx="${x(row.second)}" cy="${y(row.percentage)}" r="4" tabindex="0" data-second="${row.second}" data-percentage="${row.percentage.toFixed(1)}"></circle>`).join("");
    const ticks = [0, Math.min(3, maxSecond), Math.min(10, maxSecond), maxSecond].filter((v, i, a) => a.indexOf(v) === i).map((second) => `<text class="chart-label" x="${x(second)}" y="${height - 8}" text-anchor="middle">${time(second)}</text>`).join("");
    container.innerHTML = `<svg class="retention-svg" viewBox="0 0 ${width} ${height}" role="img"><line class="chart-grid" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"/><polygon class="chart-area" points="${pad},${height - pad} ${points} ${x(maxSecond)},${height - pad}"/><polyline class="chart-line" points="${points}"/><g class="retention-dots">${dots}</g>${ticks}</svg><div class="retention-tooltip" role="status" aria-live="polite"></div>`;
    const tooltip = container.querySelector(".retention-tooltip");
    const hideTooltip = () => tooltip?.classList.remove("is-visible");
    const showTooltip = (event) => {
      const dot = event.currentTarget;
      const box = container.getBoundingClientRect();
      const dotBox = dot.getBoundingClientRect();
      const percentage = Number(dot.dataset.percentage || 0);
      tooltip.innerHTML = `<strong>${time(dot.dataset.second)}</strong><span>留存 ${percentage.toFixed(1)}%</span>`;
      tooltip.classList.add("is-visible");
      const left = Math.max(8, Math.min(box.width - tooltip.offsetWidth - 8, dotBox.left - box.left + dotBox.width / 2 - tooltip.offsetWidth / 2));
      const top = Math.max(8, dotBox.top - box.top - tooltip.offsetHeight - 12);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    container.querySelectorAll(".retention-dots circle").forEach((dot) => {
      dot.addEventListener("mouseenter", showTooltip);
      dot.addEventListener("focus", showTooltip);
      dot.addEventListener("mouseleave", hideTooltip);
      dot.addEventListener("blur", hideTooltip);
    });
  }
  function duration(value) { const n = Number(value) || 0; return n >= 3600 ? `${(n / 3600).toFixed(1)} 小时` : n >= 60 ? `${Math.floor(n / 60)}分${Math.round(n % 60)}秒` : `${n.toFixed(n % 1 ? 1 : 0)}秒`; }
  function percent(value) { const n = Number(value) || 0; return `${(n <= 1 && n > 0 ? n * 100 : n).toFixed(1).replace(/\.0$/, "")}%`; }
  function time(second) { const n = Math.max(0, Math.round(Number(second) || 0)); return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; }
  function activate(button, selector) { button.parentElement?.querySelectorAll(selector).forEach((item) => item.classList.toggle("is-active", item === button)); }
  function avatar(item) { return item.profileImage ? `<img src="${escapeHtml(item.profileImage)}" alt="" referrerpolicy="no-referrer"/>` : '<span class="avatar-placeholder"></span>'; }
  function showStatus(message) { const node = $("#pageStatus"); if (!node) return; node.textContent = message; node.classList.add("is-visible"); }
  function hideStatus() { $("#pageStatus")?.classList.remove("is-visible"); }
  function format(value) { return new Intl.NumberFormat("zh-CN", { notation: Number(value) >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value) || 0); }
  function validDateTimestamp(value) {
    if (value === undefined || value === null || value === "") return 0;
    let timestamp = Number(value);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      while (timestamp > 1e14) timestamp /= 1000;
      if (timestamp < 1e12) timestamp *= 1000;
    } else timestamp = Date.parse(String(value));
    const min = Date.UTC(2016, 0, 1);
    const max = Date.now() + 14 * 86400000;
    return Number.isFinite(timestamp) && timestamp >= min && timestamp <= max ? timestamp : 0;
  }
  function timestampFromTikTokId(value) {
    try {
      const id = String(value || "").trim();
      if (!/^\d{16,22}$/.test(id)) return 0;
      return validDateTimestamp(Number(BigInt(id) >> 32n) * 1000);
    } catch { return 0; }
  }
  function videoTimestamp(item) {
    const analytics = item?.analytics && typeof item.analytics === "object" ? item.analytics : {};
    const fields = ["createTime", "createdAt", "create_time", "publishTime", "publish_time", "publishedAt", "published_at"];
    for (const field of fields) {
      const timestamp = validDateTimestamp(item?.[field]) || validDateTimestamp(analytics?.[field]);
      if (timestamp) return timestamp;
    }
    return timestampFromTikTokId(item?.id || item?.videoId || item?.item_id);
  }
  function dateTime(value, fallbackId = "") { const timestamp = validDateTimestamp(value) || timestampFromTikTokId(fallbackId); return timestamp ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : "-"; }
  function videoDateTime(item) { const timestamp = videoTimestamp(item); return timestamp ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : "-"; }
  function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
  function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
  window.OfficialAnalytics = { $, fetchDashboard, drawChart, drawRetention, renderDistribution, parseObject, pick, activate, avatar, showStatus, hideStatus, format, duration, percent, dateTime, videoDateTime, debounce, escapeHtml };
})();
