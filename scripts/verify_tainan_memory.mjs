import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {makePath,distanceM,formationPoses} from '../memories/tainan-2026-09-12/vendor/train-path.js';
const dir=path.resolve(import.meta.dirname,'../memories/tainan-2026-09-12'),read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const integrity=read('integrity.json'),data=read('snapshot.json'),sources=read('source-schedule.json'),paths=data.routes.map(r=>makePath(r.coordinates));
// 網格改存 .bin.gz（傳輸量），雜湊仍是解壓後的原始 .bin，所以封存內容逐 byte 不變。
const archived=f=>fs.existsSync(path.join(dir,f))?fs.readFileSync(path.join(dir,f)):zlib.gunzipSync(fs.readFileSync(path.join(dir,f+'.gz')));
for(const [file,hash] of Object.entries(integrity.files))assert.equal(crypto.createHash('sha256').update(archived(file)).digest('hex'),hash,'封存檔案被改寫：'+file);
const onDisk=[];(function visit(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())visit(f);else if(e.name!=='integrity.json')onDisk.push(path.relative(dir,f).replace(/\.gz$/,''));}})(dir);
assert.deepEqual(onDisk.sort(),Object.keys(integrity.files).sort(),'封存目錄與雜湊清單不一致');
// 列車網格（fleet/catalog.json）：每個封存編組都要有逐輛規則、輛數與班表一致、每輛網格的近遠兩檔都已封存。
// 重播頁開機時同樣檢查輛數，不符就整頁打不開，所以這裡要先擋。排法與 replay.js 的 arrange() 相同：各車 pitchM 首尾相接、以編組中心置中。
const fleet=read('fleet/catalog.json');
// 集電弓車（*-ep、*-tep）的網格把集電弓放在 -X 端，編組表的 flip 以此為準（取最高點下 5 cm 內的頂點＝集電弓頂；冷氣頂至少低 10 cm）；新自強號的集電弓在轉向架正上方（x≈-6.9，運轉手冊 4.1.1）。
for(const [id,m] of Object.entries(fleet.meshes).filter(([id])=>/-t?ep$/.test(id)))for(const k of ['near','far']){const v=new Float32Array(new Uint8Array(archived('fleet/'+m[k].file)).buffer);let top=-Infinity;for(let i=2;i<v.length;i+=10)top=Math.max(top,v[i]);const xs=[];for(let i=2;i<v.length;i+=10)if(v[i]>top-.05)xs.push(v[i-2]);const cx=xs.reduce((a,x)=>a+x,0)/xs.length;assert.ok(cx<-1,'集電弓不在網格的 -X 端：'+id+' '+k+' x='+cx.toFixed(2));if(id==='emu3000-ep')assert.ok(Math.abs(cx+6.9)<.7,'新自強號集電弓不在轉向架上方：'+k+' x='+cx.toFixed(2));}
const arranged=tr=>{const rule=fleet.formations[tr.formation.id];assert.ok(rule&&rule.cars.length===tr.formation.parts.length,'缺少編組規則或輛數與班表不符：'+tr.formation.id);const cars=rule.listedFor&&tr.direction!==rule.listedFor?rule.cars.slice().reverse().map(c=>({mesh:c.mesh,flip:!c.flip})):rule.cars;const parts=cars.map(c=>{const m=fleet.meshes[c.mesh];assert.ok(m&&m.pitchM>0,'編組引用了不存在的網格：'+c.mesh);for(const k of ['near','far'])assert.ok(integrity.files['fleet/'+m[k]?.file],'網格未封存：'+c.mesh+' '+k);return {mesh:c.mesh,flip:c.flip,lengthM:m.pitchM,offsetM:0};});let front=parts.reduce((a,c)=>a+c.lengthM,0)/2;for(const c of parts){c.offsetM=front-c.lengthM/2;front-=c.lengthM;}return parts;};
assert.equal(data.date,'2026-09-12');assert.equal(data.trains.length,227);assert.equal(new Set(data.trains.map(t=>t.id)).size,227);
assert.equal(data.trains.filter(t=>t.direction==='北上').length,114);assert.equal(data.trains.filter(t=>t.direction==='南下').length,113);assert.equal(data.trains.filter(t=>t.serviceDate==='2026-09-11').length,2);
assert.ok(data.rails.length>30);assert.ok(data.rails.every(r=>r.tags.railway==='rail'&&!r.tags.construction&&!r.tags.tunnel));
for(const tr of data.trains){assert.ok(sources.trains.some(s=>s.serviceDate===tr.serviceDate&&s.train===tr.train));const shown=arranged(tr);
 for(const [i,span] of tr.spans.entries()){
  assert.ok(span.start>=0&&span.start+span.s.length-1<=86399);assert.ok(span.s.length>0);
  const route=paths[span.route];for(const [j,s] of span.s.entries()){assert.ok(Number.isFinite(s)&&s>=0&&s<=route.length);if(j)assert.ok(s>=span.s[j-1]-.001,'里程不能倒退：'+tr.train);}
  if(i){const last=tr.spans[i-1];if(span.start===last.start+last.s.length-1)assert.ok(distanceM(route.at(span.s[0]).coordinate,paths[last.route].at(last.s.at(-1)).coordinate)<.02,'路段切換跳位：'+tr.train);}
  for(const s of [span.s[0],span.s[Math.floor(span.s.length/2)],span.s.at(-1)]){assert.ok(formationPoses(route,s,1,tr.formation.parts),'編組落在未知路徑：'+tr.train);assert.ok(formationPoses(route,s,1,shown),'真實比例編組落在未知路徑：'+tr.train);}
 }
}
// 任意日期更新都不得讓歷史頁改去讀取網站的可變資料／API。
for(const name of ['replay.js','vendor/train-path.js','vendor/mesh.js']){const code=fs.readFileSync(path.join(dir,name),'utf8');assert.ok(!/(?:\.\.\/)+(?:data|rail-3d)|\/api\//.test(code),name+' 依賴可變的正式資料');}
const index=fs.readFileSync(path.resolve(dir,'../../index.html'),'utf8');assert.ok(index.includes('id="tainanMemoryLink"'));assert.ok(index.includes('data-cl="tainanmemory0912"'));
const uncertainty=read('uncertainty.json');assert.equal(uncertainty.date,data.date);assert.equal(uncertainty.intervals.length,22);
for(const i of uncertainty.intervals){assert.ok(i.start>=0&&i.end<=86399&&i.end>=i.start);assert.equal(i.trains.length,2);assert.ok(i.trains.every(id=>data.trains.some(t=>t.id===id)));}
// ── 周邊建物（surroundings/）：低細節建物網格（使用者 2026-09-30「不要是灰色方塊」）。
// 規則與 prototypes/tiny-trains/blender/tainan-memory-v1/surroundings.py 各自獨立實作一次；輸入只用封存的 snapshot.json、station/model.json，
// 以及封存輪廓漏掉的香格里拉飯店塔身（同資料夾 tower-parts-source.json，雜湊要與 model.json 的 sources 一致）。
// 每條斷言的訊息都以「周邊建物：」開頭，突變測試靠它辨認是哪一條紅。
const surroundings=(()=>{
 const S='surroundings/',ok=(c,m)=>assert.ok(c,'周邊建物：'+m);
 const BUDGET={triangles:60000,gzipBytes:350000,drawGroups:16};   // 350 KB 取 350,000 byte（比 350×1024 嚴）
 // 檔案與封存
 ok(fs.existsSync(path.join(dir,S+'model.json'))&&fs.existsSync(path.join(dir,S+'near.mesh.bin.gz')),'缺少 surroundings/model.json 或 near.mesh.bin.gz');
 ok(!fs.existsSync(path.join(dir,S+'near.mesh.bin')),'不留未壓縮的 near.mesh.bin（封存只存 .gz）');
 for(const f of [S+'model.json',S+'near.mesh.bin'])ok(integrity.files[f],'封存雜湊清單缺少 '+f);
 const sm=read(S+'model.json'),near=sm.lods?.near;ok(near&&near.file==='near.mesh.bin','model.json 缺少 lods.near');
 const raw=archived(S+'near.mesh.bin'),gzSize=fs.statSync(path.join(dir,S+'near.mesh.bin.gz')).size;
 ok(crypto.createHash('sha256').update(raw).digest('hex')===near.sha256,'解壓後 sha256 與 model.json 不符');
 ok(near.strideBytes===24&&raw.length%24===0,'stride 不是 24 byte 或檔案不是整數個頂點');
 ok(near.byteLength===raw.length&&near.vertexCount===raw.length/24&&near.triangleCount===near.vertexCount/3&&Number.isInteger(near.triangleCount),'vertexCount／triangleCount／byteLength 與檔案不一致');
 ok(near.gzipBytes===gzSize,'gzipBytes 與 near.mesh.bin.gz 的實際大小不一致');
 // drawGroups：首尾相接、涵蓋全部頂點；三項預算
 const groups=near.drawGroups;ok(Array.isArray(groups)&&groups.length>0,'沒有 drawGroups');
 let cursor=0;for(const g of groups){ok(g.start===cursor,'drawGroups 沒有首尾相接：'+g.name);ok(Number.isInteger(g.count)&&g.count>0&&g.count%3===0,'drawGroup 頂點數不是 3 的正整數倍：'+g.name);cursor+=g.count;
  ok(typeof g.name==='string'&&typeof g.label==='string'&&g.color?.length===3&&g.color.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&Number.isFinite(g.roughness)&&Number.isFinite(g.metalness),'drawGroup 欄位不完整：'+g.name);}
 ok(cursor===near.vertexCount,'drawGroups 沒有涵蓋全部三角形');ok(new Set(groups.map(g=>g.name)).size===groups.length,'drawGroup 名稱重複');
 ok(near.triangleCount<=BUDGET.triangles,'三角形超出預算 '+near.triangleCount+' > '+BUDGET.triangles);
 ok(near.gzipBytes<=BUDGET.gzipBytes,'gzip 超出預算 '+near.gzipBytes+' > '+BUDGET.gzipBytes);
 ok(groups.length<=BUDGET.drawGroups,'drawGroup 超出預算 '+groups.length+' > '+BUDGET.drawGroups);
 // 涵蓋率：與 replay.js 的 features 迴圈同一套排除順序（highway、平台由自己的分支處理；雨棚、跨站橋、舊站房本體、施工中不進周邊網格）
 const stationId=read('station/model.json').osmId,skip=f=>f.tags.building==='roof'?'roof':f.tags.building==='bridge'?'bridge':f.id===stationId?'station':(f.tags.construction||f.tags.building==='construction')?'construction':null;
 const PARTS='prototypes/tiny-trains/blender/tainan-memory-v1/tower-parts-source.json',partsRaw=fs.readFileSync(path.resolve(dir,'../..',PARTS)),partsSrc=JSON.parse(partsRaw.toString('utf8'));
 ok((sm.sources||[]).some(s=>s.file===PARTS&&s.sha256===crypto.createHash('sha256').update(partsRaw).digest('hex')),'model.json 的 sources 沒記 '+PARTS+'，或雜湊與檔案不符');
 // 塔身部件：OSM building:part、原本沒有 building 標記、不在封存輪廓裡，而且 way 與全部節點的最後修改都早於封存時間（形狀＝封存當天）；以 building='part' 代入
 for(const e of partsSrc.elements){ok(e.tags['building:part']&&!e.tags.building&&!data.features.some(f=>f.id===e.id),'塔身部件 '+e.id+' 不是「封存輪廓沒收的 building:part」');
  ok(e.wayTimestamp<partsSrc.captureCutoff&&e.latestNodeTimestamp<partsSrc.captureCutoff,'塔身部件 '+e.id+' 在封存之後改過，形狀不能當封存當天的');}
 const parts=partsSrc.elements.map(e=>({id:e.id,tags:{...e.tags,building:'part'},coordinates:e.coordinates}));
 const isBuilding=f=>f.tags.building&&!f.tags.highway&&f.tags.railway!=='platform',expected=[...data.features.filter(f=>isBuilding(f)&&!skip(f)),...parts],byId=new Map([...data.features,...parts].map(f=>[f.id,f]));
 const ids=sm.buildings.map(b=>b.id);ok(new Set(ids).size===ids.length,'buildings 有重複 id');
 const want=expected.map(f=>f.id).sort((a,b)=>a-b),got=[...ids].sort((a,b)=>a-b);ok(parts.length>0&&parts.every(p=>ids.includes(p.id)),'塔身部件沒有全部進網格');
 ok(want.length>0&&got.length===want.length&&got.every((v,i)=>v===want[i]),'建物 id 集合與封存輪廓不一致：多 '+got.filter(v=>!want.includes(v)).join(',')+'｜少 '+want.filter(v=>!got.includes(v)).join(','));
 const wantExcluded=data.features.filter(f=>isBuilding(f)&&skip(f)).map(f=>f.id+':'+skip(f)).sort(),gotExcluded=(sm.excluded||[]).map(e=>e.id+':'+e.reason).sort();
 ok(JSON.stringify(wantExcluded)===JSON.stringify(gotExcluded),'excluded 清單與排除規則不一致');
 // 高度：height 標記（牆腳～200 m 內）優先，其次 building:levels（牆腳＋3.6＋(層−1)×3.2），都沒有才依類型估層數；超過 200 m 的 height 視為輸入錯誤不採用。
 // 有 min_height 的部件（塔身、塔頂）牆腳從該高度起算，樓層數只算牆腳到牆頂這一段；heightM 一律是牆頂離地高。
 const DEFAULT_FLOORS={yes:3,residential:4,house:4,apartments:4,dormitory:5,retail:3,commercial:3,office:6,government:4,university:4,school:4,transportation:2};
 const expectHeight=t=>{const h=parseFloat(t.height),lv=parseFloat(t['building:levels']),mh=parseFloat(t.min_height),base=Number.isFinite(mh)&&mh>0?mh:0;
  if(t.height!==undefined&&Number.isFinite(h)&&h>base&&h<=200)return {source:'height',heightM:h,base,floors:Math.max(1,Math.floor((h-base-3.6)/3.2+.5)+1)};
  if(t['building:levels']!==undefined&&Number.isFinite(lv)&&lv>0)return {source:'levels',heightM:base+3.6+(lv-1)*3.2,base,floors:Math.max(1,Math.floor(lv+.5))};
  if(t.building==='warehouse')return {source:'default',heightM:base+6,base,floors:1};if(t.building==='grandstand')return {source:'default',heightM:base+8,base,floors:1};
  const floors=DEFAULT_FLOORS[t.building]??3;return {source:'default',heightM:base+3.6+(floors-1)*3.2,base,floors};};
 for(const b of sm.buildings){const f=byId.get(b.id),e=expectHeight(f.tags);
  ok(b.type===f.tags.building,'建物類型與輪廓不符：'+b.id);ok(b.heightSource===e.source,'heightSource 不對：'+b.id+' 應為 '+e.source+' 實為 '+b.heightSource);
  ok(Number.isFinite(b.heightM)&&Math.abs(b.heightM-e.heightM)<6e-4,'heightM 不對：'+b.id+' 應為 '+e.heightM+' 實為 '+b.heightM);ok(b.floors===e.floors,'floors 不對：'+b.id);
  ok(e.base>0?Math.abs(b.minHeightM-e.base)<6e-4:b.minHeightM===undefined,'minHeightM 不對：'+b.id+' 應為 '+(e.base||'（無）')+' 實為 '+b.minHeightM);}
 // 幾何（解壓後的位元組逐三角形檢查，不信 model.json 自報的數字）
 const v=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),tris=v.length/18;
 ok(v.every(Number.isFinite),'頂點資料有 NaN 或無限大');
 const tv=Array.from({length:tris},(_,t)=>{const o=t*18;return {p:[0,6,12].map(k=>[v[o+k],v[o+k+1],v[o+k+2]]),n:[v[o+3],v[o+4],v[o+5]]};});
 const [ox,oy]=data.origin,sxm=111320*Math.cos(oy*Math.PI/180);let bx0=Infinity,bx1=-Infinity,by0=Infinity,by1=-Infinity,maxH=0;
 for(const f of expected)for(const [lon,lat] of f.coordinates){const x=(lon-ox)*sxm,y=(lat-oy)*111320;bx0=Math.min(bx0,x);bx1=Math.max(bx1,x);by0=Math.min(by0,y);by1=Math.max(by1,y);}
 for(const b of sm.buildings)maxH=Math.max(maxH,b.heightM);
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];let minArea=Infinity,worstNormal=0,worstWinding=1,badFaceNormal=0;
 for(let t=0;t<tris;t++){const o=t*18,P=[0,6,12].map(k=>[v[o+k],v[o+k+1],v[o+k+2]]),N=[3,9,15].map(k=>[v[o+k],v[o+k+1],v[o+k+2]]);
  for(const p of P)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
  for(const n of N){worstNormal=Math.max(worstNormal,Math.abs(Math.hypot(...n)-1));}
  for(let i=0;i<3;i++)badFaceNormal=Math.max(badFaceNormal,Math.abs(N[1][i]-N[0][i]),Math.abs(N[2][i]-N[0][i]));
  const a=[P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]],b=[P[2][0]-P[0][0],P[2][1]-P[0][1],P[2][2]-P[0][2]],c=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=Math.hypot(...c);
  minArea=Math.min(minArea,len/2);if(len>0)worstWinding=Math.min(worstWinding,(c[0]*N[0][0]+c[1]*N[0][1]+c[2]*N[0][2])/len);}
 ok(worstNormal<=1e-3,'法線不是單位長，最大誤差 '+worstNormal);ok(badFaceNormal<=1e-4,'同一面三個頂點的法線不一致（應為逐面法線）');
 ok(minArea>=1e-6,'有退化三角形，最小面積 '+minArea);ok(worstWinding>.99,'有三角形繞序與法線相反（FrontSide 會被剔除、從外面看不到），最差內積 '+worstWinding);
 ok(near.bounds&&[0,1,2].every(i=>Math.abs(near.bounds.min[i]-lo[i])<1e-4&&Math.abs(near.bounds.max[i]-hi[i])<1e-4),'bounds 與實際頂點範圍不符');
 ok(lo[0]>=bx0-50&&hi[0]<=bx1+50&&lo[1]>=by0-50&&hi[1]<=by1+50,'網格超出建物輪廓範圍外擴 50 m：['+lo[0].toFixed(1)+','+hi[0].toFixed(1)+']×['+lo[1].toFixed(1)+','+hi[1].toFixed(1)+']');
 ok(lo[2]>=0&&hi[2]<=maxH+10,'網格高度範圍不合理：z '+lo[2].toFixed(2)+'～'+hi[2].toFixed(2)+'（最高建物 '+maxH+' m）');
 // 屋頂附屬物（示意項目）：水塔、鐵皮屋只給住宅類與 yes、樓層 ≥ 2、平屋頂、面積 ≥ 20 m² 的建物；鐵皮屋整座落在屋頂內縮 1 m 內
 const world=([lon,lat])=>[(lon-ox)*sxm,(lat-oy)*111320],inPoly=(p,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])c=!c;return c;};
 const segDist=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
 const edgeDist=(p,r)=>Math.min(...r.map((a,i)=>segDist(p,a,r[(i+1)%r.length]))),area=r=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
 const rec=new Map(sm.buildings.map(b=>[b.id,b]));let sheds=0,tanks=0;
 for(const it of sm.roofItems||[]){const b=rec.get(it.building),f=byId.get(it.building);ok(b&&f,'屋頂附屬物指向不存在的建物 '+it.building);const ring=f.coordinates.map(world);
  ok(['residential','house','apartments','yes'].includes(b.type)&&b.floors>=2&&!['gabled','hipped'].includes(f.tags['roof:shape'])&&area(ring)>=20,'屋頂附屬物放在不該放的建物上：'+it.building);
  if(it.kind==='shed'){sheds++;ok(it.wallM===2.4&&it.ridgeM===.6&&it.footprint?.length===4,'鐵皮屋尺寸不對：'+it.building);
   for(const c of it.footprint)ok(inPoly(c,ring)&&edgeDist(c,ring)>=1-2e-3,'鐵皮屋沒有整座落在屋頂內縮 1 m 的範圍內：'+it.building);
   const cx=it.footprint.reduce((s,p)=>s+p[0],0)/4,cy=it.footprint.reduce((s,p)=>s+p[1],0)/4,at=z=>tv.some(T=>T.p.some(p=>Math.abs(p[2]-z)<.011&&Math.hypot(p[0]-cx,p[1]-cy)<3.5));
   ok(Math.abs(it.baseZ-(.03+b.heightM))<.011,'鐵皮屋底面高度與屋面不符：'+it.building);ok(at(it.baseZ+2.4)&&at(it.baseZ+3),'網格裡找不到這座鐵皮屋（簷口 2.4 m、屋脊 3.0 m）：'+it.building);}
  else if(it.kind==='tank'){tanks++;ok(inPoly(it.center,ring)&&edgeDist(it.center,ring)>=.6,'水塔落在屋頂外或壓到女兒牆：'+it.building);
   ok(Math.abs(it.baseZ-(.03+b.heightM))<.011&&it.sizeM===1.2,'水塔底面高度或尺寸不對：'+it.building);
   ok(tv.some(T=>T.n[2]>.99&&T.p.every(p=>Math.abs(p[2]-(it.baseZ+it.sizeM))<.011&&Math.hypot(p[0]-it.center[0],p[1]-it.center[1])<.9)),'網格裡找不到這個水塔的頂面：'+it.building);}
  else ok(false,'未知的屋頂附屬物種類：'+it.kind);}
 // 網格層級的建物高度（不信 model.json 自報，直接量網格）：
 // (a) 平屋頂：朝上、三個頂點都在輪廓內（容許 5 cm）、標高＝牆腳 0.03＋heightM 的面，面積合計要涵蓋輪廓 90% 以上；斜屋頂：朝上的面要有頂點落在簷口標高
 //     （用「存在」不用「最低點」：遠東百貨的輪廓裡整個包著另一棟 499082686，它的屋面比較低，最低點會誤報）
 // (b) 平屋頂：貼著輪廓、法線朝外、從這棟牆腳（0.03＋minHeightM）起的垂直面，最高點＝屋面＋女兒牆 0.9 m（輪廓 < 20 m² 不砌女兒牆）
 //     （只看從這棟牆腳起的面：塔頂 499082686 與底下的 499151602 輪廓相同，不分開會量到上面那一棟的牆頂）
 {const signed=r=>r.reduce((s,a,i)=>{const c=r[(i+1)%r.length];return s+a[0]*c[1]-c[0]*a[1];},0)/2;
  for(const b of sm.buildings){const f=byId.get(b.id),ring=f.coordinates.map(world),xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),X0=Math.min(...xs)-.06,X1=Math.max(...xs)+.06,Y0=Math.min(...ys)-.06,Y1=Math.max(...ys)+.06,sgn=signed(ring)>0?1:-1;
   const cand=tv.filter(T=>T.p.every(p=>p[0]>=X0&&p[0]<=X1&&p[1]>=Y0&&p[1]<=Y1));
   const H0=.03+b.heightM,flat=!['gabled','hipped'].includes(f.tags['roof:shape']),inside=T=>T.p.every(p=>inPoly(p,ring)||edgeDist(p,ring)<=.05),ar2=T=>Math.abs((T.p[1][0]-T.p[0][0])*(T.p[2][1]-T.p[0][1])-(T.p[2][0]-T.p[0][0])*(T.p[1][1]-T.p[0][1]))/2;
   if(flat){let s=0;for(const T of cand)if(T.n[2]>.99&&T.p.every(p=>Math.abs(p[2]-H0)<.011)&&inside(T))s+=ar2(T);
    ok(s>=.9*area(ring),'網格屋面高度與 heightM 不符：'+b.id+' 標高 '+H0.toFixed(2)+' m 的屋面只有 '+s.toFixed(1)+' m²（輪廓 '+area(ring).toFixed(1)+' m²）');}
   else ok(cand.some(T=>T.n[2]>.3&&inside(T)&&T.p.some(p=>Math.abs(p[2]-H0)<.011)),'網格簷口高度與 heightM 不符：'+b.id+' 找不到標高 '+H0.toFixed(2)+' m 的簷口');
   if(flat){let top=-Infinity,nWall=0;
    const z0=.03+(b.minHeightM||0);for(const T of cand)if(Math.abs(T.n[2])<1e-3&&Math.abs(Math.min(...T.p.map(p=>p[2]))-z0)<.011&&T.p.every(p=>edgeDist(p,ring)<=.05)){const m=[0,1].map(i=>(T.p[0][i]+T.p[1][i]+T.p[2][i])/3);let best=1e9,en=null;
     ring.forEach((a,i)=>{const c=ring[(i+1)%ring.length],L=Math.hypot(c[0]-a[0],c[1]-a[1]);if(L<1e-6)return;const d=segDist(m,a,c);if(d<best){best=d;en=[sgn*(c[1]-a[1])/L,-sgn*(c[0]-a[0])/L];}});
     if(en&&T.n[0]*en[0]+T.n[1]*en[1]>=.999){nWall++;top=Math.max(top,...T.p.map(p=>p[2]));}}
    const want=.03+b.heightM+(area(ring)>=20?.9:0);ok(nWall>0&&Math.abs(top-want)<.011,'網格外牆頂高度與 heightM 不符：'+b.id+' 網格 '+top+' 應為 '+want);}}}
 ok(Array.isArray(sm.estimates)&&sm.estimates.length>=5&&sm.estimates.every(s=>typeof s==='string'&&s.length>10)&&Array.isArray(sm.sources)&&sm.sources.length>=1,'estimates／sources 缺漏（示意項目必須逐條揭露）');
 // 接線：重播頁要用這份網格，而且與站房網格並行下載（不排成先後）；驗收介面 tainanMemory.surroundings 要在
 const replay=fs.readFileSync(path.join(dir,'replay.js'),'utf8');
 ok(/json\(\s*['"]surroundings\/model\.json['"]\s*\)/.test(replay)&&/bytes\(\s*['"]surroundings\/near\.mesh\.bin['"]\s*\)/.test(replay),'replay.js 沒有讀取 surroundings/model.json 與 near.mesh.bin');
 ok(/Promise\.all\(\[[^\]]*bytes\(['"]station\/near\.mesh\.bin['"]\)[^\]]*bytes\(['"]surroundings\/near\.mesh\.bin['"]\)|Promise\.all\(\[[^\]]*bytes\(['"]surroundings\/near\.mesh\.bin['"]\)[^\]]*bytes\(['"]station\/near\.mesh\.bin['"]\)/.test(replay),'周邊網格必須與站房網格放在同一個 Promise.all 並行下載');
 ok(/window\.tainanMemory=\{[^}]*\bsurroundings\b/.test(replay),'window.tainanMemory 缺少 surroundings 鍵');
 ok(/surroundingIds\.has\(f\.id\)/.test(replay),'features 迴圈沒有略過已進周邊網格的建物（會重複擠出灰色方塊）');
 return {buildings:sm.buildings.length,triangles:near.triangleCount,gzipBytes:near.gzipBytes,drawGroups:groups.length,sheds,tanks,minTriangleAreaM2:minArea};
})();
console.log(JSON.stringify({files:Object.keys(integrity.files).length,trains:data.trains.length,routes:paths.length,samples:data.trains.reduce((n,t)=>n+t.spans.reduce((a,s)=>a+s.s.length,0),0),directions:['北上','南下'],overnight:2,integrity:'pass',continuity:'pass',surroundings}));
