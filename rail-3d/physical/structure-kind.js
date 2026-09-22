// layer 表達交叉上下序，不能單獨作為橋梁或土堤的證據。
// https://wiki.openstreetmap.org/wiki/Key:layer
// official＝官方橋隧幾何的判定（data/rail_structures_official.json 的一條 entry，或舊式的
// 純 kind 字串）。兩種效力：沒有 override 的只補「來源沒有標記」的地面段；帶 override 的
// 是產生器用 DEM 地形裁決過的反向改判（來源與官方互指橋／隧道），才可以推翻來源明示的標記。
// rank 只拿來排相交上下序，**不可拿來當顯示高度**——OSM 把高鐵某些高架橋標到 layer=4，
// 乘 8 公尺就變成離地 32 公尺的空中軌道，那正是 2026-09-11 回報的「整段多次上上下下」。
export function classifyRailStructure(tags={},official=null){
  const o=typeof official==='string'?{kind:official}:official;
  const structural=o&&(o.kind==='bridge'||o.kind==='tunnel');
  const layer=/^-?\d+(\.\d+)?$/.test(String(tags.layer??''))?Number(tags.layer):null;
  const bridge=!!tags.bridge&&tags.bridge!=='no';
  const passage=['avalanche_protector','building_passage'].includes(tags.tunnel);
  const source=passage&&!bridge?'surface':tags.tunnel==='yes'||tags.location==='underground'?'tunnel':bridge?'bridge':layer<0?'tunnel':'surface';
  const kind=structural&&(source==='surface'||o.override===source)?o.kind:source;
  const rank=kind==='tunnel'?Math.min(-1,layer??-1):kind==='bridge'?Math.max(1,layer??1):layer??0;
  return {kind,rank,layer,...(kind!==source?{officialKind:kind,...(o.override===source?{officialOverride:source,officialReliefM:o.reliefM}:{})}:{})};
}
