import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceDayWindow,beijingTime} from '../public/report-time.js';
test('UTC source-day summaries show their true Beijing interval, including month and year boundaries',()=>{
 assert.equal(sourceDayWindow('2026-12-31'),'2026-12-31 08:00 至 2027-01-01 08:00（北京时间）');
 assert.equal(sourceDayWindow('2026-09-25','2026-10-01'),'2026-09-25 08:00 至 2026-10-02 08:00（北京时间）');
 assert.equal(sourceDayWindow(''),'暂无时间范围');
 assert.equal(beijingTime(null),'—');
 assert.match(beijingTime(Date.parse('2026-10-09T16:00:00Z')),/2026.*10.*10.*00:00:00/);
});
