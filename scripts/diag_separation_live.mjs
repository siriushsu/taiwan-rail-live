#!/usr/bin/env node
// 正式站此刻：同線同向相鄰兩台車的實際間距，以及最小間距守則有沒有生效／為什麼沒夾動。
//
// 分辨三種可能（三者修法完全不同）：
//   A 守則沒生效（floor 讀錯、函式沒被呼叫）→ 間距 < 門檻且 floor 明顯不是上一格的值
//   B 守則生效但被 floor 頂住（設計如此：凍後車、等前車自己走開，不把後車往回拉）
//   C 量測假象（掃描在 zoom 11 每像素 69m，門檻 100m 只有 1.45 像素）
// 用法：node scripts/diag_separation_live.mjs [url] [輪數] [間隔秒]
import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://railisland.tw/';
const ROUNDS = Number(process.argv[3] || 1);
const GAP = Number(process.argv[4] || 20);

const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('  ⚠️ pageerror:', String(e).slice(0, 160)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
});
await p.waitForTimeout(3000);

for (let r = 0; r < ROUNDS; r++) {
  if (r) await new Promise(s => setTimeout(s, GAP * 1000));
  const out = await p.evaluate(() => {
    const now = Date.now() / 1000;
    const lines = (state.lines || []).concat(state.decoLines || []);
    const rows = [], straight = [];
    for (const ln of lines) {
      const items = typeof trtcOfficialItemsForLine === 'function'
        ? trtcOfficialItemsForLine(ln, now) : null;
      if (!items || items.length < 2) continue;
      for (const dir of [1, 2]) {
        const g = items.filter(it => Number(it.vehicle && it.vehicle.dir) === dir)
          .map(it => ({ id: it.vehicleId,
            p: trtcOfficialPositionProgress(ln, it.vehicle, it.pos),
            floor: it.floor, from: it.vehicle.from, to: it.vehicle.to,
            posLL: { lat: it.pos.lat, lon: it.pos.lon } }))
          .filter(x => Number.isFinite(x.p)).sort((a, c) => c.p - a.p);
        for (let i = 1; i < g.length; i++) {
          const lead = g[i - 1], back = g[i];
          const step = dir === 2 ? 1 : -1;
          const need = trtcGapUnitsAt(ln, back.p, step);   // 100 公尺換算成站序單位
          const gap = lead.p - back.p;
          // 🔴 同時量「直線距離」：守則管的是沿線里程，巡檢量的是直線，兩者在彎道會不一致。
          // 只看其中一個分不出「守則沒生效」與「彎道上兩點靠得近但沿線其實夠遠」。
          const A = lead.posLL, B = back.posLL;
          const R = 6371000, rad = x => x * Math.PI / 180;
          const dLat = rad(B.lat - A.lat), dLon = rad(B.lon - A.lon);
          const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(A.lat)) * Math.cos(rad(B.lat)) * Math.sin(dLon / 2) ** 2;
          const straightM = Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
          if (straightM < 100) straight.push({ line: ln.id, dir,
            lead: lead.id.split(':').pop(), back: back.id.split(':').pop(), straightM,
            alongM: need > 0 ? Math.round(gap * (100 / need)) : null,
            seg: `${lead.from}>${lead.to} vs ${back.from}>${back.to}` });
          if (!(need > 0) || gap >= need - 1e-9) continue;  // 沿線里程夠就不列進 A/B 判定
          // 這個區間 1 站序單位 = 幾公尺
          const perUnit = need > 0 ? 100 / need : NaN;
          rows.push({ line: ln.id, dir, lead: lead.id.split(':').pop(), back: back.id.split(':').pop(),
            gapM: Math.round(gap * perUnit), needM: 100,
            backP: +back.p.toFixed(4), leadP: +lead.p.toFixed(4),
            floor: Number.isFinite(back.floor) ? +Number(back.floor).toFixed(4) : String(back.floor),
            // 守則會把後車夾到 allowed；夾不動的唯一原因是 floor 已經頂在那裡
            allowed: +(lead.p - need).toFixed(4),
            blockedByFloor: Number.isFinite(back.floor) && Number(back.floor) > lead.p - need + 1e-9,
            seg: `${back.from}>${back.to}` });
        }
      }
    }
    return { rows, straight, mode: (state.trtcOfficialRoster || {}).feedMode,
      n: ((state.trtcOfficialRoster || {}).vehicles || []).length };
  });
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}] 名冊 ${out.n} 台(${out.mode})｜沿線里程不足：${out.rows.length} 對｜直線 <100m：${out.straight.length} 對`);
  for (const x of out.straight) console.log(`   〔直線近〕${x.line}|dir${x.dir} ${x.lead}↔${x.back} 直線 ${x.straightM}m／沿線 ${x.alongM}m　${x.seg}` +
    (x.alongM != null && x.alongM >= 100 ? '　⇒ C：彎道假象(沿線夠遠)' : '　⇒ 沿線也不足,見下'));
  for (const x of out.rows) {
    console.log(`   ${x.line}|dir${x.dir} ${x.lead}↔${x.back} 相距 ${x.gapM}m(需 ${x.needM}m) 區間${x.seg}`);
    console.log(`      後車 p=${x.backP} 前車 p=${x.leadP} 應夾到 ${x.allowed} 上一格底線 ${x.floor}` +
      `　⇒ ${x.blockedByFloor ? 'B：被底線頂住(設計:凍後車等前車走開,不往回拉)' : '🔴 A：守則沒把它夾住,要查'}`);
  }
}
await b.close();
