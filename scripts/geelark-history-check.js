import path from "node:path";
import { readConfig } from "./video-core.js";
import { createGeeLarkClient } from "./geelark-client.js";

const root = process.cwd();
const config = readConfig(root);
const client = createGeeLarkClient(config);

const size = Number(process.argv[2] || 100);
const data = await client.post("/open/v1/task/historyRecords", { size });
const items = Array.isArray(data?.items) ? data.items : [];

console.log(JSON.stringify({
  total: data?.total ?? items.length,
  count: items.length,
  items: items.map((item) => ({
    id: item.id,
    planName: item.planName,
    taskType: item.taskType,
    serialName: item.serialName,
    envId: item.envId,
    scheduleAt: item.scheduleAt,
    status: item.status,
    failCode: item.failCode,
    failDesc: item.failDesc
  }))
}, null, 2));
