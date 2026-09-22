// 只用於本次尚未上線的封存產物；不可加入每日資料更新流程。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir=path.resolve(import.meta.dirname,'../memories/tainan-2026-09-12');
if(!process.argv.includes('--seal-reviewed-snapshot'))throw Error('請先完成模型及班表驗收，再明確使用 --seal-reviewed-snapshot。');
const files={};function visit(p){for(const item of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,item.name);if(item.isDirectory())visit(f);else if(item.name!=='integrity.json')files[path.relative(dir,f)]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}}
visit(dir);fs.writeFileSync(path.join(dir,'integrity.json'),JSON.stringify({schema:1,date:'2026-09-12',files},null,2)+'\n');console.log('封存雜湊：'+Object.keys(files).length+' 檔');
