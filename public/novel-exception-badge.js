(function mountNovelExceptionBadge() {
  if (document.getElementById("novelExceptionBadge")) return start();
  const actions = document.querySelector(".toolbar-actions");
  if (!actions) return;
  const link = document.createElement("a");
  link.id = "novelExceptionBadge";
  link.href = "/novel-exceptions";
  link.textContent = "异常处理";
  link.dataset.count = "0";
  actions.insertBefore(link, actions.firstChild);
  start();

  async function start() {
    if (document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/api/novel-exceptions/summary", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok) return;
      const data = await response.json();
      const count = Number(data.open || 0) + Number(data.inProgress || 0);
      const node = document.getElementById("novelExceptionBadge");
      if (!node) return;
      node.dataset.count = String(count);
      node.textContent = count ? `异常处理 ${count}` : "异常处理";
    } catch {
      /* keep the last label */
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") start();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") start();
  }, 60000);
})();
