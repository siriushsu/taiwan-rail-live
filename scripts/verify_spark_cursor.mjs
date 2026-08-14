// 跟隨面板速度曲線的「游標對位」驗收（缺陷⑥）。
//
// 缺陷：曲線的 x 軸是純表定軸（t 從 t0 走到 t1），但取樣時卻用 t - liveDelaySec(tr) 去問位置；
// 而 drawSpark 的游標吃的是 effTLive(tr)，effTLive 自己已經扣過一次誤點。於是誤點 D 的車，
// 游標指到的那一格代表的是「表定時刻 - 2D」的速度。曲線還會被永久快取在 tr._spdProf 上，
// 所以錯多少取決於它是在誤點多少的時候被建起來的。
//
// 判準（非同源）：曲線第 i 格的值，必須等於「純表定軸上 t_i 到 t_i+30s 之間的實際位移換算速度」，
// 上限 speedCapOf。位移由 trainPosAt 直接算，不經 speedProfile 自己。
//
// 用法：PORT=6400 ROOT=<受測樹> node scripts/verify_spark_cursor.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 6400);
const req = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
const { chromium } = req('playwright');

const diskMd5 = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
const servedMd5 = createHash('md5').update(Buffer.from(
  await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
console.log(`G0 target=${ROOT}\n   disk=${diskMd5}\n   serve=${servedMd5}`);
if (diskMd5 !== servedMd5) { console.error('G0 FAIL：server 提供的不是目標樹的 index.html'); process.exit(1); }

const results = [];
const check = (n, pass, detail) => { results.push({ n, pass }); console.log(`${pass ? 'PASS ' : 'FAIL '} ${n} — ${detail}`); };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof state !== 'undefined' && state.trains && state.trains.some(t => t.sys === 'tra_sched' && t.stops && t.stops.length),
  null, { timeout: 180000 });

const r = await page.evaluate(() => {
  const cand = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 5 && !t.loop).slice(0, 12);
  const out = { checked: 0, bad: [], drift: [], delaySeen: 0 };

  // ── 不變量：曲線是「表定旅程的函式」,同一班車在零誤點與大誤點下必須逐值相同。
  //    這條最強、也最不看實作細節：曲線只要還跟誤點有關,它就會紅。
  const noDelay = new Map();
  state.live = { map: new Map(), at: Date.now(), delayed: 0, srcAt: '' };
  _easedShift.clear();
  for (const tr of cand) { tr._spdProf = null; noDelay.set(tr, speedProfile(tr).v.slice()); }

  const DELAY_MIN = 10;
  state.live = { map: new Map(cand.map(t => [String(t.train), DELAY_MIN])), at: Date.now(), delayed: cand.length, srcAt: '' };
  _easedShift.clear();
  for (const tr of cand) {
    const key = (tr.sys || 'tra_sched') + ':' + tr.train;
    _easedShift.set(key, { cur: DELAY_MIN * 60, at: performance.now(), sim: state.simSec, ep: _traGateEp.ep }); // 直接把偏移設到穩態
    out.delaySeen = Math.max(out.delaySeen, liveDelaySec(tr));
    tr._spdProf = null;
    const v = speedProfile(tr).v;
    const base = noDelay.get(tr);
    for (let i = 0; i < v.length; i++)
      if (Math.abs(v[i] - base[i]) > 1e-9) { out.drift.push({ train: String(tr.train), i, delayed: Math.round(v[i]), clean: Math.round(base[i]) }); break; }
  }
  out.driftN = out.drift.length; out.drift = out.drift.slice(0, 8); // 先記真數再截斷:截斷後的 length 是假的（心得 31）

  // ── 絕對值：曲線每一格＝純表定軸同一時刻的 30 秒有限差分（oracle 不呼叫 speedProfile）
  for (const tr of cand) {
    const { v, t0, t1 } = speedProfile(tr);
    for (let i = 0; i < v.length; i += 7) {
      const t = t0 + (t1 - t0) * i / (v.length - 1);
      const a = trainPosAt(tr, t), b = trainPosAt(tr, Math.min(t + 30, t1));
      const want = a && b ? Math.min(haversineKm(a, b) / 30 * 3600, speedCapOf(tr)) : 0;
      out.checked++;
      if (Math.abs(v[i] - want) > 1e-6) out.bad.push({ train: String(tr.train), i, got: Math.round(v[i]), want: Math.round(want) });
    }
  }
  out.badN = out.bad.length; out.bad = out.bad.slice(0, 8); // 同上
  return out;
});

check('A 曲線與誤點無關：同一班車在零誤點與 10 分鐘誤點下逐值相同',
  r.driftN === 0,
  r.driftN === 0 ? `${12} 班逐格比對全數相同`
    : `${r.driftN} 班的曲線隨誤點而變；例：${JSON.stringify(r.drift.slice(0, 3))}`);

check('B 曲線每一格＝純表定軸同一時刻的實際位移速度',
  r.badN === 0,
  r.badN === 0 ? `比對 ${r.checked} 格全數相符` : `比對 ${r.checked} 格，${r.badN} 格不符；例：${JSON.stringify(r.bad.slice(0, 3))}`);

check('C 分母閘門：受測車真的帶著誤點（否則 A/B 在零誤點下恆綠）',
  r.delaySeen > 60, `最大偏移 ${Math.round(r.delaySeen)} 秒`);

await browser.close();
const bad = results.filter(x => !x.pass).length;
console.log(`\n合計 ${results.length - bad} PASS / ${bad} FAIL`);
process.exit(bad ? 1 : 0);
