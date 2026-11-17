import fs from 'fs-extra';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {safeDocument,escapeHtml} from './archive-safety.js';

export type TranscriptLesson = {title:string; path:string; segments:Array<{start:number;end:number;text:string}>};
const searchClient="(() => {\nconst data=window.ARCHIVE_TRANSCRIPTS || [];\nconst input=document.getElementById('query'), results=document.getElementById('results'), status=document.getElementById('status');\nconst normalize=s=>s.toLowerCase().normalize('NFKD').replace(/\\p{M}/gu,'');\nconst time=s=>{const n=Math.floor(s);return Math.floor(n/3600).toString().padStart(2,'0')+':'+Math.floor(n%3600/60).toString().padStart(2,'0')+':'+(n%60).toString().padStart(2,'0')};\nfunction search(){\n results.replaceChildren();\n const query=input.value.trim(), normalized=normalize(query);\n if(!query){status.textContent='Search for a topic, keyword, or an exact phrase in quotation marks.';return;}\n const terms=normalized.startsWith('\"')&&normalized.endsWith('\"')?[normalized.slice(1,-1)]:normalized.split(/\\s+/).filter(Boolean);\n if(!terms.length||terms.some(t=>!t)){status.textContent='Enter a word or phrase.';return;}\n const found=[];\n for(const lesson of data){\n  for(let i=0;i<lesson.segments.length;i++){\n   const segment=lesson.segments[i];\n   const passage=segment.text+' '+(lesson.segments[i+1]?.text||'');\n   const searchable=normalize(passage);\n   if(terms.every(t=>searchable.includes(t))){\n    if(found.length && found[found.length-1].lesson===lesson && found[found.length-1].index===i-1)continue;\n    found.push({lesson,index:i,start:segment.start,passage});\n   }\n  }\n }\n status.textContent=found.length+' matching passages'+(found.length>100?' — showing the first 100; add words to narrow the search.':'.');\n for(const hit of found.slice(0,100)){\n  const card=document.createElement('article'),link=document.createElement('a'),p=document.createElement('p');\n  link.href=hit.lesson.path+'#t='+hit.start.toFixed(3);\n  link.textContent=hit.lesson.title+' · '+time(hit.start);\n  p.textContent=hit.passage;card.append(link,p);results.append(card);\n }\n}\ndocument.getElementById('search-form').addEventListener('submit',e=>{e.preventDefault();search()});\ninput.addEventListener('input',search);\ninput.value=new URL(location.href).searchParams.get('q')||'';search();\n})();";
const playerClient="(() => {\nconst video=document.querySelector('video');if(!video)return;\nconst jump=()=>{const match=location.hash.match(/^#t=(\\d+(?:\\.\\d+)?)$/);if(match){const seek=()=>{video.currentTime=Math.min(Number(match[1]),video.duration||Number(match[1]));video.scrollIntoView({block:'center',behavior:'smooth'})};if(video.readyState>=1)seek();else video.addEventListener('loadedmetadata',seek,{once:true});}};\nwindow.addEventListener('hashchange',jump);jump();\n})();";

