// 原始網格入口。THREE 由接入端注入，沒有 DOM、全域 THREE、相機或動畫迴圈。
export async function loadWenhu(base=new URL('./',import.meta.url),fetcher=fetch) {
  const [metaResponse,binaryResponse]=await Promise.all(['wenhu.model.json','wenhu.mesh.bin'].map(f=>fetcher(new URL(f,base))));
  if(!metaResponse.ok||!binaryResponse.ok)throw Error('文湖網格資產載入失敗');
  const [meta,binary]=await Promise.all([metaResponse.json(),binaryResponse.arrayBuffer()]);
  if(binary.byteLength!==meta.mesh.byteLength)throw Error('文湖網格長度不符');
  if(globalThis.crypto?.subtle){
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',binary)),v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==meta.mesh.sha256)throw Error('文湖網格雜湊不符');
  }
  const data=new Float32Array(binary.byteLength/4),view=new DataView(binary);
  for(let i=0;i<data.length;i++)data[i]=view.getFloat32(i*4,true);
  return {meta,data};
}
export function createWenhuGeometry(THREE,asset) {
  const geometry=new THREE.BufferGeometry(),buffer=new THREE.InterleavedBuffer(asset.data,10);
  for(const [name,itemSize,offset] of [['position',3,0],['normal',3,3],['color',3,6],['gloss',1,9]])
    geometry.setAttribute(name,new THREE.InterleavedBufferAttribute(buffer,itemSize,offset));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}
export function createWenhuMaterial(THREE) {
  // 同原模型的 sRGB 調色和逐頂點 gloss，避免 Three 色彩轉換再改一次顏色。
  return new THREE.ShaderMaterial({
    side:THREE.DoubleSide,depthTest:true,depthWrite:true,transparent:false,toneMapped:false,
    vertexShader:[
      'precision highp float; attribute vec3 color; attribute float gloss;',
      'varying vec3 rgb,nrm; varying float shine;',
      'void main(){rgb=color;nrm=normal;shine=gloss;',
      'gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader:[
      'precision highp float; varying vec3 rgb,nrm; varying float shine;',
      'void main(){vec3 n=normalize(nrm),l=normalize(vec3(-.5,-.6,1.6));',
      'float light=.79+max(-.4,dot(n,l))*.23+max(0.,n.z)*.10;',
      'float spec=pow(max(0.,dot(n,normalize(l+vec3(0.,.835,.55)))),25.)*(.055+shine*.34);',
      'gl_FragColor=vec4(min(vec3(1.),rgb*light+vec3(spec)),1.);}'
    ].join('\n')
  });
}
export function createWenhuCar(THREE,asset,geometry=createWenhuGeometry(THREE,asset),material=createWenhuMaterial(THREE)) {
  const car=new THREE.Mesh(geometry,material);
  car.scale.setScalar(asset.meta.scale.metersPerUnit);
  car.userData={modelId:asset.meta.modelId,groundAnchor:[0,0,0],units:'meters'};
  return car;
}
