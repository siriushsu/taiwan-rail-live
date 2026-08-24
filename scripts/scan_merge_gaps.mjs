#!/usr/bin/env node
// 併入巡檢：有沒有做好的東西沒併進 main、或進度落在工作樹外面沒收。
//
// 為什麼需要它（2026-08-23 的事故，見 memory ship-regression-evil-merge）：
//   一顆合併把 index.html 整檔取單邊，凡「只活在 App 線、沒併進 main」的東西當場全消失，
//   而 build／archive／既有 verify 全綠，使用者是在**上架之後**才發現的。出貨鏈後來補了
//   verify_no_ship_regression（比對「這一顆有沒有比已上架的少」），但那道閘門只看得到
//   **出貨那一刻的候選 vs 基線**——它結構上看不到「這個功能根本還沒被併進 main、
//   所以永遠不會出現在候選裡」。這支補的就是那個開口。
//
// 四個維度（互相獨立，任何一個紅都不擋其他）：
//   A. 未併的識別字：某分支的 index.html 有、origin/main 完全找不到的函式／元素 id／
//      更新紀錄條目／說明中心節／方案面板功能項／旗標常數／URL 參數。
//   A2. 未併的檔案：某分支有、main 沒有的工具/程式檔（不含 docs/）。
//      ——2026-08-24 首跑就是靠這條抓到出貨閘門本身（verify_no_ship_regression.mjs）
//        只活在 feat/tra-wait-card、從沒併進 main。
//   B. 未 push 的本機 commit：只存在這台機器，磁碟壞掉就沒了。
//   C. 未 commit 的工作樹變更：連 commit 都還沒有，最脆弱。
//   D. 正式站 vs origin/main：整包替換式部署會靜默退版（見 memory 心得 16）。
//
// 判準刻意選**識別字**而不是行內容：行會被重排、改寫、搬檔，逐行比對會噴滿假陽性；
// 「這個函式還在不在」對搬家免疫。沿用 app/scripts/verify_no_ship_regression.mjs 的七類
// （那七類每一類都對映到 08-23 真的丟掉過的東西，不是憑空想的維度）。
//
// 🔴 次級過濾：識別字若以**任何形式**出現在 main 的 index.html（改宣告形式、搬進物件、
//    改成 const），就不算不見。沒有這道過濾，光 drawDeco 一個（main 有、只是不再寫成
//    `function drawDeco(`）就會在 50 條分支上各報一次。首跑實測擋掉 127 次假陽性。
//
// 用法：
//   node scripts/scan_merge_gaps.mjs                 # 預設看最近 21 天有動過的分支
//   node scripts/scan_merge_gaps.mjs --days 40
//   node scripts/scan_merge_gaps.mjs --json <檔>     # 明細落檔
//   node scripts/scan_merge_gaps.mjs --no-net        # 跳過 D（正式站）
// 退出碼：0＝沒有帳本以外的新缺口；1＝有；2＝掃描沒跑起來。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const LEDGER = join(HERE, 'merge_gaps_ledger.json');
const TAB = String.fromCharCode(9);

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DAYS = Number(arg('--days', '21'));
const NO_NET = argv.includes('--no-net');

