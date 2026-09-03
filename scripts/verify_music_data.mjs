#!/usr/bin/env node
// data/music.json 的資料契約稽核。不需瀏覽器。
// G0 自檢：印出驗的是哪一份、md5 多少——避免像 2026-07-26 那次驗到釘死的舊 worktree 而兩輪全綠。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'music.json');
const MUSIC_DIR = path.join(ROOT, 'suno musics');
const INDEX = path.join(ROOT, 'index.html');

// 分區與時段的權威清單。改這裡＝改產品行為，不是改測試。
const ZONES = ['metro', 'north-city', 'north-coast', 'yilan', 'hualien', 'taitung', 'west-plain', 'south', 'mountain'];
const HOURS = ['dawn', 'day', 'dusk', 'evening', 'night'];

const fails = [];
const ok = [];
const check = (name, cond, detail = '') => (cond ? ok : fails).push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

// ── G0 自檢 ──
if (!existsSync(DATA)) { console.error('FAIL G0 — data/music.json 不存在'); process.exit(1); }
const raw = readFileSync(DATA);
console.log(`G0 驗的是：${DATA}\n     md5=${createHash('md5').update(raw).digest('hex')}  bytes=${raw.length}`);
const J = JSON.parse(raw);

// ── A. 免費池凍結 ──
check('A1 free.tracks 恰 57 首', J.free.tracks.length === 57, `實際 ${J.free.tracks.length}`);
check('A2 free.bundled 恰 12 首', J.free.bundled.length === 12, `實際 ${J.free.bundled.length}`);
check('A3 bundled ⊆ tracks', J.free.bundled.every(b => J.free.tracks.some(t => t.src === b)));
check('A4 每首都有正的 dur/bytes', J.free.tracks.every(t => t.dur > 0 && t.bytes > 0));
check('A5 bytes 與磁碟一致', J.free.tracks.every(t => statSync(path.join(MUSIC_DIR, t.src)).size === t.bytes));

// A6 是唯一「兩個獨立來源」的比對：磁碟掃描 vs index.html 硬編的 MUSIC_FILES。
// 只驗「掃出來的檔案存在」是同源恆真（心得 29），照不到任何東西。
const SRC = readFileSync(INDEX, 'utf8');
const listOf = (name) => {
  const m = SRC.match(new RegExp('const ' + name + '\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]'));
  if (!m) return null;
  // 逐項比對要容得下 Stargazer's 這種內含單引號的檔名：只認「引號 + 以 .mp3 結尾」的字面
  return [...m[1].matchAll(/(["'])((?:(?!\1).)*\.mp3)\1/g)].map(x => x[2]);
};
const FILES = listOf('MUSIC_FILES'), BUNDLED = listOf('MUSIC_BUNDLED');
// 🔴「完全相同」必須是雙向且認得重複項：單向子集＋長度相等會被「把 A 換成已存在的 B」整個穿過
//    （2026-08-29 突變測試實測：Untitled-5→Untitled-7 讓清單出現重複，長度仍 57、每項都查得到）。
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
  [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
const dupes = (a) => (a || []).filter((x, i, arr) => arr.indexOf(x) !== i);
const dataFree = J.free.tracks.map(t => t.src);
check('A6 index.html 的 MUSIC_FILES 抓得到且為 57 首', !!FILES && FILES.length === 57, `實際 ${FILES && FILES.length}`);
check('A6b 兩份清單各自都沒有重複項',
  dupes(FILES).length === 0 && dupes(BUNDLED).length === 0 && dupes(dataFree).length === 0,
  [...dupes(FILES), ...dupes(BUNDLED), ...dupes(dataFree)].slice(0, 3).join(' / '));
check('A7 free.tracks 與 index.html 的 MUSIC_FILES 完全相同（雙向）', sameList(FILES, dataFree),
  FILES ? 'index 多：' + FILES.filter(f => !dataFree.includes(f)).slice(0, 2).join(' / ') +
          '  data 多：' + dataFree.filter(f => !FILES.includes(f)).slice(0, 2).join(' / ') : 'MUSIC_FILES 抓不到');
check('A8 free.bundled 與 index.html 的 MUSIC_BUNDLED 完全相同（雙向）', sameList(BUNDLED, J.free.bundled),
  BUNDLED ? 'index 多：' + BUNDLED.filter(b => !J.free.bundled.includes(b)).slice(0, 2).join(' / ') +
            '  data 多：' + J.free.bundled.filter(b => !BUNDLED.includes(b)).slice(0, 2).join(' / ') : 'MUSIC_BUNDLED 抓不到');

// ── B. 兩條曲庫零交集（設計書 D1 的機械化身）──
const freeSet = new Set(J.free.tracks.map(t => t.src));
const overlap = J.pools.flatMap(p => p.tracks.map(t => t.src)).filter(s => freeSet.has(s));
check('B1 付費池 ∩ 免費 57 首 = 空集合', overlap.length === 0, overlap.slice(0, 3).join(', '));
check('B2 每首付費曲檔案真的在', J.pools.every(p => p.tracks.every(t => existsSync(path.join(MUSIC_DIR, t.src)))));
// 母帶絕不可外流：付費曲的路徑一律在 _pass/ 底下，不得指到 _masters/ 或任何 .wav
check('B3 付費曲不得指向母帶或 wav',
  J.pools.every(p => p.tracks.every(t => t.src.startsWith('_pass/') && t.src.endsWith('.mp3'))));

// ── C. 結構契約 ──
const famIds = new Set(J.families.map(f => f.id));
check('C1 families 恰 3 套', J.families.length === 3);
check('C2 pools 恰 16 池', J.pools.length === 16, `實際 ${J.pools.length}`);
check('C3 每池的 family 存在（獨立池允許 null）', J.pools.every(p => p.family === null || famIds.has(p.family)));
check('C4 每池 zones 的值都在分區清單裡', J.pools.every(p => p.zones === null || p.zones.every(z => ZONES.includes(z))));
check('C5 每池 hours 的值都在時段清單裡', J.pools.every(p => p.hours === null || p.hours.every(h => HOURS.includes(h))));
check('C6 每池 id 唯一', new Set(J.pools.map(p => p.id)).size === J.pools.length);
check('C7 每池都有中文名', J.pools.every(p => typeof p.zh === 'string' && p.zh.length > 0));

// ── D. 45 格覆蓋率：對【全部 auto:true 池的 metadata】，每一格都要選得出 ──
// 🔴 這條驗的是設計正確性，與曲目有沒有生產完無關；池空著也算數。
const autoPools = J.pools.filter(p => p.auto);
const eligible = (p, z, h) => (p.zones === null || p.zones.includes(z)) && (p.hours === null || p.hours.includes(h));
const holes = [];
for (const z of ZONES) for (const h of HOURS) if (!autoPools.some(p => eligible(p, z, h))) holes.push(`${z}×${h}`);
check('D1 45 格全部選得出池', holes.length === 0, holes.join(', '));
check('D2 格數分母真的是 45', ZONES.length * HOURS.length === 45, `${ZONES.length}×${HOURS.length}`);
check('D3 每個 auto 池至少被一格選到',
  autoPools.every(p => ZONES.some(z => HOURS.some(h => eligible(p, z, h)))));

for (const line of [...ok, ...fails]) console.log(line);
console.log(`\n總計 ${ok.length + fails.length} 項，PASS ${ok.length}，FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
