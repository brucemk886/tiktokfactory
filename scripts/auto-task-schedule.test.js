import assert from "node:assert/strict";
import { buildSchedulePlan, validateScheduleCapacity } from "./auto-task-manager.js";

const start = new Date(2030, 0, 1, 23, 50, 0, 0);
const plan = buildSchedulePlan({
  videoCount: 10,
  envIds: ["a", "b", "c", "d", "e"],
  scheduleAt: Math.floor(start.getTime() / 1000),
  intervalMinutes: 15
});

assert.deepEqual(plan, [
  { date: localDate(start), count: 5, times: [{ scheduleAt: Math.floor(start.getTime() / 1000), count: 5 }] },
  { date: localDate(new Date(start.getTime() + 15 * 60 * 1000)), count: 5, times: [{ scheduleAt: Math.floor(start.getTime() / 1000) + 15 * 60, count: 5 }] }
]);

const existing = [{
  id: "existing",
  status: "queued",
  publish: { autoPublish: true },
  schedulePlan: [{ date: plan[0].date, count: 250 }]
}];

assert.doesNotThrow(() => validateScheduleCapacity({
  plan: [{ date: plan[0].date, count: 50 }],
  tasks: existing,
  dailyLimit: 300
}));

assert.throws(() => validateScheduleCapacity({
  plan: [{ date: plan[0].date, count: 51 }],
  tasks: existing,
  dailyLimit: 300
}), /超过每天 300 条上限/);

assert.doesNotThrow(() => validateScheduleCapacity({
  plan: [{ date: plan[1].date, count: 300 }],
  tasks: existing,
  dailyLimit: 300
}));

assert.doesNotThrow(() => validateScheduleCapacity({
  plan: [{ date: plan[0].date, count: 300 }],
  tasks: [{ ...existing[0], status: "failed" }],
  dailyLimit: 300
}));

console.log("auto-task schedule planning test passed");

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
