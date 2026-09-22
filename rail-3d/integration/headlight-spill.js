import * as THREE from '../vendor/three.module.js';
// 每列只畫前端的一片柔光，不建立 SpotLight／陰影貼圖。共用網格，最多 24 列。
export function createHeadlightSpill(scene){
 const capacity=24*6*4*6,positions=new Float32Array(capacity*3),uv=new Float32Array(capacity*2),strength=new Float32Array(capacity),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('beamStrength',new THREE.BufferAttribute(strength,1).setUsage(THREE.DynamicDrawUsage));geometry.setDrawRange(0,0);
 const clip={value:new THREE.Matrix4()},material=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false,
  uniforms:{clip},vertexShader:'uniform mat4 clip; attribute float beamStrength; varying vec2 at; varying float light; void main(){at=uv;light=beamStrength;gl_Position=clip*vec4(position,1.);}',
  fragmentShader:'precision highp float; varying vec2 at; varying float light; void main(){float side=pow(max(0.,1.-at.y*at.y),2.);float reach=sin(at.x*3.14159265);float glow=side*reach*reach*light*.34;gl_FragColor=vec4(vec3(1.,.86,.58),glow);}' });
 material.onBeforeRender=(_r,_s,c,_g,m)=>clip.value.multiplyMatrices(c.projectionMatrix,m.modelViewMatrix);
 const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.layers.set(3);mesh.renderOrder=1;scene.add(mesh);const stats={beams:0,vertices:0,buildMs:0};
 return {stats,update(beams){const start=performance.now();let count=0;const origin=beams[0]?.rows[0]?.[0]||[0,0,0];mesh.position.fromArray(origin);
   for(const beam of beams.slice(0,24)){const rows=beam.rows;for(let i=0;i<rows.length-1;i++)for(let j=0;j<rows[i].length-1;j++){
    for(const [a,b]of [[i,j],[i+1,j],[i+1,j+1],[i,j],[i+1,j+1],[i,j+1]]){
     const p=rows[a][b];for(let k=0;k<3;k++)positions[count*3+k]=p[k]-origin[k];uv.set([a/(rows.length-1),b/(rows[a].length-1)*2-1],count*2);strength[count]=beam.strength;count++;
    }
   }}
   for(const attribute of Object.values(geometry.attributes))attribute.needsUpdate=true;geometry.setDrawRange(0,count);mesh.visible=count>0;stats.beams=Math.min(24,beams.length);stats.vertices=count;stats.buildMs=performance.now()-start;
 },destroy(){scene.remove(mesh);geometry.dispose();material.dispose();}};
}
