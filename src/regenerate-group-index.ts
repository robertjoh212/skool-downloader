import fs from 'fs-extra';
import path from 'node:path';
import {safeDocument,escapeHtml} from './archive-safety.js';
import {trustedScripts} from './transcription.js';
export async function courseStats(root:string){
 const stats={lessons:0,videos:0,transcripts:0,retries:0,incomplete:0,durationPassed:0,durationUnavailable:0,durationPending:0,validationFailed:0,validationPending:0,missingVideos:0,missingVideoLessons:[] as string[]};
 async function walk(dir:string){for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
  if(e.isSymbolicLink())continue;const p=path.join(dir,e.name);
  if(e.isDirectory()&&!['assets','.auth','node_modules','.git'].includes(e.name))await walk(p);
  else if(e.isFile()){
   if(e.name==='lesson.json'){
    stats.lessons++;const m=await fs.readJson(p).catch(()=>({}));if(m.status==='incomplete')stats.incomplete++;
    if((m.videoLink||m.videoError||m.hasVideo)&&!await fs.pathExists(path.join(dir,'video.mp4'))){
     stats.missingVideos++;stats.missingVideoLessons.push(m.title||path.basename(dir));
    }
   }
   if(e.name==='transcript.json'){const m=await fs.readJson(p).catch(()=>({}));if(m.complete)stats.transcripts++;}
   if(e.name.endsWith('.mp4')){
    stats.videos++;
    const receipt=await fs.readJson(p+'.verified.json').catch(()=>null);
    if(await fs.pathExists(p+'.retry.json')||receipt?.durationCheck==='retry')stats.retries++;
    else if(!receipt){
     const lesson=await fs.readJson(path.join(dir,'lesson.json')).catch(()=>null);
     if(await fs.pathExists(p+'.validation-error.json')||lesson?.videoError)stats.validationFailed++;
     else stats.validationPending++;
    }else if(receipt.durationCheck==='passed')stats.durationPassed++;
    else if(receipt.durationCheck==='unavailable')stats.durationUnavailable++;
    else stats.durationPending++;
   }
  }
 }}
 await walk(root);return stats;
}
export function videoCheckSummary(s:any):string{
 return [s.durationPassed+' duration checks passed',
 s.missingVideos?s.missingVideos+' missing video download'+(s.missingVideos===1?'':'s')+': '+s.missingVideoLessons.join('; '):'',
 s.retries?s.retries+' duration mismatch'+(s.retries===1?'':'es')+' — retry later':'',
 s.durationUnavailable?s.durationUnavailable+' source runtimes unavailable':'',
 s.validationFailed?s.validationFailed+' failed validation — retry later':'',
 s.validationPending?s.validationPending+' awaiting validation':'',
 s.durationPending?s.durationPending+' duration checks pending':''].filter(Boolean).join(' · ');
}

