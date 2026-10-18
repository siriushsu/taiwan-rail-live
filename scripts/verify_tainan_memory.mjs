// 台南地面鐵道重播的驗收（ship_web 會跑）。判準與門檻讀 scripts/tainan_memory_config.mjs；沒帶 --date 時是 2026-09-12，判準與輸出照舊。
// 用法：node scripts/verify_tainan_memory.mjs [--date YYYY-MM-DD] [--data-only] [--dir <目錄>]
//   --data-only  只驗資料：snapshot、uncertainty、source-*.json 與編組規則。不驗這個目錄的封存雜湊、網格檔、頁面程式與主站入口、
//                周邊建物與馬路（那些要等封存與頁面整合）。已封存的其他日期照樣驗雜湊。
//   --dir        改驗另一個目錄（突變測試用的副本）；判準仍照 --date 的設定。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {configFor,dateFromArgv,knownDates,generationConfigSha256} from './tainan_memory_config.mjs';
const cfg=configFor(dateFromArgv()),V=cfg.verify,DATA_ONLY=process.argv.includes('--data-only'),dirAt=process.argv.indexOf('--dir');
if(dirAt>0&&!process.argv[dirAt+1])throw Error('--dir 要接目錄');
const dir=dirAt>0?path.resolve(process.argv[dirAt+1]):cfg.outDir,read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const {makePath,distanceM,formationPoses}=await import(pathToFileURL(path.join(dir,'vendor/train-path.js')).href);
const {buildRoads,ROAD}=DATA_ONLY?{}:await import(pathToFileURL(path.join(dir,'roads.js')).href);
// 網格改存 .bin.gz（傳輸量），雜湊仍是解壓後的原始 .bin，所以封存內容逐 byte 不變。
const archivedIn=d=>f=>fs.existsSync(path.join(d,f))?fs.readFileSync(path.join(d,f)):zlib.gunzipSync(fs.readFileSync(path.join(d,f+'.gz'))),archived=archivedIn(dir);
function checkIntegrity(d){
 if(!fs.existsSync(path.join(d,'integrity.json')))throw Error(path.relative(cfg.root,d)+' 還沒有 integrity.json（封存後才驗得過；只驗資料請加 --data-only）');
 const integrity=JSON.parse(fs.readFileSync(path.join(d,'integrity.json'),'utf8')),arc=archivedIn(d);
 for(const [file,hash] of Object.entries(integrity.files))assert.equal(crypto.createHash('sha256').update(arc(file)).digest('hex'),hash,'封存檔案被改寫：'+file);
 const onDisk=[];(function visit(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())visit(f);else if(e.name!=='integrity.json')onDisk.push(path.relative(d,f).replace(/\.gz$/,''));}})(d);
 assert.deepEqual(onDisk.sort(),Object.keys(integrity.files).sort(),'封存目錄與雜湊清單不一致');
 return integrity;
}
// 驗別的日期時，已封存的日期（9/12）也一併重算雜湊，確認沒被動到。
const sealedUnchanged=knownDates().filter(d=>d!==cfg.date&&configFor(d).sealed).map(d=>(checkIntegrity(configFor(d).outDir),d));
const integrity=DATA_ONLY?null:checkIntegrity(dir),data=read('snapshot.json'),sources=read('source-schedule.json'),paths=data.routes.map(r=>makePath(r.coordinates));
// 列車網格（fleet/catalog.json）：每個封存編組都要有逐輛規則、輛數與班表一致、每輛網格的近遠兩檔都已封存。
// 重播頁開機時同樣檢查輛數，不符就整頁打不開，所以這裡要先擋。排法與 replay.js 的 arrange() 相同：各車 pitchM 首尾相接、以編組中心置中。
const fleet=read('fleet/catalog.json');
// 集電弓車（*-ep、*-tep）的網格把集電弓放在 -X 端，編組表的 flip 以此為準（取最高點下 5 cm 內的頂點＝集電弓頂；冷氣頂至少低 10 cm）；新自強號的集電弓在轉向架正上方（x≈-6.9，運轉手冊 4.1.1）。
if(!DATA_ONLY)for(const [id,m] of Object.entries(fleet.meshes).filter(([id])=>/-t?ep$/.test(id)))for(const k of ['near','far']){const v=new Float32Array(new Uint8Array(archived('fleet/'+m[k].file)).buffer);let top=-Infinity;for(let i=2;i<v.length;i+=10)top=Math.max(top,v[i]);const xs=[];for(let i=2;i<v.length;i+=10)if(v[i]>top-.05)xs.push(v[i-2]);const cx=xs.reduce((a,x)=>a+x,0)/xs.length;assert.ok(cx<-1,'集電弓不在網格的 -X 端：'+id+' '+k+' x='+cx.toFixed(2));if(id==='emu3000-ep')assert.ok(Math.abs(cx+6.9)<.7,'新自強號集電弓不在轉向架上方：'+k+' x='+cx.toFixed(2));}
const arranged=tr=>{const rule=fleet.formations[tr.formation.id];assert.ok(rule&&rule.cars.length===tr.formation.parts.length,'缺少編組規則或輛數與班表不符：'+tr.formation.id);const cars=rule.listedFor&&tr.direction!==rule.listedFor?rule.cars.slice().reverse().map(c=>({mesh:c.mesh,flip:!c.flip})):rule.cars;const parts=cars.map(c=>{const m=fleet.meshes[c.mesh];assert.ok(m&&m.pitchM>0,'編組引用了不存在的網格：'+c.mesh);if(integrity)for(const k of ['near','far'])assert.ok(integrity.files['fleet/'+m[k]?.file],'網格未封存：'+c.mesh+' '+k);return {mesh:c.mesh,flip:c.flip,lengthM:m.pitchM,offsetM:0};});let front=parts.reduce((a,c)=>a+c.lengthM,0)/2;for(const c of parts){c.offsetM=front-c.lengthM/2;front-=c.lengthM;}return parts;};
assert.equal(data.date,cfg.date);assert.equal(data.trains.length,V.trains);assert.equal(new Set(data.trains.map(t=>t.id)).size,V.trains);
const nDir=d=>data.trains.filter(t=>t.direction===d).length;assert.ok(data.trains.every(t=>t.direction==='北上'||t.direction==='南下'),'方向只能是北上或南下');
if(V.directions){assert.equal(nDir('北上'),V.directions.北上);assert.equal(nDir('南下'),V.directions.南下);}else assert.ok(nDir('北上')>0&&nDir('南下')>0,'兩個方向都要有班次');
assert.equal(data.trains.filter(t=>t.serviceDate===cfg.previous).length,V.overnight);
assert.ok(data.rails.length>30);assert.ok(data.rails.every(r=>r.tags.railway==='rail'&&!r.tags.construction&&(cfg.underground||!r.tags.tunnel)));
for(const tr of data.trains){assert.ok(sources.trains.some(s=>s.serviceDate===tr.serviceDate&&s.train===tr.train));const shown=arranged(tr);
 for(const [i,span] of tr.spans.entries()){
  assert.ok(span.start>=0&&span.start+span.s.length-1<=86399);assert.ok(span.s.length>0);
  const route=paths[span.route];for(const [j,s] of span.s.entries()){assert.ok(Number.isFinite(s)&&s>=0&&s<=route.length);if(j)assert.ok(s>=span.s[j-1]-.001,'里程不能倒退：'+tr.train);}
  if(i){const last=tr.spans[i-1];if(span.start===last.start+last.s.length-1)assert.ok(distanceM(route.at(span.s[0]).coordinate,paths[last.route].at(last.s.at(-1)).coordinate)<.02,'路段切換跳位：'+tr.train);}
  for(const s of [span.s[0],span.s[Math.floor(span.s.length/2)],span.s.at(-1)]){assert.ok(formationPoses(route,s,1,tr.formation.parts),'編組落在未知路徑：'+tr.train);assert.ok(formationPoses(route,s,1,shown),'真實比例編組落在未知路徑：'+tr.train);}
 }
}
// 任意日期更新都不得讓歷史頁改去讀取網站的可變資料／API。
if(!DATA_ONLY){
 for(const name of ['replay.js','vendor/train-path.js','vendor/mesh.js']){const code=fs.readFileSync(path.join(dir,name),'utf8');assert.ok(!/(?:\.\.\/)+(?:data|rail-3d)|\/api\//.test(code),name+' 依賴可變的正式資料');}
}
const uncertainty=read('uncertainty.json');assert.equal(uncertainty.date,data.date);if(V.uncertaintyIntervals!=null)assert.equal(uncertainty.intervals.length,V.uncertaintyIntervals);
for(const i of uncertainty.intervals){assert.ok(i.start>=0&&i.end<=86399&&i.end>=i.start);assert.equal(i.trains.length,2);assert.ok(i.trains.every(id=>data.trains.some(t=>t.id===id)));}
// ── 周邊建物（surroundings/）：低細節建物網格（使用者 2026-09-30「不要是灰色方塊」）。
// 規則與 prototypes/tiny-trains/blender/tainan-memory-v1/surroundings.py 各自獨立實作一次；輸入只用封存的 snapshot.json、station/model.json，
// 以及封存輪廓漏掉的香格里拉飯店塔身（同資料夾 tower-parts-source.json，雜湊要與 model.json 的 sources 一致）。
// 每條斷言的訊息都以「周邊建物：」開頭，突變測試靠它辨認是哪一條紅。
const surroundings=DATA_ONLY?null:(()=>{
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
 const PARTS='prototypes/tiny-trains/blender/tainan-memory-v1/tower-parts-source.json',partsRaw=fs.readFileSync(path.join(cfg.root,PARTS)),partsSrc=JSON.parse(partsRaw.toString('utf8'));
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
 // 頂上整個疊著另一個部件的建物（那個部件的牆腳＝這棟牆頂、差 5 cm 內，而且這棟輪廓的頂點與邊中點都在它輪廓內或 5 cm 內）：不砌女兒牆、不放屋頂附屬物
 const ringOf=new Map(sm.buildings.map(b=>[b.id,byId.get(b.id).coordinates.map(world)]));
 const covers=(outer,inner)=>inner.every((p,i)=>{const q=inner[(i+1)%inner.length];return [p,[(p[0]+q[0])/2,(p[1]+q[1])/2]].every(x=>inPoly(x,outer)||edgeDist(x,outer)<=.05);});
 const capped=b=>sm.buildings.some(c=>c!==b&&c.minHeightM>0&&Math.abs(c.minHeightM-b.heightM)<=.05&&covers(ringOf.get(c.id),ringOf.get(b.id)));
 for(const it of sm.roofItems||[]){const b=rec.get(it.building),f=byId.get(it.building);ok(b&&f,'屋頂附屬物指向不存在的建物 '+it.building);const ring=f.coordinates.map(world);
  ok(['residential','house','apartments','yes'].includes(b.type)&&b.floors>=2&&!['gabled','hipped'].includes(f.tags['roof:shape'])&&area(ring)>=20&&!capped(b),'屋頂附屬物放在不該放的建物上：'+it.building);
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
 // (b) 平屋頂：貼著輪廓、法線朝外、從這棟牆腳（0.03＋minHeightM）起的垂直面，最高點＝屋面＋女兒牆 0.9 m（輪廓 < 20 m² 或頂上整個疊著另一個部件的不砌女兒牆）
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
    const want=.03+b.heightM+(area(ring)>=20&&!capped(b)?.9:0);ok(nWall>0&&Math.abs(top-want)<.011,'網格外牆頂高度與 heightM 不符：'+b.id+' 網格 '+top+' 應為 '+want);}}}
 // 不是灰色方塊（使用者 2026-09-30「不要是灰色方塊」）：外牆至少 6 種彼此分得開的顏色（sRGB 距離 ≥ 0.05）、中性灰（sRGB 最大最小差 < 0.04）的外牆
 // 不超過外牆面積一半、窗帶顏色跟每一種外牆色都差 0.15 以上、窗帶面積至少是外牆的 15%。面積直接量網格裡的垂直面（外牆色組也拿來畫部分屋面，不算）。
 {const srgb=c=>c.map(x=>x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]),chroma=c=>Math.max(...c)-Math.min(...c);
  const vArea=g=>{let s=0;for(let t=g.start/3;t<(g.start+g.count)/3;t++){const T=tv[t];if(Math.abs(T.n[2])>.01)continue;const a=[0,1,2].map(i=>T.p[1][i]-T.p[0][i]),b=[0,1,2].map(i=>T.p[2][i]-T.p[0][i]);s+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;}return s;};
  const walls=groups.filter(g=>g.name.startsWith('wall_')),glass=groups.find(g=>g.name==='glass');ok(walls.length>0&&glass,'找不到外牆（wall_*）或窗帶（glass）的材質組');
  const distinct=[];for(const g of walls){const c=srgb(g.color);if(distinct.every(d=>dist(d,c)>=.05))distinct.push(c);}
  ok(distinct.length>=6,'外牆只有 '+distinct.length+' 種分得開的顏色（至少 6 種，不能退回灰色方塊）');
  const wallArea=walls.map(g=>[g,vArea(g)]),total=wallArea.reduce((s,[,a])=>s+a,0),grey=wallArea.filter(([g])=>chroma(srgb(g.color))<.04).reduce((s,[,a])=>s+a,0);
  ok(total>0&&grey<=.5*total,'中性灰外牆佔外牆面積 '+(100*grey/total).toFixed(1)+'%（上限 50%，不能退回灰色方塊）');
  const gc=srgb(glass.color),near=walls.filter(g=>dist(srgb(g.color),gc)<.15).map(g=>g.name);ok(near.length===0,'窗帶顏色跟外牆太像、看不出窗：'+near.join(','));
  const ga=vArea(glass);ok(ga>=.15*total,'窗帶面積只有外牆的 '+(100*ga/total).toFixed(1)+'%（至少 15%）');}
 // 看得到的共面重疊（z-fighting）：朝向相同（內積 > 0.9999）、同一平面（差 5 mm 內）、材質不同、投影重疊 > 0.01 m² 的兩個三角形，而且重疊區的質心或任一頂點
 // （往質心縮 10%）沿法線往外 0.1 m 不在任何建物量體（輪廓內、牆腳～屋面）裡＝從外面看得到，會閃。材質是 FrontSide，朝向相反的共面不會互相閃，不算。
 {const gid=new Int32Array(tris);groups.forEach((g,i)=>{for(let t=g.start/3;t<(g.start+g.count)/3;t++)gid[t]=i;});
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const keyOf=(n,d)=>[Math.round(n[0]*50),Math.round(n[1]*50),Math.round(n[2]*50),Math.round(d*20)],buckets=new Map();
  const planeD=tv.map((T,t)=>{const d=dot(T.n,T.p[0]),k=keyOf(T.n,d).join(',');if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(t);return d;});
  const area2=P=>P.reduce((s,a,i)=>{const b=P[(i+1)%P.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
  const clip=(P,a,b)=>{const out=[],side=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);for(let i=0;i<P.length;i++){const p=P[i],q=P[(i+1)%P.length],sp=side(p),sq=side(q);
    if(sp>=0)out.push(p);if((sp>=0)!==(sq>=0)){const t=sp/(sp-sq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}return out;};
  const vol=sm.buildings.map(b=>({ring:ringOf.get(b.id),z0:.03+(b.minHeightM||0),z1:.03+b.heightM})),enclosed=q=>vol.some(V=>q[2]>=V.z0-1e-6&&q[2]<=V.z1+1e-6&&inPoly(q,V.ring));
  let pairs=0,overlap=0;const where=[];
  for(let t=0;t<tris;t++){const A=tv[t],k=keyOf(A.n,planeD[t]);
   for(let i=0;i<81;i++){const kk=[k[0]+(i%3)-1,k[1]+(Math.floor(i/3)%3)-1,k[2]+(Math.floor(i/9)%3)-1,k[3]+Math.floor(i/27)-1].join(','),list=buckets.get(kk);if(!list)continue;
    for(const u of list){if(u<=t||gid[u]===gid[t])continue;const B=tv[u];if(dot(A.n,B.n)<.9999||Math.abs(planeD[u]-planeD[t])>.005)continue;
     const r=Math.abs(A.n[2])<.9?[0,0,1]:[1,0,0],e1=(c=>c.map(x=>x/Math.hypot(...c)))(cross(A.n,r)),e2=cross(A.n,e1),pr=p=>[dot(p,e1),dot(p,e2)];
     let P=A.p.map(pr),Q=B.p.map(pr);if(area2(P)<0)P.reverse();if(area2(Q)<0)Q.reverse();
     for(let j=0;j<3&&P.length;j++)P=clip(P,Q[j],Q[(j+1)%3]);const ar=P.length>=3?Math.abs(area2(P)):0;if(ar<=.01)continue;
     const c=[P.reduce((s,p)=>s+p[0],0)/P.length,P.reduce((s,p)=>s+p[1],0)/P.length],to3=q=>[0,1,2].map(j=>planeD[t]*A.n[j]+q[0]*e1[j]+q[1]*e2[j]+.1*A.n[j]);
     if([c,...P.map(q=>[q[0]+(c[0]-q[0])*.1,q[1]+(c[1]-q[1])*.1])].every(q=>enclosed(to3(q))))continue;const c3=to3(c);
     pairs++;overlap+=ar;if(where.length<3)where.push(groups[gid[t]].name+'／'+groups[gid[u]].name+' 在 ('+c3.map(x=>x.toFixed(1)).join(', ')+')');}}}
  ok(pairs===0,'有看得到的共面重疊（不同材質疊在同一個面上會閃爍）：'+pairs+' 對、'+overlap.toFixed(1)+' m²，例如 '+where.join('；'));}
 ok(Array.isArray(sm.estimates)&&sm.estimates.length>=5&&sm.estimates.every(s=>typeof s==='string'&&s.length>10)&&Array.isArray(sm.sources)&&sm.sources.length>=1,'estimates／sources 缺漏（示意項目必須逐條揭露）');
 // 接線：重播頁要用這份網格，而且與站房網格並行下載（不排成先後）；驗收介面 tainanMemory.surroundings 要在
 const replay=fs.readFileSync(path.join(dir,'replay.js'),'utf8');
 ok(/json\(\s*['"]surroundings\/model\.json['"]\s*\)/.test(replay)&&/bytes\(\s*['"]surroundings\/near\.mesh\.bin['"]\s*\)/.test(replay),'replay.js 沒有讀取 surroundings/model.json 與 near.mesh.bin');
 ok(/Promise\.all\(\[[^\]]*bytes\(['"]station\/near\.mesh\.bin['"]\)[^\]]*bytes\(['"]surroundings\/near\.mesh\.bin['"]\)|Promise\.all\(\[[^\]]*bytes\(['"]surroundings\/near\.mesh\.bin['"]\)[^\]]*bytes\(['"]station\/near\.mesh\.bin['"]\)/.test(replay),'周邊網格必須與站房網格放在同一個 Promise.all 並行下載');
 ok(/window\.tainanMemory=\{[^}]*\bsurroundings\b/.test(replay),'window.tainanMemory 缺少 surroundings 鍵');
 ok(/surroundingIds\.has\(f\.id\)/.test(replay),'features 迴圈沒有略過已進周邊網格的建物（會重複擠出灰色方塊）');
 return {buildings:sm.buildings.length,triangles:near.triangleCount,gzipBytes:near.gzipBytes,drawGroups:groups.length,sheds,tanks,minTriangleAreaM2:minArea};
})();
// ── 馬路（roads.js）：柏油、標線、人行道（使用者 2026-09-30「連馬路、人行道細節也做更多一點」，選 A：只用封存資料）。
// 路寬、人行道側別、標線條數在這裡依 OSM 標籤獨立重算（不呼叫 roads.js 的判斷函式）；幾何另外逐三角形檢查：
// 人行道與標線不准落在別條不平行道路的車道裡、不准離軌道中心 2 m 內，人行道只准出現在標了有的那一側，斷開也不能過頭。
// 每條斷言的訊息都以「馬路：」開頭，突變測試靠它辨認是哪一條紅。
const roads=DATA_ONLY?null:(()=>{
 const ok=(c,m)=>assert.ok(c,'馬路：'+m),has=v=>v==='yes'||v==='separate',byId=new Map(data.features.map(f=>[f.id,f]));
 const sx=111320*Math.cos(data.origin[1]*Math.PI/180),world=p=>[(p[0]-data.origin[0])*sx,(p[1]-data.origin[1])*111320],rails=data.rails.map(r=>r.coordinates.map(world));
 const r=buildRoads(data.features,world,rails),L=r.layers;
 ok(r.ways.length===data.features.filter(f=>f.tags.highway).length,'道路條數與封存快照不同');
 ok(Object.keys(L).join()==='asphalt,sidewalk,curb,white,yellow','圖層應為柏油、人行道、路緣、白線、黃線五層');
 const side=(t,s)=>{const v=t['sidewalk:'+s],b=t['sidewalk:both'];if(has(v))return true;if(v==='no')return false;if(has(b))return true;if(b==='no')return false;return ['both','yes','separate',s].includes(t.sidewalk);};
 const geo=new Map();
 for(const w of r.ways){const t=byId.get(w.id).tags,n=parseInt(t.lanes,10)||0,one=t.oneway==='yes',tunnel=t.tunnel==='yes';
  const W=n?n*3.3+1.2:({primary:one?10:15,secondary:one?9:12,tertiary:one?7:9}[t.highway]||6);
  const left=!tunnel&&(one?t.sidewalk==='left'||has(t['sidewalk:left']):side(t,'left')),right=!tunnel&&side(t,'right');
  const lines=t.lane_markings==='no'||tunnel?0:(W>=6?2:0)+(one?Math.max(0,n-1):n===1?0:(n>=4||(!n&&(t.highway==='primary'||t.highway==='secondary'))?2:1)+2*Math.max(0,Math.floor(n/2)-1));
  ok(Math.abs(w.W-W)<1e-9,`路寬 ${w.id}（${t.name}）畫 ${w.W} m，依車道數與道路等級應為 ${W} m`);
  ok(w.left===left&&w.right===right,`人行道側別 ${w.id}（${t.name}）畫 ${w.left}/${w.right}，依標籤應為 ${left}/${right}`);
  ok(w.lines===lines,`標線條數 ${w.id}（${t.name}）畫 ${w.lines} 條，依標籤應為 ${lines} 條`);
  if(tunnel)ok(Object.values(w.tri).every(([,c])=>c===0),`地下道 ${w.id}（${t.name}）不該畫在地面上`);
  const P=[];for(const c of byId.get(w.id).coordinates){const p=world(c),q=P[P.length-1];if(!q||Math.hypot(p[0]-q[0],p[1]-q[1])>.01)P.push(p);}geo.set(w.id,{P,W,tunnel});}
 const CELL=30,roadGrid=new Map(),railGrid=new Map(),cell=(x,y)=>Math.floor(x/CELL)+','+Math.floor(y/CELL);
 const put=(g,a,b,pad,item)=>{for(let i=Math.floor((Math.min(a[0],b[0])-pad)/CELL);i<=Math.floor((Math.max(a[0],b[0])+pad)/CELL);i++)for(let j=Math.floor((Math.min(a[1],b[1])-pad)/CELL);j<=Math.floor((Math.max(a[1],b[1])+pad)/CELL);j++){const k=i+','+j;if(!g.has(k))g.set(k,[]);g.get(k).push(item);}};
 for(const [id,g] of geo)if(!g.tunnel)for(let k=0;k<g.P.length-1;k++)put(roadGrid,g.P[k],g.P[k+1],g.W/2,[id,g.P[k],g.P[k+1],g.W]);
 for(const rl of rails)for(let k=0;k<rl.length-1;k++)put(railGrid,rl[k],rl[k+1],3,[rl[k],rl[k+1]]);
 const segDist=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy,u=L2?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/L2)):0;return Math.hypot(x-a[0]-dx*u,y-a[1]-dy*u);};
 const cosPar=Math.cos(25*Math.PI/180);
 const onOther=(x,y,self,d)=>{for(const [id,a,b,W] of roadGrid.get(cell(x,y))||[]){if(id===self)continue;const l=Math.hypot(b[0]-a[0],b[1]-a[1]),ex=(b[0]-a[0])/l,ey=(b[1]-a[1])/l;if(Math.abs(ex*d[0]+ey*d[1])>cosPar)continue;const u=(x-a[0])*ex+(y-a[1])*ey;if(u>=0&&u<=l&&Math.abs((x-a[0])*ey-(y-a[1])*ex)<W/2-.3)return id;}return 0;};
 const onRail=(x,y)=>(railGrid.get(cell(x,y))||[]).some(([a,b])=>segDist(x,y,a,b)<ROAD.railClearM-.2);
 let checked=0,onRoad=0,nearRail=0,wrongSide=0,flagged=0,keptHalf=0,flagLen=0,keptLen=0;const eg=[];
 for(const w of r.ways){const g=geo.get(w.id);
  for(const layer of ['sidewalk','white','yellow']){const [s,c]=w.tri[layer],pos=L[layer].position;
   for(let i=s;i<s+c;i++){const o=i*9,x=(pos[o]+pos[o+3]+pos[o+6])/3,y=(pos[o+1]+pos[o+4]+pos[o+7])/3;checked++;
    let best=1e18,k0=0;for(let k=0;k<g.P.length-1;k++){const d=segDist(x,y,g.P[k],g.P[k+1]);if(d<best){best=d;k0=k;}}
    const a=g.P[k0],b=g.P[k0+1],l=Math.hypot(b[0]-a[0],b[1]-a[1]),d=[(b[0]-a[0])/l,(b[1]-a[1])/l],other=onOther(x,y,w.id,d);
    if(other){onRoad++;if(eg.length<4)eg.push(`${layer} ${w.id}→${other}`);}
    if(onRail(x,y))nearRail++;
    if(layer==='sidewalk'&&(d[0]*(y-a[1])-d[1]*(x-a[0])>0?!w.left:!w.right))wrongSide++;}}
  let len=0;for(let k=1;k<g.P.length;k++)len+=Math.hypot(g.P[k][0]-g.P[k-1][0],g.P[k][1]-g.P[k-1][1]);
  for(const sd of ['left','right'])if(w[sd]){const k=w.keep[sd].reduce((a,[p,q])=>a+q-p,0);flagLen+=len;keptLen+=k;if(len>=40){flagged++;if(k>=len/2)keptHalf++;}}}
 // 三種幾何錯誤一次全列（突變測試看各自的數字，不靠斷言順序）
 ok(onRoad===0&&nearRail===0&&wrongSide===0,`幾何：落在別條路車道 ${onRoad}、離軌道太近 ${nearRail}、畫錯邊 ${wrongSide} 個三角形（例：${eg.join('、')}）`);
 // 斷開不能過頭：現況保留 96.2%、40 m 以上的 326 側全部過半；轉角退縮放大到約 8 m 就會低於 93%（突變 R8 放到 40 m：80.5%、282 側）。
 ok(flagLen>0&&keptLen/flagLen>=.93&&flagged>=100&&keptHalf>=.95*flagged,`人行道斷開過頭：保留長度 ${(100*keptLen/flagLen).toFixed(1)}%（應 ≥ 93%），40 m 以上的 ${flagged} 側有 ${keptHalf} 側留下一半以上（應 ≥ 95%）`);
 const total=Object.values(r.stats.triangles).reduce((a,b)=>a+b,0);ok(total<=90000,`三角形 ${total} 超過 9 萬`);
 ok(L.white.position.length>0&&L.yellow.position.length>0&&L.sidewalk.position.length>0&&L.curb.position.length>0,'有一層是空的');
 const replay=fs.readFileSync(path.join(dir,'replay.js'),'utf8'),about=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 ok(!/f\.tags\.highway\)ribbons/.test(replay),'replay.js 還在用舊的米白色帶子畫馬路');
 ok(/\broads:\{meshes:roadMeshes/.test(replay),'window.tainanMemory 缺少 roads 鍵');
 ok(/馬路依 OpenStreetMap/.test(about)&&/示意/.test(about.slice(about.indexOf('馬路依 OpenStreetMap'))),'「關於這一天」沒寫馬路的資料來源與示意');
 return {ways:r.ways.length,tunnels:r.stats.tunnels,sidewalkSides:flagged,keptHalf,keptLengthPct:+(100*keptLen/flagLen).toFixed(1),marked:r.stats.marked,triangles:total,checked};
})();
// ── 車身深重疊（設定有 ambiguity.deepOverlapM 的日期；不看 timing，預覽版也跑）：兩車車身橫向重疊的深度超過門檻的秒，每一秒都要落在
// uncertainty.json 含這兩班的時段內。深度＝(車寬A＋車寬B)/2 − 兩車車身中心線之間的最短距離。車身＝路段上 s±L/2 的中心線，
// L＝max(編組長, 車輛目錄節距加總)，與 replay.js 排車身的長度相同。兩車互量：一車車身每 0.5 m 取點，量到另一車中心線折線的最短距離，
// 最近點在另一車車身的端點上（前後相接、沒有並排）的點不算。與 build_tainan_track_ambiguities.mjs 各算各的：取樣是 0.5 m（build 是 1 m），
// 先用 2 m 步長粗篩，不看 way，不引用 build 的任何函式。每條斷言的訊息都以「深重疊：」開頭。
function checkDeepOverlap(){
 const T=cfg.ambiguity.deepOverlapM,ok=(c,m)=>assert.ok(c,'深重疊：'+m),STEP=.5,BAND=.15;
 ok(Number.isFinite(T)&&T>0,'ambiguity.deepOverlapM 要是正數：'+T);
 const hms=x=>[Math.floor(x/3600),Math.floor(x%3600/60),x%60].map(n=>String(n).padStart(2,'0')).join(':');
 const [ox,oy]=data.origin,kx=111320*Math.cos(oy*Math.PI/180),xy=c=>[(c[0]-ox)*kx,(c[1]-oy)*111320];
 const size=new Map(data.trains.map(t=>{const f=fleet.formations[t.formation.id],ms=f.cars.map(c=>fleet.meshes[c.mesh]);return [t.id,{L:Math.max(t.formation.lengthM,ms.reduce((a,m)=>a+m.pitchM,0)),w:Math.max(...ms.map(m=>m.widthM))}];}));
 const line=(ri,s,L,step)=>{const P=paths[ri],s0=Math.max(0,s-L/2),s1=Math.min(P.length,s+L/2),out=[];for(let x=s0;x<s1;x+=step)out.push(xy(P.at(x).coordinate));out.push(xy(P.at(s1).coordinate));return out;};
 // A 的取樣點到 B 折線的最短距離；最近點是 B 的起點或終點（垂足在端點之外）的取樣點不算。
 const clear=(A,B)=>{let m=Infinity;for(const q of A){let best=Infinity,atEnd=false;
   for(let i=0;i+1<B.length;i++){const ax=B[i][0],ay=B[i][1],dx=B[i+1][0]-ax,dy=B[i+1][1]-ay,l=dx*dx+dy*dy,t=l?((q[0]-ax)*dx+(q[1]-ay)*dy)/l:0,u=Math.max(0,Math.min(1,t)),d=Math.hypot(q[0]-ax-u*dx,q[1]-ay-u*dy);
    if(d<best){best=d;atEnd=(i===0&&t<=0)||(i===B.length-2&&t>=1);}}
   if(!atEnd&&best<m)m=best;}return m;};
 const depth=(A,B,half)=>half-Math.min(clear(A,B),clear(B,A));
 // 正向／反向對照（不靠當天資料）：直線車身，同位置的兩份＝車寬；橫移 d 剩 車寬−d；橫移到車寬以外不重疊；前後相接不算；前後重疊的部分仍算整個車寬。
 {const w=size.get(data.trains[0].id).w,A=Array.from({length:201},(_,i)=>[i*.5,0]),mv=(dx,dy)=>A.map(([x,y])=>[x+dx,y+dy]),near=(x,y)=>Math.abs(x-y)<1e-9;
  ok(near(depth(A,mv(0,0),w),w)&&near(depth(A,mv(0,1.5),w),w-1.5)&&near(depth(A,mv(0,2),w),w-2),'幾何對照：同位置、橫移 1.5 m、橫移 2 m 的深度不是車寬、車寬−1.5、車寬−2');
  ok(depth(A,mv(0,10),w)<0&&depth(A,mv(100.5,0),w)<0&&near(depth(A,mv(90,0),w),w),'幾何對照：橫移 10 m 或前後相接（隔 0.5 m）不該重疊，前後重疊 10 m 要算整個車寬');}
 // 每秒的活動車（同一秒落在兩段路段時取前一段，與 replay.js 的 spans.find 相同）
 const act=Array.from({length:86400},()=>[]);
 for(const tr of data.trains){let last=-1;for(const sp of tr.spans)for(let j=0;j<sp.s.length;j++){const t=sp.start+j;if(t<=last)continue;last=t;act[t].push({id:tr.id,ri:sp.route,s:sp.s[j]});}}
 const memo=new Map(),deepOf=(a,b)=>{const k=a.ri+':'+a.s+':'+a.id+'|'+b.ri+':'+b.s+':'+b.id;if(memo.has(k))return memo.get(k);
  const A=size.get(a.id),B=size.get(b.id),half=(A.w+B.w)/2,ca=line(a.ri,a.s,A.L,2),cb=line(b.ri,b.s,B.L,2);
  // 粗篩：2 m 步長量到的最短距離超過 half＋3 m 就不細量（取樣誤差遠小於 3 m）
  const d=Math.min(clear(ca,cb),clear(cb,ca))<=half+3?depth(line(a.ri,a.s,A.L,STEP),line(b.ri,b.s,B.L,STEP),half):null;
  memo.set(k,d);if(memo.size>100000)memo.clear();return d;};
 const secByPair=new Map();let pairSec=0,deepSec=0,band=0,maxDepth=0;
 for(let t=0;t<86400;t++){const A=act[t];if(A.length<2)continue;const c=A.map(a=>xy(paths[a.ri].at(a.s).coordinate));
  for(let i=0;i<A.length;i++)for(let j=i+1;j<A.length;j++){
   if(Math.hypot(c[i][0]-c[j][0],c[i][1]-c[j][1])>(size.get(A[i].id).L+size.get(A[j].id).L)/2+10)continue;
   pairSec++;const d=deepOf(A[i],A[j]);if(d==null)continue;
   if(Math.abs(d-T)<=BAND)band++;
   if(d>T){deepSec++;maxDepth=Math.max(maxDepth,d);const k=[A[i].id,A[j].id].sort().join('|');if(!secByPair.has(k))secByPair.set(k,[]);secByPair.get(k).push({t,d});}}}
 ok(pairSec>0,'整天沒有任何兩班車的車身靠在一起，判準看不到車對');
 const noOf=new Map(data.trains.map(t=>[t.id,t.train])),groups=[],uncovered=[];
 for(const [k,list] of secByPair){const ids=k.split('|'),cov=t=>uncertainty.intervals.some(i=>i.start<=t&&t<=i.end&&i.trains.length===2&&i.trains.includes(ids[0])&&i.trains.includes(ids[1]));let g=null;
  for(const {t,d} of list){if(!cov(t))uncovered.push(ids.map(id=>noOf.get(id)).join('/')+' '+hms(t)+'（'+d.toFixed(2)+' m）');
   if(g&&t-g.end<=2){g.end=t;g.sec++;g.maxDepthM=Math.max(g.maxDepthM,d);}else groups.push(g={trains:ids.map(id=>noOf.get(id)).join('/'),start:t,end:t,sec:1,maxDepthM:d});}}
 ok(uncovered.length===0,'車身橫向重疊超過 '+T+' m 的秒沒有被不確定時段涵蓋（'+uncovered.length+' 秒）：'+uncovered.slice(0,6).join('；'));
 return {secByPair,report:{thresholdM:T,stepM:STEP,pairSecChecked:pairSec,deepPairSec:deepSec,maxDepthM:+maxDepth.toFixed(2),uncovered:0,
  secondsWithinBandOfThreshold:{bandM:BAND,seconds:band},
  groups:groups.sort((a,b)=>a.start-b.start).map(g=>({trains:g.trains,span:hms(g.start)+'–'+hms(g.end),sec:g.sec,maxDepthM:+g.maxDepthM.toFixed(2)}))}};
}
// ── 實測重播（timing＝observed 的日期）：設計文件第 7 節的判準。分兩部分：通用的（逐站時刻與原始資料、實測精度、物理可行性、
// 停站、股道占用與不確定時段）每個實測日期都跑；10/16 專屬的（重點車的錨點、單線雙向、時間軸與說明檔、封鎖後的對向占用、
// 單線解不掉的時段）只在設定有對應欄位時跑（cfg.singleLine、verify.markedTrains／eventNotes）。
// 只讀這個目錄與設定檔，不讀 .cache，也不讀主站 index.html：車種極速是 build 凍結在
// timingSource.speedCaps 的值，主站日後調整極速表，已封存的一天不該跟著變紅。每條斷言的訊息都以「實測重播：」開頭。
function checkObserved(){
 const ok=(c,m)=>assert.ok(c,'實測重播：'+m),SL=cfg.singleLine,norm=n=>String(n).replace(/台/g,'臺'),U=uncertainty;
 const hms=x=>[Math.floor(x/3600),Math.floor(x%3600/60),x%60].map(n=>String(n).padStart(2,'0')).join(':'),hm=x=>hms(x).slice(0,5);
 const byId=new Map(data.trains.map(t=>[t.id,t])),byNo=(no,day)=>data.trains.find(t=>t.train===String(no)&&t.serviceDate===day),stopOf=(t,n)=>t?.stops.find(s=>norm(s.name)===norm(n));
 const inside=p=>p[0]>=cfg.bounds[0]&&p[0]<=cfg.bounds[2]&&p[1]>=cfg.bounds[1]&&p[1]<=cfg.bounds[3],pairOf=(i,a,b)=>i.trains.length===2&&i.trains.includes(a)&&i.trains.includes(b);
 const TS=data.timingSource,SO=read('source-observations.json');
 // 1. 頂層欄位；重建參數要與 tainan_actuals.py 的 P 相同（第 4 段照這組參數從原始列重算錨點）
 ok(data.defaultSec===cfg.defaultSec,'defaultSec 應為 '+cfg.defaultSec+'，實為 '+data.defaultSec);
 ok(TS&&['tdx-historical','d1'].includes(TS.primary)&&Number.isInteger(TS.histRows)&&Number.isInteger(TS.d1Rows)&&TS.calibration?.stopErrSec&&Array.isArray(TS.scheduledTrains),'timingSource 欄位不完整');
 const RP={A_off_d1:32,dep_bias:30,min_dwell:20,max_incons:900,hold_flag_s:90};
 for(const [k,v] of Object.entries(RP))ok(TS.calibration.params?.[k]===v,'timingSource 記的重建參數 '+k+' 應為 '+v);
 // 車種極速的凍結表：build 當下從主站 index.html 的 PERF_RULES／PERF_BY_TYPE（resolvePerf）依 (carName, typeName) 凍結，第 5 段照班次的
 // carName／typeName 查它。對應方式與原本即時讀 resolvePerf 相同（範圍內只有台鐵，高鐵與 DR1000 的判斷皆為否）。
 const SC=TS.speedCaps,classKey=(carName,typeName)=>JSON.stringify([carName??'',typeName??'']);
 ok(SC&&typeof SC.source==='string'&&/^[0-9a-f]{64}$/.test(SC.indexSha256)&&Array.isArray(SC.caps)&&SC.caps.length>0,'timingSource.speedCaps 欄位不完整');
 ok(SC.caps.every(c=>typeof c.carName==='string'&&typeof c.typeName==='string'&&Number.isFinite(c.capKmh)&&c.capKmh>0)&&new Set(SC.caps.map(c=>classKey(c.carName,c.typeName))).size===SC.caps.length,'timingSource.speedCaps.caps 有重複的車種，或極速不是正數');
 const capOfClass=new Map(SC.caps.map(c=>[classKey(c.carName,c.typeName),c.capKmh]));
 // 2. 逐站時刻：欄位齊全、不倒退；表定時刻與停靠／通過逐站等於 source-schedule 的原始項目；整班沒有實測的車，停靠站照表定（通過站的時刻是剖面回填）
 const schedOf=new Map(sources.trains.map(s=>[s.serviceDate+':'+s.train,s])),fileSha=new Map(data.sources.filter(s=>s.file).map(s=>[s.file,s.sha256]));
 ok(sources.date===cfg.date&&sources.trains.length===data.trains.length&&data.trains.every(t=>schedOf.has(t.serviceDate+':'+t.train)),'source-schedule 的班次與 snapshot 不一致');
 for(const s of sources.schedules)ok(fileSha.get(s.file)===s.sha256,'source-schedule 記的班表雜湊與 snapshot.sources 不符：'+s.file);
 ok(fileSha.get('index.html')===SC.indexSha256,'timingSource.speedCaps 記的 index.html 雜湊與 snapshot.sources 不符');
 // 設定檔的來源紀錄：snapshot.sources 記的是產生資料所用的設定欄位的雜湊（不是整個檔）。照快照記的欄位名單重算，要等於目前設定檔的值；
 // 不符＝產生資料的設定改了而快照沒有重建。verify 的門檻、主站入口與註解不在欄位名單內，改了不影響。
 const CR=data.sources.filter(s=>s.config==='scripts/tainan_memory_config.mjs');
 ok(CR.length===1&&CR[0].date===cfg.date&&Array.isArray(CR[0].fields)&&CR[0].fields.length>0&&CR[0].fields.every(f=>typeof f==='string')&&!CR[0].fields.includes('verify')&&/^[0-9a-f]{64}$/.test(CR[0].sha256),'snapshot.sources 沒有（或有多筆）設定檔的欄位雜湊紀錄，或欄位不對');
 ok(generationConfigSha256(cfg.date,CR[0].fields)===CR[0].sha256,'snapshot.sources 記的設定欄位雜湊與目前的 tainan_memory_config.mjs 不符（產生資料所用的設定改了，快照沒有重建）');
 const scheduled=new Set(TS.scheduledTrains),KEYS='name,arrSec,depSec,stop,schedArrSec,schedDepSec,src,holdSec',srcCount={obs:0,interp:0,est:0,sched:0};
 for(const tr of data.trains){const raw=schedOf.get(tr.serviceDate+':'+tr.train),off=tr.serviceDate===cfg.previous?-86400:0;let prev=-Infinity;
  ok((tr.timing==='observed'||tr.timing==='scheduled')&&(tr.timing==='scheduled')===scheduled.has(tr.id),'timing 與 timingSource.scheduledTrains 不一致：'+tr.train);
  ok(tr.stops.length>0,'沒有逐站時刻：'+tr.train);
  for(const s of tr.stops){const at=tr.train+' '+s.name,r=raw.stops.find(x=>norm(x.name)===norm(s.name));
   // end：起點站、終點站，照 source-schedule 的第一站、最後一站。起點的紀錄是看板佔位，重建只用它的誤點分鐘推開車時刻，
   // 這一列記推定（est）：推定只出現在起點，起點也不得記實測。
   const end=norm(s.name)===norm(raw.stops[0].name)?'origin':norm(s.name)===norm(raw.stops.at(-1).name)?'terminal':undefined;
   ok(Object.keys(s).join()===KEYS+(end?',end':'')&&s.end===end,'停站欄位不對（end 要照 source-schedule 的起訖站）：'+at);
   ok(Object.hasOwn(srcCount,s.src)&&(s.src==='sched')===(tr.timing==='scheduled')&&(s.src==='est'?end==='origin':end!=='origin'||s.src!=='obs'),
    'src 不對（只有整班沒有實測的車是 sched；推定只在起點，起點不記實測）：'+at);srcCount[s.src]++;
   ok(Number.isInteger(s.arrSec)&&Number.isInteger(s.depSec)&&prev<=s.arrSec&&s.arrSec<=s.depSec,'到離站時刻倒退：'+at);prev=s.depSec;
   ok(r&&s.stop===(r.stop!==false)&&s.schedArrSec===Math.round(r.arrSec+off)&&s.schedDepSec===Math.round(r.depSec+off),'表定時刻或停靠／通過與 source-schedule 不符：'+at);
   ok(Math.abs(s.holdSec-Math.max(0,(s.depSec-s.arrSec)-(s.schedDepSec-s.schedArrSec)))<=1,'holdSec 不是比表定多停的秒數：'+at);
   if(tr.timing==='scheduled'&&s.stop)ok(s.arrSec===s.schedArrSec&&s.depSec===s.schedDepSec,'整班沒有實測的車，停靠站沒有照表定：'+at);}}
 // 3. 原始觀測列：每班一筆、逐列標來源與檔案、檔案雜湊與 snapshot.sources 相同；標成實測（obs）的站一定有那一站的原始列
 const obsOf=new Map(SO.trains.map(t=>[t.trainId,t])),ID=new Map(data.stations.map(s=>[s.id,s.name])),rowCount={};
 ok(SO.date===cfg.date&&SO.trains.length===data.trains.length&&data.trains.every(t=>obsOf.get(t.id)?.train===t.train&&obsOf.get(t.id).serviceDate===t.serviceDate),'source-observations 的班次與 snapshot 不一致');
 for(const f of SO.files)ok(fileSha.get(f.file)===f.sha256,'source-observations 記的原始檔雜湊與 snapshot.sources 不符：'+f.file);
 for(const t of SO.trains)for(const r of t.rows)if(r.source==='tdx-historical')ID.set(r.StationID,r.StationName);
 const rowStation=r=>norm(r.source==='d1'?ID.get(r.sta)??'#'+r.sta:r.StationName);
 for(const tr of data.trains){const rows=obsOf.get(tr.id).rows;
  for(const r of rows){ok((r.source==='tdx-historical'||r.source==='d1')&&SO.files.some(f=>f.file==='.cache/'+r.file),'觀測列沒標來源，或來源檔不在 files：'+tr.train);
   ok((r.source==='d1'?r.train_no:r.TrainNo)===tr.train,'觀測列的車次不對：'+tr.train);rowCount[r.source]=(rowCount[r.source]||0)+1;}
  for(const s of tr.stops)if(s.src==='obs'||s.src==='est')ok(rows.some(r=>rowStation(r)===norm(s.name)),'標成實測或推定的站沒有原始觀測列：'+tr.train+' '+s.name);}
 // 3b. 實測時刻的精度：標成實測（obs）的到站／通過時刻，與 source-observations 裡該班該站那次到訪的第一筆紀錄相差不得超過
 //     anchorToleranceSec。換算與 tainan_actuals.py 的 A 錨點相同：秒級歷史取 SrcUpdateTime（依 SrcUpdateTime、UpdateTime 排序，連續同站的列
 //     合成一次到訪）；沒有歷史列的站用 D1，取最早一列的 obs_at−32 秒。起站不比（起站的紀錄是看板佔位，重建只用它的延誤給離站）。
 //     同一站的歷史列被別站的列隔成兩段以上（例：中洲→保安→中洲→保安），分不出哪一段才是真的到站：重建把這種站當作沒有可用的紀錄，
 //     由前後站內插（tainan_actuals.py 的 split_stations）。這裡從原始列重算，這種站不得標實測，每一站都列在輸出的 b1.split。只看資料本身，不認車次。
 const day0=Date.parse(cfg.date+'T00:00:00+08:00')/1000,secOf=iso=>Date.parse(iso)/1000-day0,TOL=V.anchorToleranceSec;
 const b1={tolSec:TOL,checked:0,maxAbsSec:0,worst:null,split:[]},b1Bad=[],b1Split=[];
 for(const tr of data.trains){if(tr.timing!=='observed')continue;
  const rows=obsOf.get(tr.id).rows,origin=norm(schedOf.get(tr.serviceDate+':'+tr.train).stops[0].name),runs=new Map(),d1=new Map();
  const H=rows.filter(r=>r.source==='tdx-historical').map(r=>({n:norm(r.StationName),s:secOf(r.SrcUpdateTime),u:secOf(r.UpdateTime)})).sort((a,b)=>a.s-b.s||a.u-b.u);
  for(let i=0,j;i<H.length;i=j+1){j=i;while(j+1<H.length&&H[j+1].n===H[i].n)j++;if(!runs.has(H[i].n))runs.set(H[i].n,[]);runs.get(H[i].n).push(H[i].s);}
  for(const r of rows)if(r.source==='d1'){const n=rowStation(r),t=secOf(r.obs_at)-RP.A_off_d1;if(!d1.has(n)||t<d1.get(n))d1.set(n,t);}
  for(const [n,f] of runs)if(f.length>1){const s=tr.stops.find(x=>norm(x.name)===n);b1.split.push({train:tr.train,station:s?s.name:n,src:s?s.src:null,first:f.map(x=>hms(Math.round(x))).join('／')});if(s?.src==='obs')b1Split.push(tr.train+' '+s.name);}
  for(const s of tr.stops){const n=norm(s.name);if(s.src!=='obs'||n===origin||runs.get(n)?.length>1)continue;
   const firsts=runs.get(n)||(d1.has(n)?[d1.get(n)]:null);ok(firsts,'標成實測的站找不到可比的原始紀錄：'+tr.train+' '+s.name);
   const dev=s.arrSec-firsts[0];b1.checked++;
   const row={train:tr.train,station:s.name,stop:s.stop,arr:hms(s.arrSec),first:hms(Math.round(firsts[0])),devSec:Math.round(dev)};
   if(Math.abs(dev)>b1.maxAbsSec){b1.maxAbsSec=Math.round(Math.abs(dev));b1.worst=row;}
   if(Math.abs(dev)>TOL)b1Bad.push(row);}}
 ok(b1.checked>0,'實測時刻精度判準沒有比到任何一站（判準失明）');
 ok(!b1Split.length,'紀錄被別站隔開的站不得標實測（'+b1Split.length+' 站）：'+b1Split.join('；'));
 ok(!b1Bad.length,'標成實測的到站／通過時刻與原始紀錄相差超過 '+TOL+' 秒（'+b1Bad.length+' 列）：'+b1Bad.map(r=>r.train+' '+r.station+' '+r.arr+'／紀錄 '+r.first+'（'+r.devSec+' 秒）').join('；'));
 // 4. 重點車（10/16 專屬：設定有 verify.markedTrains 才跑）：照 tainan_actuals.py 的錨點規則，從原始列重算範圍內每個實測錨點，與重建時刻相差不得超過門檻
 const anchors={};
 for(const no of V.markedTrains||[]){const m=cfg.marks.find(x=>x.train===no),tr=byNo(no,m?.serviceDate);ok(tr,'找不到重點車 '+no);
  const rows=obsOf.get(tr.id).rows,first=norm(schedOf.get(tr.serviceDate+':'+tr.train).stops[0].name),obs=new Map(),list=[];
  // 分鐘級 D1：A＝obs_at−32 秒，首見延誤取最早一列，離站延誤取 delay_max 的最大值
  for(const r of rows.filter(r=>r.source==='d1').map(r=>({...r,t:secOf(r.obs_at)})).sort((a,b)=>a.t-b.t)){const n=rowStation(r),o=obs.get(n);
   if(o)o.dDep=Math.max(o.dDep,r.delay_max);else obs.set(n,{src:'d1',A:r.t-RP.A_off_d1,dFirst:r.delay,dDep:r.delay_max});}
  // 秒級歷史（同站以歷史為準）：連續同站的列合成一次到訪，取第一次到訪；A＝第一列 SrcUpdateTime，離站延誤取最後一列
  const H=rows.filter(r=>r.source==='tdx-historical').map(r=>({...r,s:secOf(r.SrcUpdateTime),u:secOf(r.UpdateTime)})).sort((a,b)=>a.s-b.s||a.u-b.u),seen=new Set(),split=new Set();
  for(let i=0,j;i<H.length;i=j+1){j=i;while(j+1<H.length&&H[j+1].StationID===H[i].StationID)j++;const n=norm(H[i].StationName);if(seen.has(n)){split.add(n);continue;}seen.add(n);obs.set(n,{src:'hist',A:H[i].s,dFirst:H[i].DelayTime,dDep:H[j].DelayTime});}
  for(const n of split)obs.delete(n);   // 紀錄被別站隔開的站沒有可用的紀錄，歷史與 D1 都不取（tainan_actuals.py 的 split_stations）
  for(const s of tr.stops){const o=obs.get(norm(s.name));if(!o)continue;const cand=s.schedDepSec+Math.max(0,60*o.dDep-RP.dep_bias);
   if(norm(s.name)===first){list.push({station:s.name,kind:'D-origin',src:o.src,anchor:cand,field:'depSec'});continue;}
   const dev=o.A-(s.schedArrSec+60*o.dFirst);if(Math.abs(dev)>RP.max_incons){list.push({station:s.name,kind:'A',src:o.src,anchor:o.A,dropped:Math.round(dev)});continue;}
   list.push({station:s.name,kind:'A',src:o.src,anchor:o.A,field:'arrSec'});
   if(s.stop)list.push({station:s.name,kind:'D',src:o.src,anchor:Math.max(o.A+RP.min_dwell,cand),field:'depSec'});
   else if(cand-o.A>=RP.hold_flag_s)list.push({station:s.name,kind:'D',src:o.src,anchor:Math.max(o.A,cand),field:'depSec'});}
  const used=list.filter(a=>a.field);ok(used.length>0,no+' 在範圍內沒有實測錨點');
  for(const a of used){a.recon=stopOf(tr,a.station)[a.field];a.diff=+(a.recon-a.anchor).toFixed(1);ok(Math.abs(a.diff)<=V.anchorToleranceSec,no+' 在'+a.station+'的 '+a.kind+' 錨點與重建時刻差 '+a.diff+' 秒（上限 '+V.anchorToleranceSec+'）');}
  anchors[no]={maxAbsDiffSec:Math.max(...used.map(a=>Math.abs(a.diff))),list:list.map(a=>({station:a.station,kind:a.kind,src:a.src,anchor:hms(Math.round(a.anchor)),...(a.field?{recon:hms(a.recon),diffSec:a.diff}:{dropped:'inconsistent',devSec:a.dropped})}))};}
 // 5. 物理可行性：每秒里程差換算的點速不得超過車種極速（第 1 段檢查過的凍結表）。容差只給取樣的進位：里程存到 1 mm，一秒差分最多差 1 mm/s＝0.0036 km/h。
 const EPS_KMH=.004,speed={};let worst={over:-Infinity};
 for(const tr of data.trains){const cap=capOfClass.get(classKey(tr.carName,tr.typeName));ok(cap!==undefined,'timingSource.speedCaps 沒有這個車種的極速：'+tr.train+' '+tr.carName+'／'+tr.typeName);let v=0;
  for(const sp of tr.spans)for(let j=1;j<sp.s.length;j++)v=Math.max(v,(sp.s[j]-sp.s[j-1])*3.6);
  ok(v<=cap+EPS_KMH,'點速超過車種極速：'+tr.train+' '+v.toFixed(3)+' > '+cap+' km/h');
  if(v-cap>worst.over)worst={over:v-cap,train:tr.train,kmh:+v.toFixed(2),capKmh:cap};
  const f=speed[tr.formation.id]||=({caps:new Set(),v:[]});f.caps.add(cap);f.v.push(v);}
 const median=xs=>{const s=[...xs].sort((a,b)=>a-b),k=s.length>>1;return s.length%2?s[k]:(s[k-1]+s[k])/2;};
 const speedByFormation=Object.fromEntries(Object.entries(speed).map(([id,f])=>[id,{trains:f.v.length,capKmh:[...f.caps],minKmh:+Math.min(...f.v).toFixed(1),p50Kmh:+median(f.v).toFixed(1),maxKmh:+Math.max(...f.v).toFixed(1)}]));
 // 股道幾何：路段每一小段對上 snapshot.rails 的 way（座標逐點相同）；車身＝中心前後各半個車長（取 max(編組長, 車輛目錄節距加總)，
 // 與 replay.js 排車身的長度相同），換算成每條 way 上的沿線區間。同一秒落在兩段路段時取前一段（與 replay.js 的 spans.find 相同）。
 const key=c=>c[0].toFixed(7)+','+c[1].toFixed(7),railSeg=new Map();
 for(const r of data.rails){const C=r.coordinates;let u=0;for(let i=0;i+1<C.length;i++){const L=distanceM(C[i],C[i+1]),a=key(C[i]),b=key(C[i+1]);railSeg.set(a+'|'+b,{way:r.id,u0:u,u1:u+L});railSeg.set(b+'|'+a,{way:r.id,u0:u+L,u1:u});u+=L;}}
 const routeSeg=data.routes.map(r=>r.coordinates.slice(1).map((c,k)=>railSeg.get(key(r.coordinates[k])+'|'+key(c))??null));
 // 畫面內（任一端點在範圍內）的小段都要對得上；畫面外的路段只是取樣窗的延伸，snapshot.rails 本來就不收。
 const inView=data.routes.map(r=>r.coordinates.slice(1).map((c,k)=>inside(c)||inside(r.coordinates[k])));
 const segTotal=inView.reduce((n,r)=>n+r.filter(Boolean).length,0),segMissing=routeSeg.reduce((n,r,ri)=>n+r.filter((x,k)=>!x&&inView[ri][k]).length,0);
 ok(segTotal>0&&segMissing===0,'畫面內的路段有 '+segMissing+'／'+segTotal+' 小段對不上 snapshot.rails 的 way，股道判準看不到那些地方');
 const lenOf=new Map(data.trains.map(t=>{const f=fleet.formations[t.formation.id];return [t.id,Math.max(t.formation.lengthM,f.cars.reduce((a,c)=>a+fleet.meshes[c.mesh].pitchM,0))];}));
 const body=(ri,s,L)=>{const P=paths[ri],s0=Math.max(0,s-L/2),s1=Math.min(P.length,s+L/2),out=new Map();
  for(let k=P.at(s0).index;k<=Math.min(P.at(s1).index,routeSeg[ri].length-1);k++){const g=routeSeg[ri][k],a=P.d[k],b=P.d[k+1],x0=Math.max(s0,a),x1=Math.min(s1,b);if(!g||x1-x0<.01)continue;
   const f=x=>g.u0+(g.u1-g.u0)*(x-a)/(b-a),p=f(x0),q=f(x1),w=out.get(g.way);if(w){w[0]=Math.min(w[0],p,q);w[1]=Math.max(w[1],p,q);}else out.set(g.way,[Math.min(p,q),Math.max(p,q)]);}
  return out;};
 const active=Array.from({length:86400},()=>[]);
 for(const tr of data.trains){let last=-1;for(const sp of tr.spans)for(let j=0;j<sp.s.length;j++){const t=sp.start+j;if(t<=last)continue;last=t;active[t].push({tr,ri:sp.route,s:sp.s[j]});}}
 // 第 6、7 段（單線雙向、時間軸與說明檔）是 10/16 專屬，設定有 singleLine 的日期才跑。沒有的日期，snapshot 不該有 singleLine，時間軸 events 也要是空陣列。
 ok(SL||(data.singleLine===undefined&&Array.isArray(data.events)&&data.events.length===0),'設定沒有 singleLine 的日期，snapshot 不該有 singleLine，時間軸 events 也要是空陣列');
 const S=SL?(()=>{
 // 6. 單線雙向：從逐站時刻重算各子區間（相鄰兩站）的占用，推回起點、起點的依據、終點、反向班次與兩班重點車的身分
 const ord=n=>SL.stations.indexOf(norm(n)),subName=k=>SL.stations[k]+'—'+SL.stations[k+1],single=data.singleLine;
 const uses=data.trains.map(tr=>{const S=tr.stops,u=[];for(let i=0;i+1<S.length;i++){const x=ord(S[i].name),y=ord(S[i+1].name);if(x<0||y<0||Math.abs(x-y)!==1)continue;
  u.push({sub:Math.min(x,y),dir:y>x?'南下':'北上',start:S[i].depSec,end:S[i+1].arrSec,leave:S[i+1].depSec,to:S[i+1].name});}return {tr,u};}).filter(x=>x.u.length);
 for(const x of uses)ok(x.u.every(u=>u.dir===x.tr.direction),'子區間的行進方向與班次方向不符：'+x.tr.train);
 // 單線期間（snapshot 記的 fromSec～toSec）：永康—保安每一段相鄰站間，同一秒不得有兩個方向的列車都在站間（離開前一站之後、到達下一站之前；
 // 停在站內不算）。這是 singleLine.note「站與站之間同一時間只有一個方向的列車，對向列車在車站交會」的判準，放在起點斷言之前：
 // 起點算錯、或逐站時刻改到對向列車在站間相遇時，由這一條先報。
 // 正向對照：以整段永康—保安計（離開區間第一站到抵達最後一站），單線期間同時在區間內的對向列車要至少一組，而且每一組在重疊期間
 // 一直隔著同一座車站（兩班的位置之間始終有那座站，或兩班同時停在那座站），列在輸出的 stationGaps.sectionPairs；一組都沒有＝判準看不到對向列車。
 const entry=x=>Math.min(...x.u.map(u=>u.start)),exit=x=>Math.max(...x.u.map(u=>u.end));
 const posOf=(x,t)=>{for(const u of x.u)if(u.start<t&&t<u.end)return u.sub+.5;for(const s of x.tr.stops){const k=ord(s.name);if(k>=0&&s.arrSec<=t&&t<=s.depSec)return k;}return null;};
 const gapHits=[];let gapSec=0;
 for(let t=single.fromSec;t<=single.toSec;t++){gapSec++;const by=new Map();
  for(const x of uses)for(const u of x.u)if(u.start<t&&t<u.end){if(!by.has(u.sub))by.set(u.sub,[]);by.get(u.sub).push({x,dir:u.dir});}
  for(const [k,list] of by)if(new Set(list.map(e=>e.dir)).size>1)gapHits.push(hms(t)+' '+subName(k)+' '+list.map(e=>e.x.tr.train+e.dir).join('／'));}
 ok(gapSec>0&&!gapHits.length,'單線期間有對向列車同時在同一段站間（'+gapHits.length+' 秒）：'+gapHits.slice(0,5).join('；'));
 const sectionPairs=[];
 for(let i=0;i<uses.length;i++)for(let j=i+1;j<uses.length;j++){const A=uses[i],B=uses[j];if(A.u[0].dir===B.u[0].dir)continue;
  const o0=Math.max(entry(A),entry(B),single.fromSec),o1=Math.min(exit(A),exit(B),single.toSec);if(o0>=o1)continue;
  let at=null,unknownSec=0;
  for(let t=o0;t<=o1;t++){const p=posOf(A,t),q=posOf(B,t);if(p==null||q==null){unknownSec++;continue;}
   const here=new Set();for(let k=Math.ceil(Math.min(p,q));k<=Math.floor(Math.max(p,q));k++)here.add(k);at=at?new Set([...at].filter(k=>here.has(k))):here;}
  sectionPairs.push({trains:A.tr.train+'/'+B.tr.train,span:hms(o0)+'–'+hms(o1),meetAt:at?[...at].map(k=>SL.stations[k]):[],unknownSec});}
 ok(sectionPairs.length>0,'單線期間整段區間內沒有任何一組對向列車同時在段內，站間判準看不到對向列車（正向對照失明）');
 ok(sectionPairs.every(p=>p.meetAt.length>0&&p.unknownSec===0),'對向列車同時在區間內，卻沒有一直隔著同一座車站：'+JSON.stringify(sectionPairs.filter(p=>!p.meetAt.length||p.unknownSec)));
 const overlaps=[];for(let i=0;i<uses.length;i++)for(let j=i+1;j<uses.length;j++)for(const a of uses[i].u)for(const b of uses[j].u){
  if(a.sub!==b.sub||a.dir===b.dir)continue;const o0=Math.max(a.start,b.start),o1=Math.min(a.end,b.end);
  if(o0<o1)overlaps.push({sub:a.sub,A:uses[i].tr,B:uses[j].tr,start:o0,end:o1,endBy:a.end<=b.end?{tr:uses[i].tr,station:a.to}:{tr:uses[j].tr,station:b.to}});}
 const late=overlaps.filter(o=>o.end>SL.officialSec),lastEnd=late.length?Math.max(...late.map(o=>o.end)):SL.officialSec,fromSec=Math.ceil(lastEnd/60)*60,LO=late.find(o=>o.end===lastEnd);
 ok(single.fromSec===fromSec&&single.officialSec===SL.officialSec&&single.section.join()===SL.section.join(),'單線起點應為 '+hms(fromSec)+'（官方封鎖後最後一組對向重疊 '+hms(lastEnd)+' 結束的下一個整分），實為 '+hms(single.fromSec));
 const lo=single.basis?.lastOverlap;
 ok(LO&&lo&&lo.sub===subName(LO.sub)&&lo.end===lastEnd&&[...lo.trainIds].sort().join()===[LO.A.id,LO.B.id].sort().join()&&lo.endBy.trainId===LO.endBy.tr.id&&norm(lo.endBy.station)===norm(LO.endBy.station)&&stopOf(LO.endBy.tr,LO.endBy.station).arrSec===lo.end,
  'singleLine.basis.lastOverlap 與重算的最後一組對向重疊不符');
 // 官方封鎖之後的對向重疊，每一組都要標成單線不明（時段從官方封鎖或重疊開始起算，涵蓋到重疊結束）
 for(const o of late)ok(U.intervals.some(i=>i.reason==='single-line-unresolved'&&pairOf(i,o.A.id,o.B.id)&&i.start<=Math.max(o.start,SL.officialSec)&&o.end<=i.end),'官方封鎖後的對向重疊沒有標成單線不明：'+o.A.train+'/'+o.B.train+' '+subName(o.sub)+' '+hms(o.start)+'–'+hms(o.end));
 // 終點＝最後一班離開單線區間的時刻；反向＝起點時仍在區間內或之後才進入、而且不在封鎖後重疊名單裡的南下列車
 const lastExit=uses.reduce((b,x)=>!b||exit(x)>exit(b)?x:b,null),south=uses.filter(x=>x.u[0].dir==='南下'),lastSouth=south.reduce((b,x)=>!b||entry(x)>entry(b)?x:b,null);
 const toSec=Math.max(...lastExit.u.map(u=>u.leave)),pair=new Set(late.flatMap(o=>[o.A.id,o.B.id])),revIds=south.filter(x=>exit(x)>fromSec&&!pair.has(x.tr.id)).sort((a,b)=>entry(a)-entry(b)).map(x=>x.tr.id);
 ok(single.toSec===toSec,'單線終點應為 '+hms(toSec)+'，實為 '+hms(single.toSec));
 ok(single.reversed.map(r=>r.trainId).join()===revIds.join(),'反向行駛的班次應為 '+revIds.map(id=>byId.get(id).train)+'，實為 '+single.reversed.map(r=>r.train));
 ok(data.trains.filter(t=>t.mark).length===cfg.marks.length,'重點車的數量不對');
 for(const m of cfg.marks){const t=byNo(m.train,m.serviceDate),want=m.mark==='last-ground'?lastExit.tr:m.mark==='last-south'?lastSouth.tr:null;
  ok(t&&t.mark===m.mark&&want===t,'重點車身分與逐站時刻不符：'+m.mark+' 設定 '+m.train+'，重算 '+want?.train+'，snapshot 裡 '+m.train+' 的 mark 是 '+(t?.mark??'（沒有）'));}
 // 反向的車：時段涵蓋它在區間內的時間；車身只蓋北上那組 way（不碰南下那組），而且經過臺南的西正線月台；
 // 換線的渡線一律在畫面外（畫面內就得標不確定），始發／終到站要對得上班表；走法經過的轉轍 OSM 都有
 // way id 在 snapshot.rails 是字串、在設定裡是數字，一律轉字串比。對照組：平常（官方封鎖前）的南下列車要蓋得到南下那組 way，否則這條檢查是空的。
 const southWays=new Set(SL.ways.south.map(String)),platformWay=String(SL.tainanPlatformWay),reversed=[];let southControl=0;
 for(let t=0;t<SL.officialSec;t+=60)for(const a of active[t])if(a.tr.direction==='南下'&&[...body(a.ri,a.s,lenOf.get(a.tr.id)).keys()].some(w=>southWays.has(w)))southControl++;
 ok(southControl>0,'南下那組 way 對不上任何平常的南下列車（設定的 way 清單或比對方式錯了）');
 for(const r of single.reversed){const tr=byId.get(r.trainId),x=uses.find(x=>x.tr===tr),stops=schedOf.get(tr.serviceDate+':'+tr.train).stops;let n=0,platform=false;
  ok(x&&tr.direction==='南下'&&r.startSec<=entry(x)&&exit(x)<=r.endSec,r.train+' 的反向時段沒有涵蓋它在單線區間內的時間');
  for(let t=Math.max(0,r.startSec);t<=Math.min(86399,r.endSec);t++){const a=active[t].find(a=>a.tr===tr);if(!a)continue;n++;
   for(const w of body(a.ri,a.s,lenOf.get(tr.id)).keys()){ok(!southWays.has(w),r.train+' 反向期間車身蓋到南下那組股道 '+w+'（'+hms(t)+'）');if(w===platformWay)platform=true;}}
  ok(n>0&&platform,r.train+' 反向期間沒有經過臺南的西正線月台 '+platformWay);
  for(const end of ['start','end']){const c=r.crossovers?.[end];
   ok(c&&(c.kind==='crossover'?!inside([c.lon,c.lat])&&c.inView===false:c.kind==='origin'?end==='start'&&norm(c.station)===norm(stops[0].name):c.kind==='terminus'&&end==='end'&&norm(c.station)===norm(stops.at(-1).name)),
    r.train+' 的'+(end==='start'?'進入':'離開')+'反向位置在畫面內，或起訖站對不上班表');}
  ok(r.turnouts?.total>0&&r.turnouts.allCanTurn===true,r.train+' 的反向走法經過 OSM 沒有的轉轍');
  const where=c=>c.kind==='crossover'?c.segment+' 渡線（畫面外）':(c.kind==='origin'?'始發 ':'終到 ')+c.station+(c.inView?'（畫面內）':'（畫面外）');
  reversed.push({train:r.train,from:hms(r.startSec),to:hms(r.endSec),drawnSec:n,enter:where(r.crossovers.start),leave:where(r.crossovers.end),turnouts:r.turnouts.total});}
 const times=[...single.note.matchAll(/(\d{1,2}):(\d{2})/g)].map(m=>m[0].padStart(5,'0'));
 ok(times.includes(hm(fromSec))&&times.includes(hm(SL.officialSec))&&times.every(x=>x===hm(fromSec)||x===hm(SL.officialSec)),'singleLine.note 的時刻只能是官方封鎖與單線起點：'+times.join('、'));
 ok(!single.note.includes('實測'),'singleLine.note 不寫「實測」：單線前後的時段是依到站紀錄推算的');
 // 7. 時間軸：官方事項照設定；單線那一列在起點、依據同上；觀測類每一列的時刻＝那一班在那一站的到／離站，文字由範本套車次、不含時刻
 const E=data.events,TIME=/\d{1,2}\s*[:：]\s*\d{2}/;
 ok(Array.isArray(E)&&E.length===cfg.officialEvents.length+1+cfg.observedEvents.length&&new Set(E.map(e=>e.id)).size===E.length,'時間軸的列數或 id 不對');
 ok(E.every((e,i)=>!i||E[i-1].t<=e.t),'時間軸沒有照時刻排序');
 for(const e of E){ok(Number.isInteger(e.t)&&['official','observed','inferred'].includes(e.kind)&&typeof e.text==='string'&&e.text&&!TIME.test(e.text),'時間軸列的欄位不對，或文字含時刻：'+e.id);
  if('train' in e)ok(data.trains.some(t=>t.train===e.train),'時間軸的 train 要與 trains[].train 相同：'+e.id);}
 for(const o of cfg.officialEvents){const e=E.find(x=>x.id===o.id);ok(e&&e.t===o.t&&e.text===o.text&&e.kind==='official','官方事項與設定不符：'+o.id);}
 const sl=E.find(e=>e.id==='single-line-start');
 ok(sl&&sl.t===fromSec&&sl.kind==='inferred'&&sl.text===SL.section.join('—')+'改單線雙向'&&sl.ref?.basis==='last-opposing-overlap'&&JSON.stringify(sl.ref.lastOverlap)===JSON.stringify(lo),'時間軸的單線雙向那一列要在起點、kind＝inferred、依據與 singleLine.basis 相同');
 const trace=[];
 for(const d of cfg.observedEvents){const e=E.find(x=>x.id===d.id),t=byNo(d.train,d.serviceDate),s=stopOf(t,d.station);ok(e&&t&&s,'時間軸缺「'+d.id+'」或找不到那一班那一站');
  // 只有到站／通過的實測時刻標實測（起站除外）；離站時刻是表定離站加上誤點分鐘推得，標推定並寫明依據。
  const measured=d.field==='arrSec'&&s.src==='obs'&&norm(s.name)!==norm(schedOf.get(t.serviceDate+':'+t.train).stops[0].name);
  ok(d.follow===undefined||d.follow==='other'&&!!d.other,'時間軸「'+d.id+'」的 follow 只能是 other，而且要有 other');
  ok(e.train===(d.follow==='other'?d.other.train:t.train)&&e.t===s[d.field]&&e.kind===(measured?'observed':'inferred')&&e.ref?.trainId===t.id&&norm(e.ref.station)===norm(s.name)&&e.ref.field===d.field&&e.ref.src===s.src
   &&(d.field!=='depSec'||e.ref.basis==='delay-minutes'),
   '時間軸「'+d.id+'」的時刻不是 '+d.train+' 在'+d.station+'的 '+d.field+'，或跟的車、kind／來源不對（離站時刻要標推定、依據 delay-minutes）');
  let text=d.text.replace('{train}',t.train);
  if(d.wait){const c=data.trains.filter(u=>u!==t&&u.direction===d.wait.direction).map(u=>({u,x:stopOf(u,d.wait.at)})).filter(({x})=>x&&x.arrSec>=s.arrSec&&x.arrSec<=s.depSec);
   ok(c.length===1&&e.ref.wait?.trainId===c[0].u.id,'時間軸「'+d.id+'」等的車要是停站期間唯一到站的'+d.wait.direction+'車：'+c.map(x=>x.u.train));text=text.replace('{wait}',c[0].u.train);}
  if(d.other){const u=byNo(d.other.train,d.other.serviceDate),x=stopOf(u,d.station);ok(x&&x.arrSec<=e.t&&e.t<=x.depSec&&e.ref.other?.trainId===u.id,'時間軸「'+d.id+'」交會時刻不在對方停站時間內');text=text.replace('{other}',u.train);}
  ok(e.text===text,'時間軸「'+d.id+'」的文字與範本不符：'+e.text);
  if(d.claim==='last-departure')ok(data.trains.every(u=>u===t||!(stopOf(u,d.station)?.depSec>e.t)),'時間軸「'+d.id+'」不是最後一班離開'+d.station);
  if(d.claim==='last-section-exit')ok(t===lastExit.tr&&e.t===toSec&&uses.every(x=>x.u.every(u=>u.leave<=e.t)),'時間軸「'+d.id+'」不是最後一班離開單線區間');
  trace.push(d.id+'＝'+t.train+' '+s.name+' '+d.field+' '+hms(e.t)+'（'+s.src+'，'+e.kind+(d.follow==='other'?'，車次欄記 '+d.other.train:'')+'）');}
 // 時間軸的說明與報導連結（verify.eventNotes 指的檔，以事件 id 對應）：每一列都有說明、說明裡不放網址；連結是 https，
 // 欄位只有媒體名稱、標題、網址與報導日期。說明只放在這個檔，snapshot 的時間軸不帶 desc／links。
 const NF=cfg.verify?.eventNotes;
 if(NF){const N=read(NF),notes=N?.notes,LINK=JSON.stringify(['date','outlet','title','url']);
  ok(N&&N.schema===1&&N.date===cfg.date&&notes&&typeof notes==='object'&&!Array.isArray(notes),NF+' 的 schema、date 或 notes 不對');
  ok(Object.keys(notes||{}).every(id=>E.some(e=>e.id===id)),NF+' 有時間軸沒有的事件');
  ok(E.every(e=>!('desc' in e)&&!('links' in e)),'snapshot 的時間軸不該帶 desc／links（說明只放在 '+NF+'）');
  for(const e of E){const n=notes?.[e.id];
   ok(n&&typeof n.desc==='string'&&n.desc.trim()!==''&&!/https?:\/\//.test(n.desc),'時間軸「'+e.id+'」缺說明，或說明裡有網址');
   ok(n&&(n.links===undefined||Array.isArray(n.links)&&n.links.length>0&&n.links.every(l=>JSON.stringify(Object.keys(l).sort())===LINK&&/^https:\/\/\S+$/.test(l.url)&&l.outlet&&l.title&&/^\d{4}-\d{2}-\d{2}$/.test(l.date))),'時間軸「'+e.id+'」的報導連結欄位不齊');}
  trace.push(NF+'：'+Object.keys(notes||{}).length+' 列說明、'+Object.values(notes||{}).reduce((k,n)=>k+(n.links?.length||0),0)+' 則報導連結');}
 return {singleLine:{from:hms(fromSec),to:hms(toSec),lastOverlap:LO.A.train+'/'+LO.B.train+' '+subName(LO.sub)+' 到 '+hms(lastEnd),lateOverlapsMarked:late.length,reversed,
   stationGaps:{checkedSec:gapSec,opposingInGapSec:gapHits.length,sectionPairs}},trace};})():null;
 // 8. 不確定時段：判準欄位、每段有 reason（有單線雙向的日期可以是 track-overlap 或 single-line-unresolved，沒有的日期只有 track-overlap）；
 //    有單線雙向的日期，build 列出的單線解不掉時段都在裡面
 if(cfg.ambiguity)ok(U.criterion===cfg.ambiguity.criterion,'uncertainty.json 的 criterion 應為 '+cfg.ambiguity.criterion);
 for(const i of U.intervals)ok((SL?['track-overlap','single-line-unresolved']:['track-overlap']).includes(i.reason),'不確定時段缺 reason 或 reason 不認得'+(SL?'':'（沒有單線雙向的日期只有 track-overlap）')+'：'+(i.trainNos||i.trains));
 if(SL)for(const u of data.singleLine.unresolved)ok(U.intervals.some(i=>i.reason==='single-line-unresolved'&&pairOf(i,...u.trains)&&i.start<=u.start&&u.end<=i.end),'build 列出的單線解不掉時段沒有進 uncertainty.json：'+u.trainNos+' '+hms(u.start));
 // 9. 停站：畫面內的站（大橋、臺南、保安），停站 2 秒以上的，到站到離站之間每一秒的位置（照 replay.js 取路段）與到站那一秒相差 ≤1 m，
 //    而且停在站附近（≤300 m）。路段常在到站那一秒切換，所以量座標、不量單一路段的里程。
 const stationAt=new Map(data.stations.map(s=>[norm(s.name),[s.lon,s.lat]])),posAt=(tr,t)=>{const sp=tr.spans.find(sp=>t>=sp.start&&t<sp.start+sp.s.length);return sp?paths[sp.route].at(sp.s[t-sp.start]).coordinate:null;};
 let dwellChecked=0,dwellSkipped=0,dwellMove=0,dwellDist=0;
 for(const tr of data.trains)for(const s of tr.stops){const p=stationAt.get(norm(s.name));if(!p||s.depSec-s.arrSec<2)continue;
  const pts=[];for(let t=s.arrSec;t<=s.depSec;t++)pts.push(posAt(tr,t));const n=pts.filter(Boolean).length;if(!n){dwellSkipped++;continue;}
  ok(n===pts.length,'停站期間有幾秒不在畫面內：'+tr.train+' '+s.name);
  const mv=Math.max(...pts.map(q=>distanceM(q,pts[0]))),d=distanceM(pts[0],p);dwellChecked++;dwellMove=Math.max(dwellMove,mv);dwellDist=Math.max(dwellDist,d);
  ok(mv<=1,'停站時車沒有停住：'+tr.train+' '+s.name+' 動了 '+mv.toFixed(2)+' m');ok(d<=300,'停站位置離站太遠：'+tr.train+' '+s.name+' '+d.toFixed(0)+' m');}
 ok(dwellChecked>0,'畫面內沒有任何可檢查的停站（停站檢查失明）');
 // 10. 股道占用（畫面內逐秒、整天）：兩車車身在同一條 way 上的沿線區間重疊＝車身重疊；官方封鎖之後，對向兩車車身蓋到同一條 way
 //     ＝同一條線上對向（封鎖後的對向只有設定有 singleLine 的日期才算）。兩種都要落在含這兩班的不確定時段內。反過來，每個 track-overlap 時段裡兩車
 //     至少有一秒共用同一條 way；有 deepOverlapM 的日期，只靠深重疊保留的時段改看深重疊的秒。
 const overlapOf=(X,Y)=>{const ways=[];let ovl=-Infinity;for(const [w,a] of X){const b=Y.get(w);if(!b)continue;ways.push(w);ovl=Math.max(ovl,Math.min(a[1],b[1])-Math.max(a[0],b[0]));}return {ways,ovl};};
 // 正向對照（不靠當天資料）：同一班車同一秒的兩份車身，一定共用 way、沿線重疊 > 0。當天若真的沒有任何車身重疊，這是唯一能證明判準看得到重疊的地方。
 {let x=null;for(let t=0;t<86400&&!x;t++)x=active[t].find(a=>body(a.ri,a.s,lenOf.get(a.tr.id)).size>0)||null;
  const b0=x&&body(x.ri,x.s,lenOf.get(x.tr.id)),tw=x&&overlapOf(b0,new Map(b0));
  ok(x&&tw.ways.length===b0.size&&tw.ovl>0,'占用檢查的正向對照失敗：同一份車身與自己沒有算出共用 way 與沿線重疊');}
 const covered=(a,b,t)=>U.intervals.some(i=>i.start<=t&&t<=i.end&&pairOf(i,a,b)),groups=new Map(),sharedSec=new Map();let bodySec=0,oppSec=0;
 for(let t=0;t<86400;t++){const A=active[t];if(A.length<2)continue;const B=A.map(a=>body(a.ri,a.s,lenOf.get(a.tr.id)));
  for(let i=0;i<A.length;i++)for(let j=i+1;j<A.length;j++){const {ways,ovl}=overlapOf(B[i],B[j]);
   if(!ways.length)continue;const ids=[A[i].tr.id,A[j].tr.id].sort(),k=ids.join('|');if(!sharedSec.has(k))sharedSec.set(k,[]);sharedSec.get(k).push(t);
   const isBody=ovl>0,isOpp=SL&&A[i].tr.direction!==A[j].tr.direction&&t>=SL.officialSec;if(!isBody&&!isOpp)continue;
   if(isBody)bodySec++;if(isOpp)oppSec++;
   const cov=covered(ids[0],ids[1],t),kinds=[...(isBody?['body']:[]),...(isOpp?['opposing']:[])];if(!groups.has(k))groups.set(k,[]);const list=groups.get(k),g=list.at(-1);
   if(g&&g.end===t-1&&g.covered===cov){g.end=t;g.maxOverlapM=Math.max(g.maxOverlapM,ovl);for(const w of ways)g.ways.add(w);for(const x of kinds)g.kinds.add(x);}
   else list.push({ids,start:t,end:t,covered:cov,maxOverlapM:ovl,ways:new Set(ways),kinds:new Set(kinds)});}}
 const all=[...groups.values()].flat().sort((a,b)=>a.start-b.start),uncovered=all.filter(g=>!g.covered),nameOf=g=>g.ids.map(id=>byId.get(id).train).join('/');
 // 失明檢查各自成立：uncertainty.json 有 track-overlap 時段，就一定找得到車身重疊；有單線雙向的日期，封鎖後一定找得到對向共用股道。
 // 沒有單線雙向、也沒有 track-overlap 時段的日期，兩個量都可能真的是 0，不硬斷言；0 時輸出會寫明，判準有沒有牙由上面的正向對照與突變測試證明。
 ok(bodySec>0||!U.intervals.some(i=>i.reason==='track-overlap'),'uncertainty.json 有 track-overlap 時段，占用檢查卻沒有找到任何車身重疊（'+bodySec+' 秒），判準失明');
 if(SL)ok(oppSec>0,'封鎖後的對向共用股道一秒都沒找到（'+oppSec+' 秒），判準失明');
 ok(uncovered.length===0,'有沒標記的股道重疊：'+uncovered.slice(0,5).map(g=>nameOf(g)+' '+hms(g.start)+'–'+hms(g.end)+' '+[...g.kinds]+' way '+[...g.ways]).join('；'));
 const deepSecs=deepOverlap?.secByPair;
 for(const i of U.intervals.filter(i=>i.reason==='track-overlap')){const k=[...i.trains].sort().join('|'),inI=t=>i.start<=t&&t<=i.end;
  ok((sharedSec.get(k)||[]).some(inI)||(deepSecs?.get(k)||[]).some(x=>inI(x.t)),'track-overlap 時段裡兩車從沒共用同一條 way'+(deepSecs?'、車身橫向重疊也沒超過 '+cfg.ambiguity.deepOverlapM+' m':'')+'（不符 '+U.criterion+' 判準）：'+i.trainNos+' '+hms(i.start));}
 const byReason={};for(const i of U.intervals)byReason[i.reason]=(byReason[i.reason]||0)+1;
 return {stops:srcCount,observationRows:rowCount,scheduledTrains:TS.scheduledTrains.map(id=>byId.get(id).train),...(V.markedTrains&&{anchors}),
  speed:{epsKmh:EPS_KMH,worst:{train:worst.train,kmh:worst.kmh,capKmh:worst.capKmh},byFormation:speedByFormation},
  ...(S&&{singleLine:S.singleLine}),
  b1,...(S&&{events:S.trace}),dwell:{checked:dwellChecked,notInView:dwellSkipped,maxMoveM:+dwellMove.toFixed(3),maxStationDistM:Math.round(dwellDist)},
  occupancy:{routeSegments:segTotal,bodyOverlapSec:bodySec,...(bodySec===0&&{bodyOverlapNote:'這一天沒有兩車車身在同一條 way 上重疊（uncertainty.json 也沒有 track-overlap 時段）；正向對照已過'}),...(SL&&{opposingSharedWaySec:oppSec}),groups:all.map(g=>({trains:nameOf(g),span:hms(g.start)+'–'+hms(g.end),kinds:[...g.kinds],ways:[...g.ways],maxOverlapM:+g.maxOverlapM.toFixed(1),covered:g.covered}))},
  uncertainty:{criterion:U.criterion,intervals:U.intervals.length,byReason}};
}
const deepOverlap=cfg.ambiguity?.deepOverlapM!=null?checkDeepOverlap():null;
const observed=cfg.timing==='observed'?checkObserved():null;
const underground=cfg.underground?(await import('./verify_tainan_memory_1023_data.mjs')).checkUndergroundData({cfg,dir,data,paths,fleet,arranged,formationPoses,distanceM,read}):null;
// 主站入口放最後。新日期的入口要等使用者看過頁面才加：設定 verify.entry 為 null＝還沒加，完整模式印一行明講略過，其餘判準照驗；
// 設成 {id, cl} 就檢查主站 index.html 有沒有這個入口（有哪個鍵就查哪個）。
let entry=null;
if(!DATA_ONLY){
 if(V.entry===null){entry='not-added';console.log('【略過主站入口檢查】'+cfg.date+' 的入口尚未加入主站（tainan_memory_config.mjs 的 verify.entry 為 null）；加入口的 commit 要同時把它設成 {id, cl}。');}
 else{const e=V.entry,want=[...(e?.id?['id="'+e.id+'"']:[]),...(e?.cl?['data-cl="'+e.cl+'"']:[])];assert.ok(want.length,'verify.entry 要設成 null 或 {id, cl}');
  const index=fs.readFileSync(path.join(cfg.root,'index.html'),'utf8');for(const m of want)assert.ok(index.includes(m),'主站沒有這個重播的入口：'+m);}
}
const summary={trains:data.trains.length,routes:paths.length,samples:data.trains.reduce((n,t)=>n+t.spans.reduce((a,s)=>a+s.s.length,0),0),directions:['北上','南下'],overnight:V.overnight};
const extra={...(sealedUnchanged.length&&{sealedUnchanged}),...(entry&&{entry}),...(observed&&{observed}),...(deepOverlap&&{deepOverlap:deepOverlap.report}),...(underground&&{underground})};
if(DATA_ONLY)console.log(JSON.stringify({mode:'data-only',date:cfg.date,...summary,continuity:'pass',...extra}));
else console.log(JSON.stringify({files:Object.keys(integrity.files).length,...summary,integrity:'pass',continuity:'pass',surroundings,roads,...extra}));
