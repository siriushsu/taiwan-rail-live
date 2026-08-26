// 出貨回歸閘門：這一顆有沒有把「上一顆已經上架的東西」弄不見。
//
// 為什麼需要它（2026-08-23 的事故）：
//   63e38b2 那顆合併把 index.html **整檔取 main 那一側**（它的 index.html 與父 3963cb7 逐 byte
//   相同）。凡是「只活在 App 線、沒併進 main」的東西當場全部消失，而且**沒有任何一道閘門會紅**：
//   build 成功、archive 成功、既有 88 支 verify 大多不碰那些區域。使用者是在 1.4.9 上架**之後**
//   才發現跟車鎖屏的通行證入口、衛星高解析提示、說明中心的捷運小工具與等車卡兩節、
//   前景持續定位、以及 11 條更新紀錄全都不見了——1.4.8 (68) 明明有。
//   當時真正紅著的兩支（verify_plus_ctas、verify_boot_geo）從 08-22 起就一路紅，但它們不在
//   出貨鏈上，沒有人會在出 build 的時候跑到。
//
// 這支就是要把「不能靜默變少」變成一條會擋下 build 的斷言。判準刻意選**識別字**而不是行內容：
//   行會被重排、改寫、搬檔（MetroWidgetCatalog 就從 MetroBoardIntent.swift 搬到 MetroWidgetShared.swift），
//   逐行比對會噴一堆假陽性；而「這個函式還在不在」「這顆元素 id 還在不在」對搬家免疫。
//
// 用法：
//   node app/scripts/verify_no_ship_regression.mjs              # 對 app/www/index.html 驗（出貨產物）
//   node app/scripts/verify_no_ship_regression.mjs --cand <檔>   # 指定候選 index.html
//   node app/scripts/verify_no_ship_regression.mjs --update --from <index.html> --marketing X --build N
//        ↑ **只有在那一顆真的上傳成功之後**才可以跑，把基線推進到那一顆。
//
// 退出碼：0＝沒有東西變少；1＝有東西不見了（訊息會逐項列出）；2＝基線讀不到／參數錯。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, '..');
const REPO_ROOT = join(APP_ROOT, '..');
const BASELINE = join(APP_ROOT, 'shipped-baseline.json');

// ── 七類識別字。每一類都對映到 08-23 那次真的丟掉過的東西，不是憑空想的維度 ──────────
export function inventory(html) {
  const uniq = a => [...new Set(a)].sort();
  const all = (re, g = 1) => { const o = []; let m; const r = new RegExp(re, 'g'); while ((m = r.exec(html))) o.push(m[g]); return o; };
  return {
    // ① 函式：renderLaCta／maybeSatPlusNotice／startForegroundGeoWatch… 那一批就是這樣沒的
    functions: uniq(all(String.raw`\bfunction\s+([A-Za-z_$][\w$]{2,})\s*\(`)),
    // ② 元素 id：#fpLaCta（入口的掛載點）
    elementIds: uniq(all(String.raw`\bid="([A-Za-z][\w-]{2,})"`)),
    // ③ 更新紀錄正本：11 條就是這樣沒的
    changelog: uniq(all(String.raw`data-cl="([a-z0-9_-]+)"`)),
    // ④ 使用說明中心的節：metrowidget／metrowait 兩整節就是這樣沒的
    helpKeys: uniq(all(String.raw`\{\s*key:\s*'([a-z0-9-]+)',\s*ic:`)),
    // ⑤ 方案面板的功能清單：「捷運小工具放多站」那一項就是這樣沒的
    plusFeats: uniq((html.match(/const feats = \[[\s\S]*?\]\.map/) || [''])[0]
      .split('\n').map(l => (l.match(/^\s*'(.+)',\s*$/) || [])[1]).filter(Boolean)),
    // ⑥ 平台旗標與付費閘門的常數名（被整檔取代時會一起消失）
    gates: uniq(all(String.raw`\bconst\s+([A-Z][A-Z0-9_]{4,})\s*=`)),
    // ⑦ 深連結／URL 參數契約（?geoseq= 那類；掉了會讓驗收器與分享連結一起失效）
    urlParams: uniq(all(String.raw`\b(?:searchParams\.get|qs\.get|params\.get)\(['"]([a-z0-9_]+)['"]\)`)),
  };
}

