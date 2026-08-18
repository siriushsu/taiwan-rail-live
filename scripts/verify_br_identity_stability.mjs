#!/usr/bin/env node
// BR 身分穩定度:同一個 vehicleId 在相鄰兩輪之間不得「跳到另一台車上一輪的位置」。
// 這是 2026-08-18 使用者親自提出的判準:「跳動之後跟跳動之前,有本來不同的車調換位置的嗎?
// 比如前一輛車跳完剛好是後面一輛車的位置」——整批標籤位移的指紋。
// 對照組用「同一份程式碼、只把身分改寫那一段關掉」,一次只動一個變因(不用正式站當對照,
// 那會同時混進版本差異)。API 一律走正式站 ⇒ 兩組吃同一份即時資料。
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.argv.find(a => a.startsWith('http')) || 'https://railisland.tw/';
const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 8), GAP = 15;
const CUR = fs.readFileSync('index.html', 'utf8');
const FLAG = 'const TRTC_BR_FROM_COUNTDOWN = true;';
if (!CUR.includes(FLAG)) { console.log('❌ 找不到 TRTC_BR_FROM_COUNTDOWN 旗標,腳本與程式碼脫節'); process.exit(2); }
const OFF = CUR.replace(FLAG, 'const TRTC_BR_FROM_COUNTDOWN = false;');

async function run(html, label) {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.route(u => { const x = new globalThis.URL(u); return x.origin + x.pathname === new globalThis.URL(URL).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
  const snaps = [];
  for (let i = 0; i < N; i++) {
    snaps.push(await p.evaluate(() => {
      const vs = ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])
        .filter(v => String(v.line) === 'BR');
      return vs.map(v => ({ id: String(v.vehicleId), dir: Number(v.dir), from: Number(v.from), to: Number(v.to) }));
    }));
    if (i < N - 1) await p.waitForTimeout(GAP * 1000);
  }
  await b.close();
  let jumped = 0, onOther = 0, setKept = 0, setTotal = 0, samples = 0;
  for (let i = 1; i < snaps.length; i++) {
    const a = new Map(snaps[i - 1].map(v => [v.id, v]));
    const posOld = new Map();
    for (const v of snaps[i - 1]) { const k = `${v.dir}|${v.from}>${v.to}`;
      if (!posOld.has(k)) posOld.set(k, []); posOld.get(k).push(v.id); }
    for (const y of snaps[i]) {
      setTotal++; if (posOld.has(`${y.dir}|${y.from}>${y.to}`)) setKept++;
      const x = a.get(y.id); if (!x) continue;
      samples++;
      const step = x.dir === 2 ? 1 : -1;
      if ((y.to - x.to) * step >= 0) continue;
      jumped++;
      if ((posOld.get(`${y.dir}|${y.from}>${y.to}`) || []).some(o => o !== y.id)) onOther++;
    }
  }
  // 疊車：同線同向兩台的站序距離。用官方報的到站時刻換算連續位置。
  let minGap = Infinity, tight = 0, pairs = 0;
  for (const snap of snaps) for (const dir of [1, 2]) {
    const step = dir === 2 ? 1 : -1;
    const a = snap.filter(v => v.dir === dir).map(v => v.to * step).sort((x, y) => x - y);
    for (let i = 1; i < a.length; i++) { pairs++; const g = a[i] - a[i - 1];
      if (g < minGap) minGap = g; if (g < 0.35) tight++; }
  }
  return { label, jumped, onOther, setKept, setTotal, samples, errs, rounds: snaps.map(s => s.length),
    minGap: Number.isFinite(minGap) ? minGap : null, tight, pairs };
}

const off = await run(OFF, '對照組（走 CarWeightBR，＝現行正式站）');
const on = await run(CUR, '本次改動（車來自官方倒數）');
for (const r of [off, on]) {
  if (r.errs.length) console.log(`  ⚠️ ${r.label} pageerror：${r.errs.slice(0, 2).join(' | ')}`);
  console.log(`${r.label}：逐輪 BR ${r.rounds.join('→')} 台｜同 id 比對 ${r.samples} 台次｜` +
    `倒退 ${r.jumped}（其中 ${r.onOther} 次落在別台車上一輪的位置）｜` +
    `位置集合穩定 ${r.setTotal ? Math.round(r.setKept / r.setTotal * 100) : 0}%｜` +
    `相鄰兩車最小站序距離 ${r.minGap == null ? '-' : r.minGap.toFixed(2)}、<0.35 站序的 ${r.tight}/${r.pairs} 對`);
}
let fail = 0;
if (!off.samples || !on.samples) { console.log('❌ 分母為 0（沒抓到 BR 車），這一輪不構成證據'); process.exit(2); }
if (!off.onOther) { console.log('❌ 對照組沒有重現「跳到別台車舊位置」⇒ 這支測試對本次改動沒有鑑別力'); fail++; }
else console.log(`✅ 對照組有牙：重現了 ${off.onOther} 次整批標籤位移`);
if (on.onOther) { console.log(`❌ 改動後仍有 ${on.onOther} 次跳到別台車上一輪的位置`); fail++; }
else console.log('✅ 改動後：0 次跳到別台車上一輪的位置');
const setDrop = (off.setKept / off.setTotal) - (on.setKept / on.setTotal);
if (setDrop > 0.05) { console.log(`❌ 位置集合穩定度掉了 ${Math.round(setDrop * 100)} 個百分點 ⇒ 我們動到位置了,不只是名字`); fail++; }
else console.log(`✅ 位置集合穩定度沒有變差（差 ${Math.round(setDrop * 100)} 個百分點）⇒ 只動名字沒動位置`);
console.log(fail ? `\n❌ ${fail} 項未過` : '\n✅ 全部通過');
process.exit(fail ? 1 : 0);
