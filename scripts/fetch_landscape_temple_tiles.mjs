// 補齊古蹟與宗教百景座標周邊的 Overture 建物，重用地景母檔已有的原始 MVT。
// node scripts/fetch_landscape_temple_tiles.mjs 暫存目錄 地景母檔/cache/overture-2026-10-21.0
import path from 'node:path';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { runInThisContext } from 'node:vm';
const [cache,native]=process.argv.slice(2);
if(!cache||!native)throw Error('參數需要暫存目錄和 Overture 快取目錄');
const output=path.join(cache,'heritage-buildings');
await mkdir(output,{recursive:true});
const load=async name=>JSON.parse(await readFile(path.join(cache,name),'utf8'));
const heritage=(await load('temple-monuments.json')).filter(r=>r.assetsTypes.some(v=>v.name==='寺廟')).map(r=>[r.longitude,r.latitude]);
const religious=(await load('religious-landscapes.json')).map(r=>[+r.WGS84X,+r.WGS84Y]);
const zoom=14,n=2**zoom;
const tileX=x=>Math.floor((x+180)/360*n),tileY=y=>Math.floor((1-Math.asinh(Math.tan(y*Math.PI/180))/Math.PI)*n/2);
const tiles=new Map();
for(let [lon,lat] of [...heritage,...religious]){
  if(lon<27&&lat>118)[lon,lat]=[lat,lon];
  if(!(lon>118&&lon<123&&lat>21&&lat<27))continue;
  for(let x=tileX(lon-.002);x<=tileX(lon+.002);x++)for(let y=tileY(lat+.002);y<=tileY(lat-.002);y++)tiles.set(x+'-'+y,[x,y]);
}
const url='https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-10-21.0/buildings.pmtiles';
const lib=runInThisContext((await readFile(new URL('../rail-3d/vendor/pmtiles.js',import.meta.url),'utf8'))+'\npmtiles;');
const archive=new lib.PMTiles({getKey:()=>url,async getBytes(offset,length){
  const res=await fetch(url,{headers:{Range:`bytes=${offset}-${offset+length-1}`}});
  if(res.status!==206)throw Error('Overture HTTP '+res.status);
  return {data:await res.arrayBuffer()};
}});
const exists=p=>access(p).then(()=>true,()=>false);
const pending=[...tiles.values()];let fetched=0;
async function worker(){
  while(pending.length){
    const [x,y]=pending.pop(),name=`buildings-14-${x}-${y}.mvt`,out=path.join(output,name);
    if(await exists(path.join(native,name))||await exists(out))continue;
    const tile=await archive.getZxy(zoom,x,y);
    await writeFile(out,tile?Buffer.from(tile.data):Buffer.alloc(0));fetched++;
  }
}
await Promise.all(Array.from({length:5},worker));
console.log('建物圖磚已核對',tiles.size,'本次下載',fetched);
