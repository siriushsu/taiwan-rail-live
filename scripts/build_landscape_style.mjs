// 延用本站 OFM 圖資、中文字標與授權，產生獨立的自然色地景。
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const style=JSON.parse(await readFile(new URL('vendor/ofm-positron.json',root),'utf8'));
style.name='軌島・地景';
style.metadata={...style.metadata,'railisland:contextTiles':JSON.parse(await readFile(new URL('landscape-web/places/library-context/index.json',root),'utf8'))};
// 自有靜態圖磚；只有地景樣式會請求。OSM 細節畫在上方，ESA 補足大片土地覆蓋。
style.sources['taiwan-worldcover']={type:'vector',tiles:['./rail-3d/landcover/worldcover-2021/{z}/{x}/{y}.pbf'],minzoom:6,maxzoom:11,bounds:[118.151366,21.895601,122.085059,26.383474],
  attribution:'© <a href="https://esa-worldcover.org/en/data-access" target="_blank">ESA WorldCover 2021</a>'};
const fill={park:'#bad09e',water:'#86babd',landuse_residential:'#e7dcc6',landcover_wood:'#7fa47b',building:'#d7c5ad',road_area_pier:'#dfd4bb'};
// 部分 OFM transportation_name 缺少 brunnel；隧道專名也必須避開地表路牌。
const tunnelName = ['coalesce',['get','name:zh-Hant'],['get','name:zh'],['get','name'],''];
const surfaceName = ['all',...['隧道','車行地下道'].map(word=>['==',['index-of',word,tunnelName],-1])];
for(const layer of style.layers){
  const p=layer.paint||(layer.paint={}),source=layer['source-layer'];
  if(layer.type==='background')p['background-color']='#ece3cd';
  if(fill[layer.id])p['fill-color']=fill[layer.id];
  if(layer.id==='landcover_wood')p['fill-opacity']=1;
  if(layer.id==='landuse_residential')p['fill-opacity']=.8;
  if(layer.id==='building')p['fill-outline-color']='#bda98f';
  // 地下道路和鐵路由洞口銜接地表；向量圖在所有縮放都不能把地下段投影到山上。
  if (['transportation','transportation_name'].includes(source))
    layer.filter=['all',...(layer.filter?[layer.filter]:[]),...(source==='transportation_name'?[surfaceName]:[]),['!=',['get','brunnel'],'tunnel']];
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
// 校界、場館、逐棟外形和球場依所在區域載入；已有高精度近景模型的範圍，接手後交給同一張 3D 畫布。
const source = 'taiwan-places';
style.sources[source] = {
  type: 'vector', tiles: ['ri-places://tiles/{z}/{x}/{y}'], minzoom: 12, maxzoom: 12,
  bounds: [118.15, 21.89, 122.09, 26.39],
  attribution: '校界 © <a href="https://data.gov.tw/dataset/174606">內政部國土測繪中心</a> · 場館 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap 貢獻者</a> · 寺廟：<a href="https://data.gov.tw/dataset/6246">文資局</a>、<a href="https://data.gov.tw/dataset/8203">內政部</a>',
};
const category = ['get','k'];
const categoryColor = ['match',category,['mall','department'],'#a48668','library','#698887','theme_park','#a77355','playground','#95a478','museum','#9b8a7a','stadium','#859775','#879b87'];
const fieldColor = ['match',category,'track','#b1725f','track-blue','#3886bf','basketball','#b88470','tennis','#699784','volleyball','#af9579','soccer','#859f74','baseball','#a0a87a','sand','#c1ae87','asphalt','#88918d','clay','#ad765b','playground','#b5a285','#92a285'];
const firstRoad = style.layers.findIndex(layer => layer['source-layer'] === 'transportation');
const grounds = {id:'place-grounds',type:'line',source,'source-layer':'grounds',minzoom:14,
  paint:{'line-color':categoryColor,'line-opacity':.55,'line-width':['interpolate',['linear'],['zoom'],14,.65,18,1.5]}};
style.layers.splice(firstRoad,0,grounds);
for (const near of [0,1]) {
  const suffix = near ? 'detail' : 'regional', filter = ['==',['get','near'],near];
  style.layers.push(
    {id:'place-fields-'+suffix,type:'fill',source,'source-layer':'fields',minzoom:14,filter,paint:{'fill-color':fieldColor}},
    {id:'place-lines-'+suffix,type:'line',source,'source-layer':'lines',minzoom:16,filter,
      paint:{'line-color':'#f4ece0','line-width':['interpolate',['linear'],['zoom'],16,.45,19,1.2]}},
    {id:'place-buildings-'+suffix,type:'fill-extrusion',source,'source-layer':'buildings',minzoom:15,filter,
      paint:{'fill-extrusion-color':['coalesce',['get','wall'],['match',category,['mall','department'],'#c6bbaa','library','#b8c7c1','museum','#c6beb2','#c9c5ae']],
        'fill-extrusion-height':['get','h'],'fill-extrusion-vertical-gradient':true}},
  );
}
for (const [bespoke,suffix] of [[0,'regional'],[1,'detail']]) {
  style.layers.push({id:'place-architecture-'+suffix,type:'fill-extrusion',source,'source-layer':'architecture',minzoom:14,
    filter:['==',['get','bespoke'],bespoke],paint:{'fill-extrusion-color':['get','color'],
    'fill-extrusion-base':['get','base'],'fill-extrusion-height':['get','top'],'fill-extrusion-vertical-gradient':false}});
}
for (const [near,suffix] of [[0,'regional'],[1,'detail']]) {
  style.layers.push({id:'place-temple-'+suffix,type:'fill-extrusion',source,'source-layer':'temple',minzoom:15,
    filter:['==',['get','near'],near],paint:{'fill-extrusion-color':['get','color'],
    'fill-extrusion-base':['get','base'],'fill-extrusion-height':['get','top'],'fill-extrusion-vertical-gradient':false}});
}
const placeNames = {id:'place-names',type:'symbol',source,'source-layer':'names',minzoom:14,
  filter:['step',['zoom'],['in',category,['literal',['mall','department','university','theme_park','library','stadium']]],15,true],
  layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],14,12,18,14],
    'text-max-width':12,'text-variable-anchor':['center','top','bottom'],'text-radial-offset':.6,'text-padding':7,
    'symbol-sort-key':['case',['==',['get','priority'],1],-2,['match',category,['mall','department','university','theme_park'],0,'library',1,'kindergarten',4,2]]},
  paint:{'text-color':'#30423c','text-halo-color':'#fff9ea','text-halo-width':1.8}};
