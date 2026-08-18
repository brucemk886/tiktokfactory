const KIND_LABEL = {
  daily_work: "每日工作",
  essay: "每日随笔",
  mindmap: "脑图",
};

const state = {
  kind: "",
  query: "",
  dateKey: "",
  entries: [],
  selectedId: "",
};

const listNode = document.querySelector("#journalList");
const editorNode = document.querySelector("#journalEditor");
const kindTabs = document.querySelector("#kindTabs");
const searchForm = document.querySelector("#journalSearch");

document.querySelectorAll("[data-create]").forEach((button) => {
  button.addEventListener("click", () => createEntry(button.dataset.create));
});

kindTabs?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-kind]");
  if (!button) return;
  state.kind = button.dataset.kind || "";
  kindTabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  loadEntries();
});

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = document.querySelector("#journalQuery").value.trim();
  state.dateKey = document.querySelector("#journalDate").value.trim();
  loadEntries();
});

async function loadEntries() {
  const params = new URLSearchParams();
  if (state.kind) params.set("kind", state.kind);
  if (state.query) params.set("query", state.query);
  if (state.dateKey) params.set("date", state.dateKey);
  const response = await fetch(`/api/work-journal?${params}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    listNode.innerHTML = `<div class="empty-state">${escapeHtml(payload.error || "读取失败")}</div>`;
    return;
  }
  state.entries = payload.entries || [];
  if (state.selectedId && !state.entries.some((item) => item.id === state.selectedId)) state.selectedId = "";
  renderList();
  if (state.selectedId) renderEditor(state.entries.find((item) => item.id === state.selectedId));
}

function renderList() {
  if (!state.entries.length) {
    listNode.innerHTML = '<div class="empty-state">还没有记录。点右上角新建一条。</div>';
    return;
  }
  listNode.innerHTML = state.entries.map((item) => `
    <button type="button" class="journal-card${item.id === state.selectedId ? " is-active" : ""}" data-id="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(KIND_LABEL[item.kind] || item.kind)} · ${escapeHtml(item.dateKey)}</small>
    </button>
  `).join("");
  listNode.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      renderList();
      renderEditor(state.entries.find((item) => item.id === state.selectedId));
    });
  });
}

function renderEditor(entry) {
  if (!entry) {
    editorNode.innerHTML = '<div class="empty-state">选左侧一条记录，或新建每日工作 / 随笔 / 脑图。</div>';
    return;
  }
  editorNode.innerHTML = `
    <form class="editor-grid" id="entryForm">
      <div class="editor-actions">
        <button type="submit" class="primary-button">保存</button>
        <button type="button" class="danger-button" id="deleteEntry">删除</button>
      </div>
      <label>类型
        <select name="kind">
          <option value="daily_work"${entry.kind === "daily_work" ? " selected" : ""}>每日工作</option>
          <option value="essay"${entry.kind === "essay" ? " selected" : ""}>每日随笔</option>
          <option value="mindmap"${entry.kind === "mindmap" ? " selected" : ""}>脑图</option>
        </select>
      </label>
      <label>日期<input name="dateKey" type="date" value="${escapeHtml(entry.dateKey)}" required></label>
      <label>标题<input name="title" value="${escapeHtml(entry.title)}" maxlength="120" required></label>
      ${entry.kind === "mindmap" ? `<div class="mindmap-board" id="mindmapBoard"></div>` : `<label>正文<textarea name="body">${escapeHtml(entry.body || "")}</textarea></label>`}
    </form>
  `;
  const form = editorNode.querySelector("#entryForm");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEntry(entry, form);
  });
  editorNode.querySelector("#deleteEntry").addEventListener("click", () => deleteEntry(entry.id));
  if (entry.kind === "mindmap") {
    entry.mindmap = entry.mindmap || { id: "root", text: entry.title, children: [] };
    renderMindmap(editorNode.querySelector("#mindmapBoard"), entry.mindmap, entry);
  }
}

function renderMindmap(board, node, entry) {
  board.innerHTML = renderMindNode(node);
  board.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = findNode(entry.mindmap, button.dataset.add);
      target?.children.push({ id: `node-${Date.now()}`, text: "新节点", children: [] });
      renderEditor(entry);
    });
  });
  board.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.remove === "root") return;
      removeNode(entry.mindmap, button.dataset.remove);
      renderEditor(entry);
    });
  });
  board.querySelectorAll("[data-node-input]").forEach((input) => {
    input.addEventListener("input", () => {
      const target = findNode(entry.mindmap, input.dataset.nodeInput);
      if (target) target.text = input.value;
      if (input.dataset.nodeInput === "root") {
        const titleInput = editorNode.querySelector("input[name=title]");
        if (titleInput) titleInput.value = input.value;
      }
    });
  });
}

function renderMindNode(node) {
  return `<div class="mind-node">
    <div class="mind-card">
      <input data-node-input="${escapeHtml(node.id)}" value="${escapeHtml(node.text)}">
      <div class="mind-actions">
        <button type="button" data-add="${escapeHtml(node.id)}">加子节点</button>
        ${node.id === "root" ? "" : `<button type="button" data-remove="${escapeHtml(node.id)}">删除</button>`}
      </div>
    </div>
    ${node.children?.length ? `<div class="mind-children">${node.children.map(renderMindNode).join("")}</div>` : ""}
  </div>`;
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function removeNode(node, id) {
  node.children = (node.children || []).filter((child) => {
    if (child.id === id) return false;
    removeNode(child, id);
    return true;
  });
}

async function createEntry(kind) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const titles = { daily_work: `${today} 工作`, essay: `${today} 随笔`, mindmap: `${today} 脑图` };
  const response = await fetch("/api/work-journal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind,
      dateKey: today,
      title: titles[kind],
      body: "",
      mindmap: { id: "root", text: titles[kind], children: [] },
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    alert(payload.error || "创建失败");
    return;
  }
  state.selectedId = payload.entry.id;
  await loadEntries();
  renderEditor(payload.entry);
}

async function saveEntry(entry, form) {
  const data = new FormData(form);
  const payload = {
    kind: data.get("kind"),
    dateKey: data.get("dateKey"),
    title: data.get("title"),
    body: data.get("body") || "",
    mindmap: entry.mindmap,
  };
  const response = await fetch(`/api/work-journal/${encodeURIComponent(entry.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    alert(result.error || "保存失败");
    return;
  }
  state.selectedId = result.entry.id;
  await loadEntries();
  renderEditor(result.entry);
}

async function deleteEntry(id) {
  if (!confirm("确定删除这条记录？")) return;
  const response = await fetch(`/api/work-journal/${encodeURIComponent(id)}`, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    alert(payload.error || "删除失败");
    return;
  }
  state.selectedId = "";
  await loadEntries();
  renderEditor(null);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

loadEntries();