const LABEL = {
  functions: '函式', elementIds: '元素 id', changelog: '更新紀錄條目',
  helpKeys: '使用說明中心的節', plusFeats: '方案面板功能項', gates: '旗標／閘門常數', urlParams: 'URL 參數契約',
};

function loadBaseline() {
  if (!existsSync(BASELINE)) {
    console.error(`✋ 讀不到出貨基線 ${BASELINE}。`);
    console.error('   第一次建立：node app/scripts/verify_no_ship_regression.mjs --update --from <已上架那顆的 index.html> --marketing 1.4.9 --build 75');
    process.exit(2);
  }
  return JSON.parse(readFileSync(BASELINE, 'utf8'));
}

export function compare(baseInv, candInv, allow = {}) {
  const missing = {};
  for (const k of Object.keys(baseInv)) {
    const skip = new Set(allow[k] || []);
    const gone = (baseInv[k] || []).filter(x => !(candInv[k] || []).includes(x) && !skip.has(x));
    if (gone.length) missing[k] = gone;
  }
  return missing;
}

function main() {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

  if (argv.includes('--update')) {
    // --from 可給多個（逗號分隔）：基線是**所有還在使用者手上的 build 的聯集**，不是只有最新那顆。
    // 08-23 的事故正是「68 有、75 沒有」——只拿 75 當基線的話，那次損失連被發現的機會都沒有。
    const froms = (arg('--from') || join(APP_ROOT, 'www', 'index.html')).split(',').map(s => resolve(s.trim()));
    const marketing = arg('--marketing'), build = arg('--build');
    if (!marketing || !build) { console.error('✋ --update 必須同時給 --marketing 與 --build（那一顆真的上傳成功的版號）'); process.exit(2); }
    const invs = froms.map(f => inventory(readFileSync(f, 'utf8')));
    const inv = {};
    for (const k of Object.keys(invs[0])) inv[k] = [...new Set(invs.flatMap(x => x[k]))].sort();
    writeFileSync(BASELINE, JSON.stringify({
      _why: '這是【所有還在使用者手上的 build】的可見面聯集。verify_no_ship_regression 用它擋「新 build 悄悄變少」。只有在新的一顆上傳成功之後才准推進。',
      marketing, build, from: froms.map(f => f.replace(REPO_ROOT, '<repo>')),
      updatedAt: new Date().toISOString(), inventory: inv,
    }, null, 2) + '\n');
    console.log(`✅ 出貨基線推進到 ${marketing} (${build})：` +
      Object.entries(inv).map(([k, v]) => `${LABEL[k]} ${v.length}`).join('、'));
    return;
  }

  const candPath = resolve(arg('--cand') || join(APP_ROOT, 'www', 'index.html'));
  if (!existsSync(candPath)) { console.error(`✋ 候選檔不存在：${candPath}`); process.exit(2); }
  const base = loadBaseline();
  const cand = inventory(readFileSync(candPath, 'utf8'));

  // G0 自檢（judgment 心得 32）：先印出「我到底在比哪兩個東西」，比錯目標要看得出來。
  const label = base.covers || `${base.marketing} (${base.build})`;
  console.log(`[出貨回歸閘門] 基線＝已上架的 ${label}，候選＝${candPath.replace(REPO_ROOT, '<repo>')}`);

  const missing = compare(base.inventory, cand, base.allowRemoved || {});
  const total = Object.values(missing).reduce((n, a) => n + a.length, 0);
  if (!total) {
    console.log('✅ 沒有任何一項比上一顆已上架的少' +
      `（比對 ${Object.values(base.inventory).reduce((n, a) => n + a.length, 0)} 個識別字）`);
    return;
  }
  console.error(`\n✋ 這一顆比已上架的 ${label} 少了 ${total} 項——除非是刻意移除，否則就是又被合併吃掉了：\n`);
  for (const [k, v] of Object.entries(missing)) {
    console.error(`  ${LABEL[k]}（${v.length}）：${v.join('、')}`);
  }
  console.error(`
  怎麼處理（三選一，不准直接改基線）：
  1. 真的是被吃掉了 → 找出那顆合併／改動，把內容補回來，再跑一次。
  2. 是搬家或改名 → 補在新位置後這裡自然會綠；若識別字真的改名，把舊名寫進
     ${BASELINE.replace(REPO_ROOT, '<repo>')} 的 allowRemoved.<類別>，並在 commit message 說明為什麼。
  3. 是刻意下架的功能 → 同上寫進 allowRemoved，並確認更新紀錄與說明中心也一起處理了。
`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
