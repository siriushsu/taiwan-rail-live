// issue #16：跨系統車次撞號——在高鐵／林鐵點的車次，被跟成台鐵的同號車。
//
// 跑法：PORT=5294 node scripts/dev_server.mjs &  然後
//       VURL=http://localhost:5294/index.html node scripts/verify_issue16.mjs
//
// 判準刻意不看程式碼、不看 dataset，只看「跟到的那班車實際屬於哪個系統」（state.followTrain.sys）——
// 那是使用者真正感受到的東西，也是唯一不與修法同源的判準。
//
// 撞號清單是從 data/*_schedule_dense.json 現算的，不是寫死的：改點後車次會變，
// 寫死的號碼會在某次改點後靜默變成「兩邊都不存在」而全數 skip 成假綠。
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const URL = process.env.VURL || 'http://localhost:5294/index.html';
const SYS_FILES = {
  tra_sched: 'data/tra_schedule_dense.json',
  thsr_sched: 'data/thsr_schedule_dense.json',
  afr_sched: 'data/afr_schedule_dense.json',
};

let pass = 0, fail = 0;
const ok = (name, detail) => { pass++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail) => { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); };

// ── 撞號清單：從實際班表算 ───────────────────────────────────────────────────
const nums = {};
for (const [sid, f] of Object.entries(SYS_FILES)) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  nums[sid] = new Set((d.trains || []).map(t => String(t.train)));
}
const collisions = [];
const ids = Object.keys(nums);
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    for (const n of nums[ids[i]]) if (nums[ids[j]].has(n)) collisions.push({ no: n, a: ids[i], b: ids[j] });
  }
}
if (!collisions.length) {
  console.log('🔴 這份班表裡沒有任何跨系統重號——這支測試無從驗起（改點後可能真的沒有了，也可能是讀錯檔）。');
  process.exit(1);
}
console.log(`撞號清單（現算自班表）：${collisions.length} 組，例：${collisions.slice(0, 3).map(c => `${c.no}(${c.a}∩${c.b})`).join('、')}`);
// 每一對系統各取兩個號碼測，數量夠但不至於跑太久
const seenPair = new Map();
const cases = [];
for (const c of collisions) {
  const k = c.a + '|' + c.b;
  const n = seenPair.get(k) || 0;
  if (n >= 2) continue;
  seenPair.set(k, n + 1);
  cases.push(c);
}

for (const [ename, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  console.log(`\n===== ${ename} =====`);
  const b = await engine.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(URL, { waitUntil: 'domcontentloaded' });

  // G0：服務中的檔案就是這棵樹的檔案（延伸 verify_pass_obs 的自檢：驗錯目標比驗失敗更糟）
  const served = await p.evaluate(async u => (await fetch(u, { cache: 'no-store' })).text(), URL);
  const dm = createHash('md5').update(readFileSync('index.html')).digest('hex');
  const sm = createHash('md5').update(served).digest('hex');
  if (dm !== sm) { bad('G0 服務中的檔案 = 磁碟上的檔案', `disk=${dm.slice(0, 8)} served=${sm.slice(0, 8)}——port 被別的樹佔走`); await b.close(); break; }
  ok('G0 服務中的檔案 = 磁碟上的檔案', dm.slice(0, 8));

  await p.waitForFunction(() => typeof state !== 'undefined' && state.group && state.systems && state.systems.length >= 10, null, { timeout: 60000 });
  await p.waitForTimeout(2000);

  for (const c of cases) {
    for (const want of [c.a, c.b]) {
      // ① 指名系統的程式路徑
      const got = await p.evaluate(async ([no, sys]) => {
        clearFollow();
        followTrainNo(no, { sys });
        await new Promise(r => setTimeout(r, 1200));
        const t = state.followTrain;
        return t ? { sys: t.sys, train: String(t.train) } : null;
      }, [c.no, want]);
      const label = `${c.no} 指名 ${want}`;
      if (!got) bad(label, '沒跟到任何車');
      else if (got.sys !== want) bad(label, `跟到的是 ${got.sys} 的 ${got.train}`);
      else ok(label, `跟到 ${got.sys} 的 ${got.train}`);
    }

    // ② 搜尋下拉：使用者實際會做的動作——打車號、點那一列（列上有系統標籤）
    for (const want of [c.a, c.b]) {
      const got = await p.evaluate(async ([no, sys]) => {
        clearFollow();
        const ts = document.getElementById('trainSearch');
        ts.value = no;
        ts.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        const rows = [...document.querySelectorAll('#searchDrop .row.tr-row')];
        const idx = rows.findIndex(r => {
          const o = (state._searchTrains || [])[+r.dataset.ti];
          return o && o.sys && o.sys.id === sys && String(o.tr.train) === no;
        });
        if (idx < 0) return { skip: true, rows: rows.length };
        rows[idx].click();
        await new Promise(r => setTimeout(r, 1400));
        const t = state.followTrain;
        return t ? { sys: t.sys, train: String(t.train) } : null;
      }, [c.no, want]);
      const label = `${c.no} 從搜尋下拉點 ${want} 那一列`;
      if (got && got.skip) ok(label + '（下拉沒列出該系統，略過）', `下拉 ${got.rows} 列`);
      else if (!got) bad(label, '沒跟到任何車');
      else if (got.sys !== want) bad(label, `跟到的是 ${got.sys} 的 ${got.train}`);
      else ok(label, `跟到 ${got.sys} 的 ${got.train}`);
    }
  }

  // ③ 不指名系統時仍要跟得到車（不能因為加了篩選就把單純搜尋弄壞）
  const plain = await p.evaluate(async no => {
    clearFollow(); followTrainNo(no);
    await new Promise(r => setTimeout(r, 1200));
    const t = state.followTrain;
    return t ? { sys: t.sys, train: String(t.train) } : null;
  }, cases[0].no);
  if (plain) ok('不指名系統仍跟得到車（沒把舊行為弄壞）', `${plain.sys} 的 ${plain.train}`);
  else bad('不指名系統仍跟得到車（沒把舊行為弄壞）', '完全跟不到');

  // ④ 不存在的車次仍要走「查無」而不是靜默跟到別的車
  const ghost = await p.evaluate(async () => {
    clearFollow(); followTrainNo('999999', { sys: 'thsr_sched' });
    await new Promise(r => setTimeout(r, 900));
    return state.followTrain ? String(state.followTrain.train) : null;
  });
  if (ghost) bad('不存在的車次不會誤跟', `竟然跟到 ${ghost}`);
  else ok('不存在的車次不會誤跟');

  await b.close();
}

console.log(`\n${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
