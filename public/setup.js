document.querySelector("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#setupStatus");
  status.textContent = "正在创建管理员...";
  const response = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: document.querySelector("#username").value, displayName: document.querySelector("#displayName").value, password: document.querySelector("#password").value }) });
  const data = await response.json();
  if (!response.ok) return status.textContent = data.error || "初始化失败。";
  location.assign("/");
});
