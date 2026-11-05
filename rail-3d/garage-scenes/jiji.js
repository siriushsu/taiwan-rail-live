// 集集車站：1933 年的檜木站房，九二一地震倒塌後照原樣重建；集集線是單線、不電化，站前有台車與蒸汽機車的展示，綠色隧道的樟樹夾道，四周都是山。
// 不是實際街廓的重建：綠色隧道搬到站前馬路。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e4ece6','#f0d7bc','#10202a');

export function createScene(parts){
 const s=createStage({seed:20466,grass:'#7f9463',trees:[['ficus',.6],['trema',.25],['koelreuteria',.15]]}),{k}=s;
 const {M,mat,block,instance,rand,groundZ,props,cylinder}=k;
 const T=3.6;
 k.keepClear((x,y)=>y>-11&&y<T+2.2);
 const t=s.tracks([T],{electric:false,bedColor:'#958f80'});
 s.station(parts,{scale:.46,y:-2.4});

 const p=s.platform(T,{length:34,width:1.9});s.furnish(p,{name:'集集',stairs:false,bench:6});
 s.canopy(p,{from:-8,to:8,color:'#6e6a60',post:'#6f5e4c',h:1.5,step:2.7,lights:2});

 // 站前：鋪石廣場、蒸汽機車展示、台車，木造圍欄。
 s.label('集集車站',0,-6,groundZ+1.56,1.5,.3,{bg:'#efe9dc',fg:'#3a2a1c',depth:.04});
 s.plaza(0,-9.4,20,4.4,{color:'#c9c2ae'});
 const black=mat('#2a2c2e',{metalness:.3,roughness:.5}),redW=mat('#a0342a'),brass=mat('#b89a56',{metalness:.5,roughness:.4}),L={x:-13,y:-9};
 block(mat('#8b8577'),[7.4,1.3,.08],[L.x,L.y,groundZ+.05]);for(const a of [-.34,.34])block(M.steel,[7.2,.06,.06],[L.x,L.y+a,groundZ+.13]);
 instance(cylinder,black,[L.x+.5,L.y,groundZ+.98],[.82,.82,3.4],[0,Math.PI/2,0]);block(black,[1.5,1.05,1.3],[L.x-1.9,L.y,groundZ+1.16]);block(M.glass,[.6,1.07,.36],[L.x-1.9,L.y,groundZ+1.4]);block(black,[1.7,1.15,.08],[L.x-1.9,L.y,groundZ+1.84]);
 instance(cylinder,black,[L.x+1.7,L.y,groundZ+1.62],[.26,.26,.6]);instance(cylinder,brass,[L.x+.2,L.y,groundZ+1.48],[.28,.28,.3]);block(redW,[3.8,.92,.1],[L.x+.2,L.y,groundZ+.42]);
 for(const x of [-.6,.3,1.2])for(const y of [-.47,.47])instance(cylinder,redW,[L.x+x,L.y+y,groundZ+.36],[.62,.62,.07],[Math.PI/2,0,0]);
 block(mat('#6d5a46'),[2.2,1.1,.48],[L.x-3.5,L.y,groundZ+.54]);
 s.label('集集線',9.4,-10.6,groundZ+.7,2.2,.6,{bg:'#5c4a38',fg:'#f3e6c6',depth:.06});
 for(let i=0;i<16;i++){const x=(i%2?1:-1)*(9+rand()*21),y=T+3.6+rand()*2.6;if(k.inside(x,y,1.5))props.bush(x,y,groundZ,.4+rand()*.3);}
 s.scooters(5,7.6,-8.6);s.bikes(11,-8,5);
 k.addLight('entrance',0,-6.2,groundZ+2,1.2,6);k.addLight('plaza',-3,-9.4,groundZ+2.4,.9,6);
 for(const x of [-6,6])s.lamp(x,-11.2,{arm:-1,h:2.3,r:1.8});

 // 綠色隧道：馬路兩邊大樟樹夾道。
 s.road(-13.6,{width:2.2,cars:[[-24,-1],[-6,1],[12,-1],[25,1]]});
 for(let x=-30;x<=30;x+=2.9){const h=Math.abs(x)<12?0:3.1+rand()*.8;if(h)props.broadleaf(x,-12.2,groundZ,h);if(k.inside(x,-15.2,1))props.broadleaf(x+1,-15.2,groundZ,2.8+rand()*.7);}
 // 街上的老店與檳榔、香蕉園。
 s.shops(-31,-22,-6.6,{floors:[2,2,1],ground:'shop'});s.shops(15,29,-6.4,{floors:[2,1,2,2],ground:'shop'});
 const banana=mat('#7aa654');for(let x=-30;x<=30;x+=1.7)for(const y of [-17.4,-18.8])if(k.inside(x,y,1)){block(mat('#7d8c5e'),[.1,.1,.8],[x,y,groundZ+.4]);for(let i=0;i<4;i++)block(banana,[.7,.16,.03],[x+Math.cos(i*1.6)*.3,y+Math.sin(i*1.6)*.3,groundZ+.84],[0,.4,i*1.6]);}

 // 站後：山。離軌道越遠越高，跟車看得到完整的車。
 const edge=(x,y)=>Math.min(1,(33-Math.abs(x))/4.2)*Math.min(1,(20-y)/2.2);
 const h=(x,y)=>{const d=y-(T+3.4);if(d<=0)return 0;const e=Math.max(0,edge(x,y));return e*Math.min(.36*d,Math.min(5.4,d*.4)+.7*Math.sin(x*.31)*Math.min(1,d/6)+.45*Math.sin(x*.77+y*.5)*Math.min(1,d/7));};
 const z=s.terrain(-32.8,32.8,T+3,19.9,h,{nx:60,ny:22});
 for(let i=0;i<40;i++){const x=-30+rand()*60,y=T+12.2+rand()*3.6;if(k.inside(x,y,2.4)&&h(x,y)>.4)props.broadleaf(x,y,z(x,y)-.1,1.2+rand()*.6);}

 return s.finish({tracks:t,label:'集集車站',themes:THEMES,anchors:{station:[0,-5.8,groundZ+1.5],platform:[0,(p.y0+p.y1)/2,p.z],loco:[L.x,L.y,groundZ+1]}});
}
