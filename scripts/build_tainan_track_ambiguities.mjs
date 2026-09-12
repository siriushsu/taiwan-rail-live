// 已有班表不能證明當班月台／渡線派用。把模型無法分開的車身標成不確定，而非橫移造股道。
import fs from 'node:fs';
import path from 'node:path';
import {makePath} from '../memories/tainan-2026-09-12/vendor/train-path.js';
const dir=path.resolve(import.meta.dirname,'../memories/tainan-2026-09-12');
const data=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'))),paths=data.routes.map(r=>makePath(r.coordinates)),hits=new Map();
for(let t=0;t<86400;t++){
 const active=[];for(const tr of data.trains){const span=tr.spans.find(s=>t>=s.start&&t<s.start+s.s.length);if(!span)continue;const s=span.s[t-span.start],p=paths[span.route];active.push({tr,s,p,c:p.at(s).coordinate});}
 for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
  const a=active[i],b=active[j],limit=(a.tr.formation.lengthM+b.tr.formation.lengthM)/2+3;
  if(Math.hypot((a.c[0]-b.c[0])*102000,(a.c[1]-b.c[1])*111320)>limit+3)continue;
  const loc=a.p.locate(b.c,a.s);if(!loc||loc.error>=2.9||Math.abs(loc.s-a.s)>=limit)continue;
  const key=[a.tr.id,b.tr.id].sort().join('|');let spans=hits.get(key);if(!spans)hits.set(key,spans=[]);
  const last=spans.at(-1);if(last&&last.end>=t-2)last.end=t+1;else spans.push({start:Math.max(0,t-1),end:Math.min(86399,t+1),trains:[a.tr.id,b.tr.id],trainNos:[a.tr.train,b.tr.train]});
 }
}
const intervals=[...hits.values()].flat().sort((a,b)=>a.start-b.start);
fs.writeFileSync(path.join(dir,'uncertainty.json'),JSON.stringify({schema:1,date:data.date,basis:'逐秒檢查模型車身的股道佔用範圍；不是現實碰撞紀錄。公開圖資與班表不足以核實當班渡線／月台安排，這些時段只顯示原位置的車次標記。',intervals},null,2)+'\n');
console.log('股道安排待確認：'+intervals.length+' 個時段，'+new Set(intervals.flatMap(i=>i.trains)).size+' 班涉及。');
