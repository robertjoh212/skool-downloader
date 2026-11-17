import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {buildSearch} from '../src/transcription.js';
import {regenerateGroupIndex} from '../src/regenerate-group-index.js';
import {safeDocument} from '../src/archive-safety.js';
test('library search spans courses without changing their players, and checklist never completes mismatches',async()=>{
 await fs.ensureDir('.test-output');const root=await fs.mkdtemp(path.resolve('.test-output/library-'));
 const courses=[{id:'one',title:'First course',status:'complete'},{id:'two',title:'Second course',status:'complete'}];
 await fs.writeJson(path.join(root,'.library-state.json'),{title:'Test library',courses});
 for(const course of courses){
  const folder=path.join(root,course.id),lesson=path.join(folder,'1-Lesson');
  await fs.ensureDir(lesson);await fs.writeJson(path.join(folder,'.course.json'),{courseName:course.title});
  await fs.writeJson(path.join(lesson,'lesson.json'),{title:'Training',status:'complete'});
  await fs.writeFile(path.join(lesson,'video.mp4'),'synthetic');
  await fs.writeJson(path.join(lesson,'video.mp4.verified.json'),{durationCheck:'passed'});
  await fs.writeFile(path.join(lesson,'index.html'),safeDocument('<html><head></head><body><video src="video.mp4" controls></video><div class="nav"></div></body></html>'));
  await fs.writeJson(path.join(lesson,'transcript.json'),{complete:true,title:'Training',segments:[{start:8,end:12,text:'Find the onboarding topic'}]});
  await buildSearch(folder);
 }
 const firstPage=path.join(root,'one','1-Lesson','index.html');const before=await fs.readFile(firstPage,'utf8');
 const result=await buildSearch(root);assert.equal(result.transcripts,2);
 assert.equal(await fs.readFile(firstPage,'utf8'),before);
 const data=await fs.readFile(path.join(root,'archive-search-data.js'),'utf8');
 assert.match(data,/First course \/ Training/);assert.match(data,/Second course \/ Training/);assert.match(data,/one\/1-Lesson\/index.html/);
 await fs.writeJson(path.join(root,'two','1-Lesson','video.mp4.retry.json'),{reason:'duration-mismatch'});
 await regenerateGroupIndex(root,{silent:true});
 const progress=await fs.readJson(path.join(root,'library-progress.json'));
 assert.equal(progress.total.complete,1);assert.equal(progress.courses[1].status,'retry');
 const html=await fs.readFile(path.join(root,'index.html'),'utf8');
 assert.match(html,/library-client.js/);assert.match(html,/connect-src 'self'/);assert.match(html,/Search all courses/);
 assert.equal((await buildSearch(root)).transcripts,1);
});
