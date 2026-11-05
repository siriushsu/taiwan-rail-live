// 舊山線勝興車站：1907 年的木造小站，全線不用一根鐵釘的傳說、台灣鐵路最高點（海拔 402.326 公尺）的紀念碑，山洞口就在站邊，四周是苗栗三義的山。
// 舊山線單線、不電化；站房是照印象用方料搭的，不是照圖面做的。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e4ece6','#efd8bf','#0f1f28');

export function createScene(){
 const s=createStage({seed:20470,grass:'#7f9463',trees:[['acacia',.4],['trema',.35],['cyathea',.25]]}),{k}=s;
 const {M,mat,block,instance,rand,groundZ,props,prism,cylinder}=k;
 const T=1.6;
 k.keepClear((x,y)=>y>-1&&y<T+2.4);
 const t=s.tracks([T],{electric:false,bedColor:'#958f80'});
 const p=s.platform(T,{length:22,width:1.5,x:2});s.furnish(p,{name:'勝興',stairs:false,bench:6});

 // 站房：深色杉木板、灰瓦兩坡頂、正面一個山牆門廊、月台側長長的挑簷。
 const X=2,Y=-3.8,wood=mat('#5f4631',{roughness:.85}),woodL=mat('#7c5f43',{roughness:.85}),plaster=mat('#e3dccb'),tile=mat('#4a4c4e',{roughness:.65}),stone=mat('#8f8b7c',{roughness:.95});
 block(stone,[10.6,4.2,.3],[X,Y,groundZ+.15]);
 block(wood,[10,3.6,1.9],[X,Y,groundZ+1.25]);block(plaster,[10.04,3.64,.6],[X,Y,groundZ+1.9]);
 for(let x=-4.8;x<=4.81;x+=1.2){for(const y of [-1.83,1.83])block(woodL,[.1,.05,1.92],[X+x,Y+y,groundZ+1.24]);}
 for(const y of [-1.84,1.84])for(const z of [.7,1.2,1.6])block(woodL,[10,.04,.05],[X,Y+y,groundZ+z]);
 for(const x of [-3.6,-1.2,3.6])for(const y of [-1.86,1.86]){block(M.glass,[1.3,.04,.7],[X+x,Y+y,groundZ+1.15]);for(const a of [-.33,.33])block(woodL,[.04,.05,.72],[X+x+a,Y+y,groundZ+1.15]);block(woodL,[1.34,.05,.04],[X+x,Y+y,groundZ+1.15]);}
 instance(prism,tile,[X,Y,groundZ+2.2],[11.2,5,1.5]);
 // 門廊：正面山牆。
 block(wood,[3.2,1.5,1.7],[X+1.2,Y-2.4,groundZ+1.15]);block(M.glass,[1.3,.05,1.2],[X+1.2,Y-3.17,groundZ+.95]);
 instance(prism,tile,[X+1.2,Y-2.6,groundZ+2.0],[3.8,2.4,1.1],[0,0,Math.PI/2]);
 for(const a of [-1.45,1.45])block(woodL,[.14,.14,1.9],[X+1.2+a,Y-3.2,groundZ+1.05]);
 s.label('勝興車站',X+1.2,Y-3.3,groundZ+2.06,1.9,.42,{bg:'#4d3a29',fg:'#f1e2bf',depth:.05});
 // 月台挑簷、木柱。
 block(tile,[11,1.5,.08],[X,Y+2.6,groundZ+2.15],[-.14,0,0]);for(let x=-4.6;x<=4.61;x+=2.3)block(woodL,[.12,.12,1.8],[X+x,Y+3.1,groundZ+1.1]);
 k.addLight('hall',X,Y+3,groundZ+1.9,1.1,6);k.addLight('entrance',X+1.2,Y-4,groundZ+2,1,6);

 // 紀念碑：鐵路最高點。
 const P={x:-9,y:-2.4};block(stone,[1.1,.9,.2],[P.x,P.y,groundZ+.1]);block(mat('#d8d3c4'),[.72,.28,1.5],[P.x,P.y,groundZ+.95]);
 s.label('402.326',P.x,P.y-.16,groundZ+1.2,.66,.26,{bg:'#d8d3c4',fg:'#7c2a22',depth:.02,lit:false});s.label('海拔',P.x,P.y-.16,groundZ+1.5,.5,.2,{bg:'#d8d3c4',fg:'#333',depth:.02,lit:false});

 // 老街：一條小路、幾間紅磚與木造老店、燈籠。
 const lantern=mat('#c8382e',{emissive:'#ff4a2e',emissiveIntensity:0});
 s.plaza(-1,-10.8,34,2.6,{color:'#b9b19c',grid:3});
 const brick=mat('#a65a42'),walls=[wood,brick,plaster,woodL,brick];
 walls.forEach((m,i)=>{const x=-14+i*6.4,y=-13.8;block(m,[5.6,2.8,1.5],[x,y,groundZ+.75]);instance(prism,tile,[x,y,groundZ+1.5],[6.2,3.3,.9]);block(M.glass,[3.6,.04,.7],[x,y-1.42,groundZ+.7]);block(woodL,[5.8,.8,.05],[x,y-1.8+2.9*.0+2.9,groundZ+1.34]);
  for(const a of [-2,2])instance(cylinder,lantern,[x+a,y+1.46,groundZ+1.34],[.26,.26,.32]);});
 for(const x of [-12,-1,10])s.lamp(x,-9.7,{arm:-1,h:2.1,r:1.7});
 // 右前方：紅磚拱橋的斷墩（舊山線的龍騰斷橋那樣的紅磚墩，只取印象）。
 const pierB=mat('#a4553f',{roughness:.9}),pierD=mat('#8d4634',{roughness:.9});
 [[17,4.4],[22.4,3.5],[27.8,2.6]].forEach(([x,h],i)=>{block(pierB,[1.5,1.9,h],[x,-8.2,groundZ+h/2]);block(pierD,[1.8,2.2,.3],[x,-8.2,groundZ+.15]);for(let z=.6;z<h;z+=.5)block(pierD,[1.52,1.92,.03],[x,-8.2,groundZ+z]);
  if(i<2){const m=x+2.7,top=Math.min(h,[4.4,3.5,2.6][i+1]);block(pierB,[3.9,1.7,.46],[m-.6,-8.2,groundZ+top-.1]);}});
 for(let i=0;i<26;i++){const x=12+rand()*19,y=-6+rand()*6.4;if(k.inside(x,y,1.4)&&Math.abs(x-22)>7.6)props.broadleaf(x,y,groundZ,1.6+rand()*.8);else if(k.inside(x,y,1.4))props.bush(x,y,groundZ,.4+rand()*.3);}
 for(let i=0;i<20;i++){const x=-22+rand()*12,y=-9+rand()*8;if(y<-1.5&&Math.hypot(x+9,y+2.4)>2.2&&k.inside(x,y,1.4))props.broadleaf(x,y,groundZ,1.5+rand()*.7);}
 for(let i=0;i<14;i++){const x=16+rand()*15,y=-14.5+rand()*2.6;if(k.inside(x,y,1.6))props.broadleaf(x,y,groundZ,1.4+rand()*.7);}
 s.scooters(-20,-18,-10.6);k.car(13,-10.8,{yaw:0});

 // 山：左邊的山洞、前後的山坡（跟車那一面低、遠處才高）。
 const wallBrick=mat('#9c5a44'),hole=mat('#14181a');
 const front=(x,y)=>Math.min(1,(33-Math.abs(x))/3.8)*Math.min(1,(y+20)/2);
 const hb=(x,y)=>{const d=y-(T+2.6);if(d<=0)return 0;const e=Math.max(0,Math.min(1,(33-Math.abs(x))/3.8)*Math.min(1,(20-y)/2));return e*Math.min(.34*d,4.8+.5*Math.sin(x*.4));};
 const z1=s.terrain(-32.8,32.8,T+2.2,19.9,hb,{nx:56,ny:18});
 const hf=(x,y)=>{const d=-15.6-y;if(d<=0)return 0;return Math.max(0,front(x,y))*Math.min(.9*d,2.6+.4*Math.sin(x*.5));};
 s.terrain(-32.8,32.8,-19.9,-15.2,hf,{nx:52,ny:6});
 const X0=-24,hl=(x,y)=>{const d=X0-x;if(d<=0)return 0;const e=Math.max(0,Math.min(1,(33+x)/2.4)*Math.min(1,(20-Math.abs(y))/3));return e*Math.min(5.4,d*1.5);};
 s.terrain(-32.8,X0+.4,-19.8,19.8,hl,{nx:18,ny:30,colors:['#5a7a4c','#62804f','#567547','#668356']});
 block(wallBrick,[.4,5,2.9],[X0-.1,T,groundZ+1.45]);block(stone,[.46,5.2,.2],[X0-.1,T,groundZ+2.9]);
 instance(cylinder,hole,[X0+.11,T,groundZ+1.05],[2,2,.04],[0,Math.PI/2,0]);block(hole,[.04,2,1.05],[X0+.11,T,groundZ+.52]);
 for(let i=0;i<34;i++){const x=-31+rand()*62,y=T+12+rand()*4;if(k.inside(x,y,2.4)&&hb(x,y)>.3)props.broadleaf(x,y,z1(x,y)-.1,1.2+rand()*.5);}
 for(let i=0;i<20;i++){const x=-32+rand()*7,y=-17+rand()*34;if(k.inside(x,y,2)&&Math.abs(y-T)>3)props.broadleaf(x,y,groundZ+hl(x,y)-.2,1.5+rand()*.7);}

 return s.finish({tracks:t,label:'勝興車站',themes:THEMES,anchors:{station:[X,Y-3,groundZ+1.5],platform:[2,(p.y0+p.y1)/2,p.z],tunnel:[X0,T,groundZ+1]},update(time,theme){lantern.emissiveIntensity=theme.lamp*1.2;}});
}
