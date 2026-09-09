// 與車廂共用公尺高程，寬度以螢幕像素計算；保留地形／建物深度遮擋。
import * as THREE from '../vendor/three.module.js';
export function profileLines(scene,{underground=false}={}){
  const geometry=new THREE.BufferGeometry(),uniforms={viewport:{value:new THREE.Vector2(1,1)},width:{value:5},physicalWidth:{value:1.4},outline:{value:0}};
  const vertexShader=`attribute vec3 other; attribute float side; attribute float cap; attribute float physical; attribute vec3 color; varying vec3 vColor; uniform vec2 viewport; uniform float width; uniform float physicalWidth;
    void main(){vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0),q=projectionMatrix*modelViewMatrix*vec4(other,1.0);vec2 d=(q.xy/q.w-p.xy/p.w)*viewport;d=length(d)>0.0001?normalize(d):vec2(1.0,0.0);vec2 n=vec2(-d.y,d.x);p.xy+=(n*side*mix(width,physicalWidth,physical)-d*cap)*p.w/viewport;gl_Position=p;vColor=color;}`;
  const fragmentShader=`varying vec3 vColor; uniform float outline; uniform float night; uniform float opacity; void main(){vec3 c=mix(vColor,vec3(1.0,.992,.965),outline*(1.0-night));gl_FragColor=vec4(c,opacity*(night*outline>0.5?.18:1.0));}`;
  function layer(outline,order){const u={viewport:uniforms.viewport,width:{value:5},physicalWidth:{value:1.4},outline:{value:outline},night:{value:0},opacity:{value:underground?.32:1}},material=new THREE.ShaderMaterial({uniforms:u,vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:!underground,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.layers.set(underground?1:0);mesh.frustumCulled=false;mesh.renderOrder=order;scene.add(mesh);return {u,material,mesh};}
  const casing=layer(1,0),line=layer(0,1);
  return {set(segments){geometry.dispose();const p=[],o=[],s=[],cap=[],colors=[],physicalFlags=[];for(const {a,b,color,physical}of segments){const c=new THREE.Color(color).convertLinearToSRGB();for(const [at,side]of [[0,-1],[0,1],[1,-1],[1,-1],[0,1],[1,1]]){p.push(...(at?b:a));o.push(...(at?a:b));s.push(side*(at?-1:1));cap.push(1);physicalFlags.push(physical?1:0);colors.push(c.r,c.g,c.b);}}
      for(const [name,values,size]of [['position',p,3],['other',o,3],['side',s,1],['cap',cap,1],['color',colors,3],['physical',physicalFlags,1]])geometry.setAttribute(name,new THREE.Float32BufferAttribute(values,size));geometry.setDrawRange(0,p.length/3);},
    render(width,height,pixels,visible,dark=false){uniforms.viewport.value.set(width,height);line.u.width.value=dark?2.2:pixels;casing.u.width.value=dark?9:pixels+2;line.u.physicalWidth.value=dark?1.4:1.5;casing.u.physicalWidth.value=dark?3:2.5;line.u.night.value=casing.u.night.value=dark?1:0;line.mesh.visible=casing.mesh.visible=visible;},
    destroy(){for(const l of [line,casing]){scene.remove(l.mesh);l.material.dispose();}geometry.dispose();}};
}
