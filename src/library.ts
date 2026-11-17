import fs from 'fs-extra';
import path from 'node:path';
import {statfs} from 'node:fs/promises';
import {downloadCourse} from './index.js';
import {Scraper} from './scraper.js';
import {buildSearch,transcribeCourse} from './transcription.js';
import {courseStats,regenerateGroupIndex} from './regenerate-group-index.js';

export async function cacheLibraryCovers(root:string,courses:Array<{url:string;coverImageUrl?:string}>){
 await fs.ensureDir(path.join(root,'assets'));
 await Promise.all(courses.map(async course=>{
  if(!course.coverImageUrl)return;
  const id=new URL(course.url).pathname.split('/').pop();
  const file=path.join(root,'assets','course-'+id+'.jpg');
  if(await fs.pathExists(file))return;
  try{const response=await fetch(course.coverImageUrl);if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Invalid course cover');await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));}
  catch(e){console.warn('Course cover unavailable:',id);}
 }));
}

type Adoption={id:string;status:string;log:string};
export async function downloadLibrary(url:string,root:string,adopt?:Adoption){
 await fs.ensureDir(root);
 const stateFile=path.join(root,'.library-state.json');
 let state=await fs.readJson(stateFile).catch(()=>null);
 let inventory=await fs.readJson(path.join(root,'library-inventory.json')).catch(()=>null);
 if(!state){const scraper=new Scraper();try{inventory=await scraper.parseCourseLibrary(url);await fs.writeJson(path.join(root,'library-inventory.json'),inventory,{spaces:2});const courses=inventory.courses.filter((c:any)=>c.hasAccess!==false&&!(Number(c.privacy)>0)).sort((a:any,b:any)=>Number(/call recording/i.test(a.title))-Number(/call recording/i.test(b.title)));state={title:inventory.groupName,courses:courses.map((c:any,i:number)=>({id:new URL(c.url).pathname.split('/').pop(),title:c.title,url:c.url,order:i+1,status:'queued',recordings:/call recording/i.test(c.title)}))};}finally{await scraper.close();}}
 if(inventory)await cacheLibraryCovers(root,inventory.courses);
 const save=async()=>{state.updatedAt=new Date().toISOString();const temp=stateFile+'.tmp';await fs.writeJson(temp,state,{spaces:2});await fs.move(temp,stateFile,{overwrite:true});};
 let updates=Promise.resolve();let lastTranscripts=-1;
 const refresh=()=>{updates=updates.then(async()=>{await save();await regenerateGroupIndex(root,{silent:true});const progress=await fs.readJson(path.join(root,'library-progress.json'));if(progress.total.transcripts!==lastTranscripts){await buildSearch(root);lastTranscripts=progress.total.transcripts;}}).catch(e=>console.error('Progress refresh:',String(e)));return updates;};
 const event=async(course:any)=>{const record={at:new Date().toISOString(),id:course.id,title:course.title,status:course.status};await fs.appendFile(path.join(root,'library-events.jsonl'),JSON.stringify(record)+'\n');console.log('COURSE STATUS: '+JSON.stringify(record));await refresh();};
 await refresh();const timer=setInterval(()=>{void refresh()},15000);
 try{
  for(const course of state.courses){
   if(['complete','retry','review'].includes(course.status))continue;
   const disk=await statfs(root);if(disk.bavail*disk.bsize<20e9){course.status='paused';course.note='Less than 20 GB free; queue paused.';await event(course);break;}
   const folder=path.join(root,course.id);
   try{
    if(adopt?.id===course.id){
     course.status='downloading';await event(course);
     const inventoryScraper=new Scraper();try{const inventory=await inventoryScraper.parseClassroom(course.url);course.expectedLessons=inventory.modules.reduce((n,m)=>n+m.lessons.length,0);}catch{course.inventoryUnavailable=true;}finally{await inventoryScraper.close();}
     for(;;){const status=await fs.readJson(adopt!.status);if(!status.running)break;const log=await fs.readFile(adopt!.log,'utf8').catch(()=>'');if(/\[\d+\/\d+\] Transcribing:/.test(log))course.status='transcribing';await new Promise(r=>setTimeout(r,5000));}
    }else{
     course.status='downloading';await event(course);
     const summary=await downloadCourse({url:course.url,outputDir:folder,mode:'course',concurrency:2,transcribe:false,suppressIndexLogs:true,callbacks:{onCourseStart(info){course.expectedLessons=info.lessonsCount;},onLessonStart(info){course.currentLesson=info.lessonTitle;}}});
     course.downloadSummary={lessons:summary.lessonsCount,failed:summary.failedLessons};
     course.status='transcribing';await event(course);
     try{await transcribeCourse(folder);}catch(e){course.note=String(e);}
    }
    let stats=await courseStats(folder);
    if(adopt?.id===course.id&&(stats.incomplete||(course.expectedLessons&&stats.lessons<course.expectedLessons))&&!stats.retries){
     course.status='downloading';await event(course);
     const repaired=await downloadCourse({url:course.url,outputDir:folder,mode:'course',concurrency:2,transcribe:false,suppressIndexLogs:true});
     course.expectedLessons=repaired.lessonsCount;course.downloadSummary={lessons:repaired.lessonsCount,failed:repaired.failedLessons};
     course.status='transcribing';await event(course);
     try{await transcribeCourse(folder);}catch(e){course.note=String(e);}
     stats=await courseStats(folder);
    }
    const transcription=await fs.readJson(path.join(folder,'transcription-status.json')).catch(()=>null);
    course.status=stats.retries||stats.validationFailed||stats.incomplete||course.downloadSummary?.failed||(course.expectedLessons&&stats.lessons<course.expectedLessons)||(transcription?.failed?.length)||stats.transcripts<stats.videos?'retry':stats.durationUnavailable||stats.validationPending||stats.durationPending||course.inventoryUnavailable?'review':'complete';
    if(!stats.lessons)course.status='retry';
    delete course.currentLesson;
    await buildSearch(root);await event(course);
   }catch(e){course.status='retry';course.note=String(e);await event(course);}
  }
 }finally{clearInterval(timer);await refresh();}
 console.log('Library queue finished. Review any Retry later or Review needed entries.');
}
