// 北捷模型載入器的守門人(2026-09-23 事故)。
//
// 事故:正式站每分鐘的 cron 從 21:44 起反覆整發卡死——每發都跑滿 15 分鐘牆鐘上限被 Cloudflare 以
// exceededWallTime 砍掉(cpuTime 只有 0.1 秒)。卡住的那幾發裡,捷運等車卡那一輪走完 trtcLive 的官方名冊
// 之後就沒下文,北捷帳本與綁定器一行都沒印;台鐵等站卡照常。兩條路共同的下一步是 trtcLedgerModel()。
// 當時它把【進行中的 promise】存在模組層全域:promise 背後的 env.ASSETS.fetch 屬於發起它的那個 request,
// 那個 request 被取消時 I/O 跟著被取消、promise 永遠不 resolve,之後同一個 isolate 裡每個 await 它的人
// (cron 帳本、等車卡、訪客的 trtcLive)都一起卡死,帳本漏寫到那個 isolate 被換掉為止。
//
// 這支量的性質:同一個 isolate 裡「前一個 request 的載入永遠不回來」時,另一個 request 仍拿得到結果;
// 而且載好之後會寫回快取,之後的 request 不再碰 I/O(不然冷啟動以外每個請求都要重讀 1.1 MB 的班表)。
// 「永遠不回來」用永不 resolve 的 ASSETS.fetch 模擬——那正是被取消的 I/O 在 await 它的人眼裡的樣子。
//
// 跑法:node scripts/verify_trtc_model_memo.mjs(不需要伺服器、不打任何上游)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _trtcLedger: api } = await import('../worker.js');

const LOADERS = ['trtcLedgerModel', 'trtcBoardModel', 'trtcDayTypeTable'];
let fetches = 0;
const stuckEnv = { ASSETS: { fetch: () => { fetches++; return new Promise(() => {}); } } };
const okEnv = {
  ASSETS: {
    fetch: req => {
      fetches++;
      const rel = new URL(req.url).pathname.replace(/^\//, '');
      return Promise.resolve(new Response(fs.readFileSync(path.join(ROOT, rel)),
        { headers: { 'content-type': 'application/json' } }));
    },
  },
};

// 限時等一個 promise;逾時回 { ok:false }。計時器一定清掉,免得行程多掛幾秒才結束。
function within(promise, ms) {
  let timer;
  return Promise.race([
    promise.then(v => ({ ok: true, v }), e => ({ ok: false, err: e })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, timeout: true }), ms); }),
  ]).finally(() => clearTimeout(timer));
}

let failed = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
}

for (const name of LOADERS) {
  check(`${name} 有導出給測試`, typeof api[name] === 'function');
  if (typeof api[name] !== 'function') continue;

  // (1) 先讓一個「會被取消的 request」開始載入:它的 I/O 永遠不回來。不 await 它。
  api[name](stuckEnv);

  // (2) 同一個 isolate 裡另一個 request 來要——必須在時限內拿到真的結果,不可以陪著卡住。
  const second = await within(api[name](okEnv), 5000);
  check(`${name}:前一個 request 的載入卡住時,另一個 request 仍在 5 秒內拿到結果`,
    second.ok && second.v != null,
    second.ok ? '' : (second.timeout ? '逾時(被前一個 request 的 promise 拖住)' : String(second.err)));

  // (3) 載好之後要寫回快取:下一個 request 就算 I/O 也會卡,仍直接拿到同一份,不再碰 I/O。
  //     反向對照:(2) 沒拿到東西時這條必紅,不會空過。
  const before = fetches;
  const third = await within(api[name](stuckEnv), 1000);
  check(`${name}:載好之後寫回快取,之後的 request 不再碰 I/O`,
    third.ok && second.ok && third.v === second.v && fetches === before,
    `fetches +${fetches - before}`);
}

// 正向對照:okEnv 真的讀得到三個資產,且模型長得像模型——不然 (2) 可能是拿到一個空殼也算過。
const model = await within(api.trtcBoardModel(okEnv), 5000);
check('對照:模型含北捷各線(lines 是非空 Map)',
  model.ok && model.v && model.v.lines instanceof Map && model.v.lines.size > 0,
  model.ok && model.v && model.v.lines ? `lines=${model.v.lines.size}` : '');

console.log(failed ? `\n${failed} 項未過` : '\n全部通過');
process.exit(failed ? 1 : 0);
