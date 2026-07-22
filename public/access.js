(async () => {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return location.assign("/login");
    const { user } = await response.json();
    document.documentElement.dataset.role = user.role;
    document.querySelectorAll("[data-admin-only]").forEach((item) => { item.hidden = user.role !== "admin"; });
    document.querySelectorAll("[data-account-name]").forEach((item) => { item.textContent = user.displayName || user.username; });
    document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.assign("/login");
    }));
  } catch {
    location.assign("/login");
  }
})();
