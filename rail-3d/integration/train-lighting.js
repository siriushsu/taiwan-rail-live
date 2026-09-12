// 日夜沿用既有太陽狀態；隧道以每節自身的里程取樣，不使用另一個播放時鐘。
export const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export function nightAmount(sun){return sun?1-smooth(-6,8,sun.elevation):0;}
export function tunnelAmount(path,s){
 if(!path?.level)return 0;
 const at=x=>{const l=path.level(Math.max(0,Math.min(path.length,x)));return l?.kind==='tunnel'||(l?.kind!=='bridge'&&(l?.offsetM??0)<-3)?1:0;};
 const here=at(s),radius=8;
 for(const direction of [-1,1]){const end=Math.max(0,Math.min(path.length,s+direction*radius));if(at(end)===here)continue;
  let lo=Math.min(s,end),hi=Math.max(s,end),left=at(lo);
  for(let i=0;i<8;i++){const mid=(lo+hi)/2;if(at(mid)===left)lo=mid;else hi=mid;}
  const boundary=(lo+hi)/2,value=smooth(-6,6,s-boundary);return left?1-value:value;
 }return here;
}
// LOD 玻璃的平滑頂點法線會朝向窗框，不能拿它判斷側窗，否則同一片窗會出現黑三角。
// 以實際三角面的朝向辨識側面玻璃；每份共用網格只算一次，保留原頂點與白天材質。
export function prepareWindowLighting(geometry,THREE){
 const p=geometry.getAttribute('position'),color=geometry.getAttribute('color'),gloss=geometry.getAttribute('gloss'),values=new Float32Array(p.count*2),faces=[];
 let low=Infinity,high=-Infinity;
 for(let i=0;i<p.count;i+=3){
  if(![i,i+1,i+2].every(j=>gloss.getX(j)>.78&&color.getX(j)<.2&&color.getY(j)<.35&&color.getZ(j)<.4))continue;
  const ax=p.getX(i+1)-p.getX(i),ay=p.getY(i+1)-p.getY(i),az=p.getZ(i+1)-p.getZ(i),bx=p.getX(i+2)-p.getX(i),by=p.getY(i+2)-p.getY(i),bz=p.getZ(i+2)-p.getZ(i);
  const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
  if(Math.abs(ny)<Math.hypot(nx,ny,nz)*.75||Math.hypot(nx,ny,nz)<1e-9)continue;
  faces.push(i);for(let j=i;j<i+3;j++){low=Math.min(low,p.getZ(j));high=Math.max(high,p.getZ(j));}
 }
 for(const i of faces)for(let j=i;j<i+3;j++){values[j*2]=1;values[j*2+1]=(p.getZ(j)-low)/Math.max(.01,high-low);}
 geometry.setAttribute('windowLight',new THREE.Float32BufferAttribute(values,2));
}
export function installTrainLighting(material,THREE){
 Object.assign(material.uniforms,{trainNight:{value:0},trainTunnel:{value:new THREE.Vector3()},trainBounds:{value:new THREE.Vector2(-1,1)},trainOpacity:{value:1}});
 material.vertexShader=material.vertexShader.replace('varying vec3 rgb,nrm;', 'attribute vec2 windowLight; varying vec2 cabinLight; uniform vec2 trainBounds; varying float carriageX; varying vec3 rgb,nrm;').replace('void main(){rgb=color;', 'void main(){cabinLight=windowLight;carriageX=clamp((position.x-trainBounds.x)/(trainBounds.y-trainBounds.x),0.,1.);rgb=color;');
 material.fragmentShader=material.fragmentShader.replace('varying vec3 rgb,nrm;', 'uniform float trainNight,trainOpacity; uniform vec3 trainTunnel; varying vec2 cabinLight; varying float carriageX; varying vec3 rgb,nrm;');
 material.fragmentShader=material.fragmentShader.replace('gl_FragColor=vec4(min(vec3(1.),rgb*light+vec3(spec)),1.);}', [
  'float tunnel=carriageX<.5?mix(trainTunnel.x,trainTunnel.y,carriageX*2.):mix(trainTunnel.y,trainTunnel.z,(carriageX-.5)*2.);',
  'float darkness=max(trainNight,tunnel*.94);',
  'vec3 shade=mix(vec3(1.),vec3(.29,.36,.47),darkness);',
  'vec3 lit=rgb*light*shade+vec3(spec)*(1.-darkness*.8);',
  'vec3 interior=mix(vec3(.94,.72,.43),vec3(1.,.93,.76),smoothstep(0.,1.,cabinLight.y));',
  'lit=mix(lit,interior,cabinLight.x*darkness);',
  'gl_FragColor=vec4(min(vec3(1.),lit),trainOpacity);}'
 ].join('\n'));
}
export function createTrainLamps(THREE){
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,-.82,0,0,.82,0],3));
 const material=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,toneMapped:false,
  uniforms:{clip:{value:new THREE.Matrix4()},strength:{value:0},tint:{value:new THREE.Color(1,.91,.68)},pixelRatio:{value:1},tail:{value:0}},
  vertexShader:'uniform mat4 clip; uniform float strength,pixelRatio,tail; void main(){gl_Position=clip*vec4(position,1.);gl_PointSize=mix(7.+11.*strength,5.+4.*strength,tail)*pixelRatio;}',
  fragmentShader:'precision highp float; uniform float strength,tail; uniform vec3 tint; void main(){float r=length(gl_PointCoord-.5)*2.;float glow=exp(-r*r*5.)*(1.-smoothstep(.75,1.,r));float core=1.-smoothstep(.04,.24,r);vec3 color=mix(tint,vec3(1.,.99,.94),core*(1.-tail));gl_FragColor=vec4(color,min(1.,(glow+core*.8)*strength));}' });
 material.onBeforeRender=(_r,_s,c,_g,mesh)=>{material.uniforms.clip.value.multiplyMatrices(c.projectionMatrix,mesh.modelViewMatrix);material.uniforms.strength.value=mesh.userData.lightStrength||0;material.uniforms.tail.value=mesh.userData.tail?1:0;material.uniforms.tint.value.setRGB(...(mesh.userData.tail?[1,.16,.06]:[1,.91,.68]));material.uniforms.pixelRatio.value=Math.min(globalThis.devicePixelRatio||1,2);material.uniformsNeedUpdate=true;};
 return {add(car,part,width,side){const points=new THREE.Points(geometry,material);points.position.set(side*(part.bodyLengthM/2+.04),0,1.25);points.scale.y=width/3.2;points.frustumCulled=false;points.renderOrder=4;car.add(points);return points;},destroy(){geometry.dispose();material.dispose();}};
}
