import * as THREE from '../vendor/three.module.js';
import {createKit,smooth} from './new-scene-kit.js';
import {coastalPath,offsetPoint,ribbon,fence,hillside,tunnelRidge,staircase} from './scene-detail-kit.js';

export function createScene(){
 const k=createKit(),{group,mat,block,beam,mesh,props,rand}=k,path=coastalPath();
 const stone=mat('#a5a18b'),red=mat('#b93f2b'),cream=mat('#c9c2ac'),wood=mat('#785d43');
 k.slab('#655442',76,48,-1.6,.45,5);k.slab('#ad9671',75.5,47.5,-1.15,.5,5);
 k.slab('#357f8c',75,47,-.65,.67,5);k.slab('#78936c',72,29.6,-.55,4.2,13);
 const sea=mat('#3b8d9d',{metalness:.2,roughness:.32});block(sea,[69,14,.035],[0,-10.8,.045]);
 const waves=[],foam=mat('#bcd7c9',{transparent:true,opacity:.48,depthWrite:false});
 for(let i=0;i<30;i++){const w=mesh(new THREE.BoxGeometry(1.8+rand()*5,.045,.012),foam,[-33+rand()*66,-17+rand()*11,.09+i*.001]);waves.push({w,y:w.position.y,phase:rand()*6.28});}
 // 沿彎軌的擋土結構、排水孔與岩岸；不把階梯月台架在平板上。
 ribbon(k,path,-25,25,-2.4,4.5,.06,3.64,stone);
 ribbon(k,path,-25,25,-2.55,-1.15,3.64,4.32,cream);
 for(let s=-24;s<25;s+=1.8){const p=path.sample(s);block(mat('#878779'),[.75,.18,2.4],offsetPoint(path,s,-2.46,1.8),[0,0,p.heading]);block(mat('#484f4b'),[.16,.07,.13],offsetPoint(path,s,-2.59,2.65),[0,0,p.heading]);}
 fence(k,path,-24,24,-2.45,4.32,red);
 for(let i=0;i<100;i++){const s=-35+rand()*70,p=offsetPoint(path,s,-3.4-rand()*2,.02);props.rock(...p,.3+rand()*.65);}
 k.track(path);
 // 山側下層步道與海側窄月台分開，所有欄杆都順著曲線。
 ribbon(k,path,-23.5,23.5,1.45,3.85,3.65,4.50,cream);
 fence(k,path,-23.5,23.5,1.58,4.50,red);
 for(let s=-23;s<23;s+=1.4){const p=path.sample(s);block(mat('#a6a18f'),[.022,2.15,.012],offsetPoint(path,s,2.7,4.507),[0,0,p.heading]);}
 // 2018 原照的站房上方觀景層、洗石子階梯、藍扶欄與深色握把。
 block(mat('#d4c6a0'),[12,4.2,2.72],[-5,8.2,5.01]);
 block(mat('#c69643'),[12.03,.065,.92],[-5,6.065,5.80]);
 for(let x=-10.8;x<.9;x+=.44)for(let z=5.38;z<6.22;z+=.21)block(mat('#aa8246'),[.40,.012,.012],[x,6.023,z]);
 for(const x of [-9.2,-5.3,-1.4]){block(mat('#4d5957'),[1.8,.07,1.25],[x,6.018,4.68]);for(let dx=-.6;dx<=.6;dx+=.4)block(cream,[.045,.09,1.25],[x+dx,5.97,4.68]);}
 block(mat('#8c4734'),[.95,.09,2],[-7.1,6.008,4.69]);
 block(cream,[12.4,4.55,.24],[-5,8.2,6.78]);
 for(const yy of [5.97,10.43]){for(let x=-11.1;x<=1.1;x+=.62)block(wood,[.07,.07,1.05],[x,yy,7.43]);for(const z of [7.12,7.55,7.95])beam(wood,[-11.15,yy,z],[1.15,yy,z],.075);}
 const stairs=[staircase(k,{x:2.6,y:4.3,z:4.5,steps:15,rise:.16,tread:.32,width:2.5})];
 block(cream,[4.0,1.25,.2],[1.85,9.72,6.80]);
 block(cream,[2.5,4.8,.85],[2.6,6.7,4.075]);
 beam(wood,[3.87,9.15,7.92],[3.87,10.29,7.92],.08);
 block(cream,[3.0,.9,.16],[2.6,3.91,4.42]);
 for(const y of [10.29]){beam(wood,[1.1,y,7.92],[3.87,y,7.92],.08);for(let x=1.25;x<3.9;x+=.6)block(mat('#408eaa'),[.07,.07,1.0],[x,y,7.4]);}
 k.label('多 良 車 站',-4.8,5.89,6.0,3.4,.65);
 k.label('觀 景 步 道',4.25,4.1,5.75,1.5,.5);
 for(const x of [-9,-4]){block(wood,[2,.52,.13],[x,9.45,7.34]);block(wood,[2,.1,.42],[x,9.68,7.6]);for(const dx of [-.7,.7])block(mat('#59605b'),[.10,.40,.42],[x+dx,9.45,7.11]);}
 // 山稜連成實際坡面，低處接站房後方平台；岩面與植栽都取地形高度。
 function land(u,v){const x=-35+70*u,rail=92-Math.sqrt(92*92-x*x),front=rail+5+7*(1-smooth((Math.abs(x)-12)/10));const y=front+(28-front)*v;
  const ridge=9+5*Math.exp(-(((x+21)/12)**2))+7*Math.exp(-(((x-18)/12)**2)),z=3.65+ridge*Math.pow(Math.sin(v*Math.PI/2),.9)+(.65*Math.sin(x*.43+v*9)+.3*Math.sin(x*1.1))*Math.sin(v*Math.PI);return[x,y,z];}
 hillside(k,land);
 const tunnels=[tunnelRidge(k,path,-25,-36),tunnelRidge(k,path,25,36)];
 for(let i=0;i<160;i++){const u=.03+rand()*.94,v=.1+rand()*.85,p=land(u,v);if(Math.abs(p[0])>23&&v<.6)continue;props.broadleaf(...p,1.2+rand()*1.7);}
 for(let i=0;i<145;i++){const p=land(rand(),rand());props.bush(...p,.45+rand()*.45);}
 // 山腳護坡塊及泄水溝，不穿入遊客平台。
 for(const side of [-1,1])for(let i=0;i<9;i++){const x=side*(13+i*.6),y=path.sample(x).y+5.5;block(mat('#8e9580'),[.42,.22,.56],[x,y,4.05+i*.15],[0,.12,0]);}
 const colors=['#d8a64e','#b35042','#5c8f9b','#e7dfc6','#485e7f','#d0a5a2'];
 for(let i=0;i<10;i++){const s=-20+i*4.2,p=offsetPoint(path,s,2.3+(i%2)*.8,4.5);k.person(...p,{color:colors[i%6],photo:i%3===0,hat:i%4===0,scale:i===7?.67:.9,angle:path.sample(s).heading});}
 for(let i=0;i<5;i++)k.person(-9.8+i*2.0,6.6,6.9,{color:colors[(i+2)%6],photo:i%2===0,hat:i===2,scale:.9});
 const walkers=[k.person(-4,4,4.5,{color:'#c5aa64',walk:true,hat:true}),k.person(1,3.8,4.5,{color:'#799caa',walk:true,scale:.75})];
 for(const s of [-19,-10,11,20]){const p=offsetPoint(path,s,3.6,4.5);k.lamp(...p,2.7);}k.lamp(-10,9.8,6.9,2.5);k.lamp(4,4.4,4.5,2.4);
 const wireGroup=new THREE.Group();group.add(wireGroup);const wireMat=mat('#62685f');
 for(let s=-22;s<=22;s+=8){const p=offsetPoint(path,s,1.15,5.7);k.part(wireGroup,wireMat,[.08,.08,3.4],p);const q=offsetPoint(path,s,.5,7.23);k.part(wireGroup,wireMat,[.10,1.35,.08],q,[0,0,path.sample(s).heading]);}
 for(let s=-25;s<25;s+=.5){const a=offsetPoint(path,s,0,7.22),b=offsetPoint(path,s+.5,0,7.22),v=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));const o=k.part(wireGroup,wireMat,[v.length(),.023,.023],a);o.position.addScaledVector(v,.5);o.rotation.z=path.sample(s).heading;}
 k.bake();let state={};return{...k,path,kind:'duoliang',focus:[0,5,6],update(time,period,train){const light=k.illumination(period);sea.color.set(period==='night'?'#193e52':period==='dawn'?'#8c9999':period==='sunset'?'#658c93':'#3b8d9d');for(const {w,y,phase}of waves){w.position.y=y+Math.sin(time*.35+phase)*.18;w.scale.x=1+Math.sin(time*.5+phase)*.12;}walkers.forEach((g,i)=>{const s=-4+i*6+Math.sin(time*.11+i)*2,p=offsetPoint(path,s,3.0,4.5);g.position.set(...p);g.rotation.z=path.sample(s).heading+(Math.cos(time*.11+i)>0?-Math.PI/2:Math.PI/2);});wireGroup.visible=train.id==='emu3000';state={visitors:17,lights:light,walkers:walkers.map(g=>g.position.toArray()),electrified:wireGroup.visible,stairs,tunnels,curved:true};},get state(){return state;}};
}
