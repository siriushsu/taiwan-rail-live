// layer 表達交叉上下序，不能單獨作為橋梁或土堤的證據。
// https://wiki.openstreetmap.org/wiki/Key:layer
export function classifyRailStructure(tags={}){
  const layer=/^-?\d+(\.\d+)?$/.test(String(tags.layer??''))?Number(tags.layer):null;
  const bridge=!!tags.bridge&&tags.bridge!=='no';
  const passage=['avalanche_protector','building_passage'].includes(tags.tunnel);
  const kind=passage&&!bridge?'surface':tags.tunnel==='yes'||tags.location==='underground'?'tunnel':bridge?'bridge':layer<0?'tunnel':'surface';
  const rank=kind==='tunnel'?Math.min(-1,layer??-1):kind==='bridge'?Math.max(1,layer??1):layer??0;
  return {kind,rank,layer};
}
