// node scripts/verify_landscape_tunnel_roads.mjs 地景母檔/tiles
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {surfaceRoads,withTunnelTrees} from '../landscape-web/tunnel-roads.mjs';

const root=process.argv[2];
if(!root)throw Error('請傳入地景圖磚目錄');
const read=async p=>JSON.parse(await readFile(p,'utf8'));
// 來源是兩方向中心線、洞外引道及實際橋面的抽樣，位置以圖磚原點為基準（公尺）。
const probes=[
  ["懷恩 B","E238_N2160",572,1043.982,193.698,false],
  ["懷恩 A","E238_N2160",1037,1051.337,655.174,false],
  ["台北二號 B","E239_N2161",601,1157.97,876.549,true],
  ["台北二號 B","E239_N2162",523,265.451,106.05,false],
  ["台北一號 A","E239_N2161",97,1227.155,821.944,false],
  ["台北二號 A","E239_N2162",536,119.164,70.224,false],
  ["台北二號 A","E239_N2162",536,664.021,16.644,true],
  ["台北一號 B","E240_N2161",72,683.862,656.676,false],
  ["辛亥北行","E239_N2161",134,330.391,937.521,false],
  ["莊敬","E239_N2161",202,1174.243,805.9,false],
  ["辛亥南行","E238_N2161",724,1272.95,1258.535,false],
  ["莊敬","E239_N2161",202,1170.013,816.725,true],
  ["辛亥北行","E239_N2161",134,344.353,922.056,true],
  ["辛亥南行","E238_N2161",724,1258.922,1273.845,true],
  ["懷恩 A","E238_N2160",1037,1052.317,675.92,true],
  ["懷恩 B","E238_N2160",572,1042.137,172.649,true],
  ["台北一號 A","E239_N2161",97,1207.233,828.121,true],
  ["台北一號 B","E240_N2161",72,703.977,651.227,true],
  ["台北二號 A","E239_N2162",536,98.093,69.67,true],
  ["台北二號 B","E239_N2162",523,286.531,107.455,true],
];

function insideRoad(roads,x,y) {
  return roads.some(r=>r.pts.slice(1).some((b,i)=>{
    const a=r.pts[i],dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy;
    if(!len2)return false;
    const t=((x-a[0])*dx+(y-a[1])*dy)/len2;
    return t>=0 && t<=1 && Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t)<3;
  }));
}
for (const [name,tile,index,x,y,expectSurface] of probes) {
  const [,east,north]=/E(\d+)_N(\d+)/.exec(tile);
  const region=Math.floor(east/8)+'_'+Math.floor(north/8);
  const detail=await read(new URL('../landscape-web/places/tunnels/'+region+'.json',import.meta.url));
  const original=(await read(path.join(root,tile,'roads.json'))).roads[index];
  assert(insideRoad([original],x,y),name+' 原始圖磚路形變更');
  assert.equal(insideRoad(surfaceRoads([original],detail[tile]),x,y),expectSurface,name+' 洞口或橋面異常');
}
const view=withTunnelTrees(new ArrayBuffer(80),[[1,2,0,0,0,0,0,0],[3,4,0,0,0,0,0,0]],.5);
assert.equal(view.byteLength,50);assert.equal(view.getUint16(40,true),1);
console.log(probes.length+' 個雙向洞身、引道與橋面樣點，以及手機樹木取樣通過');
