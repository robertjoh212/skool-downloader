import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
await fs.ensureDir(path.resolve('.test-output'));
const root=await fs.mkdtemp(path.resolve('.test-output/run-'));
process.env.SKOOL_DOWNLOADER_CACHE_DIR=path.join(root,'tools');
const {cleanLessonHtml,safeDocument,localizeCourseLinks,extractContentUrls}=await import('../src/archive-safety.js');
const {validateVideo}=await import('../src/video-validation.js');
const {Downloader,resolveFfmpegPath}=await import('../src/downloader.js');
const {Scraper}=await import('../src/scraper.js');
const {downloadCourse}=await import('../src/index.js');
const quiet={info(){},warn(){},error(){}};
await fs.ensureDir(root);
const ffmpeg=await resolveFfmpegPath();
const clip=path.join(root,'fixture.mp4');
execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=blue:s=320x180:d=1','-c:v','libx264','-pix_fmt','yuv420p',clip],{windowsHide:true});
const server=http.createServer((req,res)=>{
 if(req.url==='/clip.mp4'){res.writeHead(200,{'content-type':'video/mp4'});fs.createReadStream(clip).pipe(res);}
 else if(req.url==='/image.png'){res.writeHead(200,{'content-type':'image/png'});res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7v0AAAAASUVORK5CYII=','base64'));}
 else {res.writeHead(404);res.end();}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+(server.address() as any).port;

test.after(()=>server.close());
test('unsafe lesson HTML and active document markup are removed',()=>{
 const output=safeDocument('<html><head><title>Test</title><style>body{color:black}</style></head><body>'+cleanLessonHtml('<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><p>Kept</p>')+'</body></html>');
 assert.doesNotMatch(output,/<script|onerror=|href="javascript:/);
 assert.match(output,/Content-Security-Policy/);
 assert.match(output,/<p>Kept<\/p>/);
 assert.match(output,/<style>body/);
});
test('damaged videos are rejected, including a changed file after validation',async()=>{
 const file=path.join(root,'integrity.mp4');
 await fs.copy(clip,file); await validateVideo(file,ffmpeg);
 await fs.writeFile(file,'not a video');
 await assert.rejects(validateVideo(file,ffmpeg),/validation failed/);
});
test('images are rewritten only on success and failed images are reported',async()=>{
 const errors:string[]=[];
 const dl=new Downloader(quiet);
 const html=await dl.localizeImages('<img src="'+base+'/image.png"><img src="'+base+'/missing.png">',path.join(root,'images'),e=>errors.push(e));
 assert.match(html,/src="assets\/img_/);
 assert.ok(html.includes(base+'/missing.png'));
 assert.equal(errors.length,1);
});
test('saved lesson links become local while unsaved targets remain explicit online links',async()=>{
 const dir=path.join(root,'link-fixture');
 for(const [id,title] of [['one','First'],['two','Second']]) {
   await fs.ensureDir(path.join(dir,id));
   await fs.writeJson(path.join(dir,id,'lesson.json'),{lessonUrl:'https://www.skool.com/demo/classroom/abc?md='+id});
   await fs.writeFile(path.join(dir,id,'index.html'),'<a href="https://www.skool.com/demo/classroom/abc?md=two&amp;utm_source=test">Second</a><a href="https://example.com/">External</a>');
 }
 await localizeCourseLinks(dir);
 const html=await fs.readFile(path.join(dir,'one','index.html'),'utf8');
 assert.match(html,/href="\.\.\/two\/index.html"/);
 assert.match(html,/https:\/\/example.com/);
});
test('real video download, validation and repeat-run recovery',async()=>{
 const dl=new Downloader(quiet);
 const dir=path.join(root,'actual-download');
 await fs.ensureDir(dir);
 await fs.writeFile(path.join(dir,'video.mp4'),'broken prior download');
 await dl.downloadVideo(base+'/clip.mp4',dir,'video');
 await validateVideo(path.join(dir,'video.mp4'),ffmpeg);
 assert.ok((await fs.readdir(dir)).some(f=>f.startsWith('video.mp4.invalid-')));
 const before=(await fs.stat(path.join(dir,'video.mp4'))).mtimeMs;
 await dl.downloadVideo(base+'/clip.mp4',dir,'video');
 assert.equal((await fs.stat(path.join(dir,'video.mp4'))).mtimeMs,before);
});
test('course pipeline reports missing media, renders warnings, and recovers on retry',async()=>{
 const originalParse=Scraper.prototype.parseClassroom;
 const originalExtract=Scraper.prototype.extractLessonData;
 let fail=true;
 const url='https://www.skool.com/demo/classroom/abc';
 Scraper.prototype.parseClassroom=async()=>({groupName:'Archive Demo',courseName:'Test Course',modules:[{title:'Getting started',index:1,lessons:[{id:'one',index:1,title:'Welcome',url:url+'?md=one'},{id:'two',index:2,title:'Second lesson',url:url+'?md=two'}]}]});
 Scraper.prototype.extractLessonData=async(input:string)=>({id:input.endsWith('one')?'one':'two',title:input.endsWith('one')?'Welcome':'Second lesson',url:input,videoLink:input.endsWith('one')?(fail?base+'/missing.mp4':base+'/clip.mp4'):undefined,contentHtml:'<p>Offline archive test.</p><a href="'+url+'?md=two">Next lesson</a>',resources:[]});
 const dir=path.join(root,'preview','Archive Demo','Test Course');
 try {
  let summary=await downloadCourse({url,outputDir:dir,concurrency:1,logger:quiet});
  assert.equal(summary.failedLessons,1);assert.equal(summary.completedLessons,1);
  let html=await fs.readFile(path.join(dir,'1-Getting started','1-Welcome','index.html'),'utf8');
  assert.match(html,/Archive incomplete/);
  assert.match(html,/\.\.\/2-Second%20lesson\/index.html/);
  fail=false;
  summary=await downloadCourse({url,outputDir:dir,concurrency:1,logger:quiet});
  assert.equal(summary.failedLessons,0);assert.equal(summary.completedLessons,2);
  html=await fs.readFile(path.join(dir,'1-Getting started','1-Welcome','index.html'),'utf8');
  assert.doesNotMatch(html,/Archive incomplete/);
  assert.match(html,/<video controls src="video.mp4"><\/video>/);
 } finally {Scraper.prototype.parseClassroom=originalParse;Scraper.prototype.extractLessonData=originalExtract;}
});

test('pasted document URLs and HTML links are collected without duplicate downloads',()=>{
 const url='https://docs.google.com/document/d/example/edit?usp=sharing';
 const links=extractContentUrls('<p>'+url+'</p><a href="'+url+'">Document</a>');
 assert.deepEqual(links,[{url,title:url}]);
 assert.deepEqual(extractContentUrls('<p>No links</p>'),[]);
});
