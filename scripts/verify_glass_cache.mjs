// 直接執行正式玻璃線圖層；地形關閉不一定發 sourcedata，快取仍須回到平面。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{},matchMedia:()=>({matches:true}),performance:{now:()=>1000},setTimeout:()=>1,clearTimeout:()=>{},maplibregl:{MercatorCoordinate:{fromLngLat:(p,z=0)=>({x:p.lng??p[0],y:p.lat??p[1],z})}}};
vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../night-map.js',import.meta.url),'utf8'),context);
let terrain=false,layer,uploaded;
const center={lng:121,lat:25},feature={id:1,tile:{z:14,x:1,y:1},properties:{height:20},geometry:{type:'Polygon',coordinates:[[[121,25],[121.001,25],[121.001,25.001],[121,25.001],[121,25]]]}};
const gl=new Proxy({bufferData:(_target,data)=>uploaded=Array.from(data),getShaderParameter:()=>true,getProgramParameter:()=>true},{get:(o,k)=>k in o?o[k]:()=>{}});
const map={getCanvas:()=>({clientWidth:1000,clientHeight:800}),getPitch:()=>0,unproject:()=>center,project:()=>({x:500,y:400}),getLayer:()=>null,getStyle:()=>({layers:[]}),addLayer:l=>layer=l,on:()=>{},off:()=>{},triggerRepaint:()=>{},getZoom:()=>16.5,getSource:()=>true,getCenter:()=>center,getTerrain:()=>terrain?{}:null,queryTerrainElevation:()=>100,querySourceFeatures:()=>[feature],getBounds:()=>({getSouthWest:()=>({lng:120,lat:24}),getNorthEast:()=>({lng:122,lat:26}),contains:()=>true})};
context.window.RailNightMap.installGlass(map);layer.onAdd(map,gl);layer.rebuild();const flat=uploaded;assert(flat.length>0&&flat.every(Number.isFinite),'測試必須確實產生有效的玻璃線頂點');
terrain=true;layer.schedule({sourceId:'terrain'});layer.rebuild();const raised=uploaded;
assert(raised.some((n,i)=>i%4===2&&n===flat[i]+100),'地形上移的前置樣本必須存在');
terrain=false;layer.schedule();layer.rebuild();assert.deepEqual(uploaded,flat,'關掉地形後玻璃線不可留在舊高度');
layer.rebuild();assert.deepEqual(uploaded,flat,'快取重用仍逐頂點等價');
layer.onRemove(map,gl);assert.equal(layer.tiles,null);
console.log('PASS 玻璃線地形開關、逐頂點快取等價與釋放');
