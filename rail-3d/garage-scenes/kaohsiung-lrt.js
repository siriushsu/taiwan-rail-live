// 高雄輕軌：駁二大義站的微縮印象——路面輕軌（草皮軌；沿線沒有架空線，車靠車載儲電，只在月台上方掛一段充電軌）。
// 月台在環內側，白色雨棚伸過軌道上方掛充電軌；車站正後方是大義倉庫群（人字鐵皮屋頂、捲門、彩繪牆），倉庫後的草地上有貨櫃堆的裝置藝術、
// 紅色圓環雕塑與一節老貨車；環後是港邊碼頭與船，右後角碼頭上一群白色六角塔（流行音樂中心的印象）；站前是自行車道、步道與大草坪，
// 草坪上有鋼板機器人、方塊堆兩件裝置藝術和餐車，邊上種椰子樹。
// 不是實際線形、方位或比例的重建；裝置藝術是自己編的造型。
// 雨棚棚底離軌頂 2.35、前緣伸到軌道中心外 .9：照 .73 規則不擋車身（2.35−.73×(.9−.625)＝2.15，高過車高 1.60）。
// 倉庫在環內前半（後牆 y 1.9）、屋脊高 3.35：離後直線夠遠，跟車到後直線也看得到車；倉庫後的東西越靠後直線越矮。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e4e9eb',sun:'#fff3d6',ambient:'#c6d6e2',ground:'#86996a',power:3.0,exposure:1.04,water:'#2e5d6e',shallow:'#5a8a90',lamp:0,window:0},
 sunset:{background:'#f3cfae',sun:'#ffa058',ambient:'#d9b2a0',ground:'#7a7856',power:2.9,exposure:.94,water:'#5b6c82',shallow:'#c48f6c',lamp:.5,window:.45},
 night:{background:'#111a29',sun:'#9cbbe2',ambient:'#566f8d',ground:'#27303b',power:.7,exposure:.78,water:'#112c45',shallow:'#285166',lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20433});
 const {THREE,M,mat,geo,block,instance,rand,groundZ,props,prism,cylinder,disc,pool}=k;
 const path=k.loop({z:groundZ+.02}),railZ=path.z,front=path.front;
 const pick=list=>list[Math.floor(rand()*list.length)];
 // 兩點之間一根方料（沿 x 的 box 轉過去）。
 const beam=(m,A,B,w,h=w)=>{const d=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],r=Math.hypot(d[0],d[1]);
  block(m,[Math.hypot(r,d[2]),w,h],[(A[0]+B[0])/2,(A[1]+B[1])/2,(A[2]+B[2])/2],[0,-Math.atan2(d[2],r),Math.atan2(d[1],d[0])]);};

 // 草皮軌；沿線沒有架空線（車載儲電）。
 k.embeddedTrack(path,{surface:'grass'});

 const white=mat('#f4f3ee',{roughness:.45}),green=mat('#7cb342',{roughness:.5}),paving=mat('#cfc6b4'),quay=mat('#bdb7aa');
 const bench=mat('#8b6f52'),tvm=mat('#2f6aa0'),rust=mat('#8a5a3c',{roughness:.8}),railOld=mat('#6b5546',{metalness:.4,roughness:.6});
 const bikeLane=mat('#b8574a',{roughness:.8}),red=mat('#c8382e',{roughness:.5});

 // ── 車站：月台（環內側、低地板 .1）、後緣玻璃擋風板、座椅、售票機；雨棚兩排細柱，前排立在月台前緣、屋頂往外伸過軌道 ──
 const p=k.platform({y:front,z:railZ,side:1,length:12,width:2.6,edge:.7,top:.1,bottom:groundZ});
 block(M.gateGlass,[11.4,.05,1.1],[0,p.y1-.08,p.z+.55]);
 for(const x of [-3.6,3.6]){block(bench,[1.3,.36,.12],[x,p.y1-.55,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,p.y1-.36,p.z+.52]);}
 block(tvm,[.5,.36,1.05],[0,p.y1-.32,p.z+.52]);
 const can={y0:front-.9,y1:p.y1+.2,z:railZ+2.35,L:10};
 block(white,[can.L,can.y1-can.y0,.12],[0,(can.y0+can.y1)/2,can.z+.06]);
 block(green,[can.L+.04,.06,.18],[0,can.y0-.03,can.z+.06]);block(green,[can.L+.04,.06,.18],[0,can.y1+.03,can.z+.06]);
 for(let x=-can.L/2+.5;x<=can.L/2-.4;x+=can.L/4-.25)for(const y of [p.y0+.2,p.y1-.3])block(white,[.16,.16,can.z-p.z],[x,y,(can.z+p.z)/2]);
 // 充電軌：沿軌道中心一條剛性導電軌，吊架掛在雨棚下（車在站上升弓充電）。
 const chargeZ=railZ+1.72;
 block(M.wire,[can.L-.8,.08,.06],[0,front,chargeZ]);
 for(let x=-can.L/2+.6;x<=can.L/2-.5;x+=2.2)block(M.wire,[.04,.04,can.z-chargeZ],[x,front,(chargeZ+can.z)/2]);
 // 站名柱（綠）。
 for(const x of [-5.6,5.6]){block(green,[.3,.3,1.7],[x,p.y1-.4,p.z+.85]);block(white,[.32,.32,.4],[x,p.y1-.4,p.z+1.5]);}

 // ── 大義倉庫群（環內前半、車站正後方）：人字鐵皮屋頂長倉庫三棟，正面兩扇捲門、中間彩繪牆、上緣一排高窗 ──
 const wallCols=['#d9d2c4','#b9533f','#c9c2b0'].map(c=>mat(c,{roughness:.85})),roofM=mat('#5b5f63',{roughness:.6,metalness:.2});
 const doorM=mat('#4b5157',{roughness:.6,metalness:.3}),warm=mat('#4a3b2e',{roughness:.8,emissive:'#ffc77a',emissiveIntensity:0}),mural=['#e2793a','#3f8ac0','#e8c547','#5aa86b','#c2456a'].map(c=>mat(c,{roughness:.7}));
 const wy0=-2.5,wy1=1.9,wH=2.4,wd=wy1-wy0,wc=(wy0+wy1)/2;
 [{x:-12.4,w:9.4},{x:-2.0,w:9.0},{x:8.4,w:9.4}].forEach((w,i)=>{
  block(wallCols[i],[w.w,wd,wH],[w.x,wc,groundZ+wH/2]);
  instance(prism,roofM,[w.x,wc,groundZ+wH],[w.w+.3,wd+.3,.95]);
  // 正面左邊那扇捲門拉起來：門洞白天是暗的室內、夜裡透出暖光，門前一圈光池（中間那棟門前是月台，不放）。
  for(const s of [-1,1]){const dx=w.x+s*w.w*.3;
   block(s<0?warm:doorM,[1.7,.05,1.6],[dx,wy0-.02,groundZ+.8]);block(doorM,[1.7,.05,1.6],[dx,wy1+.02,groundZ+.8]);
   if(s<0){block(doorM,[1.8,.16,.16],[dx,wy0-.1,groundZ+1.68]);if(i!==1)pool(dx,wy0-1.0,groundZ+.06,1.7,1.2);}}
  block(M.glass,[w.w*.88,.05,.24],[w.x,wy0-.02,groundZ+2.1]);block(M.glass,[w.w*.88,.05,.24],[w.x,wy1+.02,groundZ+2.1]);
  block(mural[i%5],[1.3,.05,1.4],[w.x-.85,wy0-.03,groundZ+.95]);block(mural[(i+2)%5],[1.0,.05,.95],[w.x+.35,wy0-.03,groundZ+.7]);
  block(mural[(i+4)%5],[.7,.05,1.55],[w.x+1.2,wy0-.03,groundZ+1.0]);
  for(const s of [-1,1])block(mural[(i+1+s)%5],[.05,wd*.6,1.3],[w.x+s*(w.w/2+.03),wc,groundZ+1.0]);});

 // ── 倉庫後的草地：貨櫃堆的裝置藝術、紅色圓環雕塑、一節老貨車停在一小段舊軌上、長椅、樹（越靠後直線越矮）──
 const boxes=['#c8382e','#2f6aa0','#e2a23a','#3f8a6a','#e9e6dc'].map(c=>mat(c,{roughness:.6}));
 [[0,0,0],[1,0,0],[2,0,0],[.5,0,1],[1.5,0,1],[1,0,2]].forEach(([i,,lv],n)=>block(boxes[n%5],[1.76,.36,.38],[-9.6+i*1.8,4.4+(lv%2)*.12,groundZ+.19+lv*.38]));
 const ring=geo(new THREE.TorusGeometry(1,.13,8,40));
 instance(ring,red,[3.8,4.6,groundZ+1.25],[.95,.95,1],[0,0,Math.PI/2]);
 block(M.concreteDark,[.8,.5,.2],[3.8,4.6,groundZ+.1]);
 instance(ring,red,[3.8,4.6,groundZ+1.25],[.95,.95,1],[Math.PI/2,0,0]);
 for(const y of [5.15,5.75])block(railOld,[4.4,.07,.08],[13.6,y,groundZ+.04]);
 for(let x=11.6;x<=15.6;x+=.5)block(M.sleeper,[.14,.9,.04],[x,5.45,groundZ+.02]);
 block(rust,[2.4,.62,.62],[13.6,5.45,groundZ+.5]);block(mat('#3a3633'),[2.0,.5,.16],[13.6,5.45,groundZ+.12]);
 for(const x of [-16,-4.8,8.8])block(bench,[1.3,.36,.36],[x,3.6,groundZ+.18]);
 for(const [x,y] of [[-17.5,3.4],[-14,4.2],[-1.6,4.0],[7.0,3.6],[17.6,3.2],[10.4,3.0]])props.broadleaf(x,y,groundZ,1.5+rand()*.5);
 for(let n=0;n<14;){const x=-18+rand()*36,y=6.2+rand()*1.3;props.bush(x,y,groundZ,.4+rand()*.25);n++;}

 // ── 環後：港邊碼頭（繫船柱、埋在鋪面裡的舊軌）、港水、船；右後角碼頭上一群白色六角塔 ──
 block(quay,[64,2.6,.06],[0,11.9,groundZ+.03]);
 for(const y of [11.3,11.72])block(railOld,[60,.06,.02],[0,y,groundZ+.065]);
 const wx0=-29,wx1=18,wy=[13.3,19.6];
 k.river(wx1-wx0,wy[1]-wy[0],[(wx0+wx1)/2,(wy[0]+wy[1])/2],THEMES.day);
 block(quay,[wx1-wx0+.6,.4,.3],[(wx0+wx1)/2,wy[0]-.05,groundZ+.15]);
 for(let x=wx0+1.2;x<wx1-.6;x+=2.6)instance(cylinder,M.fastener,[x,wy[0]-.12,groundZ+.42],[.16,.16,.26]);
 const hulls=['#f2f0ea','#b8403a','#2f5f9a'].map(c=>mat(c,{roughness:.55}));
 const boat=(x,y,yaw,len,hull=pick(hulls))=>{const hz=groundZ+.32,c=Math.cos(yaw),s=Math.sin(yaw);
  instance(prism,hull,[x,y,hz],[len,.95,.5],[Math.PI,0,yaw]);
  block(white,[len*.3,.66,.42],[x+c*len*.08,y+s*len*.08,hz+.21],[0,0,yaw]);block(M.glass,[len*.31,.68,.12],[x+c*len*.08,y+s*len*.08,hz+.3],[0,0,yaw]);};
 boat(-20,14.4,0,3.0,hulls[0]);boat(-15.6,14.4,0,2.6);boat(9.8,17.8,.15,2.4);
 // 貨輪：紅船身、甲板上貨櫃兩層、船尾駕駛台。
 const ship={x:-2.5,y:15.2,L:9.6};
 instance(prism,hulls[1],[ship.x,ship.y,groundZ+.62],[ship.L,1.7,.9],[Math.PI,0,0]);
 block(hulls[1],[ship.L*.92,1.5,.3],[ship.x,ship.y,groundZ+.75]);
 for(let i=0;i<5;i++)for(let lv=0;lv<2;lv++)if(lv===0||i%2)block(boxes[(i+lv*2)%5],[1.4,1.3,.4],[ship.x-2.6+i*1.45,ship.y,groundZ+1.1+lv*.4]);
 block(white,[1.3,1.4,1.3],[ship.x+ship.L/2-1.0,ship.y,groundZ+1.55]);block(M.glass,[1.32,1.42,.24],[ship.x+ship.L/2-1.0,ship.y,groundZ+2.0]);
 // 六角塔群：六邊形柱身、每層一圈藍玻璃帶。
 const hex=geo(new THREE.CylinderGeometry(.5,.5,1,6));hex.rotateX(Math.PI/2);
 block(quay,[13.2,6.2,.08],[25.2,16.4,groundZ+.04]);
 for(const [x,y,r,h] of [[21.6,15.4,1.7,2.6],[24.2,17.6,1.9,4.4],[26.8,15.2,1.6,3.4],[28.4,17.8,1.3,2.2],[22.6,18.6,1.2,1.6]]){
  instance(hex,white,[x,y,groundZ+h/2],[r,r,h]);for(let z=.7;z<h-.2;z+=.8)instance(hex,M.glass,[x,y,groundZ+z],[r+.04,r+.04,.22]);
  instance(hex,white,[x,y,groundZ+h+.05],[r*1.06,r*1.06,.1]);}

 // ── 左側：舊鐵道調車場（三條鏽軌、兩節老貨車）與樹 ──
 for(const x of [-30.6,-29.0,-27.4]){for(const o of [-.3,.3])block(railOld,[.06,15,.05],[x+o,0,groundZ+.03]);
  for(let y=-7;y<=7.1;y+=.7)block(M.sleeper,[.8,.14,.04],[x,y,groundZ+.015]);}
 block(rust,[.62,2.4,.62],[-29.0,-3.2,groundZ+.5]);block(mat('#596b5a',{roughness:.8}),[.62,2.2,.6],[-30.6,2.8,groundZ+.49]);
 for(const y of [-13.6,9.6,12.2])props.broadleaf(-29.6,y,groundZ,1.8+rand()*.5);

 // ── 站前：紅色自行車道、步道與路燈、大草坪（兩條步道穿過）、椰子樹；草坪上是鋼板機器人與方塊堆兩件裝置藝術，右邊鋪面停兩台餐車 ──
 block(bikeLane,[60,.9,.01],[0,-9.6,groundZ+.035]);
 for(let x=-29;x<=29;x+=2.4)block(white,[.7,.05,.01],[x,-9.6,groundZ+.042]);
 block(paving,[62,1.2,.04],[0,-10.8,groundZ+.02]);block(paving,[58,1.4,.04],[0,-18.9,groundZ+.02]);
 for(const x of [-9.5,10.5])block(paving,[1.1,6.8,.04],[x,-14.8,groundZ+.02]);
 for(const x of [-26,-17,-8,8,17,26]){block(M.mast,[.08,.08,2.0],[x,-10.8,groundZ+1.0]);block(M.lamp,[.32,.32,.16],[x,-10.8,groundZ+2.0]);pool(x,-10.7,groundZ+.06,2.0,1.5);}
 const trunk=mat('#8a7458',{roughness:.8}),frond=mat('#4f7f45',{roughness:.7});
 const palm=(x,y,h)=>{instance(cylinder,trunk,[x,y,groundZ+h/2],[.2,.2,h]);
  for(let i=0;i<7;i++){const t=i/7*Math.PI*2+rand(),c=Math.cos(t),s=Math.sin(t);beam(frond,[x,y,groundZ+h],[x+c*1.25,y+s*1.25,groundZ+h-.55],.34,.05);}};
 for(const [x,y] of [[-26,-18.9],[-17,-18.9],[-4,-18.9],[6.5,-18.9],[19.5,-18.9],[27.5,-18.9],[-12.6,-12.0],[13.2,-12.0]])palm(x,y,2.4+rand()*.6);
 for(const [x,y] of [[-23.5,-15.4],[-14,-16.6],[3.6,-16.8],[25.6,-14.8]])props.broadleaf(x,y,groundZ,1.4+rand()*.4);
 // 鋼板機器人：站在圓形鋪面上、面向站前；腳、身體、垂下的手臂、頭，眼睛是兩顆小燈，夜裡會亮。
 const bot=[-1.2,-14.8];
 instance(disc,paving,[bot[0],bot[1],groundZ+.03],[2.4,2.4,1]);
 for(const s of [-1,1]){block(M.steel,[.36,.4,1.0],[bot[0]+s*.32,bot[1],groundZ+.53]);
  block(rust,[.26,.28,.95],[bot[0]+s*.8,bot[1]-.05,groundZ+1.45],[0,-s*.25,0]);}
 block(rust,[1.15,.72,1.0],[bot[0],bot[1],groundZ+1.52]);block(M.steel,[.5,.06,.4],[bot[0],bot[1]-.38,groundZ+1.6]);
 block(M.steel,[.66,.56,.5],[bot[0],bot[1],groundZ+2.3]);block(M.steel,[.04,.04,.4],[bot[0]+.2,bot[1],groundZ+2.75]);
 for(const s of [-1,1])block(M.lamp,[.12,.04,.1],[bot[0]+s*.15,bot[1]-.29,groundZ+2.36]);
 // 方塊堆：幾個彩色立方體斜斜疊起來（左邊草坪）。
 [[0,0,0,0],[.9,.2,0,.3],[.3,.5,1,.7],[.7,-.3,1,1.1],[.5,.1,2,.4]].forEach(([dx,dy,lv,r],n)=>block(boxes[n%5],[1.0,1.0,1.0],[-17.6+dx,-14.6+dy,groundZ+.52+lv*.98],[0,0,r]));
 // 右邊鋪面：餐車兩台；步道邊一排腳踏車架（都不高）。
 block(paving,[8.4,3.4,.04],[18.4,-14.8,groundZ+.02]);
 for(const [x,c] of [[16.2,0],[20.4,2]]){block(boxes[c],[1.8,.8,.75],[x,-14.8,groundZ+.45]);block(white,[1.0,.82,.18],[x+.2,-14.8,groundZ+.95]);
  for(const s of [-1,1])instance(cylinder,M.fastener,[x+s*.6,-14.8,groundZ+.12],[.24,.24,.86],[Math.PI/2,0,0]);}
 for(let x=22.2;x<=26.2;x+=.5)block(M.steel,[.05,.6,.35],[x,-12.0,groundZ+.2]);

 // 燈：月台兩盞、倉庫正面兩盞、碼頭一盞、六角塔一盞、機器人一盞（共七盞）。
 for(const x of [-3,3])k.addLight('platform',x,p.y0+1.2,p.z+1.8,.9,6);
 for(const x of [-12.4,8.4])k.addLight('warehouse',x,wy0-1.0,groundZ+2.0,.8,6);
 k.addLight('quay',-8,12.4,groundZ+1.6,.8,8);
 k.addLight('music',24.2,14.2,groundZ+2.4,1.0,7);
 k.addLight('sculpture',bot[0],bot[1]-1.6,groundZ+2.6,.8,6);

 return k.result({
  path,label:'駁二大義站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,wc,groundZ+wH+1],deck:[0,front,railZ],backdrop:[24.2,17.6,groundZ+3]},
  update(time,t){warm.emissiveIntensity=t.window*.9;}
 });
}
