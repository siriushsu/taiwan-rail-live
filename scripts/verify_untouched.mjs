// issue #17 的安全邊界閘門（設計 §4 那張表）：夾持回撥只准進 trainPos 一個入口。
// 凡走「純表定時間軸」的東西——停靠時刻、effT／effTLive（完乘蓋章、停靠倒數、下一站、
// 行程分享、本地提醒都掛在上面）、整趟速度曲線——都必須與改動前**逐點相同**。
//
// 基準是「改動前的版本」另起一個 server，不是拿改動後的自己比（心得 23）。
// 取樣刻意壓在容易改壞的分支切換點：每個停站的 arrSec/depSec 前後 1 秒、跨午夜邊界、
// 以及夾持最兇的那段時間（正午前後，誤點快照裡誤點最多）。
//
// 跑法：A_PORT=<改動後> B_PORT=<改動前> node scripts/verify_untouched.mjs
//   可選 LIVE=<誤點快照 json>（兩邊注入同一份，否則比的是兩組不同輸入）

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire('/Users/xuxiang/Code/捷運小動畫/package.json');
const { chromium } = require('playwright');

const A = process.env.A_PORT || 5361;     // 改動後
const B = process.env.B_PORT || 5362;     // 改動前
const LIVE_FILE = process.env.LIVE || path.join(HERE, 'fixtures/tra_live_fixture.json');
const live = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
const delays = {};
for (const t of live.trains || []) if (t.delay > 0) delays[String(t.no)] = t.delay;

async function sample(port) {
  const b = await chromium.launch();
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof state !== "undefined" && state.trains && state.trains.length > 300', null, { timeout: 180000 });
  const r = await page.evaluate(({ delays }) => {
    state.live = { map: new Map(Object.entries(delays)), at: Date.now(), delayed: Object.keys(delays).length, srcAt: '' };
    nowSecOfDay = () => state.simSec;
    state.playing = false;
    const h = (acc, v) => { const s = String(v); let x = acc; for (let i = 0; i < s.length; i++) x = (Math.imul(x, 31) + s.charCodeAt(i)) | 0; return x; };
    const out = { stops: [], eff: [], spd: [], n: 0 };
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched') continue;
      out.n++;
      // ① 停靠時刻：全程唯讀，一個 bit 都不該變
      let a = 7;
      for (const st of tr.stops) a = h(h(h(a, st.name), st.arrSec), st.depSec);
      out.stops.push(tr.train + ':' + a);
      // ② effT / effTLive：分支切換點各取樣一次
      let e = 7;
      const s = tr.stops, T = [];
      for (const st of s) T.push(st.arrSec - 1, st.arrSec, st.depSec, st.depSec + 1);
      T.push(s[0].arrSec - 60, s[s.length - 1].depSec + 60, 0, 43200, 86399);
      for (const t of T) {
        state.simSec = t;
        if (typeof updateBlockHolds === 'function') updateBlockHolds();   // 夾持真的在跑的狀態下取樣
        e = h(h(e, effT(tr)), effTLive(tr));
      }
      out.eff.push(tr.train + ':' + e);
      // ③ 整趟速度曲線：一次暫時的阻擋不得被烤進快取
      state.simSec = 43200;
      if (typeof updateBlockHolds === 'function') updateBlockHolds();
      tr._spdProf = null;
      const p = speedProfile(tr);
      out.spd.push(tr.train + ':' + p.v.map(x => x.toFixed(3)).join(','));
    }
    return out;
  }, { delays });
  await b.close();
  return { r, errs };
}

const [a, bb] = await Promise.all([sample(A), sample(B)]);
console.log(`改動後 ${a.r.n} 班 / 改動前 ${bb.r.n} 班`);
if (a.errs.length) console.log('改動後有 pageerror：', a.errs.slice(0, 3));
if (bb.errs.length) console.log('改動前有 pageerror：', bb.errs.slice(0, 3));

let fail = 0;
const cmp = (name, x, y, what) => {
  if (x.length !== y.length) { console.log(`FAIL  ${name} — 班次數不同 ${x.length} vs ${y.length}`); fail++; return; }
  const bad = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) bad.push(x[i].split(':')[0]);
  if (bad.length) { console.log(`FAIL  ${name} — ${bad.length} 班不同：${bad.slice(0, 8).join(' ')}`); fail++; }
  else console.log(`PASS  ${name} — ${x.length} 班逐點相同（${what}）`);
};
cmp('T5a 停靠時刻未被動到', a.r.stops, bb.r.stops, '每站 name/arrSec/depSec');
cmp('T5b effT／effTLive 未被動到', a.r.eff, bb.r.eff, '每站 4 個切換點＋首尾＋0/43200/86399');
cmp('T5c 整趟速度曲線未被烤進阻擋', a.r.spd, bb.r.spd, '140 點速度曲線，於夾持進行中重算');

console.log(fail ? `\n合計 ${3 - fail} PASS / ${fail} FAIL` : `\n合計 3 PASS / 0 FAIL`);
process.exit(fail || a.errs.length || bb.errs.length ? 1 : 0);
