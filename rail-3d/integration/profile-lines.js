// 與車廂共用公尺高程，寬度以螢幕像素計算；保留地形／建物深度遮擋。
// 線只比取樣地面高 0.65 m，MapLibre 畫的地形網格比取樣粗（遠處圖磚更粗），某些地方比線高就把線切成一段一段：
// 深度改取沿視線往鏡頭拉近 LINE_PULL 的位置，畫面位置與線寬不變。靠地形擋住的淺隧道（depth）不拉近。
// 遠處淡出（setFade）：鏡頭深度 from→to（MapLibre 畫面像素單位）之間淡成透明，strength＝0 時跟沒有這一段逐位元相同（新地景才開，見 landscape-web/site.js）。
import * as THREE from '../vendor/three.module.js';
const LINE_PULL=.015;
export function profileLines(scene,{underground=false}={}){
  let physicalQuiet=!underground;
  const geometry=new THREE.BufferGeometry(),uniforms={viewport:{value:new THREE.Vector2(1,1)},width:{value:5},physicalWidth:{value:1.4},outline:{value:0},eye:{value:new THREE.Vector4()},fade:{value:new THREE.Vector3(0,1,0)}},inverse=new THREE.Matrix4(),eyeAt=new THREE.Vector4();
  const vertexShader=`attribute vec3 other; attribute float side; attribute float cap; attribute float physical; attribute float pull; attribute vec3 color; varying vec3 vColor; varying float vPhysical; varying float vW; uniform vec2 viewport; uniform float width; uniform float physicalWidth; uniform vec4 eye;
    void main(){mat4 m=projectionMatrix*modelViewMatrix;vec4 p=m*vec4(position,1.0),q=m*vec4(other,1.0),e=m*vec4(mix(position,eye.xyz,eye.w*pull),1.0);vec2 d=(q.xy/q.w-p.xy/p.w)*viewport;d=length(d)>0.0001?normalize(d):vec2(1.0,0.0);vec2 n=vec2(-d.y,d.x);p.xy+=(n*side*mix(width,physicalWidth,physical)-d*cap)*p.w/viewport;p.z=e.z/e.w*p.w;gl_Position=p;vColor=color;vPhysical=physical;vW=p.w;}`;
  const fragmentShader=`varying vec3 vColor; varying float vPhysical; varying float vW; uniform vec3 fade; uniform float outline; uniform float night; uniform float opacity; uniform float physicalQuiet; void main(){float quiet=vPhysical*physicalQuiet*(1.0-night);vec3 c=mix(vColor,vec3(.43,.5,.48),.65*quiet);c=mix(c,vec3(1.0,.992,.965),outline*(1.0-night));gl_FragColor=vec4(c,opacity*(night*outline>0.5?.18:1.0)*mix(1.0,.45,quiet*outline)*(1.0-fade.z*smoothstep(fade.x,fade.y,vW)));}`;
  function layer(outline,order){const u={viewport:uniforms.viewport,eye:uniforms.eye,fade:uniforms.fade,width:{value:5},physicalWidth:{value:1.4},outline:{value:outline},night:{value:0},physicalQuiet:{value:physicalQuiet?1:0},opacity:{value:underground?.32:1}},material=new THREE.ShaderMaterial({uniforms:u,vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.layers.set(underground?1:0);mesh.frustumCulled=false;mesh.renderOrder=order;scene.add(mesh);return {u,material,mesh};}
  const casing=layer(1,0),line=layer(0,1);
  // 建置拆成「算」與「換上」（跟 rail-structures.js 的 build 同一個做法）：build 是產生器，due() 說這一段時間用完了就讓出主執行緒
  // （map3d.js 的分段重建用）；算完回傳的函式才把新的一份換上去，途中畫面還是上一份。set 是一次做完的原介面，結果相同。
  const CORNERS=[[0,-1],[0,1],[1,-1],[1,-1],[0,1],[1,1]];
  function* build(segments,due=()=>false){
    const n=segments.length*6,p=new Float32Array(n*3),o=new Float32Array(n*3),s=new Float32Array(n),cap=new Float32Array(n).fill(1),colors=new Float32Array(n*3),physicalFlags=new Float32Array(n),pulls=new Float32Array(n);
    let v=0,k=0;
    for(const {a,b,color,physical,depth}of segments){if(!(++k&255)&&due())yield;
      const c=new THREE.Color(color).convertLinearToSRGB();
      for(const [at,side]of CORNERS){const from=at?b:a,to=at?a:b,i=v*3;p[i]=from[0];p[i+1]=from[1];p[i+2]=from[2];o[i]=to[0];o[i+1]=to[1];o[i+2]=to[2];s[v]=side*(at?-1:1);physicalFlags[v]=physical?1:0;pulls[v]=depth?0:1;colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;v++;}}
    return ()=>{geometry.dispose();for(const [name,values,size]of [['position',p,3],['other',o,3],['side',s,1],['cap',cap,1],['color',colors,3],['physical',physicalFlags,1],['pull',pulls,1]])geometry.setAttribute(name,new THREE.BufferAttribute(values,size));geometry.setDrawRange(0,n);};
  }
  function set(segments){const job=build(segments);let step;do step=job.next();while(!step.done);step.value();}
  return {set,build,
    setFade(f){if(f&&f.strength>0&&f.to>f.from)uniforms.fade.value.set(f.from,f.to,Math.min(1,f.strength));else uniforms.fade.value.set(0,1,0);},
    setPhysicalQuiet(value){physicalQuiet=!!value;line.u.physicalQuiet.value=casing.u.physicalQuiet.value=physicalQuiet?1:0;},
    render(width,height,pixels,visible,dark=false,clip=null){uniforms.viewport.value.set(width,height);const v=clip&&eyeAt.set(0,0,1,0).applyMatrix4(inverse.copy(clip).invert());if(v&&v.w!==0&&Number.isFinite(v.x/v.w))uniforms.eye.value.set(v.x/v.w,v.y/v.w,v.z/v.w,LINE_PULL);else uniforms.eye.value.set(0,0,0,0);line.u.width.value=dark?2.2:pixels;casing.u.width.value=dark?9:pixels+2;line.u.physicalWidth.value=dark?1.4:physicalQuiet?1:1.5;casing.u.physicalWidth.value=dark?3:physicalQuiet?1.7:2.5;line.u.night.value=casing.u.night.value=dark?1:0;line.mesh.visible=casing.mesh.visible=visible;},
    destroy(){for(const l of [line,casing]){scene.remove(l.mesh);l.material.dispose();}geometry.dispose();}};
}
