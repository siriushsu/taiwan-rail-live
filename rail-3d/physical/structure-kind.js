// layer 表達交叉上下序，不能單獨作為橋梁或土堤的證據。
// https://wiki.openstreetmap.org/wiki/Key:layer
// official＝官方橋隧幾何的判定（data/rail_structures_official.json）。它只補「來源沒有標記」
// 的地面段，永遠不推翻來源明示的 bridge／tunnel——兩邊都是明示標記時不自行裁決。
export function classifyRailStructure(tags={},official=null){
  const layer=/^-?\d+(\.\d+)?$/.test(String(tags.layer??''))?Number(tags.layer):null;
  const bridge=!!tags.bridge&&tags.bridge!=='no';
  const passage=['avalanche_protector','building_passage'].includes(tags.tunnel);
  const source=passage&&!bridge?'surface':tags.tunnel==='yes'||tags.location==='underground'?'tunnel':bridge?'bridge':layer<0?'tunnel':'surface';
  const kind=source==='surface'&&(official==='bridge'||official==='tunnel')?official:source;
  const rank=kind==='tunnel'?Math.min(-1,layer??-1):kind==='bridge'?Math.max(1,layer??1):layer??0;
  return {kind,rank,layer,...(kind!==source?{officialKind:kind}:{})};
}
