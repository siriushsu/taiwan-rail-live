#!/usr/bin/env node
// 資格降級的機械稽核:每一處寫入 plus 資格之後,都必須呼叫 musicReconcileMode()。
//
// 🔴 判準寫「怎麼排」不寫「有幾個」——寫入點會隨訂閱管線改動而增減,寫死行號或個數的斷言
//    下次重構就過期,而且過期的方式是【靜默放行】。所以這裡掃的是結構關係,不是位置。
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = readFileSync(join(ROOT, 'index.html'), 'utf8').split('\n');
const WINDOW = 8;                      // 賦值之後幾行內要看到 reconcile

// 註解行不算寫入點:12058 附近有一段註解在講「await 之後的 p.active = ... 會怎樣」,
// 把它算進來會變成「要求在註解後面加呼叫」。
const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);
const writes = [];
SRC.forEach((line, i) => {
  if (isComment(line)) return;
  if (/(^|[\s;{(])(p|state\.plus)\.active\s*=\s*[^=]/.test(line)) writes.push(i);
});

const fails = [], ok = [];
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] 掃到 ${writes.length} 個 plus 資格寫入點:行 ${writes.map(i => i + 1).join(', ')}`);
if (writes.length < 5) {
  console.error(`❌ [G0] 只掃到 ${writes.length} 個寫入點,遠少於已知的 7 個——正規表示式失效,`
    + `此時「每個寫入點都合格」會變成真空為真。`);
  process.exit(1);
}

for (const i of writes) {
  const near = SRC.slice(i, i + WINDOW + 1).join('\n');
  const has = near.includes('musicReconcileMode()');
  (has ? ok : fails).push(`${has ? '✅' : '❌'} 行 ${i + 1} 的資格寫入後 ${WINDOW} 行內有 musicReconcileMode()`
    + (has ? '' : `\n      ${SRC[i].trim().slice(0, 110)}`));
}

// 反向:函式本身要存在,且真的做事(不是空殼)
const src = SRC.join('\n');
const m = src.match(/function musicReconcileMode\(\)\s*\{([\s\S]*?)\n\}/);
const body = m ? m[1] : '';
const need = [['musicEffectiveMode', '真的讀生效模式'], ['musicApplyMode', '真的重建播放清單'],
  ['showToast', '降級時有告知使用者(設計書 §6:退回免費要 toast 一次)']];
for (const [frag, why] of need) {
  const has = body.includes(frag);
  (has ? ok : fails).push(`${has ? '✅' : '❌'} musicReconcileMode ${why}`);
}
// 反向:不得每次都重建(開機期 plusApplyCustomerInfo 會跑,每次重洗會把正在播的曲子切掉)
const guarded = /_effKey/.test(body);
(guarded ? ok : fails).push(`${guarded ? '✅' : '❌'} musicReconcileMode 只在生效模式真的變了時才動作`);

for (const l of [...ok, ...fails]) console.log(l);
console.log(`\n總計 ${ok.length + fails.length} 項,PASS ${ok.length},FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
