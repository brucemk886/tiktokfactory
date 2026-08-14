(async function guard() {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return location.assign("/login");
    const { user, sidebarModules } = await response.json();
    if (!Array.isArray(sidebarModules)) throw new Error("Sidebar catalog is unavailable.");
    document.documentElement.dataset.role = user.role;

    renderCanonicalSidebars(user, sidebarModules);
    applyRoleVisibility(user);
    document.querySelectorAll(".app-brand, .tasks-brand").forEach((item) => {
      item.href = "/";
    });
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
    nav.querySelectorAll("a[href], .sidebar-group").forEach((item) => {
      if (!item.classList.contains("app-brand") && !item.classList.contains("tasks-brand")) item.remove();
    });
    const insertionPoint = nav.querySelector("[data-logout]");
    const fragment = document.createDocumentFragment();
    const available = sidebarModules.filter((item) => {
      if (!Array.isArray(item.roles) || !item.roles.includes(user.role)) return false;
      return !visibleModules || visibleModules.has(item.id);
    });
    const emittedGroups = new Set();
    available.forEach((item) => {
      if (!item.group?.id) {
        fragment.append(createSidebarLink(item));
        return;
      }
      if (emittedGroups.has(item.group.id)) return;
      emittedGroups.add(item.group.id);
      const items = available.filter((candidate) => candidate.group?.id === item.group.id);
      fragment.append(createSidebarGroup(item.group, items));
    });
    nav.insertBefore(fragment, insertionPoint || null);
  });
}

function createSidebarLink(item) {
  const link = document.createElement("a");
  link.href = item.href;
  link.textContent = item.label;
  link.dataset.sidebarModule = item.id;
  if (sidebarPath(location.pathname) === item.href) {
    link.className = "is-active";
    link.setAttribute("aria-current", "page");
  }
  return link;
}

function createSidebarGroup(group, items) {
  const currentPath = sidebarPath(location.pathname);
  const active = items.some((item) => item.href === currentPath);
  const wrapper = document.createElement("div");
  wrapper.className = `sidebar-group${active ? " is-open" : ""}`;
  wrapper.dataset.sidebarGroup = group.id;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidebar-group-toggle";
  button.setAttribute("aria-expanded", String(active));
  const label = document.createElement("span");
  label.textContent = group.label;
  const chevron = document.createElement("span");
  chevron.className = "sidebar-group-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";
  button.append(label, chevron);
  const children = document.createElement("div");
  children.className = "sidebar-group-items";
  children.hidden = !active;
  items.forEach((item) => children.append(createSidebarLink(item)));
  button.addEventListener("click", () => {
    const open = !wrapper.classList.contains("is-open");
    wrapper.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
    children.hidden = !open;
  });
  wrapper.append(button, children);
  return wrapper;
}

function sidebarPath(pathname) {
  const normalized = pathname.replace(/\/$/, "") || "/";
  if (["/official-account-detail", "/official-account-videos", "/official-video-detail"].includes(normalized)) return "/official-analytics";
  if (normalized === "/operator") return "/operator/third-party";
  return normalized;
}

function applyRoleVisibility(user) {
  document.querySelectorAll("[data-admin-only]").forEach((item) => {
    item.hidden = user.role !== "admin";
  });
}
