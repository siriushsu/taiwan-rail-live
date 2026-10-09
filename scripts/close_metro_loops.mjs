// 從現有股道包補齊閉環；也由 pack_metro_physical_network 自動執行，重建時不會再漏段。
import fs from 'node:fs';
import {closeMetroLoops,metroLoopLines} from './lib/close_metro_loops.mjs';
const root=new URL('../',import.meta.url),file=new URL('rail-3d/physical/metro-network.json',root),pack=JSON.parse(fs.readFileSync(file));
const report=closeMetroLoops(pack,metroLoopLines(pack,root));
if(report.length)fs.writeFileSync(file,JSON.stringify(pack));
console.log(JSON.stringify(report));
