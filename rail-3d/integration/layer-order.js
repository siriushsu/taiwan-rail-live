// 玻璃後的列車先提供底色；底色必須在所有地表道路畫完之後。
// getStyle() 不列出 custom layers，故自訂 pass 以固定 ID 額外安置。
export function orderBuildingPasses(map) {
  const layers=map.getStyle()?.layers||[];
  const buildings=layers.filter(layer=>layer.type==='fill-extrusion');
  if(!buildings.length)return;
  const isGround=layer=>layer.type!=='symbol'&&layer.type!=='custom'&&layer.type!=='fill-extrusion'
    &&!layer.id.startsWith('track-')&&!layer.id.startsWith('aligndot');
  let lastGround=-1;
  layers.forEach((layer,i)=>{if(isGround(layer))lastGround=i;});
  const anchor=layers.slice(lastGround+1).find(layer=>layer.type==='symbol'||layer.id.startsWith('track-'))?.id;
  for(const layer of buildings)map.moveLayer(layer.id,anchor);
  if(map.getLayer('live-tunnel-apertures'))map.moveLayer('live-tunnel-apertures',buildings[0].id);
  if(map.getLayer('live-vehicles-underlay'))map.moveLayer('live-vehicles-underlay',buildings[0].id);
  if(map.getLayer('building-glass-edges'))map.moveLayer('building-glass-edges',anchor);
}
