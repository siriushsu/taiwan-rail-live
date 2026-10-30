// 固定時鐘與稠密圖資，檢查正式圖層在整個過渡期間的預算、連續性與空間覆蓋。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let source=fs.readFileSync(new URL('../night-map.js',import.meta.url),'utf8');
// 反向對照：刻意退回中央排序，空間覆蓋判準必須紅。
if(process.env.GLASS_MUTATE==='center')source=source.replace('const targets=[];','priority.splice(0,priority.length,...candidates);const targets=[];');
function scene(coarse=false) {
  let now=1000,layer,bound,features=[],queries=0,uploads=0,draws=0,repaints=0;
  const buffers=new Map(),uniforms=new Map(),handlers=new Map();
  const gl=new Proxy({
    createBuffer:()=>({}),getAttribLocation:(_,name)=>name==='position'?0:1,
    getUniformLocation:(_,name)=>name,getShaderParameter:()=>true,getProgramParameter:()=>true,
    getParameter:()=>bound,bindBuffer:(_,b)=>bound=b,
    bufferData:(_,data)=>{buffers.set(bound,Array.from(data));uploads++;},
    uniform1f:(key,value)=>uniforms.set(key,value),drawArrays:()=>draws++,
    deleteBuffer:b=>buffers.delete(b),
  },{get:(object,key)=>key in object?object[key]:()=>{}});
  const map={
    getCanvas:()=>({clientWidth:800,clientHeight:600}),getLayer:()=>null,getStyle:()=>({layers:[]}),
    addLayer:l=>layer=l,on:(key,fn)=>handlers.set(key,fn),off:key=>handlers.delete(key),
    triggerRepaint:()=>repaints++,getZoom:()=>16.5,getSource:()=>true,getCenter:()=>({lng:0,lat:0}),
    getTerrain:()=>null,querySourceFeatures:()=>{queries++;return features;},
    project:p=>({x:p[0],y:p[1]}),
    getBounds:()=>({getSouthWest:()=>({lng:-1000,lat:-1000}),getNorthEast:()=>({lng:2000,lat:2000})}),
  };
  const context={window:{},document:{documentElement:{dataset:{theme:'dark'}}},
    matchMedia:()=>({matches:coarse}),performance:{now:()=>now},setTimeout:()=>1,clearTimeout:()=>{},
    maplibregl:{MercatorCoordinate:{fromLngLat:(p,z=0)=>({x:p.lng??p[0],y:p.lat??p[1],z})}},
  };
  map.getLayoutProperty=()=> 'visible';
  vm.createContext(context);vm.runInContext(source,context);context.window.RailNightMap.installGlass(map);layer.onAdd(map,gl);
  const fixture=(offset=0)=>Array.from({length:4800},(_,i)=>{
    const x=(i%80)*10+4,y=Math.floor(i/80)*10+4;
    return {tile:{z:14,x:offset,y:0},properties:{height:12},geometry:{type:'Polygon',coordinates:[[[x,y],[x+1,y],[x+1,y+1],[x,y+1],[x,y]]]}};
  });
  const render=()=>layer.render(gl,new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));
  return {layer,map,buffers,uniforms,fixture,render,setNow:v=>now=v,setFeatures:v=>features=v,
    counters:()=>({queries,uploads,draws,repaints})};
}

