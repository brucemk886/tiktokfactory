import fs from "node:fs";
import path from "node:path";
import {
  assignAccounts,
  attachAccounts,
  createGroup,
  createProject,
  deleteGroup,
  deleteProject,
  findProjectForModule,
  normalizeStore,
  officialAccountKeys,
  publicState,
  renameProject,
  updateGroup,
  updateProject,
} from "./official-account-group-store.js";

export function createOfficialTikTokAccountGroups({ workDir } = {}) {
  if (!workDir) throw new Error("Official TikTok account groups require a work directory.");
  const storePath = path.join(workDir, "official-tiktok-account-groups.json");

  function getState() {
    return publicState(readStore(storePath));
  }

  function createProjectRecord(name) {
    return persist(createProject(readStore(storePath), name));
  }

  function renameProjectRecord(projectId, name) {
    return persist(renameProject(readStore(storePath), projectId, name));
  }

  function updateProjectRecord(projectId, patch) {
    return persist(updateProject(readStore(storePath), projectId, patch));
  }

  function deleteProjectRecord(projectId) {
    return persist(deleteProject(readStore(storePath), projectId));
  }

  function createGroupRecord(name, options = {}) {
    return persist(createGroup(readStore(storePath), name, options));
  }

  function renameGroup(groupId, name) {
    return persist(updateGroup(readStore(storePath), groupId, { name }));
  }

  function updateGroupRecord(groupId, patch) {
    return persist(updateGroup(readStore(storePath), groupId, patch));
  }

  function deleteGroupRecord(groupId) {
    return persist(deleteGroup(readStore(storePath), groupId));
  }

  function assignAccountRecords(payload) {
    return persist(assignAccounts(readStore(storePath), payload));
  }

  function attach(payload = {}) {
    return attachAccounts(payload, readStore(storePath));
  }

  function persist(store) {
    writeStore(storePath, store);
    return publicState(store);
  }

  return {
    getState,
    createProject: createProjectRecord,
    renameProject: renameProjectRecord,
    updateProject: updateProjectRecord,
    deleteProject: deleteProjectRecord,
    createGroup: createGroupRecord,
    renameGroup,
    updateGroup: updateGroupRecord,
    deleteGroup: deleteGroupRecord,
    assignAccounts: assignAccountRecords,
    attach,
    findProjectForModule: (moduleKey) => findProjectForModule(readStore(storePath), moduleKey),
  };
}

export { officialAccountKeys };

function readStore(filePath) {
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return normalizeStore({});
  }
}

function writeStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizeStore(store), null, 2), "utf8");
}
