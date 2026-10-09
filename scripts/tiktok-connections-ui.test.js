import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { pageFileFor } from "../factory-cloud/src/pages.js";
import { canAccessPath, moduleIdForPath } from "../factory-cloud/src/sidebar.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, "public", name), "utf8");

test("authorized account list is a view page with 20-account pagination", () => {
  const html = read("tiktok-connections.html");
  const script = read("tiktok-connections.js");
  assert.match(html, /data-connections-page="view"/);
  assert.match(html, /href="\/tiktok-connections-organize"/);
  assert.match(html, /项目分组管理/);
  assert.match(html, /id="accountPager"/);
  assert.doesNotMatch(html,/id="rename(?:Dialog|ProjectBtn|GroupBtn)"/);
  assert.match(html, /id="assignGroupBtn"/);
  assert.match(html, /id="selectVisibleBtn"/);
  assert.match(html, /id="moveGroupToProjectBtn"/);
  assert.match(html, /data-workspace-tab="groups"/);
  assert.match(html, /data-workspace-tab="projects"/);
  assert.match(html, /id="groupsPane"/);
  assert.match(html, /id="projectsPane"/);
  assert.match(html, /id="groupList"/);
  assert.match(html, /id="projectsPane"[^>]*hidden/);
  const groupsChunk = html.split('id="projectsPane"')[0];
  const projectsChunk = html.split('id="projectsPane"')[1] || "";
  assert.match(groupsChunk, /id="assignGroupBtn"/);
  assert.doesNotMatch(groupsChunk, /id="moveGroupToProjectBtn"/);
  assert.match(projectsChunk, /id="moveGroupToProjectBtn"/);
  assert.doesNotMatch(projectsChunk, /id="assignGroupBtn"/);
  assert.doesNotMatch(html, /id="createProjectBtn"/);
  assert.doesNotMatch(html, /id="createGroupBtn"/);
  assert.doesNotMatch(html, /id="newProjectName"/);
  assert.match(script, /const PAGE_SIZE = 20/);
  assert.match(script, /canSelectAccounts/);
  assert.match(script, /account-check/);
  assert.match(script, /function renderGroups/);
  assert.match(script, /function moveSelectedGroups/);
  assert.match(script, /setWorkspaceTab\("groups"\)/);
});

test("creating projects and groups happens on a separate organize page", () => {
  const html = read("tiktok-connections-organize.html");
  const access = read("access.js");
  assert.match(html, /data-connections-page="organize"/);
  assert.match(html, /<h1>项目分组管理<\/h1>/);
  assert.match(html, /id="createProjectBtn"/);
  for(const id of ["renameProjectBtn","renameGroupBtn","renameDialog","renameForm"])assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /id="createGroupBtn"/);
  assert.match(html, /id="deleteProjectSelect"/);
  assert.match(html, /id="deleteGroupSelect"/);
  assert.match(html, /href="\/tiktok-connections"/);
  assert.doesNotMatch(html, /<h3>移动账号<\/h3>/);
  assert.doesNotMatch(html, /id="assignGroupBtn"/);
  assert.doesNotMatch(html, /id="accountList"/);
  assert.doesNotMatch(html, /id="accountPager"/);
  assert.equal(pageFileFor("/tiktok-connections-organize"), "tiktok-connections-organize.html");
  assert.equal(moduleIdForPath("/tiktok-connections-organize"), "tiktok-connections");
  assert.equal(canAccessPath({ role: "admin", sidebarModules: ["tiktok-connections"] }, "/tiktok-connections-organize"), true);
  assert.match(access, /tiktok-connections-organize/);
});

test('renaming projects and groups keeps module scopes, memberships and account IDs stable',async()=>{
  const {ensureModuleProjects,updateProject,updateGroup,scopeOfficialAccess}=await import('./official-account-group-store.js');
  const before=ensureModuleProjects({projects:[{id:'proj-psych',name:'心理学',moduleKey:'psychology'}],groups:[{id:'group-a',name:'旧分组',projectId:'proj-psych'}],assignments:{account1:'group-a'}});
  const renamed=ensureModuleProjects(updateGroup(updateProject(before,'proj-psych',{name:'新的项目名称'}),'group-a',{name:'新的分组名称'}));
  assert.deepEqual(renamed.assignments,before.assignments);assert.deepEqual(renamed.projects.map(p=>p.id),before.projects.map(p=>p.id));
  assert.equal(renamed.groups[0].projectId,'proj-psych');assert.equal(renamed.projects.find(p=>p.id==='proj-psych').moduleKey,'psychology');
  const scoped=scopeOfficialAccess({accounts:[{connectionId:'account1'}]},renamed,{role:'admin'},'psychology');
  assert.equal(scoped.accounts.length,1);assert.equal(scoped.accounts[0].groupName,'新的分组名称');assert.equal(scoped.accounts[0].projectName,'新的项目名称');
  assert.throws(()=>updateGroup(renamed,'group-a',{name:'  '}),/填写名称/);
});


