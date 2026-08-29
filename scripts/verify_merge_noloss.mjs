#!/usr/bin/env node
// 合併零遺失證明 —— 拿七類識別字對「合併結果 vs 兩個父」做三方比對。
//
// 為什麼需要這支：git 對 index.html 這種單檔巨獸的衝突，最容易的解法是「整檔取單邊」
// （`--ours` / `--theirs` / 編輯器一鍵套用），而那**不會留下任何衝突標記，也不會讓任何
// 既有閘門轉紅**——2026-08-23 的 63e38b2 就是這樣把 18 項功能靜默刪掉，1.4.9 照樣上架，
// 全鏈全綠（見記憶 ship-regression-evil-merge）。逐行比對在這種檔案上沒有可讀性，
// 所以這支改判「識別字有沒有活下來」。
//
// 判準（刻意不逐行）：某識別字必須留在結果裡，除非「擁有它的那一側自己刪掉了它」。
//   required = (mine ∩ theirs) ∪ (mine \ base) ∪ (theirs \ base)
//   base 裡被單邊刻意刪掉的 → 合法消失，不算遺失（但會印出來讓你看見）。
//
// 用法：
//   # 併到一半、衝突都解完還沒 commit 時（最常用；theirs 自動讀 MERGE_HEAD）
//   node scripts/verify_merge_noloss.mjs
//   # 指定對方 ref（沒有 MERGE_HEAD 時，例如已經 commit 完想回頭驗）
//   node scripts/verify_merge_noloss.mjs origin/main
//   # 驗一顆已經做好的 merge commit（mine=該 commit 的第一父、theirs=第二父）
//   node scripts/verify_merge_noloss.mjs --commit <merge-sha>
//
// 🔴 這支自己也要有牙：2026-08-29 用兩次控制組驗過——把結果換成「整檔取我這側」
//    抓到 90 個函式遺失，換成「整檔取對方」抓到 37 個。**改動這支之後要重跑一次控制組**
//    控制組怎麼跑（第三個參數把結果換成單邊）：
//      node scripts/verify_merge_noloss.mjs --commit 55062e7 55062e7^1   # 整檔取我這側 → 應該紅
//      node scripts/verify_merge_noloss.mjs --commit 55062e7 55062e7^2   # 整檔取對方   → 應該紅
//    兩發都紅才代表它還有牙；只跑正向那發等於沒驗。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// 只驗這一個檔：風險集中在單檔巨獸，其餘檔案的整檔取單邊肉眼看 diff 就抓得到。
const FILE = 'index.html';

const git = (...a) => execFileSync('git', a, { maxBuffer: 1 << 30 }).toString().trim();
const showFile = ref => execFileSync('git', ['show', `${ref}:${FILE}`], { maxBuffer: 1 << 30 }).toString();

function inventory(html) {
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

const argv = process.argv.slice(2);
let mine, theirs, resultHtml, resultLabel;
if (argv[0] === '--commit') {
  const c = argv[1];
  if (!c) { console.error('用法：--commit <merge-sha>'); process.exit(2); }
  mine = git('rev-parse', `${c}^1`); theirs = git('rev-parse', `${c}^2`);
  // 第三個參數用來跑控制組：把結果換成單邊的 ref，這支就該轉紅。
  resultHtml = showFile(argv[2] || c); resultLabel = argv[2] || c.slice(0, 8);
} else {
  mine = git('rev-parse', 'HEAD');
  const mergeHead = `${git('rev-parse', '--git-dir')}/MERGE_HEAD`;
  theirs = argv[0] ? git('rev-parse', argv[0])
    : (existsSync(mergeHead) ? readFileSync(mergeHead, 'utf8').trim().split('\n')[0] : '');
  if (!theirs) { console.error('沒有進行中的合併，也沒給對方的 ref。用法見檔頭。'); process.exit(2); }
  // 結果預設取工作樹——合併解到一半就是要驗磁碟上這份，不是任何 commit。
  resultHtml = argv[1] ? showFile(argv[1]) : readFileSync(FILE, 'utf8');
  resultLabel = argv[1] || '工作樹';
}
const base = git('merge-base', mine, theirs);

// 🔴 第一道 gate：先證明「我在量的是誰」（延伸記憶 assertion-blindspot-taxonomy 形態 0）
console.log(`檔案 ${FILE}`);
console.log(`  base   ${base.slice(0, 8)}  ${git('log', '-1', '--format=%s', base).slice(0, 60)}`);
console.log(`  mine   ${mine.slice(0, 8)}  ${git('log', '-1', '--format=%s', mine).slice(0, 60)}`);
console.log(`  theirs ${theirs.slice(0, 8)}  ${git('log', '-1', '--format=%s', theirs).slice(0, 60)}`);
console.log(`  result ${resultLabel}  ${resultHtml.split('\n').length} 行\n`);

const inv = { base: inventory(showFile(base)), mine: inventory(showFile(mine)),
              theirs: inventory(showFile(theirs)), result: inventory(resultHtml) };

const LABEL = { functions: '函式', elementIds: '元素 id', changelog: '更新紀錄條目',
  helpKeys: '使用說明中心的節', plusFeats: '方案面板功能項', gates: '旗標／閘門常數', urlParams: 'URL 參數契約' };

let bad = 0;
for (const k of Object.keys(inv.base)) {
  const B = new Set(inv.base[k]), M = new Set(inv.mine[k]), T = new Set(inv.theirs[k]), R = new Set(inv.result[k]);
  const required = new Set([
    ...[...M].filter(x => T.has(x)),      // 兩側都有
    ...[...M].filter(x => !B.has(x)),     // 我新增
    ...[...T].filter(x => !B.has(x)),     // 對方新增
  ]);
  const lost = [...required].filter(x => !R.has(x)).sort();
  const droppedByMine   = [...B].filter(x => !M.has(x) && T.has(x));   // 我刪、對方留 → 合法但要看得見
  const droppedByTheirs = [...B].filter(x => !T.has(x) && M.has(x));
  console.log(`${lost.length ? '🔴 遺失' : '✅'} ${LABEL[k]}: 應留 ${required.size} / 結果有 ${R.size}` +
    (lost.length ? `\n      遺失 ${lost.length} 個: ${lost.join(', ')}` : '') +
    (droppedByMine.length   ? `\n      (我這側刻意刪、對方仍有 ${droppedByMine.length}: ${droppedByMine.join(', ')})` : '') +
    (droppedByTheirs.length ? `\n      (對方刻意刪、我仍有 ${droppedByTheirs.length}: ${droppedByTheirs.join(', ')})` : ''));
  if (lost.length) bad++;
}
console.log(bad ? `\n🔴 ${bad} 類有遺失` : '\n✅ 七類識別字零遺失');
process.exit(bad ? 1 : 0);
