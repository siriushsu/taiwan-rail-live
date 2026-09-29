// 2026-09-25 裁示 A4（高出洞口 20 公尺的取樣要占整段 5% 以上才算山岳隧道）的層位檔可重現步驟：
// 完整重算之後，只把高雄（東經 120.25～120.42、北緯 22.50～22.80）與臺北（東經 121.40～121.70、
// 北緯 24.95～25.12）有經過的 way 真的有變的剖面換進改動前已驗證的層位檔，其餘 entries 逐筆保留。
// 全國因這條規則改判的只有高捷紅線 5 條 way 與臺北臺鐵地下化 67 條，其餘改動是交會淨距與平面地圖
// 全網求解的連動，實測都落在這兩個框裡。不整檔採用完整重算的理由同 splice_zuoying_flat_profiles_0925.mjs：
// 蘇澳 09-14 刻意保留的高程解，以及遠處的求解雜訊（這次是阿里山兩筆，最大 0.01 公尺：平面地圖的
// 迭代次數是全網一起算的，別處約束一變，阿里山獨立山那段就多跑或少跑幾輪）。
// 跑法：node scripts/build_rail_levels.mjs && BASE_REF=<改動前已驗證commit> node scripts/splice_mountain_share_profiles_0925.mjs
// 完成後仍必須跑 verify_rail_levels、verify_flat_rail_grade、verify_rail_grounding、verify_rail_structure_heights。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const ref=process.env.BASE_REF;assert(ref,'必須明確指定改動前已驗證的 BASE_REF');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sha=execFileSync('git',['-C',root,'rev-parse',ref],{encoding:'utf8'}).trim();
const file='rail-3d/physical/level-profiles.json';
const base=JSON.parse(execFileSync('git',['-C',root,'show',`${sha}:${file}`],{maxBuffer:64*1024*1024}));
const full=JSON.parse(fs.readFileSync(file));
assert.deepEqual(full.inputSha256,base.inputSha256,'輸入檔跟 BASE_REF 不同，不能只換高雄、臺北兩框');
const boxes=[[120.25,22.50,120.42,22.80],[121.40,24.95,121.70,25.12]];
const inBox=w=>w.coordinates.some(([x,y])=>boxes.some(b=>x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3]));
const ways=['network.json','metro-network.json'].flatMap(f=>JSON.parse(fs.readFileSync('rail-3d/physical/'+f)).ways);
// 數值陣列差超過 0.001 公尺才算變；其餘欄位（kind、boreKind…）要完全相同。
const differs=(a,b)=>{if(!a||!b)return !!(a||b);for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const u=a[k],v=b[k];
 if(Array.isArray(u)&&Array.isArray(v)&&u.length===v.length&&u.every(x=>typeof x==='number')){if(u.some((x,i)=>Math.abs(x-v[i])>.001))return true;}
 else if(JSON.stringify(u)!==JSON.stringify(v))return true;}return false;};
const replaced=[];let skipped=0;
for(const w of ways){const id=String(w.id);if(!differs(base.entries[id],full.entries[id]))continue;if(!inBox(w)){skipped++;continue;}
 replaced.push(id);if(full.entries[id])base.entries[id]=full.entries[id];else delete base.entries[id];}
// 隧道分類有變的每一條都必須在框內而且換進來；框外有一條改判，就代表規則的影響超出裁示範圍。
for(const w of ways){const id=String(w.id);if(base.entries[id]?.boreKind!==full.entries[id]?.boreKind)assert.fail('隧道分類改變卻沒有換進來 '+id);}
base.incrementalSplice={baseCommit:sha,boxes,replacedWays:replaced,method:'完整重算後只換進高雄、臺北兩框實際有變的剖面；蘇澳 09-14 保留的高程解與阿里山兩筆 0.01 公尺以下的求解雜訊不採用。換進的剖面另經完整高度、坡度、交會淨距與接縫閘門驗證。',previous:base.incrementalSplice};
fs.writeFileSync(file,JSON.stringify(base));
console.log(`高雄、臺北兩框剖面換進 ${replaced.length} 筆；框外有變但不採用 ${skipped} 筆。`);
