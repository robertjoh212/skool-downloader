import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'fs-extra';
export type VideoExpectation={duration?:number;estimatedBytes?:number};
export class VideoDurationMismatch extends Error {}
async function digest(file:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export async function probeDuration(file:string,ffmpeg:string):Promise<number>{
 return new Promise((resolve,reject)=>{let output='';const child=spawn(ffmpeg,['-nostdin','-hide_banner','-i',file],{windowsHide:true});child.stdout.resume();child.stderr.on('data',c=>{output+=String(c)});child.on('error',reject);child.on('close',()=>{const m=output.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);if(!m)reject(new Error('Could not determine downloaded video duration'));else resolve(Number(m[1])*3600+Number(m[2])*60+Number(m[3]));});});
}
export async function validateVideo(file:string,ffmpeg:string,expected:VideoExpectation={}):Promise<void>{
 const stats=await fs.stat(file);if(!stats.isFile()||!stats.size)throw new Error('Video is empty or missing');
 const sha256=await digest(file),receipt=file+'.verified.json';
 const saved=await fs.readJson(receipt).catch(()=>null);
 const reusable=saved&&[1,2].includes(saved.version)&&saved.sha256===sha256;
 if(!reusable)await new Promise<void>((resolve,reject)=>{
  const child=spawn(ffmpeg,['-nostdin','-v','error','-xerror','-i',file,'-map','0:v:0','-map','0:a?','-f','null','-'],{windowsHide:true});let errors='';child.stdout.resume();child.stderr.on('data',c=>{errors=(errors+String(c)).slice(-4000)});child.on('error',reject);child.on('close',code=>{const decoderErrors=errors.split(/\r?\n/).filter(line=>!line.includes('Application provided invalid, non monotonically increasing dts to muxer')).join('\n').trim();code===0&&!decoderErrors?resolve():reject(new Error('Video validation failed: '+(decoderErrors||'FFmpeg exit '+code)));});
 });
 const actualSeconds=reusable&&saved.actualSeconds>0?saved.actualSeconds:await probeDuration(file,ffmpeg);
 const expectedSeconds=Number(expected.duration)>0?expected.duration:undefined;
 // Allow only small container/rounding differences, never a percentage of a long recording.
 const toleranceSeconds=5;
 const mismatch=expectedSeconds!==undefined&&Math.abs(actualSeconds-expectedSeconds)>toleranceSeconds;
 const result={version:2,sha256,size:stats.size,actualSeconds,expectedSeconds,estimatedBytes:expected.estimatedBytes,durationCheck:expectedSeconds===undefined?'unavailable':mismatch?'retry':'passed',toleranceSeconds,checkedAt:new Date().toISOString()};
 await fs.writeJson(receipt,result,{spaces:2});
 if(mismatch){await fs.writeJson(file+'.retry.json',{reason:'duration-mismatch',actualSeconds,expectedSeconds,toleranceSeconds,createdAt:new Date().toISOString()},{spaces:2});throw new VideoDurationMismatch('Retry later: video duration '+actualSeconds+'s differs from source '+expectedSeconds+'s');}
 if(expectedSeconds!==undefined)await fs.remove(file+'.retry.json');
}