for(const coarse of [false,true]) {
  const s=scene(coarse),g=s.layer,features=s.fixture(),cap=coarse?700:1600;
  s.setFeatures(features);g.rebuild();
  assert.equal(g.buildings,cap,'稠密案例必須真的用滿建物額度');
  assert(g.count<=160000,'頂點預算必須包含所有過渡線段');
  assert([...g.selection.values()].every(x=>x.from===0&&x.to===1),'首次載入的線從透明開始');
  const cells=new Set([...g.selection.values()].map(({b})=>Math.floor(b.bounds[0]/100)+','+Math.floor(b.bounds[1]/100)));
  assert.equal(cells.size,48,'縮小時整個 8×6 畫面都有線，不只中央圓形');
  const center=features.slice().sort((a,b)=>{
    const p=a.geometry.coordinates[0][0],q=b.geometry.coordinates[0][0];
    return (p[0]+.5-400)**2+(p[1]+.5-300)**2-((q[0]+.5-400)**2+(q[1]+.5-300)**2);
  }).slice(0,20);
  for(const f of center)assert(g.selection.has(JSON.stringify(f.geometry.coordinates[0])),'中央最近 20 棟仍保留');
  s.setNow(1180);const before=s.counters();s.render();
  assert.equal(s.uniforms.get('progress'),.5,'動畫中點由 GPU 插值');
  assert.equal(s.counters().queries,before.queries,'動畫逐幀不可重新查詢圖資');
  assert.equal(s.counters().uploads,before.uploads,'動畫逐幀不可重新上傳頂點');
  assert.equal(s.counters().draws-before.draws,1,'每幀只呼叫一次 drawArrays');
  s.setNow(1360);s.render();assert(!g.fading,'靜止後動畫必須結束');
  const settled=s.counters();s.setNow(1400);s.render();assert.equal(s.counters().repaints,settled.repaints,'靜止畫面不持續要求重畫');
  const original=[...g.selection.keys()].sort();
  s.setFeatures(features.slice().reverse());g.rebuild();
  assert.deepEqual([...g.selection.keys()].sort(),original,'相同圖資反序仍選取同一批建物');
  // 換成完全不同的建物，以免只測到名單不變的假動畫。
  const replacements=s.fixture(1).map(f=>({...f,geometry:{type:'Polygon',coordinates:f.geometry.coordinates.map(r=>r.map(([x,y])=>[x+.2,y+.2]))}}));
  s.setFeatures(replacements);g.rebuild();
  assert([...g.selection.values()].every(x=>x.from===1&&x.to===0),'額度已滿時先保留舊線淡出');
  s.setNow(1580);s.render();assert.equal(s.uniforms.get('progress'),.5);
  // 淡出尚未結束就回頭，alpha 不能跳回 1。
  s.setFeatures(features);g.rebuild();
  assert([...g.selection.values()].every(x=>x.from===.5&&x.to===1),'中途改方向從當下透明度繼續');
  s.setNow(1940);s.render();
  s.setFeatures(replacements);g.rebuild();
  s.setNow(2300);s.render();
  assert(g.buildings<=cap&&g.count<=160000,'舊線換新線時守住建物與頂點額度');
  assert([...g.selection.values()].every(x=>x.from===0&&x.to===1),'舊線淡完，才漸進補新線');
  s.setNow(2660);s.render();assert(!g.fading);
  assert([...g.selection.values()].every(x=>x.from===1&&x.to===1));
  // 相機跨原點後，舊線在淡出期間也必須重算相對座標。
  s.map.getCenter=()=>({lng:.1,lat:.1});s.setFeatures(features);g.rebuild();
  const outgoing=[...g.selection.values()].find(x=>x.to===0);
  assert(outgoing,'換原點案例必須包含真正正在淡出的舊線');
  assert.equal(outgoing.b.v[0],Math.fround(outgoing.b.ring[0][0]-.1),'淡出的舊線使用新的相對原點');
  const oldBuffer=g.buffer,fadeBuffer=g.transitionBuffer;
  g.onRemove(s.map,g.gl);assert.equal(g.selection,null);assert.equal(g.targets,null);
  assert(!s.buffers.has(oldBuffer)&&!s.buffers.has(fadeBuffer),'兩個 GPU buffer 都必須釋放');
  console.log(`PASS ${coarse?'觸控':'桌面'} 空間覆蓋、中央保留、淡入淡出、中途反向、預算與單次 draw`);
}

{
  const s=scene(),g=s.layer;
  const dense=s.fixture().slice(0,500).map((f,i)=>{
    const x=(i%40)*20+10,y=Math.floor(i/40)*40+20;
    const ring=Array.from({length:179},(_,j)=>[x+3*Math.cos(j/179*2*Math.PI),y+3*Math.sin(j/179*2*Math.PI)]);ring.push(ring[0]);
    return {...f,properties:{height:900},geometry:{type:'Polygon',coordinates:[ring]}};
  });
  s.setFeatures(dense);g.rebuild();
  assert(g.buildings<1600&&g.count>150000&&g.count<=160000,'複雜輪廓必須真的打到頂點預算，而非只驗建物數');
  assert([...g.selection.values()].every(({b})=>b.v.length%8===0),'預算不得截斷最後一棟的線段');
  s.setNow(1360);s.render();g.onRemove(s.map,g.gl);
  console.log('PASS 複雜建物頂點硬上限與完整線段');
}
