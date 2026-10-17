// 只用於尚未上線的封存產物；不可加入每日資料更新流程。
// 用法：node scripts/seal_tainan_memory.mjs [--date YYYY-MM-DD] (--seal-reviewed-snapshot | --check)
//   沒帶 --date 時是 2026-09-12。--check 重算雜湊並與既有 integrity.json 比對，不寫檔；已上線的封存只准 --check。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {configFor,dateFromArgv} from './tainan_memory_config.mjs';
const cfg=configFor(dateFromArgv()),dir=cfg.outDir,CHECK=process.argv.includes('--check');
if(!CHECK&&!process.argv.includes('--seal-reviewed-snapshot'))throw Error('請先完成模型及班表驗收，再明確使用 --seal-reviewed-snapshot。');
if(!CHECK&&cfg.sealed)throw Error(cfg.date+' 已封存上線：只能用 --check 比對，不重寫 integrity.json。');
const files={};function visit(p){for(const item of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,item.name);if(item.isDirectory())visit(f);else if(item.name!=='integrity.json'){const gz=f.endsWith('.bin.gz');files[path.relative(dir,gz?f.slice(0,-3):f)]=crypto.createHash('sha256').update(gz?zlib.gunzipSync(fs.readFileSync(f)):fs.readFileSync(f)).digest('hex');}}}
visit(dir);
const file=path.join(dir,'integrity.json');
if(CHECK){
 if(!fs.existsSync(file))throw Error(cfg.date+' 還沒有 integrity.json');
 const now=JSON.parse(fs.readFileSync(file,'utf8')),keys=Object.keys(files).sort();
 const same=now.schema===1&&now.date===cfg.date&&JSON.stringify(Object.keys(now.files).sort())===JSON.stringify(keys)&&keys.every(k=>now.files[k]===files[k]);
 if(!same)throw Error('重算的雜湊與 '+path.relative(cfg.root,file)+' 不同：'+keys.filter(k=>now.files[k]!==files[k]).concat(Object.keys(now.files).filter(k=>!(k in files))).join('、'));
 console.log('封存雜湊比對一致：'+keys.length+' 檔（未寫檔）');
}else{
 fs.writeFileSync(file,JSON.stringify({schema:1,date:cfg.date,files},null,2)+'\n');console.log('封存雜湊：'+Object.keys(files).length+' 檔');
}
