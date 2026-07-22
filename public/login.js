document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#loginStatus");
  status.textContent = "正在登录...";
  const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: document.querySelector("#username").value, password: document.querySelector("#password").value }) });
  const data = await response.json();
  if (!response.ok) return status.textContent = data.error || "登录失败。";
  location.assign("/tasks");
});
