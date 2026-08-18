const COLORS = ["#5b8ff9", "#61ddaa", "#f6bd16", "#7262fd", "#78d3f8", "#f6903d", "#9661bc", "#65789b"];
const H_GAP = 78;
const V_GAP = 18;

const state = {
  entry: null,
  selectedId: "root",
  scale: 1,
  tx: 0,
  ty: 0,
  dirty: false,
  saving: false,
  drag: null,
  nodeDrag: null,
  dropId: "",
};

const stage = document.querySelector("#mindStage");
const svg = document.querySelector("#mindSvg");
const titleInput = document.querySelector("#mapTitle");
const saveState = document.querySelector("#saveState");

await guard();
await loadMap();
bindChrome();
fitView();
draw();

async function guard() {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (!response.ok) {
    location.assign("/login");
    throw new Error("unauthorized");
  }
}

async function loadMap() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    location.assign("/work-journal");
    return;
  }
  const response = await fetch(`/api/work-journal?t=${Date.now()}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "读取失败");
  state.entry = (payload.entries || []).find((item) => item.id === id);
  if (!state.entry || state.entry.kind !== "mindmap") {
    location.assign("/work-journal");
    return;
  }
  state.entry.mindmap = state.entry.mindmap || { id: "root", text: state.entry.title, children: [] };
  titleInput.value = state.entry.title || "";
  document.title = `${state.entry.title} · 脑图`;
}

function bindChrome() {
  titleInput.addEventListener("input", () => {
    state.entry.title = titleInput.value;
    const root = state.entry.mindmap;
    if (root) root.text = titleInput.value || root.text;
    markDirty();
    draw();
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.action));
  });
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const next = Math.min(2.4, Math.max(0.35, state.scale * (event.deltaY < 0 ? 1.08 : 0.92)));
    state.scale = next;
    draw();
  }, { passive: false });
  stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".mind-editor")) return;
    const nodeEl = event.target.closest(".mind-node");
    if (nodeEl) {
      event.stopPropagation();
      state.selectedId = nodeEl.dataset.id;
      state.nodeDrag = {
        id: nodeEl.dataset.id,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      stage.setPointerCapture(event.pointerId);
      draw();
      return;
    }
    state.drag = { x: event.clientX, y: event.clientY, tx: state.tx, ty: state.ty };
    stage.classList.add("is-panning");
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (state.nodeDrag) {
      const dx = event.clientX - state.nodeDrag.x;
      const dy = event.clientY - state.nodeDrag.y;
      if (!state.nodeDrag.moved && Math.hypot(dx, dy) < 6) return;
      if (state.nodeDrag.id === "root") return;
      state.nodeDrag.moved = true;
      const laid = currentLayout().nodes;
      const hit = hitNode(event.clientX, event.clientY, laid);
      const nextDrop = canDropOn(state.nodeDrag.id, hit?.id) ? hit.id : "";
      if (nextDrop !== state.dropId) {
        state.dropId = nextDrop;
        draw();
      }
      return;
    }
    if (!state.drag) return;
    state.tx = state.drag.tx + (event.clientX - state.drag.x);
    state.ty = state.drag.ty + (event.clientY - state.drag.y);
    draw();
  });
  stage.addEventListener("pointerup", () => {
    if (state.nodeDrag?.moved && state.dropId) attachNode(state.nodeDrag.id, state.dropId);
    state.nodeDrag = null;
    state.dropId = "";
    state.drag = null;
    stage.classList.remove("is-panning");
    draw();
  });
  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea")) {
      if (event.key === "Enter" && event.target === titleInput) event.target.blur();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      addChild();
    } else if (event.key === "Enter") {
      event.preventDefault();
      addSibling();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveMap();
    }
  });
}

function runAction(action) {
  if (action === "add-child") addChild();
  if (action === "add-sibling") addSibling();
  if (action === "remove") removeSelected();
  if (action === "fit") {
    fitView();
    draw();
  }
  if (action === "save") saveMap();
}

function addChild() {
  const node = findNode(state.entry.mindmap, state.selectedId) || state.entry.mindmap;
  const child = { id: `node-${Date.now()}`, text: "新主题", children: [] };
  node.children = node.children || [];
  node.children.push(child);
  state.selectedId = child.id;
  markDirty();
  draw();
  startEdit(child.id);
}

function addSibling() {
  if (state.selectedId === "root") return addChild();
  const parent = findParent(state.entry.mindmap, state.selectedId);
  if (!parent) return;
  const child = { id: `node-${Date.now()}`, text: "新主题", children: [] };
  const index = parent.children.findIndex((item) => item.id === state.selectedId);
  parent.children.splice(index + 1, 0, child);
  state.selectedId = child.id;
  markDirty();
  draw();
  startEdit(child.id);
}

function removeSelected() {
  if (state.selectedId === "root") return;
  removeNode(state.entry.mindmap, state.selectedId);
  state.selectedId = "root";
  markDirty();
  draw();
}

function markDirty() {
  state.dirty = true;
  saveState.textContent = "未保存";
  clearTimeout(markDirty.timer);
  markDirty.timer = setTimeout(saveMap, 900);
}

function fitView() {
  const { nodes } = layoutTree(state.entry.mindmap);
  const box = nodeBounds(nodes);
  const width = stage.clientWidth || 1200;
  const height = stage.clientHeight || 700;
  const scale = Math.min(1.2, Math.max(0.4, Math.min((width - 120) / box.width, (height - 120) / box.height)));
  state.scale = scale;
  state.tx = width / 2 - (box.x + box.width / 2) * scale;
  state.ty = height / 2 - (box.y + box.height / 2) * scale;
}

function draw() {
  const root = state.entry.mindmap;
  const { nodes, links } = layoutTree(root);
  const colorById = topicColors(root);
  const parts = [];
  for (const link of links) {
    const from = nodes.find((item) => item.id === link.from);
    const to = nodes.find((item) => item.id === link.to);
    if (!from || !to) continue;
    const color = colorById.get(firstTopicId(root, to.id)) || "#5c6a14";
    parts.push(`<path class="mind-link" d="${curve(from, to)}" stroke="${color}"></path>`);
  }
  for (const node of nodes) {
    const color = node.depth === 0 ? "#c8dc5a" : (colorById.get(firstTopicId(root, node.id)) || "#fff");
    const selected = node.id === state.selectedId ? " is-selected" : "";
    const dropClass = node.id === state.dropId ? " is-drop" : "";
    const dragClass = state.nodeDrag?.moved && node.id === state.nodeDrag.id ? " is-dragging" : "";
    const rootClass = node.depth === 0 ? " is-root" : "";
    const fill = node.depth === 0 ? "#c8dc5a" : "#fffdf8";
    const stroke = node.depth === 0 ? "#5c6a14" : color;
    parts.push(`<g class="mind-node${rootClass}${selected}${dropClass}${dragClass}" data-id="${escapeAttr(node.id)}" transform="translate(${node.x - node.width / 2},${node.y - node.height / 2})">
      <rect rx="${node.depth === 0 ? 18 : 10}" width="${node.width}" height="${node.height}" fill="${fill}" stroke="${stroke}"></rect>
      <text x="${node.width / 2}" y="${node.height / 2 + 5}" text-anchor="middle">${escapeHtml(node.text)}</text>
    </g>`);
  }
  svg.innerHTML = `<g transform="translate(${state.tx},${state.ty}) scale(${state.scale})">${parts.join("")}</g>`;
  svg.querySelectorAll(".mind-node").forEach((group) => {
    group.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      startEdit(group.dataset.id);
    });
  });
}

function startEdit(id) {
  const node = findNode(state.entry.mindmap, id);
  const laid = layoutTree(state.entry.mindmap).nodes.find((item) => item.id === id);
  if (!node || !laid) return;
  document.querySelector(".mind-editor")?.remove();
  const editor = document.createElement("textarea");
  editor.className = "mind-editor";
  editor.value = node.text;
  const left = state.tx + (laid.x - laid.width / 2) * state.scale;
  const top = state.ty + (laid.y - laid.height / 2) * state.scale;
  editor.style.left = `${Math.max(8, left)}px`;
  editor.style.top = `${Math.max(8, top)}px`;
  editor.style.width = `${Math.max(120, laid.width * state.scale)}px`;
  stage.append(editor);
  editor.focus();
  editor.select();
  const commit = () => {
    node.text = editor.value.trim() || node.text;
    if (id === "root") {
      state.entry.title = node.text;
      titleInput.value = node.text;
    }
    editor.remove();
    markDirty();
    draw();
  };
  editor.addEventListener("blur", commit);
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      editor.blur();
    }
    if (event.key === "Escape") {
      editor.value = node.text;
      editor.blur();
    }
    event.stopPropagation();
  });
}

async function saveMap() {
  if (!state.entry || state.saving) return;
  state.saving = true;
  saveState.textContent = "保存中…";
  const response = await fetch(`/api/work-journal/${encodeURIComponent(state.entry.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "mindmap",
      dateKey: state.entry.dateKey,
      title: titleInput.value.trim() || state.entry.title,
      body: "",
      mindmap: state.entry.mindmap,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  state.saving = false;
  if (!response.ok) {
    saveState.textContent = payload.error || "保存失败";
    return;
  }
  state.entry = payload.entry;
  state.dirty = false;
  saveState.textContent = "已保存";
  document.title = `${state.entry.title} · 脑图`;
}

function currentLayout() {
  return layoutTree(state.entry.mindmap);
}

function layoutTree(root) {
  const nodes = [];
  const links = [];
  const first = Array.isArray(root.children) ? root.children : [];
  const rootSize = measure(root.text, true);
  nodes.push({ id: root.id, text: root.text, ...rootSize, x: 0, y: 0, depth: 0, side: "right" });
  placeGroup(first, "right", rootSize.width / 2 + H_GAP, 0, root.id, 1);

  function placeGroup(list, side, startX, centerY, parentId, depth) {
    if (!list.length) return;
    const heights = list.map((item) => subtreeHeight(item));
    const total = heights.reduce((sum, value) => sum + value, 0) + V_GAP * (list.length - 1);
    let cursor = centerY - total / 2;
    for (let index = 0; index < list.length; index += 1) {
      const node = list[index];
      const size = measure(node.text, false);
      const block = heights[index];
      const y = cursor + block / 2;
      const x = side === "right" ? startX + size.width / 2 : startX - size.width / 2;
      nodes.push({ id: node.id, text: node.text, ...size, x, y, depth, side });
      links.push({ from: parentId, to: node.id, side });
      const nextX = side === "right" ? x + size.width / 2 + H_GAP : x - size.width / 2 - H_GAP;
      placeGroup(node.children || [], side, nextX, y, node.id, depth + 1);
      cursor += block + V_GAP;
    }
  }

  return { nodes, links };
}

function subtreeHeight(node) {
  const kids = Array.isArray(node.children) ? node.children : [];
  const self = measure(node.text, false).height;
  if (!kids.length) return self;
  return Math.max(self, kids.reduce((sum, child) => sum + subtreeHeight(child), 0) + V_GAP * (kids.length - 1));
}

function measure(text, isRoot) {
  const length = String(text || "主题").length;
  return {
    width: Math.min(isRoot ? 320 : 240, Math.max(isRoot ? 96 : 76, length * (isRoot ? 16 : 14) + 28)),
    height: isRoot ? 46 : 34,
  };
}

function curve(from, to) {
  const startX = from.x + from.width / 2;
  const endX = to.x - to.width / 2;
  const midX = (startX + endX) / 2;
  return `M ${startX} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${endX} ${to.y}`;
}

function hitNode(clientX, clientY, nodes) {
  const x = (clientX - state.tx) / state.scale;
  const y = (clientY - state.ty) / state.scale;
  return [...nodes].reverse().find((node) => (
    x >= node.x - node.width / 2
    && x <= node.x + node.width / 2
    && y >= node.y - node.height / 2
    && y <= node.y + node.height / 2
  )) || null;
}

function canDropOn(dragId, targetId) {
  if (!dragId || !targetId || dragId === targetId || dragId === "root") return false;
  const dragged = findNode(state.entry.mindmap, dragId);
  return Boolean(dragged && targetId !== dragId && !findNode(dragged, targetId));
}

function attachNode(dragId, targetId) {
  if (!canDropOn(dragId, targetId)) return;
  const moved = detachNode(state.entry.mindmap, dragId);
  const target = findNode(state.entry.mindmap, targetId);
  if (!moved || !target) return;
  target.children = target.children || [];
  target.children.push(moved);
  state.selectedId = moved.id;
  markDirty();
}

function detachNode(node, id) {
  const children = node.children || [];
  const index = children.findIndex((child) => child.id === id);
  if (index >= 0) return children.splice(index, 1)[0];
  for (const child of children) {
    const found = detachNode(child, id);
    if (found) return found;
  }
  return null;
}

function topicColors(root) {
  const map = new Map();
  (root.children || []).forEach((child, index) => map.set(child.id, COLORS[index % COLORS.length]));
  return map;
}

function firstTopicId(root, id) {
  if (id === root.id) return root.id;
  for (const child of root.children || []) {
    if (child.id === id || findNode(child, id)) return child.id;
  }
  return id;
}

function nodeBounds(nodes) {
  if (!nodes.length) return { x: -200, y: -120, width: 400, height: 240 };
  const left = Math.min(...nodes.map((item) => item.x - item.width / 2));
  const right = Math.max(...nodes.map((item) => item.x + item.width / 2));
  const top = Math.min(...nodes.map((item) => item.y - item.height / 2));
  const bottom = Math.max(...nodes.map((item) => item.y + item.height / 2));
  return { x: left, y: top, width: right - left, height: bottom - top };
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

function findParent(node, id) {
  for (const child of node.children || []) {
    if (child.id === id) return node;
    const found = findParent(child, id);
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
