// 退場透明度只屬於畫面；材質與其它車共用時，每次 draw 都要從該 mesh 重設。
export function trainDisplayOpacity(value) {
  return value == null || !Number.isFinite(Number(value)) ? 1 : Math.max(0, Math.min(1, Number(value)));
}

export function createFadingTrainMaterial(base, prepare) {
  const material = base.clone();
  material.transparent = true;
  material.depthWrite = false;
  material.forceSinglePass = true;
  material.onBeforeRender = (_renderer, _scene, view, _geometry, mesh) => prepare(material, view, mesh);
  return material;
}