function groupCountFixture() {
  const select = (value = "") => ({
    value, innerHTML: "", addEventListener() {},
    get options() { return Array.from(this.innerHTML.matchAll(/<option value="([^"]*)">/g), match => ({ value: match[1] })); },
  });
  const nodes = Object.fromEntries(["groupFilter", "assignGroupSelect", "moveGroupSelect", "deleteGroupSelect", "deleteProjectSelect", "accountSearch"].map(id => [`#${id}`, select()]));
  const context = vm.createContext({ document: { body: { dataset: {} }, querySelector: id => nodes[id] || null } });
  const script = read("tiktok-connections.js").replace("await loadSettings();", "").replace("await loadAccounts();", "");
  vm.runInContext(`${script}
globalThis.ui = { state, fillGroupSelects, applyGroupState, pagedAccounts };`, context);
  const { ui } = context;
  ui.state.groups = [
    { id: "g1", name: "一组", projectName: "心理学", projectId: "p1", accountCount: 999 },
    { id: "g2", name: "空组", projectName: "心理学", projectId: "p1", accountCount: 8 },
  ];
  ui.state.accounts = [...Array.from({ length: 25 }, (_, index) => ({ connectionId: `a${index}`, groupId: "g1", profile: { username: `test${index}` } })), { connectionId: "u1" }, { connectionId: "u2", groupId: "" }];
  return { ui, nodes };
}

test("all group selectors count the entire loaded directory, including empty and ungrouped accounts", () => {
  const { ui, nodes } = groupCountFixture();
  nodes["#groupFilter"].value = "g1";
  nodes["#assignGroupSelect"].value = "g2";
  ui.state.page = 2;
  assert.equal(ui.pagedAccounts().accounts.length, 5);
  nodes["#accountSearch"].value = "test24";
  assert.equal(ui.pagedAccounts().total, 1);
  ui.fillGroupSelects();
  for (const id of ["groupFilter", "assignGroupSelect", "moveGroupSelect", "deleteGroupSelect"]) {
    assert.match(nodes[`#${id}`].innerHTML, /心理学 \/ 一组（25 个账号）/);
    assert.match(nodes[`#${id}`].innerHTML, /心理学 \/ 空组（0 个账号）/);
  }
  assert.match(nodes["#groupFilter"].innerHTML, /全部分组（27 个账号）/);
  for (const id of ["groupFilter", "assignGroupSelect"]) assert.match(nodes[`#${id}`].innerHTML, /未分组（2 个账号）/);
  assert.equal(nodes["#groupFilter"].value, "g1");
  assert.equal(nodes["#assignGroupSelect"].value, "g2");
  nodes["#deleteProjectSelect"].value = "another-project";
  ui.fillGroupSelects();
  assert.doesNotMatch(nodes["#deleteGroupSelect"].innerHTML, /一组/);
});

test("moving accounts updates both group counts and ungrouped count without a reload", () => {
  const { ui, nodes } = groupCountFixture();
  const assignments = Object.fromEntries(ui.state.accounts.filter(account => account.groupId).map(account => [account.connectionId, account.groupId]));
  assignments.a0 = "g2";
  ui.applyGroupState({ assignments });
  for (const id of ["groupFilter", "assignGroupSelect"]) {
    assert.match(nodes[`#${id}`].innerHTML, /一组（24 个账号）/);
    assert.match(nodes[`#${id}`].innerHTML, /空组（1 个账号）/);
  }
  delete assignments.a0;
  ui.applyGroupState({ assignments });
  assert.equal(ui.state.accounts[0].groupId, "");
  assert.match(nodes["#assignGroupSelect"].innerHTML, /未分组（3 个账号）/);
  assert.match(nodes["#assignGroupSelect"].innerHTML, /空组（0 个账号）/);
  ui.applyGroupState({ assignments: {} });
  assert.match(nodes["#groupFilter"].innerHTML, /未分组（27 个账号）/);
  assert.match(nodes["#groupFilter"].innerHTML, /一组（0 个账号）/);
});

test("group metadata refresh preserves assignments when the response omits the assignment map", () => {
  const { ui, nodes } = groupCountFixture();
  ui.applyGroupState({ groups: ui.state.groups.map(group => ({ ...group, name: `${group.name}改名` })) });
  assert.equal(ui.state.accounts[0].groupId, "g1");
  assert.match(nodes["#assignGroupSelect"].innerHTML, /一组改名（25 个账号）/);
});
