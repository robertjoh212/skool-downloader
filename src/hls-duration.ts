import axios from 'axios';
/** Read a complete VOD playlist's declared segment duration without downloading media. */
export async function hlsDuration(url:string,depth=0):Promise<number|undefined>{
 if(depth>3)return undefined;
 const response=await axios.get<string>(url,{responseType:'text',timeout:20000,headers:{Referer:'https://www.skool.com/'}});
 const lines=response.data.trim().split(/\r?\n/).map(x=>x.trim());
 if(lines[0]!=='#EXTM3U')return undefined;
 const variant=lines.findIndex(x=>x.startsWith('#EXT-X-STREAM-INF:'));
 if(variant>=0){const next=lines.slice(variant+1).find(x=>x&&!x.startsWith('#'));return next?hlsDuration(new URL(next,url).href,depth+1):undefined;}
 if(!lines.includes('#EXT-X-ENDLIST'))return undefined;
 const segments=lines.filter(x=>x.startsWith('#EXTINF:')).map(x=>Number(x.slice(8).split(',')[0]));
 if(!segments.length||segments.some(x=>!Number.isFinite(x)||x<=0))return undefined;
 return segments.reduce((sum,x)=>sum+x,0);
}
