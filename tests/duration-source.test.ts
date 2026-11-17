import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {hlsDuration} from '../src/hls-duration.js';
test('source runtime follows master playlists and sums VOD segments, but rejects live or malformed data',async()=>{
 const pages:Record<string,string>={'/master.m3u8':'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo.m3u8','/video.m3u8':'#EXTM3U\n#EXTINF:4.25,\na.ts\n#EXTINF:5.75,\nb.ts\n#EXT-X-ENDLIST','/live.m3u8':'#EXTM3U\n#EXTINF:4,\na.ts','/invalid.m3u8':'#EXTM3U\n#EXTINF:bad,\na.ts\n#EXT-X-ENDLIST'};
 const server=http.createServer((req,res)=>res.end(pages[req.url!]||'not a playlist'));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 try{assert.equal(await hlsDuration(base+'/master.m3u8'),10);assert.equal(await hlsDuration(base+'/live.m3u8'),undefined);assert.equal(await hlsDuration(base+'/invalid.m3u8'),undefined);}finally{server.close();}
});
