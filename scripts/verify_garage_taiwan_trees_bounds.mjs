// taiwan-trees 的邊界情況要出聲：外推不出去、外推到地面外、降高到底仍超過冠幅上限、上限傳成 NaN。不需要瀏覽器。
// 用法：node scripts/verify_garage_taiwan_trees_bounds.mjs [T1|T2|T3|T4 …]；不帶參數跑全部。
import {createTaiwanTrees,trackHouses} from '../rail-3d/garage-scenes/taiwan-trees.js';
const want=new Set(process.argv.slice(2)),on=k=>!want.size||want.has(k);
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??'').slice(0,400));}
const houses=build=>{const props={townhouse(){},farmhouse(){}},h=trackHouses(props);build(props);return h;};
const near=(p,q)=>Array.isArray(p)&&Math.abs(p[0]-q[0])<1e-9&&Math.abs(p[1]-q[1])<1e-9;
const throws=f=>{try{f();return false;}catch{return true;}};

if(on('T1')){
 // 間隔 .03 的兩棟連棟（外框各含 .05 屋簷，其實互相重疊）：(1,0) 往最近的側邊推會進隔壁，隔壁再推回來，四輪後仍在房子裡。
 const row=houses(p=>{p.townhouse(0,0,0,{width:2.6});p.townhouse(2.63,0,0,{width:2.6});});
 const r=row.outside(1,0,.8);
 check('T1 連棟夾住推不出去回 null',r===null,{r});
 // 單棟：最近的是背面，推到離外框 .8，座標和原本的做法逐值相同。
 const one=houses(p=>p.farmhouse(0,0,0,{}));
 const q=one.outside(.2,1,.8);
 check('T1 推得出去時結果不變',near(q,[.2,2.25])&&Math.abs(one.clearance(...q)-.8)<1e-9,{q});
 check('T1 不在外框裡原樣回傳',near(one.outside(5,5,.8),[5,5]));
 // 外框不含邊：農舍半寬 1.5＋屋簷 .25＝1.75，剛好在邊上的點不算在裡面，不外推。
 check('T1 剛好在外框邊上不外推',near(one.outside(1.75,0,.8),[1.75,0])&&near(one.outside(0,-1.45,.8),[0,-1.45])&&near(one.outside(0,1.45,.8),[0,1.45]));
}

if(on('T2')){
 // 底座邊緣在 x=−33：農舍靠邊，樹心落在農舍裡，最近的邊朝底座外。
 const edge=houses(p=>p.farmhouse(-31.5,0,0,{}));
 const onBase=(x,y)=>Math.abs(x)<33;
 const free=edge.outside(-32.6,0,.8);
 check('T2 不傳 within 時照舊外推（會推出底座）',Array.isArray(free)&&free[0]<-33,{free});
 check('T2 外推落在 within 外回 null',edge.outside(-32.6,0,.8,onBase)===null);
 check('T2 外推落在 within 內照常回傳',near(edge.outside(-31.3,0,.8,(x,y)=>x<0),[-31.3,-2.25]),{r:edge.outside(-31.3,0,.8,(x,y)=>x<0)});
 check('T2 沒碰到房子但在 within 外也回 null',edge.outside(-40,0,.8,onBase)===null);
}

if(on('T3')){
 const trees=createTaiwanTrees();
 trees.plant('terminalia',0,0,0,2.2,{maxReach:.1});
 trees.plant('terminalia',10,0,0,2.2,{maxReach:50});
 trees.plantMix([['terminalia',1],['koelreuteria',1]],20,0,0,2.2,{maxReach:.1});
 trees.plant('terminalia',30,0,0,2.2);
 const [a,b,c,d]=trees.spots;
 check('T3 降到 75% 仍超過 maxReach 標成 over',a.fit.over===true&&Math.abs(a.h-2.2*.75)<1e-9&&a.shape.bounds.reach>.1,{h:a.h,reach:a.shape.bounds.reach});
 check('T3 放得下的不標 over',b.fit.over===false,{fit:b.fit});
 check('T3 plantMix 都放不下也標 over',c.fit.over===true,{fit:c.fit});
 check('T3 stats().over 數得到',trees.stats().over===2&&d.fit===undefined,{over:trees.stats().over});
}

if(on('T4')){
 const trees=createTaiwanTrees();
 check('T4 plant 的 maxReach 是 NaN 丟錯',throws(()=>trees.plant('terminalia',0,0,0,2.2,{maxReach:NaN})));
 check('T4 plantMix 的 maxReach 是 NaN 丟錯',throws(()=>trees.plantMix([['terminalia',1]],0,0,0,2.2,{maxReach:NaN})));
 check('T4 maxPatch 是 NaN 丟錯',throws(()=>trees.plant('terminalia',0,0,0,2.2,{maxPatch:NaN})));
 // plantMix 帶有限的 maxReach 時不經過 plant，maxPatch 只靠 plantMix 自己檢查。
 check('T4 plantMix 帶 maxReach 時 maxPatch 是 NaN 也丟錯',throws(()=>trees.plantMix([['terminalia',1]],0,0,0,2.2,{maxReach:5,maxPatch:NaN})));
 check('T4 maxReach 是 null 或字串丟錯',throws(()=>trees.plant('terminalia',0,0,0,2.2,{maxReach:null}))&&throws(()=>trees.plantMix([['terminalia',1]],0,0,0,2.2,{maxReach:'1'})));
 check('T4 丟錯時不留下半棵',trees.spots.length===0,{spots:trees.spots.length});
 check('T4 undefined、Infinity、負數照常種',!throws(()=>{trees.plant('terminalia',0,0,0,2.2,{maxReach:undefined});trees.plantMix([['terminalia',1]],1,0,0,2.2,{maxReach:Infinity});trees.plant('terminalia',2,0,0,2.2,{maxReach:-.04});})&&trees.spots.length===3);
}

const fails=results.filter(r=>!r.pass).length;console.log(`共 ${results.length} 項：FAIL ${fails}`);if(fails)process.exitCode=1;
