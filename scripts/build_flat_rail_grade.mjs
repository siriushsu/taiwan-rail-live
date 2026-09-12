import fs from 'node:fs';
import {makePath} from '../rail-3d/integration/train-path.js';
import {applyFlatRailGrade,FLAT_BASIS} from './lib/flat_rail_grade.mjs';
import {collectLevelCrossings} from './lib/rail_level_crossings.mjs';
const dir='rail-3d/physical/',file=dir+'level-profiles.json',levels=JSON.parse(fs.readFileSync(file)),records=[];
for(const f of ['network.json','metro-network.json'])for(const w of JSON.parse(fs.readFileSync(dir+f)).ways)records.push({w,path:makePath(w.coordinates),c:levels.entries[w.id]});
levels.flatBasis=FLAT_BASIS;
levels.flatSolver=applyFlatRailGrade(records,levels.entries,collectLevelCrossings(records));
fs.writeFileSync(file,JSON.stringify(levels));console.log(levels.flatSolver);
