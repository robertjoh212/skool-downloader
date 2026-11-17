import fs from 'fs-extra';
import path from 'node:path';
import pLimit from 'p-limit';
import {Downloader,resolveFfmpegPath} from './downloader.js';
import {validateVideo} from './video-validation.js';
import {Scraper} from './scraper.js';
export async function auditCourseVideos(root:string){
 const sources=new Map<string,string>();const lessons=new Map<string,string>();const videos:string[]=[];
 async function walk(dir:string){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name.endsWith('.mp4'))videos.push(file);else if(entry.name==='lesson.json'){const m=await fs.readJson(file);if(m.videoLink){sources.set(path.join(dir,'video.mp4'),m.videoLink);lessons.set(path.join(dir,'video.mp4'),file);}}else if(entry.name==='links.json'){const links=await fs.readJson(file);function collect(items:any[]){for(const x of items){for(const f of x.files||[])if(f.endsWith('.mp4'))sources.set(path.resolve(dir,f),x.url);collect(x.nested||[]);}}collect(links);}}}
 await walk(root);const downloader=new Downloader();await downloader.init();const ffmpeg=await resolveFfmpegPath();const limit=pLimit(2);const results:any[]=[];const scraper=new Scraper();await scraper.init();
 try{await Promise.all(videos.map(file=>limit(async()=>{const url=sources.get(file);let error:string|undefined;try{let expectation=url?await downloader.inspectVideo(url):{};
 if(!expectation.duration&&url?.includes('stream.video.skool.com')&&lessons.has(file)){try{const metadataFile=lessons.get(file)!;const metadata=await fs.readJson(metadataFile);const fresh=await scraper.extractLessonData(metadata.lessonUrl);if(fresh.videoLink){expectation=await downloader.inspectVideo(fresh.videoLink);await fs.writeJson(metadataFile,{...metadata,videoLink:fresh.videoLink},{spaces:2});}}catch{console.log('Source runtime still unavailable: '+path.relative(root,file));}}
 await validateVideo(file,ffmpeg,expectation);}catch(e){error=String(e);}const receipt=await fs.readJson(file+'.verified.json').catch(()=>({}));const item={video:path.relative(root,file),actualSeconds:receipt.actualSeconds,expectedSeconds:receipt.expectedSeconds,status:error?'retry':receipt.durationCheck||'unavailable',error};results.push(item);console.log('Duration audit '+results.length+'/'+videos.length+': '+item.status+' — '+item.video);})));}finally{await scraper.close();}
 const summary={videos:videos.length,passed:results.filter(x=>x.status==='passed').length,retry:results.filter(x=>x.status==='retry').length,unavailable:results.filter(x=>x.status==='unavailable').length,checkedAt:new Date().toISOString(),results};await fs.writeJson(path.join(root,'duration-audit.json'),summary,{spaces:2});return summary;
}
