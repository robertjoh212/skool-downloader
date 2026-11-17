import test from 'node:test';import assert from 'node:assert/strict';import fs from 'fs-extra';import path from 'node:path';import {courseStats} from '../src/regenerate-group-index.js';import {regenerateIndex} from '../src/regenerate-index.js';
import {videoCheckSummary} from '../src/regenerate-group-index.js';
test('cards name missing videos without counting text lessons or existing rejected videos as missing',async()=>{
 await fs.ensureDir('.test-output');const root=await fs.mkdtemp(path.resolve('.test-output/missing-'));
 for(const name of ['missing','text','mismatch']){const dir=path.join(root,name);await fs.ensureDir(dir);await fs.writeJson(path.join(dir,'lesson.json'),{title:name,videoLink:name==='text'?undefined:'https://example.com/video',hasVideo:false});}
 await fs.writeFile(path.join(root,'mismatch/video.mp4'),'fixture');await fs.writeJson(path.join(root,'mismatch/video.mp4.retry.json'),{});
 let stats=await courseStats(root);assert.equal(stats.missingVideos,1);assert.deepEqual(stats.missingVideoLessons,['missing']);assert.match(videoCheckSummary(stats),/1 missing video download: missing/);assert.equal(stats.retries,1);
 await fs.writeFile(path.join(root,'missing/video.mp4'),'recovered');stats=await courseStats(root);assert.equal(stats.missingVideos,0);assert.doesNotMatch(videoCheckSummary(stats),/missing video download/);
});
test('card distinguishes missing source duration, failed validation, pending validation and confirmed mismatch',async()=>{
 await fs.ensureDir('.test-output');const root=await fs.mkdtemp(path.resolve('.test-output/stats-'));
 for(const name of ['passed','unavailable','failed','pending','mismatch']){const dir=path.join(root,name);await fs.ensureDir(dir);await fs.writeFile(path.join(dir,'video.mp4'),'fixture');if(['passed','unavailable'].includes(name))await fs.writeJson(path.join(dir,'video.mp4.verified.json'),{durationCheck:name});if(name==='failed')await fs.writeJson(path.join(dir,'lesson.json'),{videoError:'decode error'});if(name==='mismatch')await fs.writeJson(path.join(dir,'video.mp4.retry.json'),{reason:'duration-mismatch'});}
 const s=await courseStats(root);assert.equal(s.durationPassed,1);assert.equal(s.durationUnavailable,1);assert.equal(s.validationFailed,1);assert.equal(s.validationPending,1);assert.equal(s.retries,1);
});
test('a faster lesson two download does not make the course start at lesson two',async()=>{
 const root=await fs.mkdtemp(path.resolve('.test-output/order-'));await fs.ensureDir(path.join(root,'2-Second'));await fs.writeFile(path.join(root,'2-Second/index.html'),'<html><body>Second</body></html>');await fs.writeJson(path.join(root,'.lesson-plan.json'),{modules:[{index:1,title:'Lessons',moduleDirName:'',lessons:[{index:1,title:'First',path:'1-First/index.html'},{index:2,title:'Second',path:'2-Second/index.html'}]}]});await regenerateIndex(root,{silent:true});let html=await fs.readFile(path.join(root,'index.html'),'utf8');assert.match(html,/Lesson 1 is pending download/);assert.doesNotMatch(html,/Start course[^<]*Lesson 2/);await fs.ensureDir(path.join(root,'1-First'));await fs.writeFile(path.join(root,'1-First/index.html'),'<html><body>First</body></html>');await regenerateIndex(root,{silent:true});html=await fs.readFile(path.join(root,'index.html'),'utf8');assert.match(html,/Start course[^<]*Lesson 1/);
});
