// 重放已通過多車與雙引擎驗收的局部進路；只寫候選目錄，不自動部署。
// 原始 ways 必須未變；來源更新後須重新查核，不能把舊節點序號套進新路網。
import fs from'node:fs';import assert from'node:assert/strict';import crypto from'node:crypto';
const read=f=>JSON.parse(fs.readFileSync(f)),proof=read('scripts/fixtures/remaining-routes-0913.json'),net=read(process.env.NETWORK||'rail-3d/physical/network.json'),dispatch=read(process.env.DISPATCH||'rail-3d/physical/dispatch.json'),out=process.env.OUT||'output/remaining-station-routes';
assert.equal(crypto.createHash('sha256').update(JSON.stringify(net.ways)).digest('hex'),proof.waysSha256,'來源股道已更新，必須重新覆核進路');
for(const[id,p]of Object.entries(proof.newPaths)){if(net.paths[id])assert.deepEqual(net.paths[id],p,'新路徑 ID 已被其他工作使用 '+id);else net.paths[id]=p;}
for(const[key,p]of Object.entries(proof.afterPlans)){const current=dispatch.plans[key]||null;if(JSON.stringify(current)!==JSON.stringify(p))assert.deepEqual(current,proof.beforePlans[key],'這班車已另有修改，須先合併 '+key);dispatch.plans[key]=p;}
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/network.json',JSON.stringify(net));fs.writeFileSync(out+'/dispatch.json',JSON.stringify(dispatch));console.log({out,changes:proof.changes.length,plans:Object.keys(proof.afterPlans).length});
