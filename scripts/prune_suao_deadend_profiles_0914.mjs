// 本次蘇澳四條死端裁剪的可重現步驟。網路先移除指定四條，剖面只做同一個子集裁剪。
// 刪邊不會新增既有坡度／接縫／淨距約束，因此保留原本的可行高度解；不得重算鄰接股道。
// 跑法：BASE_REF=<裁剪前已驗證commit> node scripts/prune_suao_deadend_profiles_0914.mjs
// 完成後仍必須跑 verify_rail_levels、verify_physical_display_profiles、verify_rail_structure_heights。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const ref=process.env.BASE_REF;assert(ref,'必須明確指定裁剪前已驗證的 BASE_REF');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sha=execFileSync('git',['-C',root,'rev-parse',ref],{encoding:'utf8'}).trim();
const original=file=>execFileSync('git',['-C',root,'show',`${sha}:rail-3d/physical/${file}`],{maxBuffer:32*1024*1024});
const read=file=>JSON.parse(fs.readFileSync('rail-3d/physical/'+file));
const ids=['145608233','1527875178','1527875179','1527875182'],gone=new Set(ids);
const before=JSON.parse(original('network.json')),after=read('network.json');
assert.equal(before.ways.filter(w=>gone.has(w.id)).length,4);
assert.deepEqual(after.ways,before.ways.filter(w=>!gone.has(w.id)));
assert.deepEqual(after.paths,before.paths);
for(const p of Object.values(before.paths))for(const[wi]of p.walk)assert.equal(before.ways[wi].id,after.ways[wi].id);
assert(original('dispatch.json').equals(fs.readFileSync('rail-3d/physical/dispatch.json')),'派車表不得改變');
for(const file of ['display-profiles.json','level-profiles.json']){
 const p=JSON.parse(original(file));for(const id of ids){assert(p.entries[id]);delete p.entries[id];}
 if(file==='level-profiles.json'){
  const baseInputs=structuredClone(p.inputSha256);
  for(const key of Object.keys(p.inputSha256))p.inputSha256[key]=crypto.createHash('sha256').update(fs.readFileSync('rail-3d/physical/'+key)).digest('hex');
  p.incrementalPrune={baseCommit:sha,removedWays:ids,baseInputSha256:baseInputs,method:'只移除無任何列車路徑使用的四條死端；其餘已驗證高程逐條保留，不重新最佳化相鄰股道。刪除邊只減少原約束，保留解另經完整高度、坡度與接縫閘門驗證。'};
 }
 fs.writeFileSync('rail-3d/physical/'+file,JSON.stringify(p));
}
console.log('蘇澳四條死端剖面增量裁剪完成；保留股道 entries 與派車表未變。');
