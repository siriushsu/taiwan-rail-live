// Q 版上下層：放大後的車身比股道間距寬，靠深度分前後。這支驗 q-trains.js 的純邏輯，
// 案例與數字跟 native railcore R3dQTrainsTest.kt 一一對應，兩邊要一起改。
import assert from 'node:assert/strict';
import {depthLifts,sightOverlap,qMaxPushM,qUndergroundFloorM} from '../rail-3d/integration/q-trains.js';

const eyeSide={x:0,y:-1100,z:700};
const box=(id,x,y,{rail=0,under=false,scale=8,tx=1,ty=0,lift=0}={})=>({id,x,y,z:rail+2*scale,tx,ty,halfL:15*scale,halfW:1.5*scale,halfH:2*scale,under,lift});
const lifts=(trains,eye=eyeSide,maxPushM=1e6)=>depthLifts(trains,eye,maxPushM);
const moved=(t,lift,eye)=>{const sx=t.x-eye.x,sy=t.y-eye.y,sz=t.z-eye.z,k=1-lift/Math.hypot(sx,sy,sz);return {...t,x:eye.x+sx*k,y:eye.y+sy*k,z:eye.z+sz*k,halfL:t.halfL*k,halfW:t.halfW*k,halfH:t.halfH*k};};
const assertApart=(a,b,map,eye=eyeSide)=>{const hit=sightOverlap(moved(a,map.get(a.id),eye),moved(b,map.get(b.id),eye),eye);if(hit)assert.ok(hit.enter>=0||hit.exit<=0,`還碰得到：${hit.enter}～${hit.exit}`);};
const cases={
  平面沒疊到的兩列_高低不同也不動深度(){
    const map=lifts([box('near',0,-30,{rail:-18.6,under:true,scale:6}),box('far',0,4,{rail:-15,under:true,scale:6})]);
    assert.equal(map.get('near'),0);assert.equal(map.get('far'),0);
  },
  平面疊到的地下車_分開到不碰_近的在前(){
    const near=box('near',0,-3,{under:true}),far=box('far',40,3,{under:true}),map=lifts([far,near]);
    assert.equal(map.get('near'),0);assert.ok(map.get('far')<0);assertApart(near,far,map);
  },
  俯視時高的蓋低的(){
    const top={x:0,y:0,z:1300},low=box('low',0,0,{rail:-20,under:true}),high=box('high',20,0,{rail:-10,under:true}),map=lifts([low,high],top);
    assert.equal(map.get('high'),0);assert.ok(map.get('low')<0);assertApart(high,low,map,top);
  },
  地表車只往鏡頭拉(){
    const near=box('near',0,-3),far=box('far',40,3),map=lifts([near,far]);
    assert.equal(map.get('far'),0);assert.ok(map.get('near')>0);assertApart(near,far,map);
  },
  地表車蓋住地下車_近遠都一樣(){
    const map=lifts([box('ground',0,3),box('under',0,-3,{rail:-6,under:true})]);
    assert.equal(map.get('ground'),0);assert.ok(map.get('under')<0);
  },
  沒疊到的車維持起始深度(){
    const map=lifts([box('a',0,0,{under:true,lift:-100}),box('b',900,0,{under:true,lift:-40}),box('c',0,1800,{rail:10,lift:90})]);
    assert.equal(map.get('a'),-100);assert.equal(map.get('b'),-40);assert.equal(map.get('c'),90);
  },
  起始深度把近車推進遠車_遠車再退(){
    const near=box('near',0,-30,{rail:-18.6,under:true,scale:6,lift:-181}),far=box('far',0,4,{rail:-15,under:true,scale:6,lift:-145}),map=lifts([near,far]);
    assert.equal(map.get('near'),-181);assert.ok(map.get('far')<-145);assertApart(near,far,map);
  },
  高架拉近時疊到的地表車跟著拉(){
    const near=box('near',0,-3),far=box('far',40,3,{rail:8,lift:70}),map=lifts([near,far]);
    assert.ok(map.get('far')>=70);assert.ok(map.get('near')>=0);assertApart(near,far,map);
  },
  畫面上沒疊到就不動(){
    const map=lifts([box('a',0,0,{under:true}),box('b',900,0,{under:true})]);
    assert.equal(map.get('a'),0);assert.equal(map.get('b'),0);
  },
  三列疊在一起_兩兩都分開(){
    const a=box('a',0,-4,{under:true}),b=box('b',30,0,{under:true}),c=box('c',-30,4,{under:true}),map=lifts([c,a,b]);
    assertApart(a,b,map);assertApart(b,c,map);assertApart(a,c,map);
  },
  地下車推遠有上限_地下遠裁切面裝得下(){
    assert.equal(lifts([box('a',0,-3,{under:true}),box('b',0,3,{under:true})],eyeSide,5).get('b'),-5);
    assert.equal(qUndergroundFloorM(1),50);assert.equal(qMaxPushM(1),0);
    for(const s of [2,8,14])assert.ok(qUndergroundFloorM(s)*1.01>=60+qMaxPushM(s));
  },
  交會全程誰在前不換邊(){
    for(const t of [5,-5])for(const az of [20,45,70,110,160]){
      const r=az*Math.PI/180,eye={x:-1100*Math.cos(r),y:-1100*Math.sin(r),z:700};let last=null;
      for(let x=-520;x<=520;x+=4){const hit=sightOverlap(box('a',0,0),box('b',x,t),eye);if(!hit)continue;if(last!==null)assert.equal(hit.aFront,last,`方位 ${az} 在 ${x} 翻面`);last=hit.aFront;}
      assert.notEqual(last,null);
    }
  },
  斜交時只看高低(){
    for(const x of [-120,0,120]){const hit=sightOverlap(box('a',0,0),box('b',x,x,{rail:8,tx:.7071,ty:.7071}),eyeSide);assert.ok(hit);assert.equal(hit.aFront,false);}
  },
};
for(const [name,run]of Object.entries(cases)){run();console.log('✓',name);}
console.log(`${Object.keys(cases).length} 項全過`);
