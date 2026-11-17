import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.argv[2]||'.');
const port=Number(process.argv[3]||8766);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.mp4':'video/mp4','.vtt':'text/vtt','.jpg':'image/jpeg','.png':'image/png','.pdf':'application/pdf','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
http.createServer(async(req,res)=>{
try{
 let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 let stat=await fsp.stat(file);if(stat.isDirectory()){file=path.join(file,'index.html');stat=await fsp.stat(file);}
 const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
 const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),stat.size-1):stat.size-1;
 if(start>end){res.writeHead(416);res.end();return;}
 res.writeHead(range?206:200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff',...(range?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});
 if(req.method==='HEAD'){res.end();return;}
 fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
}catch{res.writeHead(404);res.end('File not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Archive viewer: http://127.0.0.1:${port}/`));