const labels:Record<string,string>={complete:'✓ Complete',queued:'□ Queued',downloading:'↓ Downloading',transcribing:'◌ Transcribing',retry:'! Retry later',review:'! Review needed',failed:'! Retry later',paused:'Ⅱ Paused'};
async function atomic(file:string,text:string){const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';await fs.writeFile(tmp,text);await fs.move(tmp,file,{overwrite:true});}
export async function regenerateGroupIndex(groupDir:string,options:{silent?:boolean}={}){
 if(!await fs.pathExists(groupDir))return;
 let state=await fs.readJson(path.join(groupDir,'.library-state.json')).catch(()=>null);
 if(!state){const courses=[];for(const e of await fs.readdir(groupDir,{withFileTypes:true})){if(!e.isDirectory()||e.name.startsWith('.'))continue;const m=await fs.readJson(path.join(groupDir,e.name,'.course.json')).catch(()=>null);if(m)courses.push({id:e.name,title:m.courseName,status:'complete',order:m.courseIndex??courses.length+1});}state={title:path.basename(groupDir),courses};}
 const courses=[];for(const course of state.courses){const stats=await courseStats(path.join(groupDir,course.id));let status=course.status;if(status==='complete'&&(stats.missingVideos||stats.retries||stats.incomplete||stats.validationFailed))status='retry';else if(status==='complete'&&(stats.transcripts<stats.videos||stats.durationUnavailable||stats.validationPending||stats.durationPending))status='review';const cover='assets/course-'+course.id+'.jpg';courses.push({...course,...stats,checks:videoCheckSummary(stats),cover:await fs.pathExists(path.join(groupDir,cover))?cover:null,status,label:labels[status]||status,available:await fs.pathExists(path.join(groupDir,course.id,'index.html')),href:encodeURIComponent(course.id)+'/index.html'});}
 const total={courses:courses.length,complete:courses.filter(c=>c.status==='complete').length,lessons:courses.reduce((n,c)=>n+c.lessons,0),videos:courses.reduce((n,c)=>n+c.videos,0),transcripts:courses.reduce((n,c)=>n+c.transcripts,0)};
 await atomic(path.join(groupDir,'library-progress.json'),JSON.stringify({title:state.title,courses,total,updatedAt:new Date().toISOString()}));
 const cards=courses.map((c,i)=>'<li class="card">'+(c.cover?'<img class="course-cover" src="'+c.cover+'" alt="'+escapeHtml(c.title)+' cover">':'')+'<div class="eyebrow">COURSE '+String(i+1).padStart(2,'0')+(c.recordings?' · RECORDINGS LAST':'')+'</div><h2>'+escapeHtml(c.title)+'</h2><p class="state" id="state-'+escapeHtml(c.id)+'">'+escapeHtml(c.label)+'</p><p class="counts" id="counts-'+escapeHtml(c.id)+'">'+c.lessons+' lessons · '+c.videos+' videos · '+c.transcripts+' transcribed</p><p class="muted" id="duration-'+escapeHtml(c.id)+'">'+escapeHtml(c.checks)+'</p><a class="open" id="open-'+escapeHtml(c.id)+'"'+(c.available?' href="'+c.href+'"':'')+'>'+(c.available?'Open course →':'Waiting to download')+'</a></li>').join('');
 const html=safeDocument('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(state.title)+' — Course Library</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#182338;font:16px Segoe UI,sans-serif;line-height:1.55}.page{max-width:1100px;margin:42px auto;padding:0 24px 50px}.hero{background:#13233d;color:white;border-radius:22px;padding:32px}h1{font-size:36px;line-height:1.2;margin:8px 0 14px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:1.5px;color:#5d7497}.hero .eyebrow{color:#a9c3ed}.hero p{color:#d6e0f0}form{display:flex;gap:10px;margin:24px 0 12px}input{min-width:0;flex:1;padding:15px;border:0;border-radius:8px;font:inherit}button{background:#3479e8;color:white;padding:12px 20px;border:0;border-radius:8px;font:inherit;font-weight:700}a{color:#2258aa}.cards{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{background:white;padding:25px;border:1px solid #e1e7ef;border-radius:16px;display:flex;flex-direction:column;align-items:flex-start}.course-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;margin-bottom:18px}.card h2{font-size:21px;margin:8px 0 12px}.state{font-weight:700;color:#225d47}.counts{margin:4px 0}.muted{color:#65738b;font-size:14px}.open{margin-top:auto;padding-top:14px;font-weight:700;text-decoration:none}.open:not([href]){color:#8290a4}.section-title{margin-top:30px}#totals{font-weight:600}@media(max-width:680px){.cards{grid-template-columns:1fr}form{flex-direction:column}.page{padding:0 16px}.hero{padding:24px}h1{font-size:29px}}</style></head><body><main class="page"><header class="hero"><div class="eyebrow">YOUR OFFLINE COURSE LIBRARY</div><h1>'+escapeHtml(state.title)+'</h1><p>Learn in order. Find the exact moment you need.</p><form id="library-search"><label for="library-query">Search videos</label><input id="library-query" type="search" placeholder="Search every transcribed course…"><button type="submit">Search all courses</button></form><p id="totals">'+total.complete+' of '+total.courses+' courses complete · '+total.transcripts+' of '+total.videos+' videos transcribed</p></header><h2 class="section-title">Download checklist</h2><p class="muted">A checkmark means the course is downloaded, validated, transcribed and searchable. Call recordings are processed last. Status updates automatically.</p><ol class="cards">'+cards+'</ol><p class="muted">Source duration tolerance: 5 seconds. Mismatches are marked for retry. Automatic transcripts may contain errors.</p></main></body></html>');
 const client="(()=>{const form=document.getElementById('library-search');form.addEventListener('submit',e=>{e.preventDefault();location.href='search.html?q='+encodeURIComponent(document.getElementById('library-query').value)});async function update(){try{const r=await fetch('library-progress.json',{cache:'no-store'});const d=await r.json();document.getElementById('totals').textContent=d.total.complete+' of '+d.total.courses+' courses complete · '+d.total.transcripts+' of '+d.total.videos+' videos transcribed';for(const c of d.courses){const s=document.getElementById('state-'+c.id),n=document.getElementById('counts-'+c.id),v=document.getElementById('duration-'+c.id),a=document.getElementById('open-'+c.id);if(s)s.textContent=c.label;if(n)n.textContent=c.lessons+' lessons · '+c.videos+' videos · '+c.transcripts+' transcribed';if(v)v.textContent=c.checks;if(a&&c.available){a.href=c.href;a.textContent='Open course →'}}}catch{}}setInterval(update,10000);update();})();";
 await fs.writeFile(path.join(groupDir,'library-client.js'),client);
 await atomic(path.join(groupDir,'index.html'),trustedScripts(html,['library-client.js']).replace("script-src 'self';","script-src 'self'; connect-src 'self';"));
 if(!options.silent)console.log('Library homepage updated: '+groupDir);
}
