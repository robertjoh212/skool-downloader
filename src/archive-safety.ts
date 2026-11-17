import sanitizeHtml from 'sanitize-html';
import fs from 'fs-extra';
import path from 'node:path';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
export function cleanLessonHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: { a: ['href','title','target','rel'], img: ['src','alt','title'], ol:['start'] },
    allowedSchemes: ['http','https','mailto'],
    allowProtocolRelative: false,
    transformTags: {a: sanitizeHtml.simpleTransform('a', {rel:'noopener noreferrer'})}
  });
}
export function safeDocument(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'html','head','body','title','style','meta','img','video','source','input','button','label','form','details','summary'],
    allowedAttributes: {'*':['class','id','title','role'],a:['href','target','rel'],img:['src','alt'],video:['src','controls'],source:['src','type'],input:['id','type','placeholder','autofocus'],button:['type'],label:['for'],form:['id'],meta:['charset','name','content'],ol:['start']},
    allowedSchemes:['http','https','mailto'],
    allowProtocolRelative:false,
    allowVulnerableTags:true
  });
  return '<!DOCTYPE html>\n' + clean.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' data:; media-src \'self\'; base-uri \'none\'; form-action \'none\'">');
}
export function lessonKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.hostname !== 'www.skool.com' && u.hostname !== 'skool.com') return null;
    const id = u.searchParams.get('md') || u.searchParams.get('lesson');
    return u.pathname.replace(/\/$/,'') + (id ? '?md='+id : '');
  } catch { return null; }
}
export async function localizeCourseLinks(courseDir: string): Promise<void> {
  const lessons: Array<{file: string; url?: string}> = [];
  async function visit(dir: string) {
    for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
      if (entry.isSymbolicLink()) continue;
      const item = path.join(dir,entry.name);
      if (entry.isDirectory() && !['assets','resources','node_modules','.auth','.git'].includes(entry.name)) await visit(item);
      if (entry.isFile() && entry.name === 'lesson.json') {
        const meta = await fs.readJson(item);
        lessons.push({file:path.join(dir,'index.html'),url:meta.lessonUrl});
      }
    }
  }
  await visit(courseDir);
  const targets = new Map<string,string>();
  for (const lesson of lessons) { const key=lesson.url && lessonKey(lesson.url); if(key && await fs.pathExists(lesson.file)) targets.set(key,lesson.file); }
  for (const lesson of lessons) {
    if (!await fs.pathExists(lesson.file)) continue;
    let html=await fs.readFile(lesson.file,'utf8');
    html=html.replace(/href="([^"]+)"/g,(all, href:string)=>{
      const key=lessonKey(href.replace(/&amp;/g,'&'));
      const target=key && targets.get(key);
      if(!target) return all;
      const relative=path.relative(path.dirname(lesson.file),target).split(path.sep).map(encodeURIComponent).join('/');
      return 'href="'+relative+'"';
    });
    await fs.writeFile(lesson.file,html);
  }
}

/** Includes pasted URLs as well as links with href attributes. */
export function extractContentUrls(html: string): Array<{url: string; title: string}> {
  const urls = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const raw = match[0].replace(/&amp;/g,'&').replace(/[.,;]+$/,'');
    try { const u = new URL(raw); if (u.protocol === 'https:' || u.protocol === 'http:') urls.add(u.href); } catch {}
  }
  return [...urls].map(url => ({url,title:url}));
}
