// 近看使用完整 Blender 網格；海岸保留目前車款的三節編組，共用單一 WebGL context。
import * as THREE from './vendor/three.module.js';
import {createCoast,createCoastReflection} from './garage-coast.js';
import {createLoop} from './garage-loop.js';
import {loadGarageModel,createConsist} from './garage-model.js';

export function createRenderer(onLost = () => {}) {
  const renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, preserveDrawingBuffer:true});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-6,6,4,-4,.1,160);
  camera.up.set(0,0,1);
  const hemi=new THREE.HemisphereLight('#e6efff','#938670',1.75);scene.add(hemi);const lights=[];
  const coastCamera=new THREE.PerspectiveCamera(44,1,.1,2000);coastCamera.up.set(0,0,1);
  for (const [color,intensity,pos] of [['#fff5e6',3,[7,-9,14]],['#d7e8ff',1.5,[-7,5,8]]]) {
    const light = new THREE.DirectionalLight(color,intensity);light.position.set(...pos);scene.add(light);lights.push(light);
  }
  const studio = new THREE.Scene();studio.background = new THREE.Color(.30,.34,.38);
  const cards=[];
  for(const [position,size,strength] of [[[9,-8,11],[8,3],4.8],[[-9,5,7],[7,4],2.8],[[0,1,14],[9,5],3.6]]) {
    const card=new THREE.Mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial({color:new THREE.Color(strength,strength,strength),side:THREE.DoubleSide}));
    card.position.set(...position);card.lookAt(0,0,1);studio.add(card);cards.push(card);
  }
  const pmrem=new THREE.PMREMGenerator(renderer), environment=pmrem.fromScene(studio,.07,.1,60);
  scene.environment=environment.texture;cards.forEach(c=>{c.geometry.dispose();c.material.dispose();});pmrem.dispose();
  const trainRoot=new THREE.Group();scene.add(trainRoot);
  let coast,loop,primary,consist,car,abort,coastalReflection,reflectedTheme,revision=0,disposed=false,lost=false,id='',loadKey='';
  const focus=new THREE.Vector3(),project=new THREE.Vector3(),loopFocus=new THREE.Vector3(),viewRight=new THREE.Vector3(),viewUp=new THREE.Vector3();
  const clear=()=>{trainRoot.clear();primary?.dispose();primary=null;car=null;if(consist){scene.remove(consist.root);consist.dispose();consist=null;}id=loadKey='';};
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(!disposed){lost=true;onLost();}});
  return {
    async load(nextId,mode='model'){
      if(disposed||lost)throw Error('renderer unavailable');
      const key=nextId+':'+mode;if(key===loadKey){revision++;abort?.abort();return;}
      const ticket=++revision;abort?.abort();abort=new AbortController();const {signal}=abort;
      if(id!==nextId){clear();const a=await loadGarageModel(nextId,signal);if(disposed||ticket!==revision){a.dispose();return;}
        primary=a;car=new THREE.Mesh(a.geometry,a.materials);trainRoot.add(car);id=nextId;
      }
      if(mode!=='model'&&!consist){const c=await createConsist(id,primary,signal);if(disposed||ticket!==revision){c.dispose();return;}consist=c;scene.add(c.root);}
      if(!disposed&&ticket===revision)loadKey=key;
    },
    draw(target,row,angle,options={}){
      if(disposed||lost||row.id!==id||!car)return false;
      const rect=target.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5),w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr)),aspect=w/h;
      if(target.width!==w||target.height!==h){target.width=w;target.height=h;}
      if(renderer.domElement.width!==w||renderer.domElement.height!==h)renderer.setSize(w,h,false);
      const elevation=Math.max(.08,Math.min(1.48,options.elevation??.39)),onTrack=options.mode==='track',onLoop=options.mode==='loop',onScene=onTrack||onLoop;
      car.material=row.owned?primary.materials:primary.lockedMaterials;trainRoot.visible=!onScene;if(consist)consist.root.visible=onScene;if(loop)loop.group.visible=onLoop;if(coast)coast.group.visible=onTrack;
      const zoom=Math.max(.7,Math.min(3,options.zoom??1));camera.zoom=coastCamera.zoom=zoom;
      let view=camera;
      if(onTrack){
        if(!consist)return false;if(!coast){coast=createCoast();scene.add(coast.group);}coast.group.visible=true;
        consist.update(row.owned);const heading=options.direction===-1?0:Math.PI;consist.straight(options.direction);
        focus.set(0,0,1.9);const span=Math.max(3.6,consist.length*.61/aspect),radius=span/Math.tan(THREE.MathUtils.degToRad(22));
        coastCamera.aspect=aspect;coastCamera.updateProjectionMatrix();coastCamera.position.set(radius*Math.cos(elevation)*Math.cos(angle),radius*Math.cos(elevation)*Math.sin(angle),focus.z+radius*Math.sin(elevation));coastCamera.lookAt(focus);coastCamera.updateMatrixWorld();view=coastCamera;
        const theme=coast.update(options.distance||0,options.period,view,options.time||0);coast.shadow.scale.x=consist.length/14;
        if(reflectedTheme!==theme){const reflection=createCoastReflection(renderer,theme);coastalReflection?.dispose();coastalReflection=reflection;reflectedTheme=theme;}scene.environment=coastalReflection.texture;
        hemi.color.set(theme.ambient);hemi.groundColor.set('#525c4a');hemi.intensity=theme.night?.75:1.05;
        lights[0].color.set(theme.light);lights[0].intensity=theme.power;lights[0].position.set(-45,-25,theme.night?32:42);lights[1].intensity=theme.night?.28:.7;
        if(!scene.fog)scene.fog=new THREE.FogExp2();scene.fog.color.set(theme.horizon);scene.fog.density=theme.night?.0024:.0018;renderer.toneMappingExposure=theme.night?.75:1.0;
        scene.updateMatrixWorld(true);
        const anchors={railA:[-6,0,.18],railB:[6,0,.18],shoreA:[-6,20,-.64],shoreB:[6,20,-.64],land:[0,-2.5,-.08],water:[-6,40,-.64],island:[12,150,12.4]};
        for(const [key,p]of Object.entries(anchors)){project.set(...p).project(view);anchors[key]=[(project.x+1)*w/2,(1-project.y)*h/2];}
        const bounds=consist.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car),points=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){project.set(x,y,z).project(view);points.push([(project.x+1)*w/2,(1-project.y)*h/2]);}return{model:c.id,left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};});
        target.dataset.formation=JSON.stringify(bounds);target.dataset.coastAnchors=JSON.stringify(anchors);target.dataset.carCount='3';target.dataset.projection='perspective';
        target.dataset.trackX=String(-(options.distance||0));target.dataset.trackY='0';target.dataset.trackHeading=String(heading);target.dataset.distance=String(options.distance||0);target.dataset.period=options.period||'day';
      }else{
        if(coast)coast.group.visible=false;scene.environment=environment.texture;scene.fog=null;hemi.color.set('#e6efff');hemi.groundColor.set('#938670');hemi.intensity=1.75;lights[0].color.set('#fff5e6');lights[0].position.set(7,-9,14);lights[0].intensity=3;lights[1].intensity=1.5;renderer.toneMappingExposure=1.02;
        if(onLoop){
          if(!consist)return false;if(!loop){loop=createLoop();scene.add(loop.group);}loop.group.visible=true;
          consist.update(row.owned);consist.follow(loop,options.distance||0,options.direction);
          const horizontal=loop.half*Math.abs(Math.sin(angle))+loop.outer,vertical=Math.sin(elevation)*(loop.half*Math.abs(Math.cos(angle))+loop.outer)+2.3*Math.cos(elevation),span=Math.max(horizontal/aspect,vertical)*1.07;
          scene.updateMatrixWorld(true);focus.set(0,0,1.0);
          if(zoom>1){
            // 依畫面方向取得整列車的中心，彎道也同時照顧前、中、後三節。
            // 100% 保留全景；100–120% 隨縮放連續轉向列車，之後鎖住編組。
            viewRight.set(-Math.sin(angle),Math.cos(angle),0);viewUp.set(-Math.sin(elevation)*Math.cos(angle),-Math.sin(elevation)*Math.sin(angle),Math.cos(elevation));
            let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;loopFocus.set(0,0,0);
            for(const c of consist.cars){const b=c.asset.geometry.boundingBox;
              for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
                project.set(x,y,z).applyMatrix4(c.body.matrixWorld);loopFocus.addScaledVector(project,1/24);
                const u=project.dot(viewRight),v=project.dot(viewUp);left=Math.min(left,u);right=Math.max(right,u);bottom=Math.min(bottom,v);top=Math.max(top,v);
              }
            }
            loopFocus.addScaledVector(viewRight,(left+right)/2-loopFocus.dot(viewRight));loopFocus.addScaledVector(viewUp,(bottom+top)/2-loopFocus.dot(viewUp));
            focus.lerp(loopFocus,THREE.MathUtils.smoothstep(zoom,1,1.2));
          }
          Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.updateProjectionMatrix();camera.position.set(focus.x+60*Math.cos(elevation)*Math.cos(angle),focus.y+60*Math.cos(elevation)*Math.sin(angle),focus.z+60*Math.sin(elevation));camera.lookAt(focus);camera.updateMatrixWorld();
          target.dataset.carCount='3';target.dataset.projection='orthographic';target.dataset.distance=String(options.distance||0);target.dataset.loopLength=String(loop.length);
          target.dataset.poses=JSON.stringify(consist.cars.map(c=>({model:c.id,x:c.car.position.x,y:c.car.position.y,heading:c.car.rotation.z,length:c.length})));
          target.dataset.formation=JSON.stringify(consist.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car),points=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){project.set(x,y,z).project(camera);points.push([(project.x+1)*w/2,(1-project.y)*h/2]);}return{model:c.id,left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};}));
        }else{
        const {size,center}=primary,diag=Math.hypot(size.x,size.y),span=Math.max(diag/2/aspect,diag*Math.sin(elevation)/2+size.z*Math.cos(elevation)/2)*1.12;
        Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.updateProjectionMatrix();camera.position.set(center.x+50*Math.cos(elevation)*Math.cos(angle),center.y+50*Math.cos(elevation)*Math.sin(angle),center.z+50*Math.sin(elevation));camera.lookAt(center);target.dataset.carCount='1';target.dataset.projection='orthographic';
        }
      }
      // 玻璃單獨使用環境反射強度；只依賴 scene.environment 時，Three 會改用場景的統一強度。
      for(const a of new Set(onScene?consist.cars.map(c=>c.asset):[primary]))for(const m of [...a.materials,...a.lockedMaterials])if(m.name==='glass'||m.name==='glass:locked'){
        if(m.envMap!==scene.environment){m.envMap=scene.environment;m.needsUpdate=true;}m.envMapIntensity=onTrack&&m.name==='glass'?3.2:1;
      }
      renderer.render(scene,view);const ctx=target.getContext('2d');ctx.clearRect(0,0,w,h);ctx.drawImage(renderer.domElement,0,0);
      target.dataset.rendered=id;target.dataset.appearance='blender-original';target.dataset.lock=row.owned?'off':'grey';target.dataset.vertices=String(primary.geometry.attributes.position.count);
      target.dataset.mode=onLoop?'loop':onTrack?'track':'model';target.dataset.yaw=String(angle);target.dataset.zoom=String(zoom);target.dataset.elevation=String(elevation);target.dataset.drawCalls=String(renderer.info.render.calls);
      return true;
    },
    dispose(){disposed=true;revision++;abort?.abort();clear();coast?.dispose();loop?.dispose();coastalReflection?.dispose();environment.dispose();renderer.dispose();renderer.forceContextLoss();}
  };
}
