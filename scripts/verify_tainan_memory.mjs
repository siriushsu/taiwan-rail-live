import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {makePath,distanceM,formationPoses} from '../memories/tainan-2026-09-12/vendor/train-path.js';
const dir=path.resolve(import.meta.dirname,'../memories/tainan-2026-09-12'),read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const integrity=read('integrity.json'),data=read('snapshot.json'),sources=read('source-schedule.json'),paths=data.routes.map(r=>makePath(r.coordinates));
for(const [file,hash] of Object.entries(integrity.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'),hash,'封存檔案被改寫：'+file);
assert.equal(data.date,'2026-09-12');assert.equal(data.trains.length,227);assert.equal(new Set(data.trains.map(t=>t.id)).size,227);
assert.equal(data.trains.filter(t=>t.direction==='北上').length,114);assert.equal(data.trains.filter(t=>t.direction==='南下').length,113);assert.equal(data.trains.filter(t=>t.serviceDate==='2026-09-11').length,2);
assert.ok(data.rails.length>30);assert.ok(data.rails.every(r=>r.tags.railway==='rail'&&!r.tags.construction&&!r.tags.tunnel));
for(const tr of data.trains){assert.ok(sources.trains.some(s=>s.serviceDate===tr.serviceDate&&s.train===tr.train));
 for(const [i,span] of tr.spans.entries()){
  assert.ok(span.start>=0&&span.start+span.s.length-1<=86399);assert.ok(span.s.length>0);
  const route=paths[span.route];for(const [j,s] of span.s.entries()){assert.ok(Number.isFinite(s)&&s>=0&&s<=route.length);if(j)assert.ok(s>=span.s[j-1]-.001,'里程不能倒退：'+tr.train);}
  if(i){const last=tr.spans[i-1];if(span.start===last.start+last.s.length-1)assert.ok(distanceM(route.at(span.s[0]).coordinate,paths[last.route].at(last.s.at(-1)).coordinate)<.02,'路段切換跳位：'+tr.train);}
  for(const s of [span.s[0],span.s[Math.floor(span.s.length/2)],span.s.at(-1)])assert.ok(formationPoses(route,s,1,tr.formation.parts),'編組落在未知路徑：'+tr.train);
 }
}
// 任意日期更新都不得讓歷史頁改去讀取網站的可變資料／API。
for(const name of ['replay.js','vendor/train-path.js','vendor/mesh.js']){const code=fs.readFileSync(path.join(dir,name),'utf8');assert.ok(!/(?:\.\.\/)+(?:data|rail-3d)|\/api\//.test(code),name+' 依賴可變的正式資料');}
const index=fs.readFileSync(path.resolve(dir,'../../index.html'),'utf8');assert.ok(index.includes('id="tainanMemoryLink"'));assert.ok(index.includes('data-cl="tainanmemory0912"'));
const uncertainty=read('uncertainty.json');assert.equal(uncertainty.date,data.date);assert.equal(uncertainty.intervals.length,22);
for(const i of uncertainty.intervals){assert.ok(i.start>=0&&i.end<=86399&&i.end>=i.start);assert.equal(i.trains.length,2);assert.ok(i.trains.every(id=>data.trains.some(t=>t.id===id)));}
console.log(JSON.stringify({files:Object.keys(integrity.files).length,trains:data.trains.length,routes:paths.length,samples:data.trains.reduce((n,t)=>n+t.spans.reduce((a,s)=>a+s.s.length,0),0),directions:['北上','南下'],overnight:2,integrity:'pass',continuity:'pass'}));
