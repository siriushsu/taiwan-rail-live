import assert from 'node:assert/strict';import {createPassingAvoidance,offsetPose} from '../rail-3d/integration/passing-avoidance.js';
const make=(id,x,d=1,y=0)=>({id,widthM:3.4,lengthM:300,lengths:Array(12).fill(25),cars:Array.from({length:12},(_,i)=>({coordinate:[121+(x+(137.5-i*25)*d)/111320/Math.cos(24*Math.PI/180),24+y/111320],angle:d===1?0:Math.PI,height:1,pitch:0}))});
let tests=0;function check(v,s){assert.ok(v,s);tests++;}
const avoid=createPassingAvoidance();let previous=0,active=0;
for(let frame=0;frame<2400;frame++){const t=frame/60,a=make('A',-1600+80*t),b=make('B',1600-80*t,-1),v=frame%2?[b,a]:[a,b],offsets=avoid.update(v,t,t),oa=offsets.get('A'),ob=offsets.get('B');check(Math.abs(ob-previous)<=5/60+.0001,'避讓不能橫向瞬移');previous=ob;if(Math.abs(-3200+160*t)<300){const pa=offsetPose(a.cars[0],oa),pb=offsetPose(b.cars[0],ob),gap=Math.abs(pa.coordinate[1]-pb.coordinate[1])*111320;check(gap>=4.2-.001,'會車的完整車身必須分開');active++;}}
check(active>100,'確實測到會車時段');check(Math.abs(previous)<.01,'通過後回到原股道');
const group=createPassingAvoidance(),v=[make('A',0),make('B',0,-1),make('C',0),make('D',0,-1)],o=group.update(v,0,0),ys=v.map(p=>offsetPose(p.cars[0],o.get(p.id)).coordinate[1]*111320);for(let i=0;i<ys.length;i++)for(let j=i+1;j<ys.length;j++)check(Math.abs(ys[i]-ys[j])>=4.2-.001,'大站四車不可疊成兩股');
const clear=createPassingAvoidance(),parallel=[make('A',0),make('B',0,-1,5)],co=clear.update(parallel,0,0);check([...co.values()].every(x=>x===0),'已分開的真實平行股道不避讓');console.log({tests,frames:2400,meetingFrames:active});
