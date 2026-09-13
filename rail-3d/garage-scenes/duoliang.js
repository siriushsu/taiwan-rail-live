import * as THREE from '../vendor/three.module.js';
import {createKit,straightPath} from './new-scene-kit.js';
export function createScene(){
 const k=createKit(),{group,mat,block,beam,mesh,instance,ball,props,rand}=k,path=straightPath(4),stone=mat('#9e9c8a'),red=mat('#b44732'),cream=mat('#d7cfb9'),wood=mat('#81644a');
 k.slab('#655442',76,48,-1.6,.45,5);k.slab('#ad9671',75.5,47.5,-1.15,.5,5);
 k.slab('#357f8c',75,47,-.65,.67,5);k.slab('#78936c',72,30,-.55,4.2,13);
 const sea=mat('#3b8d9d',{metalness:.2,roughness:.32});block(sea,[69,14,.035],[0,-10.8,.045]);
 const foam=mat('#bcd7c9',{transparent:true,opacity:.48,depthWrite:false});const waves=[];
 for(let i=0;i<26;i++){const w=mesh(new THREE.BoxGeometry(1.8+rand()*5,.045,.012),foam,[-33+rand()*66,-17+rand()*11,.09+i*.001]);waves.push({w,y:w.position.y,phase:rand()*6.28});}
 // 岩岸、擋土壁與架高線：所有側面封閉，沒有貼在空中的海面或月台。
 block(stone,[43,1.4,3.5],[0,-1.15,1.85]);for(let x=-21;x<=21;x+=2.4){block(cream,[.7,.45,3.8],[x,-1.96,1.95]);block(mat('#858c7c'),[1.7,.06,.06],[x,-2.21,2.55]);}
 for(let i=0;i<65;i++){const x=-34+rand()*68,y=-3-rand()*2;props.rock(x,y,.03,.4+rand()*.7);}
 for(const [x,y,sx,sy,sz]of [[-22,9,10,5,5],[0,11,8,4,2.4],[23,9,6,5,6]]){instance(ball,mat('#557e57'),[x,y,3.3],[sx,sy,sz]);}
 k.track(path);
 // 架高的觀景月台，遊客在紅欄杆後方，與車體保持淨空。
 block(cream,[29,4,.7],[-1,3.4,4.02]);block(mat('#c9bfa7'),[29.15,4.12,.13],[-1,3.4,4.43]);
 for(let x=-15.2;x<=13.2;x+=.7){block(red,[.07,.07,1.0],[x,1.47,4.99]);block(red,[.06,.06,.63],[x+.35,1.47,4.81]);}
 for(const z of [4.58,5.15,5.48])block(red,[28.6,.08,.07],[-1,1.47,z]);
 for(const side of [-15.5,13.5]){block(red,[.08,4.1,.07],[side,3.4,5.48]);for(let y=1.6;y<5.5;y+=.6)block(red,[.07,.07,1],[side,y,4.99]);}
 for(let i=0;i<14;i++){const z=3.65+i*.06;block(cream,[1.8,.36,z-3.5],[15,6.8-i*.27,(z+3.5)/2]);}beam(red,[14.15,6.9,4.7],[14.15,3.0,5.53],.08);
 // 站名板、木椅、遮陽傘與遊客：攝影者、親子及看海的人。
 for(const x of [-10,8]){k.label('多 良',x,4.9,5.6,2.7,.72);for(const dx of [-1,1])block(wood,[.10,.10,1.4],[x+dx,4.9,5.1]);}
 for(const x of [-11,-3,7]){block(wood,[2.1,.52,.12],[x,4.5,4.93]);block(wood,[2.1,.10,.45],[x,4.75,5.19]);for(const dx of [-.7,.7])block(mat('#56625c'),[.09,.42,.45],[x+dx,4.5,4.69]);}
 const colors=['#d8a64e','#b35042','#5c8f9b','#e7dfc6','#485e7f','#d0a5a2'];
 for(let i=0;i<15;i++)k.person(-13+i*1.72+(i%3===1?.3:0),2.0+(i%3)*.7,4.50,{color:colors[i%6],photo:i%3===0,hat:i%4===0,scale:i===7?.67:.9,angle:i%5===1?-.6:0});
 const walkers=[k.person(-4,4,4.50,{color:'#c5aa64',walk:true,hat:true}),k.person(1,3.8,4.50,{color:'#799caa',walk:true,scale:.75})];
 for(const x of [-13,-5,4,12])k.lamp(x,5.1,4.5,2.8);
 // 有厚度的拱形隧道口與內襯，內側也有面；列車單向穿越兩端隧道。
 for(const side of [-1,1]){const x=side*22.2;instance(ball,mat('#62835b'),[x+side*6.4,.6,9.1],[7.0,3.6,1.65]);for(const sy of [-1,1])instance(ball,mat('#62835b'),[x+side*6.4,sy*3.05,5.2],[6.5,1.0,2.35]);const arch=new THREE.Shape();arch.absarc(0,0,2.25,0,Math.PI,false);arch.lineTo(-1.65,0);arch.absarc(0,0,1.65,Math.PI,0,true);arch.closePath();const g=new THREE.ExtrudeGeometry(arch,{depth:12.8,bevelEnabled:false,curveSegments:20});g.rotateX(Math.PI/2);g.rotateZ(Math.PI/2);const tunnel=mesh(g,mat('#9c9f8b'),[x,0,5.7]);if(side<0)tunnel.rotation.z=Math.PI;
  for(const sy of [-1,1])block(stone,[12.8,.6,1.7],[x+side*6.4,sy*1.95,4.85]);
 }
 // 山側低矮植栽，不遮擋主要月台與列車；背後保留山林景深。
 for(let i=0;i<75;i++){const x=-32+rand()*64,y=7+rand()*18;if(Math.abs(y-18)<2.4||Math.abs(x)>27||((Math.abs(x)-22)**2+(y-9)**2<130&&Math.abs(x)>20))continue;props.broadleaf(x,y,3.65,1.4+rand()*2.6);}
 for(let i=0;i<45;i++)props.bush(-31+rand()*62,7+rand()*17,3.65,.35+rand()*.35);
 const wireGroup=new THREE.Group();group.add(wireGroup);const wireMat=mat('#62685f');for(let x=-18;x<=18;x+=9){k.part(wireGroup,wireMat,[.08,.08,3.2],[x,1.0,5.6]);k.part(wireGroup,wireMat,[.10,1.25,.08],[x,.43,7.1]);}k.part(wireGroup,wireMat,[42,.023,.023],[0,0,6.94]);
 k.bake();let state={};return{...k,path,kind:'duoliang',focus:[0,4,3.5],update(time,period,train){const light=k.illumination(period);sea.color.set(period==='night'?'#193e52':period==='dawn'?'#8c9999':period==='sunset'?'#658c93':'#3b8d9d');for(const {w,y,phase}of waves){w.position.y=y+Math.sin(time*.35+phase)*.18;w.scale.x=1+Math.sin(time*.5+phase)*.12;}walkers.forEach((g,i)=>{g.position.x=-4+i*5+Math.sin(time*.11+i)*2;g.rotation.z=Math.cos(time*.11+i)>0?-Math.PI/2:Math.PI/2;});wireGroup.visible=train.id==='emu3000';state={visitors:17,lights:light,walkers:walkers.map(g=>g.position.toArray()),electrified:wireGroup.visible};},get state(){return state;}};
}
