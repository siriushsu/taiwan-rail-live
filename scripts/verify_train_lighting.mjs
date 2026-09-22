import assert from 'node:assert/strict';
import {tunnelAmount,nightAmount} from '../rail-3d/integration/train-lighting.js';
assert.equal(nightAmount(null),0);assert.equal(nightAmount({elevation:30}),0);assert.equal(nightAmount({elevation:-20}),1);
const path={length:1000,level:s=>({kind:s>=300&&s<=700?'tunnel':'surface',offsetM:0})};
for(const boundary of [300,700]){const samples=Array.from({length:101},(_,i)=>tunnelAmount(path,boundary-25+i*.5));assert.ok(Math.max(...samples.slice(1).map((n,i)=>Math.abs(n-samples[i])))<.07);assert.ok(samples.some(x=>x>.4&&x<.6));assert.equal(samples[0],boundary===300?0:1);assert.equal(samples.at(-1),boundary===300?1:0);}
assert.equal(tunnelAmount({length:100,level:()=>({kind:'bridge',offsetM:-10})},50),0);
assert.equal(tunnelAmount({length:100,level:()=>({kind:'surface',offsetM:-10})},50),1);
assert.equal(tunnelAmount({length:100},50),0);
console.log('日夜偏好、橋隧分類、雙向洞口漸變與缺資料退路通過');
