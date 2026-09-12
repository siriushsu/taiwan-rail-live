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
export function installTrainLighting(material,THREE){
 Object.assign(material.uniforms,{trainNight:{value:0},trainTunnel:{value:new THREE.Vector3()},trainBounds:{value:new THREE.Vector2(-1,1)},trainOpacity:{value:1}});
 material.vertexShader=material.vertexShader.replace('varying vec3 rgb,nrm;', 'uniform vec2 trainBounds; varying float carriageX; varying vec3 rgb,nrm;').replace('void main(){rgb=color;', 'void main(){carriageX=clamp((position.x-trainBounds.x)/(trainBounds.y-trainBounds.x),0.,1.);rgb=color;');
 material.fragmentShader=material.fragmentShader.replace('varying vec3 rgb,nrm;', 'uniform float trainNight,trainOpacity; uniform vec3 trainTunnel; varying float carriageX; varying vec3 rgb,nrm;');
 material.fragmentShader=material.fragmentShader.replace('gl_FragColor=vec4(min(vec3(1.),rgb*light+vec3(spec)),1.);}', [
  'float tunnel=carriageX<.5?mix(trainTunnel.x,trainTunnel.y,carriageX*2.):mix(trainTunnel.y,trainTunnel.z,(carriageX-.5)*2.);',
  'float darkness=max(trainNight,tunnel*.94);',
  'vec3 shade=mix(vec3(1.),vec3(.29,.36,.47),darkness);',
  'float windowMask=smoothstep(.72,.8,shine)*(1.-smoothstep(.18,.48,max(rgb.r,max(rgb.g,rgb.b))))*(1.-smoothstep(.3,.7,abs(n.x)));',
  'vec3 lit=rgb*light*shade+vec3(spec)*(1.-darkness*.8);',
  'lit=mix(lit,vec3(1.,.77,.42),windowMask*darkness*.88);',
  'gl_FragColor=vec4(min(vec3(1.),lit),trainOpacity);}'
 ].join('\n'));
}
export function createTrainLamps(THREE){
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,-.82,0,0,.82,0],3));
 const material=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,toneMapped:false,
  uniforms:{clip:{value:new THREE.Matrix4()},strength:{value:0},tint:{value:new THREE.Color(1,.91,.68)},pixelRatio:{value:1}},
  vertexShader:'uniform mat4 clip; uniform float strength,pixelRatio; void main(){gl_Position=clip*vec4(position,1.);gl_PointSize=(5.+4.*strength)*pixelRatio;}',
  fragmentShader:'precision highp float; uniform float strength; uniform vec3 tint; void main(){float r=length(gl_PointCoord-.5)*2.;float glow=exp(-r*r*5.)*(1.-smoothstep(.75,1.,r));gl_FragColor=vec4(tint,glow*strength);}' });
 material.onBeforeRender=(_r,_s,c,_g,mesh)=>{material.uniforms.clip.value.multiplyMatrices(c.projectionMatrix,mesh.modelViewMatrix);material.uniforms.strength.value=mesh.userData.lightStrength||0;material.uniforms.tint.value.setRGB(...(mesh.userData.tail?[1,.16,.06]:[1,.91,.68]));material.uniforms.pixelRatio.value=Math.min(globalThis.devicePixelRatio||1,2);material.uniformsNeedUpdate=true;};
 return {add(car,part,width,side){const points=new THREE.Points(geometry,material);points.position.set(side*(part.bodyLengthM/2+.04),0,1.25);points.scale.y=width/3.2;points.frustumCulled=false;points.renderOrder=4;car.add(points);return points;},destroy(){geometry.dispose();material.dispose();}};
}
