import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIME_ZONE, PACIFIC_TIME_ZONE as PT, zonedDate, zonedEpoch, nextDay, addZonedDays, calendarDayIndex, pilotTimeZoneAt } from './psychology-schedule-time.js';
const iso = ms => new Date(ms).toISOString();
test('Pacific three rounds retain local date across two Beijing dates', () => {
  const times = [[8,0],[11,30],[20,0]].map(([h,m]) => zonedEpoch('2026-10-02',h,m,PT));
  assert.deepEqual(times.map(iso), ['2026-10-02T15:00:00.000Z','2026-10-02T18:30:00.000Z','2026-10-03T03:00:00.000Z']);
  assert.deepEqual(times.map(t => zonedDate(t,PT)), Array(3).fill('2026-10-02'));
  assert.deepEqual(times.map(t => zonedDate(t,DEFAULT_TIME_ZONE)), ['2026-10-02','2026-10-03','2026-10-03']);
});
test('Pacific winter conversion moves Beijing clock by one hour', () => {
  assert.equal(iso(zonedEpoch('2026-11-02',8,0,PT)), '2026-11-02T16:00:00.000Z');
  assert.equal(iso(zonedEpoch('2026-11-02',11,30,PT)), '2026-11-02T19:30:00.000Z');
  assert.equal(iso(zonedEpoch('2026-11-02',20,0,PT)), '2026-11-03T04:00:00.000Z');
});
test('DST operating days can be 23 or 25 hours without duplicated rounds', () => {
  const spring = zonedEpoch('2026-03-08',0,0,PT), fall = zonedEpoch('2026-11-01',0,0,PT);
  assert.equal((nextDay(spring,PT)-spring)/3600000,23);
  assert.equal((nextDay(fall,PT)-fall)/3600000,25);
  assert.throws(() => zonedEpoch('2026-03-08',2,30,PT), /夏令时/);
  assert.equal(iso(zonedEpoch('2026-11-01',1,30,PT)), '2026-11-01T08:30:00.000Z');
});
test('calendar review and seven-day cycles remain midnight through DST', () => {
  for (const [date,hours] of [['2026-03-06',167],['2026-10-30',169]]) {
    const start = zonedEpoch(date,0,0,PT), end = addZonedDays(start,7,PT);
    assert.equal((end-start)/3600000,hours);
    assert.equal(calendarDayIndex(end,start,PT),7);
    assert.equal(iso(addZonedDays(start,3,PT)).slice(11,13), date.includes('03-')?'07':'08');
  }
});
test('old Shanghai schedules and exact transition instant remain compatible', () => {
  assert.equal(iso(zonedEpoch('2026-10-02',8)), '2026-10-02T00:00:00.000Z');
  const boundary=zonedEpoch('2026-10-02',0,0,PT);
  const p={schedule_timezone:DEFAULT_TIME_ZONE,pending_schedule_timezone:PT,slots_effective_at:boundary};
  assert.equal(pilotTimeZoneAt(p,boundary-1),DEFAULT_TIME_ZONE);
  assert.equal(pilotTimeZoneAt(p,boundary),PT);
  assert.equal(pilotTimeZoneAt({},boundary),DEFAULT_TIME_ZONE);
});
