import fs from 'node:fs'; import path from 'node:path'; import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const PORT=Number(process.env.PORT||5399);
createServer(async (req,res)=>{
  const u=new URL(req.url,'http://l');
  if(u.pathname.startsWith('/api/')){
    try{ const r=await fetch('https://railisland.tw'+u.pathname+u.search,{headers:{'cache-control':'no-cache'}});
      res.setHeader('content-type','application/json'); return res.end(await r.text()); }
    catch(e){ res.setHeader('content-type','application/json'); return res.end('{}'); }
  }
  const f=path.join(ROOT,u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).slice(1));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.statusCode=404;return res.end('x');}
  res.setHeader('content-type',MIME[path.extname(f)]||'application/octet-stream');
  res.end(fs.readFileSync(f));
}).listen(PORT,'127.0.0.1',()=>console.log('serving on '+PORT));
