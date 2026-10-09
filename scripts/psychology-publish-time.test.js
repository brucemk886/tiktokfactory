import test from 'node:test';
import assert from 'node:assert/strict';
import {publishScheduleError,formatPublishTime,localPublishInput} from '../public/psychology-publish-time.js';
import {normalizeSelectedPublish} from '../factory-cloud/src/psychology-video-library.js';
const zone='Asia/Taipei',at=value=>Date.parse('2026-10-09T'+value+'+08:00');
const selected=Math.floor(at('14:06:00')/1000);
const input=times=>({requestId:'11111111-1111-4111-8111-111111111111',tiktokOne:{connectionId:'brand',accountId:'1',campaignId:'7693454687705595917'},items:times.map((scheduleAt,i)=>({assetId:'asset-'+i,connectionId:'a',caption:'Saved',isAiGenerated:true,scheduleAt}))});
test('14:06 is valid at 14:00, but at 14:01:20 the error explains seconds and the next selectable minute',()=>{
 assert.equal(publishScheduleError([selected],at('14:00:00'),zone),'');
 assert.equal(publishScheduleError([selected],at('14:01:00'),zone),'');
 const error=publishScheduleError([selected],at('14:01:20'),zone);
 for(const text of ['2026-10-09 14:06:00','2026-10-09 14:01:20','2026-10-09 14:07:00','不足 5 分钟','Asia/Taipei'])assert.ok(error.includes(text));
});
test('every item must fit the time window, including final per-account intervals',()=>{
 const now=at('14:00:00'),first=Math.floor(now/1000)+600,last=Math.floor(now/1000)+14*86400;
 assert.equal(publishScheduleError([first,last],now,zone),'');
 assert.match(publishScheduleError([first,last+1],now,zone),/第 2 条.*超出未来 14 天.*缩短同账号间隔/);
 for(const invalid of [NaN,Infinity,0,1.2,'1900000000',undefined])assert.match(publishScheduleError([invalid],now,zone),/时间无效/);
});
test('server validates new schedules with explicit UTC+8 times and preserves old batch replay',()=>{
 const body=input([selected]);assert.equal(normalizeSelectedPublish(body,at('14:00:00')).items[0].scheduleAt,selected);
 assert.throws(()=>normalizeSelectedPublish(body,at('14:01:20')),/14:06:00.*14:01:20.*14:07:00.*Asia\/Taipei/);
 assert.equal(normalizeSelectedPublish(body,at('20:00:00'),true).items[0].scheduleAt,selected);
 assert.throws(()=>normalizeSelectedPublish(input([NaN]),at('20:00:00'),true),/发布时间无效/);
});
test('time formatting is explicitly 24-hour and datetime-local roundtrips the device time zone',()=>{
 assert.equal(formatPublishTime(selected,zone),'2026-10-09 14:06:00');
 const stamp=at('14:06:00');assert.equal(new Date(localPublishInput(stamp)).getTime(),stamp);
});