style.layers.push(
  {...placeNames, filter:['all', ['!=',['get','major'],1], placeNames.filter]},
  {...placeNames, id:'place-names-major', filter:['==',['get','major'],1],
    layout:{...placeNames.layout, 'text-allow-overlap':true}},
);

// 新地景接手後才開啟。沿既有圖源的道路放路名牌，有公路編號時一併顯示。
const roadName = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name'], ''];
const roadRef = ['coalesce', ['get', 'ref'], ''];
style.layers.push({
  id: 'landscape-road-signs', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom: 17,
  filter: ['all', surfaceName, ['!=',['get','brunnel'],'tunnel'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
    ['any', ['!=', roadName, ''], ['!=', roadRef, '']]],
  layout: {
    visibility: 'none', 'symbol-placement': 'line', 'symbol-spacing': 1000, 'symbol-avoid-edges': false,
    'text-field': ['case', ['==', roadName, ''], roadRef, ['any', ['==', roadRef, ''], ['==', roadName, roadRef]], roadName,
      ['concat', roadRef, ' · ', roadName]],
    'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-max-width': 14, 'text-padding': 55,
    'text-pitch-alignment': 'viewport', 'text-rotation-alignment': 'viewport',
    'icon-image': 'landscape-road-plate', 'icon-text-fit': 'both', 'icon-text-fit-padding': [3,6,3,6],
    'icon-padding': 36, 'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport',
  },
  paint: { 'text-color': '#ffffff' },
});
await writeFile(new URL('vendor/ofm-landscape.json',root),JSON.stringify(style,null,2)+'\n');
