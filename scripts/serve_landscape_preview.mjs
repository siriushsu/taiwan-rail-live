// 本機預覽只提供公開前端與唯讀 API；支援 DEM 的 Range，避免每塊圖磚重下載整份分片。
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))),port=Number(process.env.PORT||5228);
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.geojson':'application/geo+json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.pbf':'application/x-protobuf','.bin':'application/octet-stream','.gz':'application/gzip','.mp3':'audio/mpeg','.webmanifest':'application/manifest+json'};
const api=new Set(['tra-live','metro-core','trtc-live','metro-live','ntmetro-live','klrt-position','tra-alert','thsr-alert','metro-alert','hazard-alert','today-board','station-events','delay-stats','delay-history','tra-daily-trains','thsr-schedule','thsr-freeseat','basemap-src','basemap-token']);
createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const u=new URL(req.url,'http://localhost'),p=decodeURIComponent(u.pathname);
  if(p.split('/').some(x=>x.startsWith('.'))||p.includes('\\')||p.includes('\0')){res.writeHead(403).end();return;}
  if(p.startsWith('/api/')){if(!api.has(p.slice(5))){res.writeHead(404).end('{}');return;}const r=await fetch('https://railisland.tw'+p+u.search,{signal:AbortSignal.timeout(10000)});res.writeHead(r.status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(req.method==='HEAD'?'':await r.text());return;}
  if(p!=='/'&&!/^\/(data|assets|vendor|rail-3d|i18n)\//.test(p)&&!/^\/[^/]+\.(html|css|js|png|webmanifest)$/.test(p)){res.writeHead(404).end();return;}
  const file=await realpath(path.join(root,p==='/'?'index.html':p));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const info=await stat(file),type=types[path.extname(file)];if(!info.isFile()||!type){res.writeHead(404).end();return;}
  let start=0,end=info.size-1,status=200;const headers={'Content-Type':type,'Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416).end();return;}start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));if(start>end||start>=info.size){res.writeHead(416).end();return;}status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;}
  headers['Content-Length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}const stream=createReadStream(file,{start,end});res.on('close',()=>stream.destroy());stream.pipe(res);
 }catch(e){if(!res.headersSent)res.writeHead(e.code==='ENOENT'?404:502);res.end();}
}).listen(port,'127.0.0.1',()=>console.log('地景預覽 http://127.0.0.1:'+port));
