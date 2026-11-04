// 新北捷運中運量：三鶯線陶瓷老街站的微縮印象——紅磚與陶瓦的高架站（人字形陶瓦屋頂、紅磚柱、拱窗站體），
// 站前的陶瓷老街（紅磚街屋、騎樓、陶器攤、大陶瓶），站後的隧道窯與方煙囪、陶瓷博物館，後方山頭的鶯歌石。雙線高架穿過站體（島式月台）。
// 不是實際線形、方位或比例的重建。
// 屋頂簷口外伸到軌道中心外 2.8、底面離軌頂 3.21：從正面看露得出的車身高度是 3.21−.73×(2.8−.63)=1.62，比車高 1.56 多，整個側面看得到。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#ebe7e0',sun:'#fff1d4',ambient:'#cdd8de',ground:'#8d9468',power:3.0,exposure:1.04,water:'#4a8592',shallow:'#83b5aa',lamp:0,window:0},
 sunset:{background:'#f1d6be',sun:'#ffae66',ambient:'#d6b6a8',ground:'#7b7656',power:2.9,exposure:.94,water:'#617f8a',shallow:'#b2a993',lamp:.5,window:.45},
 night:{background:'#141c28',sun:'#a0bde0',ambient:'#5a708a',ground:'#2a313a',power:.7,exposure:.78,water:'#15324a',shallow:'#2f5a6c',lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20344,trees:[['koelreuteria',.35],['terminalia',.3],['acacia',.35]]});
 const {THREE,M,mat,geo,block,instance,mesh,rand,groundZ,props,prism,cylinder,pool,inside}=k;
 const path=k.line(),far=k.line({y:-1.86}),railZ=path.z,front=path.front;
 const inStation=q=>Math.abs(q.x)<11.6;
 k.keepClear((x,y)=>y>-9&&y<.7);   // 高架橋底不種樹
 const pick=list=>list[Math.floor(rand()*list.length)];

 // 高架橋與道床：站內月台那側不砌牆、不立墩（站體撐著）；第三軌在月台對面。
 k.viaduct(path,{round:true,walls:[.45,.45],open:(q,side)=>side>0&&inStation(q),pier:q=>!inStation(q)});
 k.viaduct(far,{round:true,walls:[.45,.45],open:(q,side)=>side<0&&inStation(q),pier:q=>!inStation(q)});
 k.slabTrack(path);k.slabTrack(far);
 k.thirdRail(path,{side:-1});k.thirdRail(far,{side:1});

 const brick=mat('#a5553b',{roughness:.85}),brick2=mat('#94493a',{roughness:.85}),brick3=mat('#b8694a',{roughness:.85});
 const tile=mat('#b4683f',{roughness:.7}),tileDark=mat('#8a4a2f',{roughness:.7}),trim=mat('#efe9dc'),under=mat('#cfd4d4',{roughness:.6});
 const plaza=mat('#bcae99'),paving=mat('#a9826b'),dark=mat('#3b3a3a'),bench=mat('#8b6f52'),concrete2=mat('#c9c6bf');
 const arch=geo(new THREE.CylinderGeometry(.5,.5,1,16,1,false,0,Math.PI));arch.rotateY(-Math.PI/2);   // 半圓柱，軸沿 y、圓頂朝 +z
 const ball=geo(new THREE.IcosahedronGeometry(1,1));
 // 陶瓶：車床旋轉體（瓶底、鼓腹、細頸、口沿），Z 朝上、高 1。
 const vase=geo(new THREE.LatheGeometry([[0,0],[.3,0],[.42,.18],[.5,.42],[.44,.66],[.24,.84],[.16,.92],[.22,1],[0,1]].map(([r,h])=>new THREE.Vector2(r,h)),10));vase.rotateX(Math.PI/2);
 const glazes=['#9fc5b0','#2f5d9a','#c98a3a','#efece2','#b5432f','#5b7f4f','#3e6f86'].map(c=>mat(c,{roughness:.28,metalness:.1}));

 // 島式月台＋兩側半高月台閘門；站體在月台底下，往外延伸到高架橋外側的站前入口。
 const p=k.platform({y:front,z:railZ,side:1,length:20,width:3.2,edge:.72,top:.2,bottom:railZ-.73});
 k.gates(p);k.gates({...p,y0:p.y1,side:-1});
 for(let x=-7.5;x<=7.5;x+=5)for(const s of [-1,1]){block(bench,[1.3,.3,.12],[x,(p.y0+p.y1)/2+s*.45,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,(p.y0+p.y1)/2+s*.28,p.z+.52]);}
 // 站體：紅磚、白色腰線、正面一排拱窗，中間三個拱門入口。
 const hallY0=-9.7,hallY1=-.1,hallTop=railZ-.73,hallH=hallTop-groundZ;
 block(brick,[22,hallY1-hallY0,hallH],[0,(hallY0+hallY1)/2,groundZ+hallH/2]);
 block(under,[22.3,front-1.75-hallY0+.15,.12],[0,(hallY0+front-1.75)/2-.07,hallTop+.06]);
 block(trim,[22.2,hallY1-hallY0+.2,.14],[0,(hallY0+hallY1)/2,groundZ+2.55]);
 for(let x=-9.6;x<=9.7;x+=1.6){const door=Math.abs(x)<2.5,w=door?1.2:.9,h=door?1.5:1.1,z0=groundZ+(door?.02:.75);
  block(door?dark:M.glass,[w,.1,h],[x,hallY0-.03,z0+h/2]);instance(arch,door?dark:M.glass,[x,hallY0-.03,z0+h],[w,.1,w]);
  block(trim,[w+.2,.14,.08],[x,hallY0-.05,z0-.04]);}
 for(let x=-9.6;x<=9.7;x+=3.2)if(Math.abs(x)>1)block(M.glass,[1.6,.1,.6],[x,hallY0-.03,groundZ+3.0]);
 block(M.sign,[3.4,.12,.5],[0,hallY0-.08,groundZ+3.0]);   // 站名牌在腰線上方、中間那格
 k.addLight('entrance',0,hallY0-1.2,groundZ+1.9,1.3,6);

 // 人字形陶瓦屋頂：一條長三角柱，兩坡一道道瓦壟、屋脊壓一條脊瓦；底下一圈深色屋簷。
 const roof={z:railZ+3.3,y0:-9.25,y1:-.55,rise:1.7,L:12.6},roofYc=(roof.y0+roof.y1)/2,roofHalf=(roof.y1-roof.y0)/2,slope=Math.atan2(roof.rise,roofHalf);
 instance(prism,tile,[0,roofYc,roof.z],[2*roof.L,roof.y1-roof.y0,roof.rise]);
 block(tileDark,[2*roof.L+.2,roof.y1-roof.y0+.1,.14],[0,roofYc,roof.z-.02]);   // 簷口：外伸到 2.8、底面 3.21，車身側面還露得出 1.62
 for(const sd of [-1,1])for(let i=1;i<6;i++){const f=i/6;block(tileDark,[2*roof.L,.08,.06],[0,roofYc+sd*roofHalf*(1-f),roof.z+roof.rise*f+.03],[-sd*slope,0,0]);}
 block(tileDark,[2*roof.L+.2,.32,.2],[0,roofYc,roof.z+roof.rise]);
 // 屋頂柱：月台中線一排紅磚柱（白柱頭）；兩側橋面緣一排細鋼柱。
 for(let x=-9.6;x<=9.7;x+=4.8){const y=(p.y0+p.y1)/2,h=roof.z-p.z;block(brick2,[.42,.42,h],[x,y,p.z+h/2]);block(trim,[.58,.58,.12],[x,y,roof.z-.08]);
  const h2=roof.z-(railZ-.23);for(const yo of [front-1.62,far.front+1.62])block(M.steel,[.13,.13,h2],[x,yo,railZ-.23+h2/2]);}
 for(let i=0;i<4;i++){const x=-7.5+i*5,y=-4.3,z=p.z+2.3;block(M.lamp,[.5,.5,.42],[x,y,z]);block(M.steel,[.03,.03,roof.z-z],[x,y,(z+roof.z)/2]);k.addLight('platform-'+i,x,y,z-.15,2.8,7);}

 // 站前：磚鋪廣場、兩只大陶瓶；外面一條紅磚步道是老街，靠站這側一排紅磚街屋（騎樓），外側一排陶器攤。
 block(plaza,[23,6.0,.04],[0,-12.8,groundZ+.02]);
 instance(vase,glazes[1],[-7.2,-13.4,groundZ+.12],[1.5,1.5,2.0]);instance(vase,glazes[0],[7.6,-13.6,groundZ+.12],[1.3,1.3,1.7]);
 for(const x of [-7.2,7.6])block(concrete2,[1.9,1.9,.12],[x,x<0?-13.4:-13.6,groundZ+.06]);
 const streetY=-17.4;block(paving,[62,2.6,.04],[0,streetY,groundZ+.02]);
 const signs=['#c8473a','#e0a63d','#3d78b0','#4f9a6b','#d36b3c'].map(c=>mat(c,{emissive:c,emissiveIntensity:0}));
 function shophouse(x,w,floors){const d=3.0,y=-13.4,h=floors*1.15+.35,b=pick([brick,brick2,brick3]),fy=y-d/2;
  block(b,[w,d,h],[x,y,groundZ+h/2]);
  block(dark,[w-.4,.1,1.0],[x,fy-.02,groundZ+.52]);   // 騎樓的暗面
  for(const s of [-1,1])block(b,[.24,.34,1.15],[x+s*(w/2-.12),fy-.12,groundZ+.58]);
  block(trim,[w+.06,.2,.1],[x,fy-.06,groundZ+1.18]);
  for(let f=1;f<floors;f++)for(const a of w>2.6?[-.25,.25]:[0]){block(M.glass,[.6,.06,.62],[x+a*w,fy-.02,groundZ+.38+f*1.15]);instance(arch,M.glass,[x+a*w,fy-.02,groundZ+.69+f*1.15],[.6,.06,.5]);}
  block(trim,[w*.55,.16,.5],[x,fy+.02,groundZ+h+.22]);block(b,[w*.4,.18,.3],[x,fy+.02,groundZ+h+.6]);   // 山頭
  block(pick(signs),[.14,.5,1.0],[x+w/2-.4,fy-.4,groundZ+1.8]);}
 for(const [x0,x1] of [[-30.6,-12.4],[12.4,30.6]]){let x=x0;while(true){const w=2.3+rand()*1.0;if(x+w>x1)break;shophouse(x+w/2,w,2+Math.floor(rand()*2));x+=w+.04;}}
 // 陶器攤：一張桌子三只瓶，桌前地上再擺一兩只大的；兩攤一盞燈。
 const table=mat('#8f6a4c');let n=0;
 for(const [x0,x1] of [[-30,-12.6],[12.6,30]])for(let x=x0+.8;x<x1;x+=2.4,n++){
  if(!inside(x,streetY-1.0,1))continue;
  block(table,[1.6,.6,.5],[x,streetY-1.0,groundZ+.25]);
  for(const a of [-.5,0,.5]){const s=.2+rand()*.14;instance(vase,pick(glazes),[x+a,streetY-1.0,groundZ+.5],[s,s,s*1.4]);}
  if(rand()<.6){const s=.34+rand()*.16;instance(vase,pick(glazes),[x+(rand()-.5)*1.2,streetY-.25,groundZ],[s,s,s*1.6]);}
  if(n%2){block(M.steel,[.08,.08,2.4],[x+1.2,streetY-1.2,groundZ+1.2]);block(M.lamp,[.3,.3,.2],[x+1.2,streetY-1.2,groundZ+2.4]);pool(x+1.2,streetY-.9,groundZ+.06,1.8,1.4);}
 }

 // 站後左邊：隧道窯（長長的磚造拱頂）與兩根方磚煙囪。
 block(brick2,[8.6,3.0,1.0],[-16.6,6.6,groundZ+.5]);instance(arch,brick,[-16.6,6.6,groundZ+1.0],[3.0,8.6,1.6],[0,0,Math.PI/2]);
 for(let x=-19.8;x<=-13.4;x+=1.6)block(dark,[.5,.1,.5],[x,5.08,groundZ+.4]);   // 窯口
 for(const [x,y,h] of [[-21.8,5.2,10.2],[-11.5,6.6,8.0]]){block(brick,[1.3,1.3,h*.55],[x,y,groundZ+h*.275]);block(brick2,[1.0,1.0,h*.45],[x,y,groundZ+h*.55+h*.225]);block(dark,[1.1,1.1,.22],[x,y,groundZ+h+.06]);block(trim,[1.36,1.36,.12],[x,y,groundZ+h*.55]);}
 for(let n2=0;n2<12;){const x=-31+rand()*18,y=.9+rand()*3.4;if(!inside(x,y,1.2))continue;props.broadleaf(x,y,groundZ,1.6+rand()*1.0);n2++;}
 // 站後右邊：陶瓷博物館（清水混凝土盒子、整面玻璃、出挑的屋頂板），前面草坪擺幾件陶藝。
 const mu={x:16.4,y:7.2};
 block(concrete2,[8.0,4.4,2.2],[mu.x,mu.y,groundZ+1.1]);block(M.glass,[7.4,.1,1.5],[mu.x,mu.y-2.22,groundZ+.95]);for(let x=-3.3;x<=3.31;x+=1.1)block(concrete2,[.09,.14,1.5],[mu.x+x,mu.y-2.24,groundZ+.95]);block(concrete2,[7.4,.14,.08],[mu.x,mu.y-2.24,groundZ+1.2]);
 block(concrete2,[9.4,5.6,.22],[mu.x,mu.y-.3,groundZ+2.3]);block(concrete2,[.5,6.6,1.2],[mu.x-4.8,mu.y-1.0,groundZ+.6]);
 for(const [x,y,s,g] of [[13.6,3.2,.5,1],[15.2,2.4,.7,4],[17.6,3.0,.42,0],[19.4,2.2,.6,2]])instance(vase,glazes[g],[x,y,groundZ],[s,s,s*1.8]);
 instance(ball,glazes[6],[20.6,3.2,groundZ+.5],[.5,.5,.5]);
 for(let n2=0;n2<10;){const x=22+rand()*9,y=1+rand()*10;if(!inside(x,y,1.2))continue;props.broadleaf(x,y,groundZ,1.6+rand()*1.0);n2++;}

 // 後方：山頭與山頂的鶯歌石（兩塊灰岩疊成），右後方一排老窯房與一根小煙囪；樹。
 const hill={x:-12,y:17.2,rx:12,ry:2.8,rz:3.8},dome=geo(new THREE.SphereGeometry(1,28,8,0,Math.PI*2,0,Math.PI/2));dome.rotateX(Math.PI/2);
 const hillZ=(x,y)=>groundZ+hill.rz*Math.sqrt(Math.max(0,1-((x-hill.x)/hill.rx)**2-((y-hill.y)/hill.ry)**2));
 instance(dome,mat('#6f8a5a'),[hill.x,hill.y,groundZ],[hill.rx,hill.ry,hill.rz]);
 const rock=mat('#8c8a83',{roughness:.9}),rk={x:-10.4,y:17.0};rk.z=hillZ(rk.x,rk.y);
 instance(ball,rock,[rk.x,rk.y,rk.z+.6],[1.9,1.3,1.3],[0,.25,.3]);instance(ball,rock,[rk.x+1.5,rk.y-.1,rk.z+1.5],[1.0,.8,.8],[0,-.4,.5]);
 for(let n2=0;n2<22;){const x=hill.x-hill.rx+rand()*hill.rx*2,y=hill.y-hill.ry+rand()*hill.ry*2,z=hillZ(x,y);if(z<=groundZ+.1||Math.hypot(x-rk.x,y-rk.y)<2.6||!inside(x,y,1.2))continue;props.broadleaf(x,y,z-.1,1.4+rand()*1.0);n2++;}
 for(let x=6;x<=26;x+=4.2){const w=3.4,h=1.6+rand()*.6;block(pick([brick,brick2,brick3]),[w,2.6,h],[x,15.6,groundZ+h/2]);instance(prism,tileDark,[x,15.6,groundZ+h],[w+.3,2.9,.9]);
  block(dark,[.8,.05,1.05],[x-.9,14.28,groundZ+.53]);for(const dx of [.2,1.1])block(M.glass,[.56,.05,.62],[x+dx,14.28,groundZ+.82]);block(trim,[w+.02,2.62,.08],[x,15.6,groundZ+.3]);}
 block(brick,[.9,.9,6.0],[22.4,17.6,groundZ+3.0]);block(dark,[.95,.95,.18],[22.4,17.6,groundZ+6.05]);
 for(let n2=0;n2<12;){const x=4+rand()*26,y=17.6+rand()*1.6;if(!inside(x,y,1.2)||Math.abs(x-22.4)<1.2)continue;props.broadleaf(x,y,groundZ,1.5+rand()*.9);n2++;}
 for(const [x,y] of [[-30.6,8.6],[-27,10.4],[-23.4,9.2],[-8,10],[-3,8.6],[2.4,10.2],[7,9],[30.8,12]])props.broadleaf(x,y,groundZ,2.0+rand()*.8);
 // 老街上的機車。
 for(const [x0,n2] of [[-29,8],[-21,6],[14,7],[23,8]])for(let i=0;i<n2;i++)k.scooter(x0+i*.62,streetY+.9,{yaw:Math.PI/2});

 return k.result({
  path,label:'陶瓷老街站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,hallY0,groundZ+1.6],deck:[0,front,railZ],backdrop:[rk.x,rk.y,rk.z]},
  extra:{opposingPath:k.reversed(far)},
  update(time,t){for(const s of signs)s.emissiveIntensity=t.lamp*.6;}
 });
}
