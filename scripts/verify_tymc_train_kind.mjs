// 機捷車種標示 gate（issue #44/#45）。
//
// 判準來源刻意獨立於實作：車種的真值用「官方停靠樣態」自己算一次
//   直達車＝跳站（桃捷官網：直達車停靠 A1、A3、A8、A12、A13；尖峰增停再加 A18、A21）
//   普通車＝站站停（停靠索引連續）
// 而畫面那一側量的是 canvas 真的 fillText 出去的字串，不看實作的任何中間變數。
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '/Users/xuxiang/Code/捷運小動畫/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
console.log('[機捷車種 gate] 目標目錄:', ROOT);
console.log('[機捷車種 gate] index.html md5:',
  (await import('crypto')).createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex'));

const results = [];
const check = (n, pass, detail) => { results.push({ n, pass }); console.log(`${pass ? 'PASS ' : 'FAIL '} ${n} — ${detail}`); };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const port = 8399 + (process.pid % 200);
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(port, r));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));
// 只攔自家 /api/*（不打上游、走純班表）；CDN 等外部資源走真網路
await page.route('**/*', route => {
  const u = new URL(route.request().url());
  if ((u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.pathname.startsWith('/api/'))
    return route.fulfill({ status: 204, body: '' });
  return route.continue();
});
await page.goto(`http://127.0.0.1:${port}/index.html?lang=zh-TW&g=metro&at=25.0578,121.3724&z=13`,
  { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction(() => typeof state === 'object' && state.systems
  && state.systems.some(s => s.id === 'tymc' && s.data && s._times), { timeout: 45000 });

const probe = () => {
  // 真值：用官方樣態自己判一次，不呼叫實作的 tymcKindOf
  const ln = state.lines.find(l => l._sys === 'tymc');
  const truth = tr => { for (let i = 2; i < tr.length; i += 2) { const d = tr[i] - tr[i - 2]; if (d !== 1 && d !== -1) return 'exp'; } return 'com'; };
  // 嚴格真值：站站停＝普通；跳站只有恰好落在官方兩種樣態上才算直達，其餘（首末班特殊班次）＝留白
  const SF = [0, 2, 7, 11, 12, 17, 20];
  const truthStrict = tr => {
    const st = []; for (let i = 0; i < tr.length; i += 2) st.push(tr[i]);
    if (st.every((v, i) => i === 0 || Math.abs(v - st[i - 1]) === 1)) return 'com';
    const south = st[0] < st[st.length - 1];
    const full = south ? SF : [...SF].reverse();
    const seg = south ? full.slice(0, st.length) : full.slice(full.length - st.length);
    return st.length === seg.length && st.every((v, i) => v === seg[i]) ? 'exp' : null;
  };
  const map = window.__map;
  const sec = state.simSec;
  let expLive = 0, comLive = 0;
  for (const tr of ln._tt || []) { if (!freqTrainPosAt(ln, tr, sec)) continue; truth(tr) === 'exp' ? expLive++ : comLive++; }

  // 畫面：spy canvas fillText，收集這一幀真的寫出去的字
  // 只記字串的話,把「直」「普」畫回原本 15px 的小牌、或把形狀/反白拿掉,這支 gate 仍會全綠——
  // 而使用者反映的正是「看不出來」。所以連**字級、字色、牌身填色、牌身路徑形狀**一起記:
  // 尖頭牌是純多邊形(lineTo,無 arcTo),圓角牌是四個 arcTo(無 lineTo)。
  const drawn = [];
  const orig = ctx.fillText, oBegin = ctx.beginPath, oLineTo = ctx.lineTo, oArcTo = ctx.arcTo, oFill = ctx.fill;
  let seg = { lineTo: 0, arcTo: 0 }, lastFill = null;
  ctx.beginPath = function (...a) { seg = { lineTo: 0, arcTo: 0 }; return oBegin.apply(this, a); };
  ctx.lineTo = function (...a) { seg.lineTo++; return oLineTo.apply(this, a); };
  ctx.arcTo = function (...a) { seg.arcTo++; return oArcTo.apply(this, a); };
  ctx.fill = function (...a) { lastFill = { bg: String(this.fillStyle).toLowerCase(), lineTo: seg.lineTo, arcTo: seg.arcTo }; return oFill.apply(this, a); };
  ctx.fillText = function (txt, x, y, ...rest) {
    drawn.push({ s: String(txt), x, y, font: String(this.font), fg: String(this.fillStyle).toLowerCase(), body: lastFill });
    return orig.call(this, txt, x, y, ...rest);
  };
  draw();
  ctx.fillText = orig; ctx.beginPath = oBegin; ctx.lineTo = oLineTo; ctx.arcTo = oArcTo; ctx.fill = oFill;

  // 逐台比對：每台在畫面內的機捷車，牌面上那個字必須等於真值判定的結果
  // （真值＝官方樣態，這裡自己算一遍，不呼叫 tymcKindOf）
  const EXPECT = { exp: '直', com: '普', null: 'A' };
  const mismatches = [], tymcHits = [];
  let matched = 0, blanks = 0;
  for (const tr of ln._tt || []) {
    const pos = freqTrainPosAt(ln, tr, sec); if (!pos) continue;
    const cp = map.latLngToContainerPoint([pos.lat, pos.lon]);
    if (cp.x < 0 || cp.y < 0 || cp.x > map.getSize().x || cp.y > map.getSize().y) continue;
    const hit = drawn.find(d => Math.abs(d.x - cp.x) < 1.5 && Math.abs(d.y - (cp.y + 0.5)) < 1.5);
    if (!hit) continue;                       // 這台被別的東西蓋掉/沒畫牌，不列入
    const want = EXPECT[String(truthStrict(tr))];
    matched++;
    if (String(truthStrict(tr)) === 'null') blanks++;
    if (hit.s !== want) mismatches.push({ stops: tr.filter((_, i) => i % 2 === 0).join(','), want, got: hit.s });
    tymcHits.push({ kind: String(truthStrict(tr)), s: hit.s, font: hit.font, fg: hit.fg,
      bg: hit.body ? hit.body.bg : '', lineTo: hit.body ? hit.body.lineTo : -1, arcTo: hit.body ? hit.body.arcTo : -1 });
  }

  const tags = drawn.map(d => d.s).filter(s => s.length <= 2);
  // 控制組要對照的是「別的線的車牌」，不是隨便什麼被畫出來的字——站名一定會被畫，
  // 拿它當對照等於恆真、零訊號。所以只認其他捷運線自己的 abbr。
  const otherAbbrs = [...new Set(state.lines.filter(l => l._sys !== 'tymc').map(l => l.abbr))];
  const otherLineTags = otherAbbrs.filter(ab => tags.includes(ab));
  const otherFonts = [...new Set(drawn.filter(d => otherAbbrs.includes(d.s)).map(d => d.font))];
  return { tripCount: (ln._tt || []).length, expLive, comLive, matched, blanks, mismatches,
    tymcHits, otherFonts, tymcColor: String(ln.color || '').toLowerCase(),
    clock: new Date(sec * 1000).toISOString().slice(11, 16),
    drawnKinds: { 直: tags.filter(s => s === '直').length, 普: tags.filter(s => s === '普').length, A: tags.filter(s => s === 'A').length },
    otherAbbrs, otherLineTags };
};
const out = await page.evaluate(probe);

check('G1 分母閘門：機捷班表真的解析出班次（這條紅，下面每一條的「找到了」都不算數）',
  out.tripCount > 50, `解析出 ${out.tripCount} 班`);
check('G2 分母閘門：此刻兩種車都在途（否則畫面上本來就只會有一種，A1 會假綠）',
  out.expLive > 0 && out.comLive > 0, `在途 直達 ${out.expLive} 班、普通 ${out.comLive} 班`);
check('A1 畫面上真的畫出「直」字牌', out.drawnKinds.直 > 0, `本幀 fillText 出 ${out.drawnKinds.直} 個「直」`);
check('A2 畫面上真的畫出「普」字牌', out.drawnKinds.普 > 0, `本幀 fillText 出 ${out.drawnKinds.普} 個「普」`);
check('B1 逐台比對：畫面內每一台機捷車的牌面字都等於獨立算出的真值（不是只數總量）',
  out.matched > 3 && out.mismatches.length === 0,
  `比對 ${out.matched} 台，不符 ${out.mismatches.length} 台` +
  (out.mismatches.length ? `：${out.mismatches.slice(0, 3).map(m => `[${m.stops}] 期望「${m.want}」實得「${m.got}」`).join(' | ')}` : ''));
check('C 控制組：其他捷運線的車牌仍是它自己的線代號（沒有把別的系統一起改掉）',
  out.otherLineTags.length > 0,
  `同幀畫出的他線車牌：${out.otherLineTags.join('、') || '(無)'}（候選 abbr：${out.otherAbbrs.join('、')}）`);

// ── 看得出來嗎：字對了不代表使用者分得出來（2026-09-04 使用者回報「圖示太小、放字也沒用」）──
// 下面三條各鎖一個辨識管道，任一個被改回去都要紅。
const expHits = out.tymcHits.filter(h => h.kind === 'exp');
const comHits = out.tymcHits.filter(h => h.kind === 'com');
const big = h => /\b12px\b/.test(h.font);
check('G4 分母閘門：畫面內同時抓到直達與普通各至少一面牌（否則 F 系列是空集合恆真）',
  expHits.length > 0 && comHits.length > 0, `直達 ${expHits.length} 面、普通 ${comHits.length} 面`);
check('F1 放大：機捷兩種車牌都用 12px，且沒有把其他捷運線一起放大（他線仍 10px）',
  expHits.every(big) && comHits.every(big) && out.otherFonts.length > 0 && out.otherFonts.every(f => /\b10px\b/.test(f)),
  `機捷字級 ${[...new Set([...expHits, ...comHits].map(h => h.font.match(/\d+px/)?.[0]))].join('/')}；他線 ${out.otherFonts.map(f => f.match(/\d+px/)?.[0]).join('/') || '(無)'}`);
check('F2 形狀：直達＝尖頭多邊形（只有 lineTo）、普通＝圓角（只有 arcTo）',
  expHits.every(h => h.lineTo >= 4 && h.arcTo === 0) && comHits.every(h => h.arcTo === 4 && h.lineTo === 0),
  `直達 lineTo/arcTo=${expHits.map(h => h.lineTo + '/' + h.arcTo).join(' ')}；普通 ${comHits.map(h => h.lineTo + '/' + h.arcTo).join(' ')}`);
check('F3 反白：直達＝線色底白字、普通＝白底線色字（兩者填色相反，不是同一塊紫）',
  expHits.every(h => h.bg === out.tymcColor && /^#f|^rgb\(2[45]/.test(h.fg)) &&
  comHits.every(h => h.fg === out.tymcColor && h.bg !== out.tymcColor),
  `直達 底${expHits[0]?.bg}/字${expHits[0]?.fg}；普通 底${comHits[0]?.bg}/字${comHits[0]?.fg}（線色 ${out.tymcColor}）`);

// 第二格狀態：撥到末班時段。保守判定唯一看得見的地方就是這裡——首末班特殊班次要留白顯示
// 線代號，而不是被硬標成「直」。只驗現在這一刻等於只驗了狀態空間的一格。
const night = await page.evaluate(probeAt => {
  state.simSec = 23 * 3600 + 20 * 60;
  state.clockAtNow = false;   // 直接寫 simSec 必須同時關掉「跟現在走」，否則下一幀被拉回
  return eval('(' + probeAt + ')')();
}, probe.toString());
check('G3 分母閘門：末班時段畫面內真的有機捷車可比對',
  night.matched > 0, `末班 ${night.clock} 比對到 ${night.matched} 台`);
check('E1 末班時段逐台比對仍全對，且首末班特殊班次留白顯示線代號（不硬猜車種）',
  night.mismatches.length === 0,
  `比對 ${night.matched} 台、其中留白 ${night.blanks} 台，不符 ${night.mismatches.length} 台` +
  (night.mismatches.length ? `：${night.mismatches.slice(0, 3).map(m => `[${m.stops}] 期望「${m.want}」實得「${m.got}」`).join(' | ')}` : ''));

check('D 沒有 page error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '(無)');

await browser.close();
server.close();
const pass = results.filter(r => r.pass).length;
console.log(`\n合計 ${pass} PASS / ${results.length - pass} FAIL`);
process.exit(pass === results.length ? 0 : 1);
