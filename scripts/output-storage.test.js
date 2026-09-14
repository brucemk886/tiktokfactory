import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {outputDay,dailyOutputDirectory,resolveStoredOutput,isStoredOutputPath} from './output-storage.js';
import {missingOfficialPublishFiles} from './auto-task-manager.js';
test('daily folders change at midnight in Shanghai',()=>{
 assert.equal(outputDay(new Date('2026-09-06T15:59:59Z')),'2026-09-06');
 assert.equal(outputDay(new Date('2026-09-06T16:00:00Z')),'2026-09-07');
});
test('daily outputs and explicitly registered old files are found by their existing filenames',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'daily-outputs-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=path.join(base,'new'),old=path.join(base,'old');fs.mkdirSync(old,{recursive:true});
 const today=dailyOutputDirectory(root,new Date('2026-09-06T10:00:00Z'));fs.mkdirSync(today,{recursive:true});
 const output=path.join(today,'new.mp4');fs.writeFileSync(output,Buffer.alloc(2048));
 fs.writeFileSync(path.join(old,'old.mp4'),Buffer.alloc(2048));
 fs.writeFileSync(path.join(root,'.output-storage.json'),JSON.stringify({legacyRoots:[old]}));
 assert.equal(resolveStoredOutput(root,'new.mp4'),output);
 assert.equal(resolveStoredOutput(root,'old.mp4'),path.join(old,'old.mp4'));
 assert.equal(isStoredOutputPath(root,output),true);
 assert.equal(isStoredOutputPath(root,path.join(old,'old.mp4')),true);
 assert.deepEqual(missingOfficialPublishFiles({outputDir:root,videos:[{fileName:'new.mp4'},{fileName:'old.mp4'}]}),[]);
 assert.deepEqual(missingOfficialPublishFiles({outputDir:root,videos:[{fileName:'missing.mp4'}]}),['missing.mp4']);
 assert.throws(()=>resolveStoredOutput(root,'../escape.mp4'),/无效/);
 assert.equal(isStoredOutputPath(root,path.join(base,'escape.mp4')),false);
});