const git = (...a) => execFileSync('git', a, { cwd: REPO, maxBuffer: 1 << 28, encoding: 'utf8' });
// stdio 指定成三段：execFileSync 預設會把 git 的 stderr 直接吐到父行程，
// 於是每個「這個 ref 沒有這個檔」的正常情況都會噴一行 fatal 汙染報告。
const gitQ = (...a) => { try { return execFileSync('git', a, { cwd: REPO, maxBuffer: 1 << 28, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const show = (ref, f) => gitQ('show', `${ref}:${f}`);

// ── 七類識別字（與 app/scripts/verify_no_ship_regression.mjs 同一套；刻意各留一份，
//    因為那支目前只活在 App 線分支上，巡檢不該綁在一條沒併進來的分支上）────────────
export function inventory(html) {
  const uniq = a => [...new Set(a)].sort();
  const all = (re, g = 1) => { const o = []; let m; const r = new RegExp(re, 'g'); while ((m = r.exec(html))) o.push(m[g]); return o; };
  return {
    functions: uniq(all(String.raw`\bfunction\s+([A-Za-z_$][\w$]{2,})\s*\(`)),
    elementIds: uniq(all(String.raw`\bid="([A-Za-z][\w-]{2,})"`)),
    changelog: uniq(all(String.raw`data-cl="([a-z0-9_-]+)"`)),
    helpKeys: uniq(all(String.raw`\{\s*key:\s*'([a-z0-9-]+)',\s*ic:`)),
    plusFeats: uniq((html.match(/const feats = \[[\s\S]*?\]\.map/) || [''])[0]
      .split('\n').map(l => (l.match(/^\s*'(.+)',\s*$/) || [])[1]).filter(Boolean)),
    gates: uniq(all(String.raw`\bconst\s+([A-Z][A-Z0-9_]{4,})\s*=`)),
    urlParams: uniq(all(String.raw`\b(?:searchParams\.get|qs\.get|params\.get)\(['"]([a-z0-9_]+)['"]\)`)),
  };
}
const LABEL = {
  functions: '函式', elementIds: '元素 id', changelog: '更新紀錄條目', helpKeys: '說明中心節',
  plusFeats: '方案面板功能項', gates: '旗標常數', urlParams: 'URL 參數',
};
// A2 只看「會做事的檔」，docs/ 與計畫書不算缺口（那些本來就常留在分支上）
const CODE_PATH = /^(scripts\/|app\/scripts\/|app\/App\/|app\/src\/|worker\/|functions\/|[^/]+\.mjs$)/;
// 底線開頭＝這個 repo 的暫用檔慣例（_mutate_*、_shot_*）。突變測試的一次性 harness
// 本來就不該併進 main，報它們只會把真正的缺口淹掉。
const SCRATCH = /(^|\/)_/;

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { ignoreRefs: [], ignoreIds: [], ignoreFiles: [] };
const ignoredRefs = new Set((ledger.ignoreRefs || []).map(e => e.ref));
const ignoredIds = new Set((ledger.ignoreIds || []).map(e => e.id));
const ignoredFiles = new Set((ledger.ignoreFiles || []).map(e => e.file));

const out = [];
const say = s => { out.push(s); console.log(s); };
let bad = 0;

// ── 自檢：我到底是哪一版？（judgment 心得 32：驗收腳本驗到釘死的舊樹，兩輪全綠驗的都是舊檔）──
const selfPath = fileURLToPath(import.meta.url);
const selfDisk = readFileSync(selfPath, 'utf8');
const selfMain = show('origin/main', 'scripts/scan_merge_gaps.mjs');
const head = (gitQ('rev-parse', '--short', 'HEAD') || '?').trim();
if (selfMain === null) {
  say(`⚠️ 自檢：origin/main 還沒有這支腳本（跑的是本機版，HEAD=${head}）`);
} else if (selfMain !== selfDisk) {
  say(`⚠️ 自檢：磁碟上的腳本與 origin/main 不同——跑的不是 main 那版（HEAD=${head}）`);
} else {
  say(`✅ 自檢：腳本與 origin/main 逐 byte 相同（HEAD=${head}）`);
}

if (!gitQ('rev-parse', '--verify', 'origin/main')) { console.error('✋ 讀不到 origin/main'); process.exit(2); }
const baseHtml = show('origin/main', 'index.html');
if (!baseHtml) { console.error('✋ 讀不到 origin/main:index.html'); process.exit(2); }
const base = inventory(baseHtml);
const baseFiles = new Set(git('ls-tree', '-r', '--name-only', 'origin/main').trim().split('\n'));

// ── A / A2：逐分支比對 ────────────────────────────────────────────────────────
const cutoff = Date.now() - DAYS * 864e5;
const refs = git('for-each-ref', `--format=%(refname:short)${TAB}%(committerdate:unix)`, 'refs/heads/', 'refs/remotes/origin/')
  .trim().split('\n').map(l => l.split(TAB))
  .filter(([r, t]) => !['origin', 'origin/main', 'main'].includes(r) && Number(t) * 1000 >= cutoff)
  .filter(([r]) => !ignoredRefs.has(r) && !ignoredRefs.has(r.replace(/^origin\//, '')));

const byRef = new Map();   // ref -> {ids:[], files:[], date}
let softFP = 0;
for (const [ref, t] of refs) {
  if (!Number(git('rev-list', '--count', `origin/main..${ref}`).trim())) continue;
  const rec = { ids: [], files: [], date: new Date(Number(t) * 1000).toISOString().slice(0, 10), ts: Number(t) };
  const html = show(ref, 'index.html');
  if (html) {
    const inv = inventory(html);
    for (const cat of Object.keys(inv)) for (const id of inv[cat] || []) {
      if ((base[cat] || []).includes(id)) continue;
      if (baseHtml.includes(id)) { softFP++; continue; }   // 宣告形式改變／搬家 ≠ 不見
      const key = `${cat} ${id}`;
      if (ignoredIds.has(key)) continue;
      rec.ids.push({ cat, id });
    }
  }
  for (const f of (gitQ('ls-tree', '-r', '--name-only', ref) || '').trim().split('\n')) {
    if (!f || baseFiles.has(f) || !CODE_PATH.test(f) || SCRATCH.test(f) || ignoredFiles.has(f)) continue;
    rec.files.push(f);
  }
  if (rec.ids.length || rec.files.length) byRef.set(ref, rec);
}
// 同一份內容常同時存在 local 與 origin/ 兩個 ref；報告只留代表，避免同一件事讀兩次
for (const ref of [...byRef.keys()]) {
  if (ref.startsWith('origin/') && byRef.has(ref.slice(7))) byRef.delete(ref);
}
const ranked = [...byRef.entries()].sort((a, b) => b[1].ts - a[1].ts || (b[1].ids.length + b[1].files.length) - (a[1].ids.length + a[1].files.length));

say('');
if (!ranked.length) {
  say('✅ A. 未併的功能：最近 ' + DAYS + ' 天有動過的分支都沒有 main 缺的識別字或檔案');
} else {
  const totIds = ranked.reduce((s, [, r]) => s + r.ids.length, 0);
  const totF = ranked.reduce((s, [, r]) => s + r.files.length, 0);
  say(`❌ A. 未併的功能：${ranked.length} 條分支帶著 main 沒有的東西（識別字 ${totIds}、檔案 ${totF}）`);
  bad = 1;
  for (const [ref, r] of ranked.slice(0, 12)) {
    say(`   ── ${ref}  (${r.date})`);
    const g = {};
    for (const { cat, id } of r.ids) (g[cat] ??= []).push(id);
    for (const cat of Object.keys(g)) {
      const v = g[cat];
      say(`      ${LABEL[cat]} ${v.length}：${v.slice(0, 6).map(s => s.slice(0, 34)).join('、')}${v.length > 6 ? ` …+${v.length - 6}` : ''}`);
    }
    if (r.files.length) say(`      檔案 ${r.files.length}：${r.files.slice(0, 5).join('、')}${r.files.length > 5 ? ` …+${r.files.length - 5}` : ''}`);
  }
  if (ranked.length > 12) say(`   …另外 ${ranked.length - 12} 條分支（見 --json 明細）`);
}
say(`   （次級過濾擋掉「main 改了宣告形式／搬家」的假陽性 ${softFP} 次）`);

// ── B：未 push 的本機 commit ─────────────────────────────────────────────────
const unpushed = [];
for (const line of git('for-each-ref', `--format=%(refname:short)${TAB}%(committerdate:unix)`, 'refs/heads/').trim().split('\n')) {
  const [ref, t] = line.split(TAB);
  if (Number(t) * 1000 < cutoff || ignoredRefs.has(ref)) continue;
  if (!Number(git('rev-list', '--count', `origin/main..${ref}`).trim())) continue;
  const hasRemote = gitQ('rev-parse', '--verify', `refs/remotes/origin/${ref}`);
  const lead = hasRemote ? Number(git('rev-list', '--count', `origin/${ref}..${ref}`).trim())
    : Number(git('rev-list', '--count', `origin/main..${ref}`).trim());
  if (lead > 0) unpushed.push({ ref, lead, hasRemote: !!hasRemote, date: new Date(Number(t) * 1000).toISOString().slice(0, 10) });
}
unpushed.sort((a, b) => b.date.localeCompare(a.date));
say('');
if (!unpushed.length) say(`✅ B. 未 push 的本機 commit：最近 ${DAYS} 天沒有`);
else {
  say(`❌ B. 未 push 的本機 commit：${unpushed.length} 條分支只存在這台機器`);
  bad = 1;
  for (const u of unpushed.slice(0, 15)) say(`   ${u.date}  ${String(u.lead).padStart(3)} 顆  ${u.ref}${u.hasRemote ? '' : '  (origin 上沒有這條分支)'}`);
  if (unpushed.length > 15) say(`   …另外 ${unpushed.length - 15} 條`);
}

// ── C：未 commit 的工作樹變更 ────────────────────────────────────────────────
const dirty = [], gone = [];
for (const blk of git('worktree', 'list', '--porcelain').trim().split('\n\n')) {
  const m = blk.match(/^worktree (.+)$/m); if (!m) continue;
  const wt = m[1];
  if (!existsSync(wt)) { gone.push(wt); continue; }
  const st = (() => { try { return execFileSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { return ''; } })();
  const mod = st.split('\n').filter(l => l && !l.startsWith('??')).length;
  if (mod) dirty.push({ wt, mod, br: (gitQ('-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD') || '?').trim() });
}
dirty.sort((a, b) => b.mod - a.mod);
say('');
if (!dirty.length) say('✅ C. 未 commit 的變更：所有工作樹都乾淨');
else {
  say(`❌ C. 未 commit 的變更：${dirty.length} 棵工作樹有改過但沒 commit 的檔（斷電就沒了）`);
  bad = 1;
  for (const d of dirty.slice(0, 15)) say(`   ${String(d.mod).padStart(3)} 檔  ${d.br.padEnd(28)} ${d.wt.replace('/Users/xuxiang/', '~/')}`);
  if (dirty.length > 15) say(`   …另外 ${dirty.length - 15} 棵`);
}
if (gone.length) say(`   ℹ️ 另有 ${gone.length} 棵工作樹的目錄已不存在，可 git worktree prune 清掉`);

// ── D：正式站 vs origin/main ────────────────────────────────────────────────
say('');
if (NO_NET) say('⏭  D. 正式站比對：--no-net 跳過');
else {
  try {
    const r = await fetch(`https://railisland.tw/?mergescan=${Date.now()}`, { cache: 'no-store' });
    const live = await r.text();
    const { createHash } = await import('node:crypto');
    const h = s => createHash('md5').update(s).digest('hex');
    if (h(live) === h(baseHtml)) say('✅ D. 正式站：與 origin/main 的 index.html 逐 byte 相同');
    else {
      // 不逐行 diff：只答「線上缺了 main 有的哪些識別字」與反向，方向比行號有用
      const li = inventory(live);
      const missOnline = [], onlyOnline = [];
      for (const cat of Object.keys(base)) {
        for (const id of base[cat]) if (!(li[cat] || []).includes(id) && !live.includes(id)) missOnline.push(`${LABEL[cat]}:${id}`);
        for (const id of li[cat] || []) if (!(base[cat] || []).includes(id) && !baseHtml.includes(id)) onlyOnline.push(`${LABEL[cat]}:${id}`);
      }
      say(`❌ D. 正式站與 origin/main 內容不同（線上缺 ${missOnline.length} 項、線上多 ${onlyOnline.length} 項）`);
      if (missOnline.length) say(`   線上缺：${missOnline.slice(0, 10).join('、')}${missOnline.length > 10 ? ` …+${missOnline.length - 10}` : ''}`);
      if (onlyOnline.length) say(`   線上多：${onlyOnline.slice(0, 10).join('、')}${onlyOnline.length > 10 ? ` …+${onlyOnline.length - 10}` : ''}`);
      bad = 1;
    }
  } catch (e) {
    say(`⏭  D. 正式站比對沒跑起來（${String(e.message).slice(0, 60)}）——網路類失敗不算產品異常`);
  }
}

const jsonPath = arg('--json');
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({
    at: new Date().toISOString(), days: DAYS, head,
    branches: Object.fromEntries([...byRef].map(([k, v]) => [k, v])),
    unpushed, dirty, goneWorktrees: gone, softFalsePositives: softFP,
  }, null, 2));
}
say('');
say(bad ? '❌ 有帳本以外的缺口，見上面各節' : '✅ 四個維度都沒有帳本以外的缺口');
process.exit(bad);
