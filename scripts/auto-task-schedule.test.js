import assert from "node:assert/strict";
import { buildSchedulePlan, resolveDailyPlannedLimit, validateScheduleCapacity } from "./auto-task-manager.js";
import { scheduleDateKey } from "./schedule-date.js";

// 2030-01-01 23:50 Asia/Shanghai; the next 15-minute slot lands on 01-02.
const start = new Date("2030-01-01T15:50:00Z");
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

assert.equal(plan[0].date, "2030-01-01");
assert.equal(plan[1].date, "2030-01-02");
// Day boundary follows Asia/Shanghai regardless of the machine's zone.
assert.equal(scheduleDateKey(Math.floor(Date.UTC(2030, 0, 1, 16, 0, 0) / 1000)), "2030-01-02");
assert.equal(scheduleDateKey(Math.floor(Date.UTC(2030, 0, 1, 15, 59, 59) / 1000)), "2030-01-01");

// Capacity counts publishes that went out (done tasks with submitted results)
// plus the plans of tasks still queued or running.
const existing = [{
  id: "existing",
  status: "done",
  publish: { autoPublish: true },
  publishResults: Array.from({ length: 250 }, () => ({ status: "submitted", scheduleAt: Math.floor(start.getTime() / 1000) }))
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

assert.doesNotThrow(() => validateScheduleCapacity({
  plan: [{ date: plan[0].date, count: 2750 }],
  tasks: existing,
  dailyLimit: 3000
}));

const queued = {
  id: "queued",
  status: "queued",
  publish: { autoPublish: true },
  schedulePlan: [{ date: plan[0].date, count: 40, times: [] }],
  publishResults: []
};
assert.doesNotThrow(() => validateScheduleCapacity({
  plan: [{ date: plan[0].date, count: 10 }],
  tasks: [...existing, queued],
  dailyLimit: 300
}));
assert.throws(() => validateScheduleCapacity({
  plan: [{ date: plan[0].date, count: 11 }],
  tasks: [...existing, queued],
  dailyLimit: 300
}), /已发布或已排期 290 条/);
// The task being resumed does not reserve against itself.
assert.doesNotThrow(() => validateScheduleCapacity({
  plan: [{ date: plan[0].date, count: 50 }],
  tasks: [...existing, queued],
  dailyLimit: 300,
  excludeTaskId: "queued"
}));
// Paused, failed or soft-deleted tasks hold no slots.
assert.doesNotThrow(() => validateScheduleCapacity({
  plan: [{ date: plan[0].date, count: 50 }],
  tasks: [...existing, { ...queued, status: "paused" }, { ...queued, id: "gone", deleted: 1 }],
  dailyLimit: 300
}));

assert.equal(resolveDailyPlannedLimit(undefined), 300);
assert.equal(resolveDailyPlannedLimit("3000"), 3000);
assert.equal(resolveDailyPlannedLimit(0), 300);
assert.equal(resolveDailyPlannedLimit(10_000_000), 100_000);

console.log("auto-task schedule planning test passed");

function localDate(date) {
  return scheduleDateKey(Math.floor(date.getTime() / 1000));
}
