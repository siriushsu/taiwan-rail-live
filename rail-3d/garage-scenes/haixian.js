// 海線木造小站：1922 年的大山站房（海線五寶之一），日式檜木站房，鐵道外面就是防風林、沙灘與台灣海峽，遠處立著風機。
// 不是實際地形的重建：海岸拉到鐵道正後方。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e4ecee','#f3d4b4','#111a29',{day:{water:'#3b7f93',shallow:'#79b6b0'},sunset:{water:'#5b808c',shallow:'#c9a07a'},night:{water:'#17384e',shallow:'#365f70'}});

export function createScene(parts){
 const s=createStage({seed:20467,grass:'#8e9a6a',trees:[['pandanus',.3],['hibiscus',.3],['acacia',.4]]}),{k}=s;
 const {THREE,M,mat,block,instance,rand,groundZ,props,cylinder}=k;
 const Tb=-1.8,Ta=2.6,shore=11;
 k.keepClear((x,y)=>y>-11&&y<Ta+2.6);
 const t=s.tracks([Tb,Ta]);
 s.station(parts,{scale:.46,y:-6});

 const isl=s.platform(Ta,{length:30}),side=s.platform(Tb,{length:30,width:.8});
 s.canopy(isl,{from:-8,to:8,color:'#6f6a60',post:'#6f5e4c',step:2.6,lights:2});s.furnish(isl,{name:'大山'});
 s.trackFence(Ta+2.1,{color:'#8d8676'});

 // 站前：鄉間小廣場、木電桿、雜貨店、機車。
 s.label('大山車站',0,-9.76,groundZ+1.9,1.5,.3,{bg:'#efe9dc',fg:'#3a2a1c',depth:.04});
 s.plaza(0,-11.2,16,3.2,{color:'#c6bfaa'});
 s.scooters(4.6,6.6,-10.6);s.planter(-5,-11.6,2,.6);
 k.addLight('entrance',0,-9.8,groundZ+2,1.2,6);
 for(const x of [-7.6,7.6])s.lamp(x,-12.6,{arm:-1,h:2.3,r:1.8});
 s.road(-14.6,{width:2.1,cars:[[-20,-1],[6,1],[24,-1]]});
 s.shops(-30,-14,-9.4,{floors:[2,1,2],ground:'shop'});props.farmhouse(16,-9.6,groundZ,{tint:3});props.farmhouse(23.4,-9.2,groundZ,{tint:0,pitched:false});
 s.fields(-30,-1,-19.2,-16.4,3.4,1.4);s.fields(1,30,-19.2,-16.4,3.4,1.4);
 for(const x of [-25,-12,0,12,25])props.pole(x,-12.4,groundZ,2.6);

 // 鐵道後面：防風林（矮），沙灘，海；風機立在海岸線上。
 for(let i=0;i<70;i++){const x=-31+rand()*62,y=Ta+3+rand()*3.4;if(k.inside(x,y,1.2))props.broadleaf(x,y,groundZ,.9+rand()*.6);}
 block(mat('#d8c9a3',{roughness:.95}),[k.plinthW-.4,shore-Ta-5.6,.04],[0,(shore+Ta+5.6)/2,groundZ+.02]);
 for(let i=0;i<26;i++)props.rock(-30+rand()*60,shore-.7+rand()*.6,groundZ,.18+rand()*.2);
 const {plinthW:w,plinthD:d,plinthR:r}=k,x=w/2-.1,top=d/2-shore-.1,sh=new THREE.Shape();
 sh.moveTo(-x,0);sh.lineTo(x,0);sh.lineTo(x,top-r);sh.quadraticCurveTo(x,top,x-r,top);sh.lineTo(-x+r,top);sh.quadraticCurveTo(-x,top,-x,top-r);sh.lineTo(-x,0);
 k.sea(sh,[0,shore],THEMES.day);
 const white=mat('#eef0ec',{roughness:.45}),nav=mat('#d23a32',{emissive:'#ff3b2f',emissiveIntensity:0});
 for(const [x2,y,h,a] of [[-28.6,11.4,8.4,.2],[-30,16,7,1.1],[28.4,12,8.6,1.4]]){const hub=groundZ+h+.1;
  instance(cylinder,white,[x2,y,groundZ+h/2],[.3,.3,h]);block(white,[.4,.9,.4],[x2,y,hub]);
  for(let b=0;b<3;b++){const q=a+b*2*Math.PI/3;block(white,[.18,.05,2.7],[x2+Math.sin(q)*1.35,y-.5,hub+Math.cos(q)*1.35],[0,q,0]);}
  block(nav,[.12,.12,.1],[x2,y+.2,hub+.25]);}

 return s.finish({tracks:t,label:'大山車站',themes:THEMES,anchors:{station:[0,-9.5,groundZ+1.5],platform:[0,(isl.y0+isl.y1)/2,isl.z]},update(time,theme){nav.emissiveIntensity=theme.lamp*1.4;}});
}
