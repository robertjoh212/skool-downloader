import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {buildSearch,timestampHref,formatTime,trustedScripts} from '../src/transcription.js';
import {safeDocument} from '../src/archive-safety.js';

test('timestamp links preserve folder names and reject invalid times',()=>{
 assert.equal(timestampHref(path.join('1-Module','2-Lesson name','index.html'),123.456),'1-Module/2-Lesson%20name/index.html#t=123.456');
 assert.equal(formatTime(3723),'01:02:03');
 assert.throws(()=>timestampHref('index.html',NaN));
 assert.throws(()=>trustedScripts('<body></body>',['https://example.com/x.js']));
});
test('search and readable transcripts are rebuilt safely without duplicate sections',async()=>{
 await fs.ensureDir('.test-output');
 const root=await fs.mkdtemp(path.resolve('.test-output/search-'));
 const dir=path.join(root,'1-Module','2-Getting leads');
 await fs.ensureDir(dir);
 await fs.writeJson(path.join(root,'.course.json'),{courseName:'Course <script>alert(1)</script>'});
 await fs.writeFile(path.join(root,'index.html'),'<html><head></head><body><div class="page">Course</div></body></html>');
 await fs.writeFile(path.join(dir,'index.html'),safeDocument('<html><head></head><body><video controls src="video.mp4"></video><div class="nav">Back</div></body></html>'));
 await fs.writeFile(path.join(dir,'video.mp4'),'fixture');
 await fs.writeJson(path.join(dir,'transcript.json'),{complete:true,title:'Getting leads',segments:[{start:10,end:14,text:'Use paid ads for qualified leads.'},{start:14,end:18,text:'</script><img src=x onerror=alert(1)>'}]});
 const result=await buildSearch(root);
 assert.deepEqual(result,{videos:1,transcripts:1,passages:2});
 await buildSearch(root);
 const html=await fs.readFile(path.join(dir,'index.html'),'utf8');
 assert.equal((html.match(/<!-- transcript-start -->/g)||[]).length,1);
 assert.equal((html.match(/<script src="archive-player.js">/g)||[]).length,1);
 assert.match(html,/#t=10.000/);
 assert.doesNotMatch(html,/<img src=x onerror/);
 const page=await fs.readFile(path.join(root,'search.html'),'utf8');
 assert.match(page,/<input[^>]+id="query"/);
 assert.match(page,/<form[^>]+id="search-form"/);
 assert.match(page,/<script src="archive-search.js"><\/script>/);
 assert.doesNotMatch(page,/<script>alert/);
 const data=await fs.readFile(path.join(root,'archive-search-data.js'),'utf8');
 assert.doesNotMatch(data,/<\/script>/);
 assert.match(data,/\\u003c/);
 const index=await fs.readFile(path.join(root,'index.html'),'utf8');
 assert.equal((index.match(/<!-- search-link -->/g)||[]).length,1);
});

test('linked resource videos receive playable search targets',async()=>{
 const root=await fs.mkdtemp(path.resolve('.test-output/linked-'));
 const resource=path.join(root,'Lesson','resources');
 const dest=path.join(resource,'transcripts','video1');
 await fs.ensureDir(dest);
 await fs.writeFile(path.join(resource,'linked.mp4'),'fixture');
 await fs.writeJson(path.join(dest,'transcript.json'),{complete:true,title:'Linked training',media_path:path.join('..','..','linked.mp4'),segments:[{start:4,end:6,text:'A linked resource topic'}]});
 assert.deepEqual(await buildSearch(root),{videos:1,transcripts:1,passages:1});
 const page=await fs.readFile(path.join(dest,'index.html'),'utf8');
 assert.match(page,/<video[^>]+src="..\/..\/linked.mp4"/);
 assert.match(page,/#t=4.000/);
});
