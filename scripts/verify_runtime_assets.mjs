import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function ignoredRuntimeAssets(rules,files){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rail-assets-gate-'));
 try{
  execFileSync('git',['init','-q',dir]);fs.writeFileSync(path.join(dir,'.gitignore'),rules);
  const r=spawnSync('git',['-c','core.excludesFile=/dev/null','check-ignore','--no-index','-z','--stdin'],{cwd:dir,input:files.join('\0')+'\0',encoding:'utf8'});
  if(![0,1].includes(r.status))throw Error(r.stderr||'無法判讀出貨排除規則');
  return r.stdout.split('\0').filter(Boolean);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
export function verifyRuntimeAssets(){
 const tracked=execFileSync('git',['ls-files','-z','--','rail-3d'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean),importedMjs=new Set();
 // 資產目錄也留有原型用的 path.mjs；只要求頁面／模組實際引用的 mjs 出貨。
 for(const file of ['index.html','rail-3d.js',...tracked.filter(f=>/\.(?:m?js)$/.test(f))]){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of source.matchAll(/(?:import\s*\(\s*|from\s*)['"](\.{1,2}\/[^'"]+\.mjs)['"]/g))importedMjs.add(path.relative(root,path.resolve(root,path.dirname(file),match[1])));
 }
 const files=tracked.filter(f=>/\.(?:js|css|json|gltf|glb|bin|gz|png|jpe?g|webp|ktx2?|wasm)$/.test(f)||importedMjs.has(f));
 if(files.length<100||!files.includes('rail-3d/environment/sun.mjs'))throw Error('runtime 資產清單不完整');
 for(const file of files)if(!fs.existsSync(path.join(root,file)))throw Error('runtime 缺檔：'+file);
 const rules=fs.readFileSync(path.join(root,'.assetsignore'),'utf8'),missing=ignoredRuntimeAssets(rules,files);
 if(missing.length)throw Error('runtime 被 .assetsignore 排除：'+missing.join('、'));
 // 反向對照：移除白名單，就必須抓到曾在正式站回 404 的日夜模組。
 const mutant=rules.replace(/^!rail-3d\/environment\/sun\.mjs\r?\n/m,'');
 if(!ignoredRuntimeAssets(mutant,files).includes('rail-3d/environment/sun.mjs'))throw Error('日夜模組排除規則的反向對照失效');
 console.log(`  ✓ ${files.length} 個 3D runtime 資產均可出貨；日夜模組排除反向對照通過`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))verifyRuntimeAssets();
