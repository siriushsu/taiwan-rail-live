import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), read=f=>fs.readFileSync(path.join(root,f));
const {gunzipSync:browserGunzip}=await import('data:text/javascript;base64,'+read('rail-3d/vendor/fflate-gunzip.js').toString('base64'));
const box={matchMedia(){return {matches:false,addEventListener(){}};},window:{addEventListener(){}},document:{addEventListener(){}}};vm.createContext(box);
vm.runInContext(read('train-garage-catalog.js').toString(),box);vm.runInContext(read('train-garage.js').toString(),box);
const catalog=box.window.RailGarageCatalog,{collection,goals}=box.TrainGarage,ids=Object.keys(catalog);
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
assert(ids.length===62&&JSON.stringify(ids.slice().sort())===JSON.stringify(Object.keys(goals).sort()),'62 款車型與規則應一一對應');
let bytes=0;
for(const id of ids){
 const meta=JSON.parse(read('rail-3d/assets/garage-blender-v1/'+id+'.json')),zip=read('rail-3d/assets/garage-blender-v1/'+id+'.bin.gz'),raw=gunzipSync(zip);bytes+=zip.length;
 assert(meta.mesh.vertexCount*24===raw.length,'網格長度 '+id);
 assert(Buffer.from(browserGunzip(zip)).equals(raw),'舊瀏覽器無損解壓 '+id);
 assert(createHash('sha256').update(raw).digest('hex')===meta.mesh.sha256,'原始 Blender 雜湊 '+id);
 assert(meta.mesh.drawGroups.every(g=>g.start>=0&&g.count>0&&g.start+g.count<=meta.mesh.vertexCount),'材質範圍 '+id);
 assert(fs.existsSync(path.join(root,catalog[id].thumbnail)),'缩圖 '+id);
 assert(catalog[id].sources.length>0&&catalog[id].sources.every(s=>/^https?:\/\//.test(s.url)),'來源 '+id);
 const goal=goals[id];
 for(const n of [goal.need-1,goal.need]){
  const snapshot={rides:[],coll:{stock:new Set(),named:new Set(),branch:new Set(),at:{}},stationCount:0};
  if(goal.metric==='rides')snapshot.rides=Array.from({length:n},()=>({}));
  if(goal.metric==='km')snapshot.rides=[{km:n}];
  if(goal.metric==='stations')snapshot.stationCount=n;
  if(goal.metric==='branches')snapshot.coll.branch=new Set(Array.from({length:n},(_,i)=>String(i)));
  const row=collection(snapshot,catalog).find(r=>r.id===id);
  assert(row.owned===(n>=goal.need)&&row.now===n,'門檻上下界 '+id);
 }
}
const empty={rides:[],coll:{stock:new Set(),named:new Set(),branch:new Set(),at:{}},stationCount:0};
assert(collection(empty,catalog).every(r=>!r.owned),'空白護照不可自動收藏');
const legacy={...empty,coll:{...empty.coll,stock:new Set(['taroko']),at:{'stock|taroko':'2026-08-02'}}};
const row=collection(legacy,catalog).find(r=>r.id==='temu1000');assert(row.owned&&row.date==='2026-08-02'&&row.now===0,'舊章無需重新完成里程碑');
const full={rides:Array.from({length:100},()=>({km:100})),coll:{...empty.coll,branch:new Set(['1','2','3','4'])},stationCount:100};
assert(collection(full,catalog).every(r=>r.owned),'62 款全部可由護照解鎖');
const html=read('index.html').toString(),prep=read('app/scripts/prepare-web.mjs').toString();
for(const f of ['train-garage.js','train-garage.css','train-garage-catalog.js'])assert(html.includes('./'+f)&&prep.includes("'"+f+"'"),'首頁與 App 接線 '+f);
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/src=|type="(?:module|application)/.test(m[1]))new vm.Script(m[2]);
console.log(`PASS 62 款 Blender 原始網格／材質／來源、124 個門檻邊界、舊章帶入、零進度與全部可解鎖、首頁與 App 接線。壓縮 ${Math.round(bytes/1024/1024)} MB。`);
