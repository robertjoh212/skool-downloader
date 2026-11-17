import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'fs-extra';

async function digest(file:string): Promise<string> {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function validateVideo(file:string, ffmpeg:string): Promise<void> {
  const stats=await fs.stat(file);
  if(!stats.isFile() || stats.size===0) throw new Error('Video is empty or missing');
  const sha256=await digest(file);
  const receipt=file+'.verified.json';
  try { const saved=await fs.readJson(receipt); if(saved.version===1 && saved.sha256===sha256) return; } catch {}
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(ffmpeg,['-nostdin','-v','error','-xerror','-i',file,'-map','0:v:0','-map','0:a?','-f','null','-'],{windowsHide:true});
    let errors='';
    child.stdout.resume();
    child.stderr.on('data',chunk=>{errors=(errors+String(chunk)).slice(-4000)});
    child.on('error',reject);
    child.on('close',code=>code===0 && !errors.trim()?resolve():reject(new Error('Video validation failed: '+(errors.trim()||'FFmpeg exit '+code))));
  });
  await fs.writeJson(receipt,{version:1,sha256,size:stats.size,checkedAt:new Date().toISOString()});
}
