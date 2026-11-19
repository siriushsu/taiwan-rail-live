import {modelHours, lightLevel, lightCalendar} from '../rail-3d/environment/model-hours.js';

// 同一個圖磚材質可能同時用在車站、博物館與紀念建築。各模型單獨控制
// 投光強度，仍沿用原有的索引、頂點色、玻璃反射和 draw call。
export function createModelLights() {
  const active = new Set(), originals = new WeakMap();
  let hour=12, calendar={weekday:0}, darkness=0;
  function update(entry) {
    const level=lightLevel(entry.hours,hour,calendar.weekday,calendar.monthlyMonday);
    const {material,source,authored}=entry;
    if (authored) {
      material.emissive.copy(source.emissive);
      material.emissiveIntensity=source.emissiveIntensity*level;
    } else material.emissiveIntensity=darkness*level;
  }
  function bind(mesh,hours,authored=false,glass=false,stationBase=null) {
    const source=mesh.material, material=source.clone();
    const compile=source.onBeforeCompile, key=source.customProgramCacheKey();
    material.onBeforeCompile=function(shader,renderer) {
      compile.call(this,shader,renderer);
      if (authored) return;
      // 圖磚車站的局部 Z 朝上，廟宇是 Y 朝上。用公尺座標作牆腳投光，
      // 讓屋頂、背面和兩盞燈之間保留陰影，拉近拉遠仍落在同一處。
      shader.uniforms.facadeBase={value:stationBase ?? 0};
      shader.vertexShader='uniform float facadeBase; varying vec3 facadePoint; varying vec3 facadeNormal;\n'+
        shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
          facadePoint = ${stationBase===null ? 'position.xzy' : 'position'};
          facadeNormal = ${stationBase===null ? 'objectNormal.xzy' : 'objectNormal'};
          facadePoint.z -= facadeBase;`);
      shader.fragmentShader='varying vec3 facadePoint; varying vec3 facadeNormal;\n'+
        shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
          if (any(greaterThan(emissive,vec3(0.)))) {
          vec3 wallNormal = normalize(facadeNormal);
          float wall = 1. - smoothstep(.35,.92,abs(wallNormal.z));
          float along = dot(facadePoint.xy,vec2(.81,.94)) * .42;
          float pool = .5 + .5*cos(along)*(1.-smoothstep(.5,3.,fwidth(along)));
          float facing = .55 + .45*max(0.,dot(wallNormal.xy,vec2(.68,-.73)));
          float spread = .55 + .45*exp(-max(0.,facadePoint.z)*.07);
          float wash = .095 + wall*facing*(.16 + .92*pool*pool)*spread;
          totalEmissiveRadiance *= ${glass ? '(.27 + .68*wash)' : 'wash'} * (.09 + diffuseColor.rgb);
          }`);
    };
    const finish=glass ? '-glass' : '';
    material.customProgramCacheKey=()=>key+(authored ? '' : '-facade-wash'+finish+(stationBase===null ? '-y' : '-z'));
    if (!authored) material.emissive.setRGB(...(glass ? [.62,.45,.28] : [.36,.26,.16]));
    const entry={source,material,hours,authored};
    mesh.material=material; originals.set(material,source); active.add(entry); update(entry);
    mesh.geometry.addEventListener('dispose',function release() {
      mesh.geometry.removeEventListener('dispose',release);
      active.delete(entry); material.dispose();
    });
  }
  return {
    bind,
    group(site,lod,build,solid,glass) {
      // 信義地標群的市府、百貨與商辦共用一份網格；同時段的部分仍一起繪製。
      const groups = new Map();
      if (site.id === 'xinyi-civic-group') {
        for (const part of lod.drawGroups) {
          const id = part.component === 'cityhall' ? 'taipei-city-hall' :
            part.component?.startsWith('skm-') ? 'xinyi-skm' :
            part.component === 'shifu' ? 'taipei-city-hall-bus' : site.id;
          if (!groups.has(id)) groups.set(id,[]);
          groups.get(id).push(part);
        }
      } else groups.set(site.id,lod.drawGroups);
      let result;
      for (const [id,parts] of groups) {
        const group=build(parts), hours=modelHours(id,site.name);
        for (const mesh of group.children) bind(mesh,hours,mesh.material!==solid && mesh.material!==glass,mesh.material===glass,lod.origin[2]);
        if (!result) result=group;
        else { result.add(...group.children.slice()); result.userData.bytes+=group.userData.bytes; }
      }
      return result || build([]);
    },
    original(material) { return originals.get(material) || material; },
    setTime(h,date,night) {
      hour=h; calendar=lightCalendar(...date); darkness=night;
      for (const entry of active) update(entry);
    },
  };
}
