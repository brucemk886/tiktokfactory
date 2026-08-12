(async () => {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return location.assign("/login");
    const { user, sidebarModules } = await response.json();
    if (!Array.isArray(sidebarModules)) throw new Error("Sidebar catalog is unavailable.");
    document.documentElement.dataset.role = user.role;

    renderCanonicalSidebars(user, sidebarModules);
    applyRoleVisibility(user);
    document.documentElement.dataset.sidebarReady = "true";

    document.querySelectorAll("[data-account-name]").forEach((item) => {
      item.textContent = user.username;
    });
    document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.assign("/login");
    }));
  } catch {
    location.assign("/login");
  }
})();

function renderCanonicalSidebars(user, sidebarModules) {
  const visibleModules = Array.isArray(user.sidebarModules) ? new Set(user.sidebarModules) : null;
  document.querySelectorAll(".tasks-nav, .side-tabs").forEach((nav) => {
    nav.querySelectorAll("a[href]").forEach((link) => {
      if (!link.classList.contains("app-brand") && !link.classList.contains("tasks-brand")) link.remove();
    });
    const insertionPoint = nav.querySelector("[data-logout]");
    const fragment = document.createDocumentFragment();
    sidebarModules.forEach((item) => {
      if (!Array.isArray(item.roles) || !item.roles.includes(user.role)) return;
      if (visibleModules && !visibleModules.has(item.id)) return;
      const link = document.createElement("a");
      link.href = item.href;
      link.textContent = item.label;
      link.dataset.sidebarModule = item.id;
      if (location.pathname.replace(/\/$/, "") === item.href) {
        link.className = "is-active";
        link.setAttribute("aria-current", "page");
      }
      fragment.append(link);
    });
    nav.insertBefore(fragment, insertionPoint || null);
  });
}

function applyRoleVisibility(user) {
  document.querySelectorAll("[data-admin-only]").forEach((item) => {
    item.hidden = user.role !== "admin";
  });
}
