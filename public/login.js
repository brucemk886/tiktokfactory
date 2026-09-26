document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#loginStatus");
  status.textContent = "正在登录...";
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: document.querySelector("#username").value.trim(),
      password: document.querySelector("#password").value
    })
  });
  const data = await response.json();
  if (!response.ok) return status.textContent = data.error || "登录失败。";
  if (!data.home) return status.textContent = "当前账号没有可访问的页面，请联系管理员分配 GeeLark 备用权限。";
  const next = new URLSearchParams(location.search).get('next');
  // Only the two same-origin OAuth pages may override the normal login destination.
  const target = next && new URL(next, location.origin);
  location.assign(target && target.origin === location.origin && ['/oauth/authorize', '/factory-mcp'].includes(target.pathname) ? target.href : data.home);
});
