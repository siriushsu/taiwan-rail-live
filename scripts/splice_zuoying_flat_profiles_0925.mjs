// 2026-09-25 裁示「左營改平面」的層位檔可重現步驟：完整重算之後，只把高鐵左營站周邊（東經 120.29～120.34、
// 北緯 22.67～22.73 有經過的 way）真的有變的剖面換進改動前已驗證的層位檔，其餘 entries 逐筆保留。
// 不整檔採用完整重算：它會連動蘇澳那 32 條 09-14 刻意保留的高程解（見 prune_suao_deadend_profiles_0914.mjs），
// 另有幾筆遠處 0.001 公尺以下的數值雜訊（平面地圖是全網一起解的線性系統）。
// 跑法：node scripts/build_rail_levels.mjs && BASE_REF=<改動前已驗證commit> node scripts/splice_zuoying_flat_profiles_0925.mjs
// 完成後仍必須跑 verify_rail_levels、verify_flat_rail_grade、verify_rail_grounding、verify_rail_structure_heights。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {OFFICIAL_IGNORE} from './lib/rail_official_ignore.mjs';
const ref=process.env.BASE_REF;assert(ref,'必須明確指定改動前已驗證的 BASE_REF');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sha=execFileSync('git',['-C',root,'rev-parse',ref],{encoding:'utf8'}).trim();
const file='rail-3d/physical/level-profiles.json';
const base=JSON.parse(execFileSync('git',['-C',root,'show',`${sha}:${file}`],{maxBuffer:64*1024*1024}));
const full=JSON.parse(fs.readFileSync(file));
assert.deepEqual(full.inputSha256,base.inputSha256,'輸入檔跟 BASE_REF 不同，不能只換左營一帶');
const box=[120.29,22.67,120.34,22.73],inBox=w=>w.coordinates.some(([x,y])=>x>=box[0]&&x<=box[2]&&y>=box[1]&&y<=box[3]);
const ways=['network.json','metro-network.json'].flatMap(f=>JSON.parse(fs.readFileSync('rail-3d/physical/'+f)).ways);
// 數值陣列差超過 0.001 公尺才算變；其餘欄位（kind、rank…）要完全相同。
const differs=(a,b)=>{if(!a||!b)return !!(a||b);for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const u=a[k],v=b[k];
 if(Array.isArray(u)&&Array.isArray(v)&&u.length===v.length&&u.every(x=>typeof x==='number')){if(u.some((x,i)=>Math.abs(x-v[i])>.001))return true;}
 else if(JSON.stringify(u)!==JSON.stringify(v))return true;}return false;};
const replaced=[];let skipped=0;
for(const w of ways){const id=String(w.id);if(!differs(base.entries[id],full.entries[id]))continue;if(!inBox(w)){skipped++;continue;}
 replaced.push(id);if(full.entries[id])base.entries[id]=full.entries[id];else delete base.entries[id];}
for(const w of ways)if(OFFICIAL_IGNORE.has(String(w.id))&&inBox(w))assert(replaced.includes(String(w.id)),'左營站區的具名排除沒有被換進來 '+w.id);
base.incrementalSplice={baseCommit:sha,box,replacedWays:replaced,method:'完整重算後只換進左營站周邊實際有變的剖面；蘇澳 09-14 保留的高程解與遠處 0.001 公尺以下的數值雜訊不採用。換進的剖面另經完整高度、坡度、交會淨距與接縫閘門驗證。'};
fs.writeFileSync(file,JSON.stringify(base));
console.log(`左營站周邊剖面換進 ${replaced.length} 筆；框外有變但不採用 ${skipped} 筆。`);
