// 雨絲和山霧共用地景鏡頭與公尺座標。所有雨滴共用一個靜態緩衝。
import * as T from './engine/vendor/three.module.js';
import { tunnelAmount } from '../rail-3d/integration/train-lighting.js';

const uWeather = { value: new T.Vector4() }; // 雨量、雨霧、洞外濕度、白晝亮度
const uOrigin = { value: new T.Vector2() };
const uPortal = { value: new T.Vector4() }; // 地景座標的最近洞口與入洞方向
const uBore = { value: new T.Vector2() };   // 半寬與軌頂高度
const clamp = x => Math.min(1, Math.max(0, x));
const ramp = (a,b,x) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const shelter = `
uniform vec4 wPortal; uniform vec2 wBore;
float exposed(vec3 p) {
  vec2 q=p.xz-wPortal.xy;
  float depth=dot(q,wPortal.zw), side=abs(dot(q,vec2(-wPortal.w,wPortal.z)));
  return 1.-step(.01,wBore.x)*(1.-smoothstep(wBore.x,wBore.x+2.,side))*
    smoothstep(-1.,9.,depth)*(1.-smoothstep(5.,8.,p.y-wBore.y));
}
`;
function uniforms(sh) {
  Object.assign(sh.uniforms,{wLook:uWeather,wOrigin:uOrigin,wPortal:uPortal,wBore:uBore});
}
// 山霧（wBank）接在 three 共用的霧片段上，跟 engine 的 FX2 高度霧同一種接法：凡是開著霧的材質都吃得到，
// 包括 engine 之後新加的、每格圖磚各自建的（道碴）、clone 出來的（地標、夜燈）材質，以及網站自己加的場地、廟體。
// 原本逐一點名九種材質，鋼軌、道碴、電車線、電塔、橋、地標、場地、海面都漏掉，在雨霧裡顏色鮮明地浮在霧上。
// 數值用 plain object 掛進 ShaderLib：three 複製材質 uniforms 時不複製 plain object，每個材質都指到同一份。
const look = { x: 0, y: 0, z: 0, w: 1 }, lookOrigin = { x: 0, y: 0 };
function setLook(rain, mist, wet, day) { uWeather.value.set(rain, mist, wet, day); look.x = rain; look.y = mist; look.z = wet; look.w = day; }
function setLookOrigin(x, y) { uOrigin.value.set(x, y); lookOrigin.x = x; lookOrigin.y = y; }
for (const s of Object.values(T.ShaderLib)) if (s.uniforms?.fogColor) Object.assign(s.uniforms, { wLook: { value: look }, wOrigin: { value: lookOrigin } });
T.ShaderChunk.fog_pars_vertex += '\n#ifdef USE_FOG\nuniform vec4 wLook; uniform vec2 wOrigin; varying float wBank;\n#endif';
T.ShaderChunk.fog_vertex += `
#ifdef USE_FOG
wBank=0.;
if(wLook.y>0.) {
  // 使用已完成實例變換的頂點，讓樹冠與腳下地面得到相同的霧色。
  vec3 g=cameraPosition+vec3(dot(viewMatrix[0].xyz,mvPosition.xyz),dot(viewMatrix[1].xyz,mvPosition.xyz),dot(viewMatrix[2].xyz,mvPosition.xyz));
  vec2 phase=(g.xz+wOrigin)*.00076699;
  float band=.5+.25*sin(phase.x+2.*phase.y)+.25*cos(2.*phase.x-phase.y);
  wBank=wLook.y*smoothstep(150.,900.,-mvPosition.z)*band*(1.-smoothstep(60.,260.,abs(g.y-95.-90.*band)));
}
#endif`;
T.ShaderChunk.fog_pars_fragment += '\n#ifdef USE_FOG\nuniform vec4 wLook; varying float wBank;\n#endif';
T.ShaderChunk.tonemapping_fragment = '#ifdef USE_FOG\ngl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.6,.65,.67)*wLook.w,wBank*.32);\n#endif\n' + T.ShaderChunk.tonemapping_fragment;
export function shadeRainGround(sh) {
  uniforms(sh);
  sh.fragmentShader=sh.fragmentShader.replace('texture2D(tSat, uvS).rgb','texture2D(tSat, uvS, wLook.y*smoothstep(250.,1600.,length(cameraPosition-vW))*1.5).rgb')
    .replace('#include <color_fragment>','#include <color_fragment>\n diffuseColor.rgb*=1.-.20*wLook.x*(1.-wat);');
}
export function shadeRainRail(sh) {
  uniforms(sh);
  sh.vertexShader='varying vec3 wPos;\n'+sh.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n wPos=(modelMatrix*vec4(transformed,1.)).xyz;');
  sh.fragmentShader='varying vec3 wPos;\n'+shelter+sh.fragmentShader;
  sh.fragmentShader=sh.fragmentShader.replace('diffuseColor.rgb = rc;',`float wet=wLook.x*exposed(wPos);
    diffuseColor.rgb=rc*(1.-wet*(.28-.19*steel)); rRough*=1.-wet*(.18+.35*steel);`);
}
export function shadeRainSky(mat) {
  mat.uniforms.wLook=uWeather;
  mat.fragmentShader='uniform vec4 wLook;\n'+mat.fragmentShader.replace('gl_FragColor = vec4(c, 1.);',`vec3 clouds=mix(vec3(.6,.63,.65),vec3(.22,.28,.31),smoothstep(0.,.6,d.y))*wLook.w;
    gl_FragColor=vec4(mix(c,clouds,min(.94,wLook.y)),1.);`);
}
const DROPS=1280;
function drops() {
  const count=DROPS,position=new Float32Array(count*6),tips=new Float32Array(count*2);
  let seed=26119;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let i=0;i<count;i++){
    const v=[random(),random(),random()];position.set(v,i*6);position.set(v,i*6+3);tips[i*2+1]=1;
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(position,3));geometry.setAttribute('tip',new T.BufferAttribute(tips,1));
  const mat=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{clock:{value:0},clipNear:{value:1},amount:{value:0},wPortal:uPortal,wBore:uBore},
    vertexShader:`attribute float tip; uniform float clock,amount,clipNear; varying float alpha;`+shelter+`
    void main(){
      vec3 vel=vec3(1.3,-15.,.7);
      // 把雨體積放在可見視錐裡，地景為了畫遠山會隨鏡頭高度拉大近裁切距離。
      // 雨滴跟著鏡頭平移、不跟著鏡頭轉：跟車時鏡頭每秒走十幾公尺，雨滴釘在地上的話，近處的雨滴會被鏡頭帶著往側邊掃過畫面，不像在往下落。
      vec3 forward=-vec3(viewMatrix[0].z,viewMatrix[1].z,viewMatrix[2].z);
      vec3 ahead=forward*(clipNear+19.);
      vec3 q=ahead+mod(position*42.+clock*vel-ahead+21.,42.)-21.;
      vec3 p=cameraPosition+q;
      vec3 tail=p-tip*vel*(.04+.03*position.x);
      alpha=amount*exposed(p)*(.2+.22*position.z)*(1.-smoothstep(15.,21.,length(q-ahead)));
      gl_Position=projectionMatrix*viewMatrix*vec4(tail,1.);
    }`,fragmentShader:'varying float alpha;void main(){gl_FragColor=vec4(.80,.87,.91,alpha);}'});
  const mesh=new T.LineSegments(geometry,mat);mesh.frustumCulled=false;mesh.renderOrder=15;mesh.visible=false;return mesh;
}
// 只在觸控裝置的跟車雨景持續超過畫格預算時啟用。遠處改用已有的中／遠景地形。
export function weatherBudget(limits) {
  const normal={maxNear:limits.maxNear,maxMid:limits.maxMid,extraR:limits.extraR,shadowGap:limits.shadowGap};
  const reduced=(near,mid,extras,gap)=>({
    maxNear:Math.min(normal.maxNear,near),maxMid:Math.min(normal.maxMid,mid),
    extraR:Math.min(normal.extraR,extras),shadowGap:Math.max(normal.shadowGap,gap),
  });
  const settings=[normal,reduced(2,8,150,1600),reduced(1,4,80,3200)];
  return level=>Object.assign(limits,settings[level]);
}
export function createFollowRain(api,read,adaptive,onOverload,refreshSky) {
  const {view,origin,scene}=api, color=new T.Color(), wetColor=new T.Color(), skyTint=new T.Color(), grey=new T.Color(.8,.82,.84);
  const sun=scene.children.find(o=>o.isDirectionalLight), skyLight=scene.children.find(o=>o.isHemisphereLight);
  // engine 開著 FX2 霧時，霧的顏色與濃度在共用的 uHz2H（遠處霧色、濃度）與 uHz2Z（朝太陽的霧色）裡，scene.fog 只是它每格抄顏色的來源
  const fx2Fog=T.ShaderLib.standard.uniforms.uHz2H?.value, fx2SunFog=T.ShaderLib.standard.uniforms.uHz2Z?.value, fogKeep=[0,0,0,0,0,0,0];
  let mesh=null,last=0,poll=-Infinity,sample=null,rain=0,mist=0,cover=0,slow=0,range=1,wetNear=0,skyMist=0;
  const baseRatio=api.renderer.getPixelRatio();
  let detailLevel=0, pressure=0, clearTime=0;
  function setDetail(level){
    if(level===detailLevel)return;
    detailLevel=level;
    api.weatherBudget(level);
    api.renderer.setPixelRatio(level ? Math.min(baseRatio,level===1 ? 1 : .8) : baseRatio);
  }
  const frameLimits=[.039,.075,.09], holdTimes=[1.5,3,8];
  function budget(elapsed,wet){
    if(!adaptive || document.hidden)return;
    elapsed=Math.min(.3,elapsed);
    clearTime=wet ? 0 : clearTime+elapsed;
    if(clearTime>6){pressure=0;setDetail(0);return;}
    if(!wet)return;
    const limit=frameLimits[detailLevel];
    pressure=Math.max(0,pressure+(elapsed>limit ? elapsed : -elapsed*.45));
    const hold=holdTimes[detailLevel];
    if(pressure>hold){
      pressure=0;
      if(detailLevel<2)setDetail(detailLevel+1);
      else onOverload?.();
    }
  }
  function updatePortal(){
    let best=140*140;uBore.value.set(0,0);
    for(const t of api.tiles.values()){
      const b=t.mat?.bore;if(!b)continue;
      const {e0,n0}=t;
      for(let i=0;i<b.a.length;i++){
        const a=b.a[i],s=b.b[i];if(!s.w)continue;
        const e=e0+a.x,n=n0+a.y,d=(e-view.e)**2+(n-view.n)**2;
        if(d<best){best=d;uPortal.value.set(e-origin.e,origin.n-n,a.z,-a.w);uBore.value.set(s.y,s.x);}
      }
    }
  }
  function update(now, night) {
    const elapsed=last ? Math.max(.001,(now-last)/1000) : .033,dt=Math.min(.25,elapsed);last=now;
    if(now-poll>=350){poll=now;sample=read?.()||null;if(sample?.amount&&view.dist<1700){updatePortal();sample.cover=trackCover(sample.track);}else uBore.value.x=0;}
    const next=sample?.amount||0, fog=Math.max(next>0?.45+.52*next:0,sample?.fog||0);
    budget(elapsed, next>.01 || fog>.05);
    if(!next&&!fog&&!rain&&!mist){if(mesh)mesh.visible=false;return false;}
    const ease=(a,b,k)=>Math.abs(b-a)<.003?b:a+(b-a)*(1-Math.exp(-dt*k));
    rain=ease(rain,next,1.5);mist=ease(mist,fog,1.2);cover=ease(cover,sample?.cover||0,8);
    // 海面與建物反射的是 engine 的環境貼圖，engine 只在 setTime 時照當下天空重產；雨雲變化夠大、或停在新的濃度時請網站重產一次
    if(Math.abs(mist-skyMist)>.2||(mist===fog&&mist!==skyMist)){skyMist=mist;refreshSky?.();}
    range=1-ramp(300,900,view.dist);wetNear=rain*(1-cover)*range;
    const day=1-.96*night;
    setLook(rain,mist,wetNear,day);setLookOrigin(origin.e%8192,-origin.n%8192);
    if(elapsed<.5&&wetNear>.01)slow=clamp(slow+(elapsed>.045?dt/2:-dt/5));else if(!wetNear)slow=0;
    const strength=wetNear*(1-.6*slow);
    if(strength>.008&&!mesh){mesh=drops();scene.add(mesh);}
    if(mesh){
      mesh.visible=strength>.008;
      if(mesh.visible){
        const u=mesh.material.uniforms;
        u.clipNear.value=api.camera.near;u.clock.value=(now/1000)%4096;u.amount.value=strength;
        mesh.geometry.setDrawRange(0,2*Math.round((DROPS-(DROPS-(detailLevel?50:84))*slow)*(.55+.45*rain)));
      }
    }
    return true;
  }
  function draw(fn) {
    if(!mist)return fn();
    // 雨天是陰天：直射光幾乎沒有（陰影淡掉）、天光變灰變強，遠處淡進跟雨雲同色的霧裡
    const f=scene.fog,d=f.density,r=api.renderer,k=mist*.95; color.copy(f.color);
    // 霧色＝雨雲天空貼近地平線處的顏色（shadeRainSky），遠山才會融進天空，不會在地平線上浮出一道比天空亮的白牆
    wetColor.setRGB(.6,.63,.65).multiplyScalar(uWeather.value.w);
    f.color.lerp(wetColor,k);
    f.density=d+Math.min(.00076,.73/Math.max(1,view.dist))*mist;
    if(fx2Fog){
      fogKeep.splice(0,7,fx2Fog.x,fx2Fog.y,fx2Fog.z,fx2Fog.w,fx2SunFog.x,fx2SunFog.y,fx2SunFog.z);
      fx2Fog.x+=(wetColor.r-fx2Fog.x)*k;fx2Fog.y+=(wetColor.g-fx2Fog.y)*k;fx2Fog.z+=(wetColor.b-fx2Fog.z)*k;
      fx2SunFog.x+=(wetColor.r-fx2SunFog.x)*k;fx2SunFog.y+=(wetColor.g-fx2SunFog.y)*k;fx2SunFog.z+=(wetColor.b-fx2SunFog.z)*k;
      fx2Fog.w+=Math.min(.0006,.29/Math.max(1,view.dist))*mist; // 畫面中心（跟的車）最多霧兩成五，拉遠看時不會整片白掉
    }
    const direct=sun?.intensity, diffuse=skyLight?.intensity, exposure=r.toneMappingExposure;
    if(sun)sun.intensity=direct*(1-.9*mist);
    if(skyLight){skyLight.intensity=diffuse*(1+2.2*mist);skyTint.copy(skyLight.color);skyLight.color.lerp(grey,mist);}
    r.toneMappingExposure=exposure*(1-.06*mist);
    try{return fn();}finally{
      f.density=d;f.color.copy(color);
      if(sun)sun.intensity=direct;
      if(skyLight){skyLight.intensity=diffuse;skyLight.color.copy(skyTint);}
      r.toneMappingExposure=exposure;
      if(fx2Fog){[fx2Fog.x,fx2Fog.y,fx2Fog.z,fx2Fog.w,fx2SunFog.x,fx2SunFog.y,fx2SunFog.z]=fogKeep;}
    }
  }
  function reset(){
    last=0;poll=-Infinity;sample=null;rain=mist=cover=slow=wetNear=pressure=clearTime=0;
    if(skyMist){skyMist=0;refreshSky?.();}
    setDetail(0);
    setLook(0,0,0,1);uBore.value.x=0;if(mesh)mesh.visible=false;
  }
  return {update,draw,reset,get info(){return {rain,mist,cover,near:wetNear,ratio:api.renderer.getPixelRatio(),streaks:mesh?.visible?mesh.geometry.drawRange.count/2:0};}};
}
export function trackCover(pos) {
  const route=pos?.route;
  return route?.level&&Number.isFinite(pos.chainageM)&&route.path?tunnelAmount({level:route.level,length:route.path.length},pos.chainageM):0;
}
