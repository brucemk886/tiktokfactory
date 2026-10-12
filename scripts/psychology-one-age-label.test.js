import test from 'node:test';
import assert from 'node:assert/strict';
import {audienceLabel} from '../public/psychology-one-analysis.js';
import {oneAnalysis} from '../public/psychology-one-analysis-schema.js';
test('One report age enums display official bands while preserving unknown and already-readable labels',()=>{
 const labels=['13–17 岁','18–24 岁','25–34 岁','35–44 岁','45–54 岁','55 岁及以上'];
 labels.forEach((label,i)=>assert.equal(audienceLabel('age',String(i+1)),label));
 for(const code of ['0','7','99'])assert.equal(audienceLabel('age',code),'未知年龄分组（编码 '+code+'）');
 assert.equal(audienceLabel('age','18-24'),'18-24');assert.equal(audienceLabel('age','未知'),'未知');
 assert.equal(audienceLabel('language','2'),'2');assert.equal(audienceLabel('countries','US'),'美国 · US');
});
test('age display mapping keeps original percentages and raw audience keys intact',()=>{
 const rows=[{label:'2',value:.3905},{label:'3',value:.3314},{label:'1',value:.1065},{label:'4',value:.0888},{label:'5',value:.071},{label:'6',value:.0118}];
 const a=oneAnalysis({audience:{age:rows}});assert.deepEqual(a.audience.age,rows);
 const displayed=a.audience.age.map(r=>({...r,label:audienceLabel('age',r.label)}));
 assert.deepEqual(displayed.map(r=>r.value),rows.map(r=>r.value));assert.equal(displayed[0].label,'18–24 岁');assert.equal(displayed[0].value,.3905);
});
