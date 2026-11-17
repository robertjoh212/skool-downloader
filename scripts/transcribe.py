"""Local, resumable video transcription. No media is sent to an API."""
import argparse, hashlib, json, os, re, sys, time
from pathlib import Path

def timestamp(seconds, srt=False):
    ms=round(max(0,seconds)*1000)
    hours,ms=divmod(ms,3600000); minutes,ms=divmod(ms,60000); secs,ms=divmod(ms,1000)
    return f"{hours:02}:{minutes:02}:{secs:02}{',' if srt else '.'}{ms:03}"

def fingerprint(file):
    h=hashlib.sha256()
    with file.open('rb') as f:
        for block in iter(lambda:f.read(8*1024*1024),b''): h.update(block)
    return h.hexdigest()

def atomic(file, text):
    temp=file.with_suffix(file.suffix+'.tmp')
    temp.write_text(text,encoding='utf-8')
    temp.replace(file)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('course',type=Path)
    parser.add_argument('--model',default='large-v3-turbo')
    parser.add_argument('--device',default='cuda',choices=['cuda','cpu'])
    parser.add_argument('--language',default='en')
    parser.add_argument('--cache',type=Path,default=Path(os.environ.get('SKOOL_TRANSCRIPTION_CACHE') or os.environ.get('HF_HOME') or (Path.cwd()/'.cache'/'skool-transcriber')))
    args=parser.parse_args()
    handles=[]
    if sys.platform=='win32':
        import site
        for root in site.getsitepackages():
            for vendor in ['cublas','cudnn','cuda_runtime','cuda_nvrtc']:
                folder=Path(root)/'nvidia'/vendor/'bin'
                if folder.is_dir():
                    handles.append(os.add_dll_directory(str(folder)))
                    os.environ['PATH']=str(folder)+os.pathsep+os.environ.get('PATH','')
    from faster_whisper import WhisperModel
    videos=sorted(args.course.rglob('*.mp4'),key=lambda p:[int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)',str(p))])
    model=None; failed=[]; completed=0
    for number,video in enumerate(videos,1):
        if Path(str(video)+'.retry.json').exists():
            failed.append({'video':str(video),'error':'Video duration mismatch; retry download before transcription'})
            print(f"[{number}/{len(videos)}] Deferred: duration mismatch: {video.name}",flush=True)
            continue
        dest=video.parent if video.name=='video.mp4' else video.parent/'transcripts'/hashlib.sha256(video.name.encode()).hexdigest()[:12]
        dest.mkdir(parents=True,exist_ok=True)
        try:
            ancestor=video.parent
            while not (ancestor/'lesson.json').exists() and ancestor!=args.course and ancestor.parent!=ancestor:
                ancestor=ancestor.parent
            meta=json.loads((ancestor/'lesson.json').read_text(encoding='utf-8')) if (ancestor/'lesson.json').exists() else {}
            title=meta.get('title',video.stem)+(' — linked video' if video.name!='video.mp4' else '')
            source=fingerprint(video)
            receipt=Path(str(video)+'.verified.json')
            if not receipt.exists() or json.loads(receipt.read_text(encoding='utf-8')).get('sha256')!=source:
                raise RuntimeError('Video is not validated; run audit-videos before transcription')
            json_path=dest/'transcript.json'
            config={'model':args.model,'language':args.language}
            if json_path.exists():
                try: saved=json.loads(json_path.read_text(encoding='utf-8'))
                except (ValueError,OSError): saved={}
                if saved.get('complete') and saved.get('source_sha256')==source and saved.get('config')==config and all((dest/name).exists() for name in ['transcript.txt','transcript.srt','transcript.vtt']):
                    print(f"[{number}/{len(videos)}] Already transcribed: {title}",flush=True);completed+=1;continue
            print(f"[{number}/{len(videos)}] Transcribing: {title}",flush=True)
            if model is None:
                args.cache.mkdir(parents=True,exist_ok=True)
                model=WhisperModel(args.model,device=args.device,compute_type='int8_float16' if args.device=='cuda' else 'int8',download_root=str(args.cache),cpu_threads=6)
            segments,info=model.transcribe(str(video),language=args.language,beam_size=5,vad_filter=True,condition_on_previous_text=False)
            records=[];last=0
            with (dest/'transcript.partial.jsonl').open('w',encoding='utf-8') as partial:
                for segment in segments:
                    item={'start':segment.start,'end':segment.end,'text':segment.text.strip()}
                    records.append(item);partial.write(json.dumps(item,ensure_ascii=False)+'\n');partial.flush()
                    if segment.end-last>=60:
                        print(f"  {timestamp(segment.end)} / {timestamp(info.duration)}",flush=True);last=segment.end
            if not records: raise RuntimeError('No speech segments produced; left for review')
            result={'complete':True,'title':title,'media_path':os.path.relpath(video,dest),'source_sha256':source,'config':config,'device':args.device,'duration':info.duration,'language':info.language,'segments':records,'created_at':time.strftime('%Y-%m-%dT%H:%M:%S%z')}
            atomic(dest/'transcript.txt','\n\n'.join('['+timestamp(x['start']).split('.')[0]+'] '+x['text'] for x in records)+'\n')
            atomic(dest/'transcript.srt','\n\n'.join(f"{i+1}\n{timestamp(x['start'],True)} --> {timestamp(x['end'],True)}\n{x['text']}" for i,x in enumerate(records))+'\n')
            atomic(dest/'transcript.vtt','WEBVTT\n\n'+'\n\n'.join(f"{timestamp(x['start'])} --> {timestamp(x['end'])}\n{x['text']}" for x in records)+'\n')
            atomic(json_path,json.dumps(result,ensure_ascii=False,indent=2))
            (dest/'transcript.partial.jsonl').unlink(missing_ok=True)
            completed+=1
            print(f"  Complete: {len(records)} timestamped passages",flush=True)
        except Exception as exc:
            failed.append({'video':str(video),'error':str(exc)})
            print(f"  FAILED: {exc}",flush=True)
    atomic(args.course/'transcription-status.json',json.dumps({'videos':len(videos),'completed':completed,'failed':failed},indent=2))
    print(f"Transcripts: {completed}/{len(videos)}; failures: {len(failed)}",flush=True)
    return 1 if failed else 0
if __name__=='__main__':sys.exit(main())
