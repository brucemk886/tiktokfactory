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
  location.assign(data.home);
});
