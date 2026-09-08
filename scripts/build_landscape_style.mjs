// 延用本站 OFM 圖資、中文字標與授權，產生獨立的自然色地景。
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const style=JSON.parse(await readFile(new URL('vendor/ofm-positron.json',root),'utf8'));
style.name='軌島・地景';
// 自有靜態圖磚；只有地景樣式會請求。OSM 細節畫在上方，ESA 補足大片土地覆蓋。
style.sources['taiwan-worldcover']={type:'vector',tiles:['./rail-3d/landcover/worldcover-2021/{z}/{x}/{y}.pbf'],minzoom:6,maxzoom:11,bounds:[118.151366,21.895601,122.085059,26.383474],
  attribution:'© <a href="https://esa-worldcover.org/en/data-access" target="_blank">ESA WorldCover 2021</a>'};
const fill={park:'#bad09e',water:'#86babd',landuse_residential:'#e7dcc6',landcover_wood:'#7fa47b',building:'#d7c5ad',road_area_pier:'#dfd4bb'};
for(const layer of style.layers){
  const p=layer.paint||(layer.paint={}),source=layer['source-layer'];
  if(layer.type==='background')p['background-color']='#ece3cd';
  if(fill[layer.id])p['fill-color']=fill[layer.id];
  if(layer.id==='landcover_wood')p['fill-opacity']=1;
  if(layer.id==='landuse_residential')p['fill-opacity']=.8;
  if(layer.id==='building')p['fill-outline-color']='#bda98f';
  if(layer.type==='line'){
    if(source==='waterway')p['line-color']='#7cafb4';
    else if(source==='transportation')p['line-color']=/casing/.test(layer.id)?'#c2b79f':/railway/.test(layer.id)?'#b5afa0':/path/.test(layer.id)?'#d3c3a0':'#f7efd9';
    else if(source==='boundary'){p['line-color']='#a8ad95';p['line-opacity']=.35;}
  }
  if(layer.type==='symbol'){
    p['text-color']=source?.startsWith('water')?'#426f79':'#53665d';p['text-halo-color']='#f5efdf';
    if(layer.id==='label_other')layer.minzoom=15;
  }
}
const land=(id,source,classes,color)=>({id,type:'fill',source:'openmaptiles','source-layer':source,filter:['match',['get','class'],classes,true,false],paint:{'fill-color':color,'fill-opacity':1}});
// 土地用途和地表覆蓋分層，公園界線本身不冒充整片森林。
style.layers.splice(1,0,
  {id:'landscape-worldcover',type:'fill',source:'taiwan-worldcover','source-layer':'landcover',filter:['!=',['get','class'],'wood'],paint:{'fill-color':['match',['get','class'],'farmland','#dbd5a3','grass','#c6d2a3','scrub','#a5bd91','built','#e7dcc6','bare','#c5c1af','snow','#eeeee4','water','#86babd','wetland','#abc6af','mangrove','#7faaa0','moss','#b0bb94','#ece3cd'],'fill-antialias':false}},
  {id:'landscape-worldcover-wood',type:'fill',source:'taiwan-worldcover','source-layer':'landcover',filter:['==',['get','class'],'wood'],paint:{'fill-color':'#7fa47b','fill-antialias':false}},
  land('landscape-farmland','landcover',['farmland'],'#dbd5a3'),
  land('landscape-farmyard','landuse',['farmyard'],'#dbd5a3'),
  land('landscape-grass','landcover',['grass'],'#c6d2a3'),
  land('landscape-scrub','landcover',['scrub'],'#a5bd91'),
  land('landscape-sand','landcover',['sand'],'#e8d6af'),
  land('landscape-rock','landcover',['rock','bare_rock'],'#c5c1af'),
  land('landscape-wetland','landcover',['wetland'],'#abc6af'),
  land('landscape-orchard','landuse',['orchard','vineyard'],'#b4c28f'),
  land('landscape-industry','landuse',['industrial','commercial'],'#d6d4c9'));
style.layers.splice(style.layers.findIndex(l=>l.id==='water')+1,0,{
  id:'landscape-shore',type:'line',source:'openmaptiles','source-layer':'water',
  filter:style.layers.find(l=>l.id==='water').filter,
  paint:{'line-color':'#d8e5cc','line-width':['interpolate',['linear'],['zoom'],8,.3,15,1.4],'line-opacity':.65}
});
await writeFile(new URL('vendor/ofm-landscape.json',root),JSON.stringify(style,null,2)+'\n');