export function encodePath(value:string):string {return value.split(path.sep).map(encodeURIComponent).join('/');}
export function formatTime(value:number):string {const n=Math.floor(value);return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(v=>String(v).padStart(2,'0')).join(':');}
export function timestampHref(relativePath:string,seconds:number):string {
 if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid timestamp');
 return encodePath(relativePath)+'#t='+seconds.toFixed(3);
}
export function trustedScripts(html:string,scripts:string[]):string {
 for(const script of scripts)if(!/^[a-z0-9-]+\.js$/.test(script))throw new Error('Invalid local script');
 return html.replace(/script-src 'self';\s*/g,'').replace("default-src 'none';","default-src 'none'; script-src 'self';")
 .replace('</body>',scripts.map(script=>'<script src="'+script+'"></script>').join('')+'</body>');
}
export async function buildSearch(courseDir:string):Promise<{videos:number;transcripts:number;passages:number}> {
 const items:TranscriptLesson[]=[];
 let videos=0;
 async function visit(dir:string){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   if(entry.isSymbolicLink())continue;
   const p=path.join(dir,entry.name);
   if(entry.isDirectory()&&!['assets','.auth','.git','node_modules'].includes(entry.name))await visit(p);
   if(entry.isFile()&&entry.name.toLowerCase().endsWith('.mp4'))videos++;
   if(entry.isFile()&&entry.name==='transcript.json'){
    const json=p;
    const transcript=await fs.readJson(json);
    if(!transcript.complete||!Array.isArray(transcript.segments))continue;
    const segments=transcript.segments.filter((s:any)=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&typeof s.text==='string');
    const lesson={title:String(transcript.title||path.basename(dir)),path:encodePath(path.relative(courseDir,path.join(dir,'index.html'))),segments};
    items.push(lesson);
    const lessonPage=path.join(dir,'index.html');
    if(!await fs.pathExists(lessonPage)&&typeof transcript.media_path==='string'){
      const media=path.resolve(dir,transcript.media_path);
      const relative=path.relative(courseDir,media);
      if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Transcript media is outside archive');
      await fs.writeFile(lessonPage,safeDocument('<html><head><meta charset="utf-8"><title>'+escapeHtml(lesson.title)+'</title></head><body><h1>'+escapeHtml(lesson.title)+'</h1><video controls src="'+encodePath(path.relative(dir,media))+'" style="max-width:100%"></video><div class="nav"></div></body></html>'));
    }
    if(await fs.pathExists(lessonPage)){
      let html=await fs.readFile(lessonPage,'utf8');
      html=html.replace(/<!-- transcript-start -->[\s\S]*?<!-- transcript-end -->/g,'').replace(/<script src="archive-player\.js"><\/script>/g,'');
      const searchPath=encodePath(path.relative(dir,path.join(courseDir,'search.html')));
      const section='<!-- transcript-start --><section class="resources"><h3>Video transcript</h3><p><a href="'+searchPath+'">Search all course videos</a> · <a href="transcript.txt">Download text</a> · <a href="transcript.srt">Download subtitles</a></p><details><summary>Read full transcript ('+segments.length+' passages)</summary>'+segments.map((s:any)=>'<p><a href="#t='+s.start.toFixed(3)+'">'+formatTime(s.start)+'</a> '+escapeHtml(s.text)+'</p>').join('')+'</details></section><!-- transcript-end -->';
      html=html.replace('<div class="nav">',section+'<div class="nav">');
      await fs.writeFile(lessonPage,trustedScripts(html,['archive-player.js']));
    }
   }
  }
 }
 await visit(courseDir);
 items.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true}));
 // Player scripts are fixed trusted source, never lesson-provided JavaScript.
 for(const item of items){
  const decoded=item.path.split('/').map(decodeURIComponent).join(path.sep);
  await fs.writeFile(path.join(path.dirname(path.join(courseDir,decoded)),'archive-player.js'),playerClient);
 }
 const encoded=JSON.stringify(items).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 await fs.writeFile(path.join(courseDir,'archive-search-data.js'),'window.ARCHIVE_TRANSCRIPTS='+encoded+';');
 await fs.writeFile(path.join(courseDir,'archive-search.js'),searchClient);
 const title=await fs.readJson(path.join(courseDir,'.course.json')).then(m=>String(m.courseName)).catch(()=>path.basename(courseDir));
 const html=safeDocument('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Search '+escapeHtml(title)+'</title><style>body{font:17px Segoe UI,sans-serif;background:#f3f5fa;color:#172033;margin:0}main{max-width:960px;margin:40px auto;padding:24px}a{color:#2559b5}form{display:flex;gap:12px;margin:20px 0}input{flex:1;min-width:0;padding:14px;font:inherit;border:1px solid #a6b2c8;border-radius:8px}button{padding:14px 24px;font:inherit;background:#2559b5;color:white;border:0;border-radius:8px}article{background:white;border-radius:12px;padding:22px;margin:14px 0}article a{font-weight:700}p{line-height:1.6}.muted{color:#566479}</style></head><body><main><a href="index.html">← Back to course</a><h1>Search course videos</h1><h2>'+escapeHtml(title)+'</h2><p class="muted">'+items.length+' of '+videos+' videos transcribed. Automatic transcripts may contain errors.</p><form id="search-form"><label for="query">Topic</label><input id="query" type="search" placeholder="Try onboarding, paid ads, or &quot;sales presentation&quot;" autofocus><button type="submit">Search</button></form><p id="status" role="status"></p><div id="results"></div><p><a href="all-transcripts.md">Read all transcripts</a></p></main></body></html>');
 await fs.writeFile(path.join(courseDir,'search.html'),trustedScripts(html,['archive-search-data.js','archive-search.js']));
 await fs.writeFile(path.join(courseDir,'all-transcripts.md'),'# '+title+' — video transcripts\n\n'+items.map(item=>'## '+item.title+'\n\n'+item.segments.map(s=>'['+formatTime(s.start)+'] '+s.text).join('\n\n')).join('\n\n'));
 const index=path.join(courseDir,'index.html');
 if(await fs.pathExists(index)){
  let page=await fs.readFile(index,'utf8');
  page=page.replace(/<!-- search-link -->[\s\S]*?<!-- end-search-link -->/g,'');
  page=page.replace('<div class="page">','<div class="page"><!-- search-link --><p><a href="search.html">🔎 Search video transcripts</a></p><!-- end-search-link -->');
  await fs.writeFile(index,page);
 }
 return {videos,transcripts:items.length,passages:items.reduce((n,item)=>n+item.segments.length,0)};
}
export async function transcribeCourse(courseDir:string):Promise<void> {
 const python=process.env.SKOOL_PYTHON||'python';
 const script=fileURLToPath(new URL('../scripts/transcribe.py',import.meta.url));
 const args=[script,path.resolve(courseDir),'--model',process.env.SKOOL_WHISPER_MODEL||'large-v3-turbo','--device',process.env.SKOOL_WHISPER_DEVICE||'cuda'];
 if(process.env.SKOOL_TRANSCRIPTION_CACHE)args.push('--cache',process.env.SKOOL_TRANSCRIPTION_CACHE);
 let pendingIndex=Promise.resolve();
 let output='';
 const code=await new Promise<number>((resolve,reject)=>{
  const child=spawn(python,args,{stdio:['ignore','pipe','inherit'],windowsHide:true});
  child.stdout.on('data',chunk=>{
   process.stdout.write(chunk); output+=chunk.toString();
   const lines=output.split(/\r?\n/);output=lines.pop()||'';
   if(lines.some(line=>/Complete:|Already transcribed:/.test(line)))pendingIndex=pendingIndex.then(async()=>{await buildSearch(courseDir)}).catch(error=>console.error('Could not refresh search:',error));
  });
  child.on('error',reject);child.on('close',code=>resolve(code??1));
 });
 await pendingIndex;
 const summary=await buildSearch(courseDir);console.log('Search index:',summary);
 if(code!==0)throw new Error('Some transcripts are incomplete. Rerun transcribe to retry.');
}
