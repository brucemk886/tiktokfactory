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
  checkedIds: new Set(),
};

const listNode = document.querySelector("#journalList");
const editorNode = document.querySelector("#journalEditor");
const kindTabs = document.querySelector("#kindTabs");
const searchForm = document.querySelector("#journalSearch");
const deleteSelected = document.querySelector("#deleteSelected");
const checkAll = document.querySelector("#checkAll");

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

deleteSelected?.addEventListener("click", () => {
  deleteChecked();
});

checkAll?.addEventListener("change", () => {
  if (checkAll.checked) {
    state.entries.forEach((item) => state.checkedIds.add(item.id));
  } else {
    state.checkedIds.clear();
  }
  renderList();
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
  pruneChecked();
  renderList();
  renderEditor(state.entries.find((item) => item.id === state.selectedId) || null);
}

function renderList() {
  syncDeleteButton();
  if (!state.entries.length) {
    listNode.innerHTML = '<div class="empty-state">还没有记录。点右上角新建一条。</div>';
    return;
  }
  listNode.innerHTML = state.entries.map((item) => {
    const checked = state.checkedIds.has(item.id);
    const classes = [
      "journal-card",
      item.id === state.selectedId ? "is-active" : "",
      checked ? "is-checked" : "",
    ].filter(Boolean).join(" ");
    return `
    <div class="${classes}">
      <label class="journal-check">
        <input type="checkbox" data-check-id="${escapeHtml(item.id)}"${checked ? " checked" : ""}>
      </label>
      <button type="button" class="journal-card-body" data-id="${escapeHtml(item.id)}">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(KIND_LABEL[item.kind] || item.kind)} · ${escapeHtml(item.dateKey)}</small>
      </button>
    </div>
  `;
  }).join("");
  listNode.querySelectorAll("[data-check-id]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      toggleChecked(input.dataset.checkId, input.checked);
    });
  });
  listNode.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectEntry(button.dataset.id));
    button.addEventListener("dblclick", () => {
      const entry = state.entries.find((item) => item.id === button.dataset.id);
      if (entry?.kind === "mindmap") {
        location.assign(`/work-journal-mindmap?id=${encodeURIComponent(entry.id)}`);
      }
    });
  });
}

function selectEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  state.selectedId = entry.id;
  renderList();
  renderEditor(entry);
}

function pruneChecked() {
  const ids = new Set(state.entries.map((item) => item.id));
  state.checkedIds = new Set([...state.checkedIds].filter((id) => ids.has(id)));
}

function toggleChecked(id, checked) {
  if (checked) state.checkedIds.add(id);
  else state.checkedIds.delete(id);
  syncDeleteButton();
  const card = listNode.querySelector(`[data-check-id="${CSS.escape(id)}"]`)?.closest(".journal-card");
  card?.classList.toggle("is-checked", checked);
}

function checkedList() {
  return state.entries.filter((item) => state.checkedIds.has(item.id));
}

function syncDeleteButton() {
  const count = checkedList().length;
  if (deleteSelected) {
    deleteSelected.disabled = count === 0;
    deleteSelected.textContent = count ? `删除（${count}）` : "删除";
  }
  if (checkAll) {
    const total = state.entries.length;
    checkAll.checked = total > 0 && count === total;
    checkAll.indeterminate = count > 0 && count < total;
    checkAll.disabled = total === 0;
  }
}

function renderEditor(entry) {
  syncDeleteButton();
  if (!entry) {
    editorNode.innerHTML = '<div class="empty-state">选左侧一条记录，或新建每日工作 / 随笔 / 脑图。</div>';
    return;
  }
  editorNode.innerHTML = `
    <form class="editor-grid" id="entryForm">
      <div class="editor-actions">
        <button type="submit" class="primary-button">保存</button>
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
      ${entry.kind === "mindmap"
        ? `<div class="mindmap-launch"><p>脑图在独立全屏页里编辑，默认向右展开。双击左侧名称也可打开。</p><a class="primary-button" href="/work-journal-mindmap?id=${encodeURIComponent(entry.id)}">打开脑图</a></div>`
        : `<label>正文<textarea name="body">${escapeHtml(entry.body || "")}</textarea></label>`}
    </form>
  `;
  const form = editorNode.querySelector("#entryForm");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEntry(entry, form);
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
  if (kind === "mindmap") {
    location.assign(`/work-journal-mindmap?id=${encodeURIComponent(payload.entry.id)}`);
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

async function deleteChecked() {
  const ids = checkedList().map((item) => item.id);
  if (!ids.length) return;
  const label = ids.length === 1 ? "确定删除这条记录？" : `确定删除选中的 ${ids.length} 条记录？`;
  if (!confirm(label)) return;
  const failed = [];
  for (const id of ids) {
    const response = await fetch(`/api/work-journal/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      failed.push(payload.error || "删除失败");
    }
  }
  if (ids.includes(state.selectedId)) state.selectedId = "";
  state.checkedIds.clear();
  await loadEntries();
  if (failed.length) alert(failed[0]);
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
