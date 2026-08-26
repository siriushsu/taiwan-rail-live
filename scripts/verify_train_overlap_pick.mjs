// 兩台列車重疊時「下面那台點不到」——網友 2026-08-13 回報的重現與修復驗收。
//
// 根因:trainAt() 是「命中半徑內取唯一最近者」,而畫面上畫的是車號牌矩形。
// 兩車中心相距 d 時,下層車只露出寬約 d 的一條邊;點那條邊時因為離上層車中心更近,
// 永遠命中上層車 ⇒ 下層車點不到。車站早就修過同一個問題(index.html 的 stCands 疊站選單),
// 捷運示意層的 freqTrainsAt 也早就是箱式,只有台鐵/高鐵這半沒補。
//
// 判準(真的按下去,不是只算幾何):
//   G0 自檢  先證明我在量的是誰:這份 index.html 真的含本批的機制
//   A 繪製端  每顆 _trainHits 都帶命中框 w/h,且尺寸等於該牌用 ctx.measureText 實算的大小
//   B 命中端  兩車相距 d(0..30) 時,點「下層車露出的可見區」必須跟到下層車 ← 網友回報的那件事
//   C 選單    兩張牌同時壓住點擊處(含完全重合 d=0)時彈 tapPick,列出兩台,**點哪一列就跟哪一台**
//   D 迴歸    單獨一台直接跟隨不彈選單／點空白不跟車／車與站的既有歧義選單不變／退路層只回最近一台
//
// 範圍:只驗台鐵/高鐵(_trainHits)。捷運示意層(_freqHits)那半刻意不在這支裡——
// main 的 freqTrainsAt 用的是 halfW/halfH＋vehicleId＋OFFICIAL_ROSTER_ENABLED 另一套形狀,
// 而「捷運同線疊車」正由 metro core 那條線在動,兩邊同時改同一區會互相踩。等那批落地再補。
//
// 重疊情境用注入 _trainHits 製造(真實畫面要等兩台車自己撞在一起無法決定性重現),
// 但 A 判準量的是真實繪製流程的產物,兩條互相補位:B/C 驗判定邏輯、A 驗繪製端真的有填框。
//
// 🔴 這支是從 feat/changelog-slim 搬過來的,原版有四個假綠,已逐條修掉(見各處 🔧 註記):
//   md5 只印不斷言／C3 點第二列跟到原本那台也算過／選單列用 mouse click 而非觸控／
//   視窗只有 1280 與 375,缺 360/414/768 這段中間帶。
//
// 用法:node scripts/verify_train_overlap_pick.mjs   (ONLY=chromium 只跑單引擎)
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// ── G0 自檢:先證明我在量的是誰 ─────────────────────────────────────────
// 🔧 原版只 console.log 出 md5、沒有任何斷言——驗到別的 worktree 一樣全綠,那個 md5 是裝飾。
//    md5 本身無從斷言(沒有已知期望值),真正該斷言的是「這份檔含本批要驗的機制」。
const IDX = path.join(ROOT, 'index.html');
const SRC = readFileSync(IDX, 'utf8');
console.log(`目標 ROOT = ${ROOT}`);
console.log(`index.html md5 = ${createHash('md5').update(SRC).digest('hex')}  (${SRC.length} bytes)`);
for (const [frag, why] of [
  ['function trainsAt(cp)', '多候選命中'],
  ['function trainMarkBox(', '命中框尺寸的單一來源'],
  ['hits.map(tapPickSchedTrain)', '疊車選單接上了點擊流程'],
  ['...trainMarkBox(tr, showTrain)', '繪製端把框填進 _trainHits'],
]) if (!SRC.includes(frag)) { console.error(`❌ [G0] 這份 index.html 沒有「${why}」(${frag})——驗錯目標或改動沒落地`); process.exit(1); }
console.log('[G0] 四項機制都在這份檔裡');

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 🔧 /api/* 回 404 而不是 200 `{}`:前端資料源是「apiUrl 優先、data/*.json 退路」兩層,
  //    回一個**成功但空**的 200 會讓它以為拿到了 ⇒ `sys.data.trains` undefined ⇒ boot 拋錯 ⇒
  //    waitForFunction 等不到 state.ready,五個視窗全部 45 秒逾時。回 404 才會走進磁碟上那份真資料。
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; res.setHeader('content-type', 'application/json'); return res.end('{"error":"stubbed"}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(0, r));           // 埠交給 OS:硬編埠會撞到其他 worktree 的 server
const BASE = `http://localhost:${server.address().port}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const allErrors = [];

async function boot(browser, tag, vp = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    try { localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => allErrors.push(`[${tag}] pageerror: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) allErrors.push(`[${tag}] console.error: ${m.text()}`); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    try { return typeof state !== 'undefined' && state.ready === true && (state.trains || []).length > 0; } catch (e) { return false; }
  }, null, { timeout: 45000 });
  await page.waitForTimeout(600);
  return { ctx, page };
}

// 地圖容器左上角(container point → page 座標)
const originOf = page => page.evaluate(() => {
  const r = document.getElementById('map').getBoundingClientRect();
  return { left: r.left, top: r.top, w: r.width, h: r.height };
});

// 實驗場:找一塊「附近沒有任何車站」的空地。車站命中半徑 16px、疊站選單 8px,
// 場地沒選乾淨的話點下去彈的是車站選單,量到的根本不是車與車的勝負(第一版就踩到)。
const findEmptySpot = page => page.evaluate(() => {
  const pts = [];
  for (const st of (state.schedStations || [])) pts.push(map.latLngToContainerPoint([st.lat, st.lon]));
  if (state.deco) for (const ln of (state.decoLines || [])) for (const p of (ln.pts || [])) pts.push(p);
  for (const ln of (state.lines || [])) for (const p of (ln.pts || [])) pts.push(p);
  const r = document.getElementById('map').getBoundingClientRect();
  let best = null, bd = -1;
  // 也要避開面板/工具列:點擊處與其下方彈出的小選單都必須落在地圖本身上,
  // 否則 tapPick 會開在面板底下,測試點不到它(不是產品問題,是場地沒選好)
  const onMap = (x, y) => {
    for (const dy of [0, 20, 60, 100]) {
      const el = document.elementFromPoint(r.left + x, r.top + y + dy);
      if (!el || !el.closest('#map')) return false;
    }
    return true;
  };
  // 邊界要隨視窗縮放:寫死 240/300 在 375 寬的手機上會讓迴圈一次都不跑(場地=undefined,後面整串靜默假綠)
  const mx = Math.min(240, Math.round(r.width * 0.16)), my0 = Math.min(180, Math.round(r.height * 0.2));
  const mx1 = r.width - Math.min(300, Math.round(r.width * 0.16)), my1 = r.height - Math.min(280, Math.round(r.height * 0.3));
  for (let x = mx; x < mx1; x += 12) {
    for (let y = my0; y < my1; y += 12) {
      let m = 1e9;
      for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < m) m = d; }
      if (m > bd && onMap(x, y)) { bd = m; best = { x, y }; }
    }
  }
  return { ...best, clearance: bd };
});

// 把畫面凍住並塞兩台車的命中點:draw() 每幀重建 hits,不凍住會被立刻蓋掉
async function freezeAndInject(page, { pair }) {
  return page.evaluate(({ pair }) => {
    // 🔧 一定要指名 #overlay:main 的街道底圖已改 MapLibre 向量圖磚,而它自己就是一個 <canvas>,
    //    且在 DOM 裡排在前面 ⇒ querySelector('canvas') 抓到的是 WebGL 那顆,getContext('2d') 回 null。
    //    這支從舊分支搬過來時就是這樣整批炸掉的(Cannot set properties of null)。
    if (!window.__origDraw) window.__origDraw = window.draw;
    window.draw = () => {};                       // 凍住重建(rAF 仍在跑,只是不再覆寫 hits)
    const FONT = getComputedStyle(document.body).fontFamily;
    const cx = document.getElementById('overlay').getContext('2d');
    cx.font = '700 10px ' + FONT;
    const mk = (label) => cx.measureText(label).width + 10;   // drawTag 的 pw 公式
    const out = [];
    {
      const trs = state.trains.slice(0, 2);
      // 期望寬度由**繪製公式**獨立算出,不呼叫頁面的 trainMarkBox——判準的真值來源不得與實作同源。
      // drawTag: measureText + 10;drawHSRTag: measureText + 13,再加左右各 5 的尖角 ⇒ +23。
      state._trainHits = pair.map((p, i) => ({ x: p.x, y: p.y, tr: trs[i],
        w: mk(trs[i].train) + (isHSR(trs[i]) ? 13 : 0), h: 15 }));
      out.push(...state._trainHits.map((h, i) => ({ w: h.w, label: trs[i].train })));
    }
    return out;
  }, { pair });
}

// 等相機停下來再取樣。D1 的 setFollow() 會讓鏡頭飛向那台車,clearFollow() 之後緩動還在跑;
// 而注入的 _trainHits 是釘死的容器座標、車站卻每次都即時重投影 ⇒ 鏡頭沒停時兩者會漂開,
// 歧義門檻只有 8px,漂 10px 就足以讓「車與站重疊」的情境靜默失效(實測 414/768 就是這樣紅的)。
async function waitMapStill(page, ms = 4000) {
  const t0 = Date.now(); let prev = null;
  while (Date.now() - t0 < ms) {
    const now = await page.evaluate(() => { const c = map.getCenter(); return `${c.lat.toFixed(7)},${c.lng.toFixed(7)},${map.getZoom()}`; });
    if (prev === now) return true;
    prev = now;
    await page.waitForTimeout(150);
  }
  return false;
}

const resetFollow = page => page.evaluate(() => {
  try { if (typeof clearFollow === 'function') clearFollow(); } catch (e) {}
  state.followTrain = null; state.freqFollow = null;
  const el = document.getElementById('tapPick'); if (el) { el.hidden = true; el.innerHTML = ''; }
});

// 現在跟到哪一台?(車次字串;沒跟車回 null)。tapPick 開著時回 'PICK:<各列文字>'
const followedNow = page => page.evaluate(() => {
  const el = document.getElementById('tapPick');
  if (el && !el.hidden) return 'PICK:' + [...el.querySelectorAll('.tp-row .tp-tx')].map(x => x.textContent.trim()).join(' | ');
  return state.followTrain ? String(state.followTrain.train) : null;
});

async function run(browser, tag, vp = { width: 1280, height: 800 }, coreOnly = false) {
  const { ctx, page } = await boot(browser, tag, vp);
  const org = await originOf(page);
  // 手機用真觸控(tap)不用滑鼠:這個 bug 在手指誤差下更兇,而 Leaflet 對 touch 走另一條事件路徑
  const click = async (x, y) => {
    if (vp.touch) await page.touchscreen.tap(org.left + x, org.top + y);
    else await page.mouse.click(org.left + x, org.top + y);
    await page.waitForTimeout(90);
  };

  // ── A 繪製端:真實畫面的 hits 必須帶命中框,尺寸等於這一幀「實際畫出來的東西」 ──
  // 兩種顯示模式都要量:z<11 畫圓點(12×12)、z≥11 畫車號牌(實算寬×15)。
  // 只量預設縮放會整段落在圓點模式,牌寬那條一次都沒驗到(第一版就是這樣假綠)。
  const measureA = async (label, wantTag) => {
    const a = await page.evaluate(() => {
      const FONT = getComputedStyle(document.body).fontFamily;
      const cx = document.getElementById('overlay').getContext('2d');
      cx.font = '700 10px ' + FONT;
      const tagMode = map.getZoom() >= 11;           // drawSched 的 showTrain
      const hits = (state._trainHits || []);
      const withBox = hits.filter(h => h.w > 0 && h.h > 0);
      // 期望值從繪製公式推導,不用寬鬆容差:drawTag 是 measureText+10、drawHSRTag 是 +13 再加兩端尖頭 2×5
      const want = h => cx.measureText(String(h.tr.train)).width + (isHSR(h.tr) ? 23 : 10);
      const mism = withBox.filter(h => tagMode ? (h.h !== 15 || Math.abs(h.w - want(h)) > 1) : (h.w !== 12 || h.h !== 12));
      return { z: map.getZoom(), tagMode, n: hits.length, boxed: withBox.length, mism: mism.length,
        bad: mism.slice(0, 3).map(h => ({ t: h.tr.train, hsr: isHSR(h.tr), w: +h.w.toFixed(1), h: h.h, want: +want(h).toFixed(1) })),
        sample: hits.slice(0, 3).map(h => ({ t: h.tr.train, w: Math.round(h.w), h: h.h })) };
    });
    ok(`[${tag}] A1 ${label} 每顆 _trainHits 都帶命中框 w/h`, a.n > 0 && a.boxed === a.n && a.tagMode === wantTag, `z=${a.z} 牌模式=${a.tagMode} hits=${a.n} 有框=${a.boxed} 樣本=${JSON.stringify(a.sample)}`);
    // 分母用「有框的筆數」會在全都沒框時假綠(第一版踩過),所以要求 boxed 與 hits 相等才算過
    ok(`[${tag}] A2 ${label} 命中框尺寸＝實際畫出來的大小`, a.n > 0 && a.boxed === a.n && a.mism === 0 && a.tagMode === wantTag, `不符=${a.mism}/${a.boxed}(總 ${a.n})${a.mism ? ' 例:' + JSON.stringify(a.bad) : ''}`);
  };
  if (!coreOnly) {
  await measureA('遠景圓點', false);
  // 放大到「某一台車所在的位置」再量,單純 setZoom 會落在沒有車的地方(量到 hits=0 的空綠)
  await page.evaluate(() => {
    window.__save = { c: map.getCenter(), z: map.getZoom() };
    const h = (state._trainHits || [])[0];
    if (h) map.setView(map.containerPointToLatLng([h.x, h.y]), 12); else map.setZoom(12);
  });
  await page.waitForTimeout(1500);
  await measureA('近景車號牌', true);
  await page.evaluate(() => map.setView(window.__save.c, window.__save.z));  // 還原,否則後面的實驗場會被挪到面板底下
  await page.waitForTimeout(1200);
  }

  // 實驗場:避開所有車站,否則量到的是車與站的勝負
  const spot = await findEmptySpot(page);
  const CX = spot.x, CY = spot.y;
  const spotOk = spot.x != null && spot.clearance > 60;
  ok(`[${tag}] 場地淨空(離最近車站 >60px)`, spotOk, `(${CX},${CY}) 淨空 ${spot.clearance.toFixed(0)}px`);
  if (!spotOk) { await ctx.close(); return; }   // 場地都沒有就別再往下跑,不然後面每條都是「零取樣的綠」

  // ── D3 迴歸(刻意排在最前面跑)────────────────────────────────────────────
  // 為什麼不排在 D1/D2 旁邊:freezeAndInject 會把 window.draw 換成空函式,而地圖的投影包裝層
  // 與相機記帳都住在 draw 裡。凍過之後 map.getZoom() 與 latLngToContainerPoint 會互相矛盾
  // (實測 375/360:getZoom() 回 46、部分站的容器座標飆到 2×10^12,解凍再 setView 也回不來)。
  // D3 驗的是「車與站的既有歧義選單」,不依賴前面任何情境,排在凍結之前就完全避開這件事。
  {
    // D3 迴歸:車與站黏在一起的既有歧義選單不可以被這次改動弄掉。
    //
    // 🔴 場地必須**原子**取:注入的 _trainHits 是釘死的容器座標,車站卻是每次呼叫都即時重投影的。
    //    首版先讀站座標、再注入、再點,三步之間地圖還在沉降 ⇒ 站漂走了 9.7~15.5px,而歧義門檻
    //    是 8px ⇒ 選單不彈、直接跟車。那是場地不穩不是產品行為:控制組(改動前)在同一條上
    //    768 綠、414 紅,純看地圖那一刻停在哪。所以改成同一個 evaluate 內「讀站座標＋把車放上去」。
    await resetFollow(page);
    // D1 的 setFollow 會把鏡頭帶到那台車並拉近;在窄視窗那個高倍率視野裡可能一個車站都沒有
    // (實測 375/360:在畫面內 0 個)。先把鏡頭放到一座車站上,這條驗的是「車站與列車的歧義選單」,
    // 鏡頭停在哪不是它要驗的東西。
    await page.evaluate(() => {
      // 🔴 先解凍 draw 再擺鏡頭。前面的 freezeAndInject 把 window.draw 換成空函式,而相機的
      //    自我記帳就住在 draw 裡——凍著它再 setView,縮放會失控(實測 375/360 量到 z=46、
      //    容器座標 2×10^12,整個投影已經沒有意義,所以「在畫面內 0 個站」)。
      //    解凍→擺好→下面的 evaluate 會再凍回去,注入的命中點才落在有意義的座標系上。
      if (window.__origDraw) { window.draw = window.__origDraw; }
      const st = (state.schedStations || [])[0];
      if (st) map.setView([st.lat, st.lon], 12);
    });
    await page.waitForTimeout(400);
    const still = await waitMapStill(page);
    const sp = await page.evaluate(() => {
      const r = document.getElementById('map').getBoundingClientRect();
      // 挑「真的在畫面上、且離畫面中心最近」的站:schedStations[0] 在窄視窗常常在畫面外
      // (實測 375 寬時 x=-46),點下去什麼都不會發生,判準會回一個跟產品無關的 null。
      // 邊界只留 8px:首版用 40/120px 想「把彈出的選單留在畫面內」,結果窄視窗一個候選都不剩
      // ——而選單自己的定位本來就會夾在畫面內(openTapPick 有 clamp),那個邊界是多餘的自殘。
      let best = null, bd = 1e9, onScreen = 0, clickable = 0;
      for (const st of (state.schedStations || [])) {
        const p = map.latLngToContainerPoint([st.lat, st.lon]);
        if (p.x < 8 || p.y < 8 || p.x > r.width - 8 || p.y > r.height - 8) continue;
        onScreen++;
        const el = document.elementFromPoint(r.left + p.x, r.top + p.y);
        if (!el || !el.closest('#map')) continue;   // 被面板/工具列蓋住的不算
        clickable++;
        const d = Math.hypot(p.x - r.width / 2, p.y - r.height / 2);
        if (d < bd) { bd = d; best = { x: p.x, y: p.y, name: st.name }; }
      }
      if (!best) return { skip: `畫面上沒有可點的車站(在畫面內 ${onScreen} 個、沒被蓋住 ${clickable} 個)`,
        diag: { n: (state.schedStations || []).length, mode: state.mode, z: map.getZoom(),
          rect: [Math.round(r.width), Math.round(r.height)],
          sample: (state.schedStations || []).slice(0, 3).map(st => { const p = map.latLngToContainerPoint([st.lat, st.lon]); return `${st.name}@${Math.round(p.x)},${Math.round(p.y)}`; }) } };
      // 同一拍把車放到站的位置上,兩者之間不給地圖任何移動的機會
      if (!window.__origDraw) { window.__origDraw = window.draw; }
      window.draw = () => {};
      const cx = document.getElementById('overlay').getContext('2d');
      cx.font = '700 10px ' + getComputedStyle(document.body).fontFamily;
      const trs = state.trains.slice(0, 2);
      state._trainHits = [
        { x: best.x, y: best.y, tr: trs[0], w: cx.measureText(String(trs[0].train)).width + 10 + (isHSR(trs[0]) ? 13 : 0), h: 15 },
        { x: best.x + 600, y: best.y + 400, tr: trs[1], w: cx.measureText(String(trs[1].train)).width + 10 + (isHSR(trs[1]) ? 13 : 0), h: 15 },
      ];
      // 回報這一拍的實際站距:>16 就是場地沒站穩,後面那條不判分
      let sd = 1e9;
      for (const st of (state.schedStations || [])) {
        const p = map.latLngToContainerPoint([st.lat, st.lon]);
        const d = Math.hypot(p.x - best.x, p.y - best.y); if (d < sd) sd = d;
      }
      return { ...best, stDist: +sd.toFixed(1), label: String(trs[0].train) };
    });
    if (sp.skip || sp.stDist > 8) {
      ok(`[${tag}] D3 場地成立(站在畫面上且點得到)`, false, (sp.skip || `站距 ${sp.stDist}px 超過歧義門檻,場地沒站穩`) + (sp.diag ? ' 診斷=' + JSON.stringify(sp.diag) : ''));
    } else {
      ok(`[${tag}] D3 場地成立(站在畫面上且點得到)`, true, `${sp.name}(${Math.round(sp.x)},${Math.round(sp.y)}) 站距=${sp.stDist}`);
      await click(sp.x, sp.y);
      const got3 = await followedNow(page);
      // 點完再量一次站距:注入的車釘在容器座標、站是即時投影,鏡頭只要在這幾十毫秒內動過就會漂開。
      // 漂了就是場地問題不是產品問題——要讓它自己說出來,不可以變成一句無從診斷的「沒彈選單」。
      const after = await page.evaluate(({ x, y }) => {
        let d = 1e9;
        for (const st of (state.schedStations || [])) {
          const p = map.latLngToContainerPoint([st.lat, st.lon]);
          const k = Math.hypot(p.x - x, p.y - y); if (k < d) d = k;
        }
        return +d.toFixed(1);
      }, { x: sp.x, y: sp.y });
      const hasBoth = typeof got3 === 'string' && got3.startsWith('PICK') && got3.includes('跟隨') && got3.includes('車站看板');
      if (!hasBoth && after > 8) {
        ok(`[${tag}] D3 場地成立(站在畫面上且點得到)`, false, `點擊當下站漂到 ${after}px(取樣時 ${sp.stDist}px,鏡頭靜止=${still})——場地問題`);
      } else {
        ok(`[${tag}] D3 車與站重疊仍彈原本的車/站選單`, hasBoth, `${String(got3).slice(0, 90)}　站距 取樣${sp.stDist}→點擊後${after} 鏡頭靜止=${still}`);
      }
    }
  }

  // ── B 命中端:點在「看得見的那張牌」上,就必須選到那台車 ────────────────────
  // 使用者的心智是「我點的是我看到的那張牌」,不是「我點的是離某個看不見的中心 16px 以內」。
  // 佈局:A(下層,先 push)在左、B(上層,後 push)在右,相距 d;掃 A 牌內「沒有被 B 牌蓋住」的
  // 每一個取樣點,逐點真的按下去。只要有一點選不到 A(得到 B、或什麼都沒選到)就是網友回報的那件事。
  // 取樣要覆蓋整張牌而不是只取可見區中點——中點必然離 A 較近,那個點永遠是綠的,測不出東西。
  const bFail = [];
  let bPts = 0;
  for (const d of [4, 8, 12, 16, 20, 26]) {
    const meta = await freezeAndInject(page, { pair: [{ x: CX - d, y: CY }, { x: CX, y: CY }] });
    const [A, B] = meta;
    if (A.label === B.label) continue;                     // 兩台同車次無法分辨(資料異常)
    const aL = (CX - d) - A.w / 2, aR = (CX - d) + A.w / 2;
    const bL = CX - B.w / 2, bR = CX + B.w / 2;
    for (let x = Math.ceil(aL) + 1; x <= aR - 1; x += 3) {
      for (const y of [CY - 6, CY, CY + 6]) {
        if (x >= bL && x <= bR) continue;                  // 這裡被 B 的牌蓋住,屬於重疊區(歸 C 判準)
        bPts++;
        await resetFollow(page);
        await click(x, y);
        const got = await followedNow(page);
        const pass = got === String(A.label) || (typeof got === 'string' && got.startsWith('PICK') && got.includes(String(A.label)));
        if (!pass && bFail.length < 8) bFail.push(`d=${d} 點(${x},${y})→ ${got}(期望 ${A.label})`);
        else if (!pass) bFail.push('…');
      }
    }
  }
  // bPts > 0 是必要的正向對照:取樣一個都沒跑到時 bFail 也是空的,沒有這條就會報「全通過」
  ok(`[${tag}] B 點下層車露出的牌面就跟到下層車`, bPts > 0 && bFail.length === 0, bFail.length ? `${bFail.filter(x => x !== '…').join(' ; ')}(共 ${bFail.length}/${bPts} 點失敗)` : `${bPts} 個取樣點全通過`);

  // ── C 兩張牌同時壓住點擊處 → 彈選單,且選單能跟到下層車 ────────────────────
  {
    await resetFollow(page);
    const meta = await freezeAndInject(page, { pair: [{ x: CX, y: CY }, { x: CX, y: CY }] });  // 完全重合
    await click(CX, CY);
    const got = await followedNow(page);
    const isPick = typeof got === 'string' && got.startsWith('PICK');
    ok(`[${tag}] C1 完全重合時彈出疊車選單`, isPick, String(got));
    if (isPick) {
      const rows = await page.$$('#tapPick .tp-row');
      ok(`[${tag}] C2 選單列出兩台車`, rows.length >= 2, `列數=${rows.length}`);
      if (rows.length >= 2) {
        // 🔧 原版判準是 `got2 === meta[1].label || got2 === meta[0].label`——**跟到原本那台也算過**,
        //    等於完全沒驗到「選單真的能切換」。改成:讀第二列自己寫的車次,點它,斷言跟到的就是那一台。
        //    期望值來自選單列的文字(使用者看得到的東西),不是來自 meta 的索引順序。
        const rowTx = (await rows[1].innerText()).trim();
        const wantNo = (rowTx.match(/(\d+)\s*次/) || [])[1];
        // 🔧 原版用 rows[1].click():手機組宣稱在測觸控,選單列卻走滑鼠。改成與地圖點擊同一條路徑。
        let clickErr = '';
        try {
          const bb = await rows[1].boundingBox();
          if (!bb) throw new Error('選單列量不到位置');
          const mx = bb.x + bb.width / 2, my = bb.y + bb.height / 2;
          if (vp.touch) await page.touchscreen.tap(mx, my); else await page.mouse.click(mx, my);
        } catch (e) { clickErr = ' 選單列點不下去:' + String(e).slice(0, 80); }
        await page.waitForTimeout(160);
        const got2 = await followedNow(page);
        ok(`[${tag}] C3 點第二列就跟到第二列那台`, !clickErr && !!wantNo && got2 === wantNo,
          `第二列寫「${rowTx.slice(0, 40)}」⇒ 期望跟到 ${wantNo}、實際 ${got2}${clickErr}`);
      } else ok(`[${tag}] C3 點第二列就跟到第二列那台`, false, '選單不足兩列');
    } else { ok(`[${tag}] C2 選單列出兩台車`, false, 'C1 未彈'); ok(`[${tag}] C3 點第二列跟到另一台`, false, 'C1 未彈'); }
  }

  // ── D 迴歸:單獨一台直接跟隨(不彈選單)、點空白不跟車 ──────────────────────
  {
    await resetFollow(page);
    const meta = await freezeAndInject(page, { pair: [{ x: CX, y: CY }, { x: CX + 400, y: CY + 300 }] });
    await click(CX, CY);
    const got = await followedNow(page);
    ok(`[${tag}] D1 單獨一台直接跟隨不彈選單`, got === String(meta[0].label), String(got));
    await resetFollow(page);
    await page.evaluate(() => { state._trainHits = []; state._freqHits = []; });
    await click(CX, CY);
    const got2 = await followedNow(page);
    ok(`[${tag}] D2 附近沒有車就不跟車`, got2 === null, String(got2));

    // D4 迴歸:「沒有疊牌時行為零變化」這句話要有守門人。
    // 🔴 補這條之前,把退路層的 `return near.length ? [near[0]] : []` 改成 `return near`
    //    (M3 突變)是 53/53 全過的——等於 index.html 註解裡那句「退路永遠 length<=1 ⇒
    //    疊車選單那條分支根本進不去」從來沒被驗過,只是一句話。
    //    這裡放兩台**都在 16px 命中半徑內、但都沒中框**的圓點車:正確行為是直接跟最近那台,
    //    退路層一旦回傳多筆就會冒出選單。
    //    12 是 DOT_HIT 的字面值,刻意不讀頁面的常數(判準的真值來源不得與實作同源)。
    await resetFollow(page);
    const near2 = await page.evaluate(({ cx, cy }) => {
      const trs = state.trains.slice(0, 2);
      const D = 12;                                    // 圓點命中框邊長
      state._trainHits = [
        { x: cx - 13, y: cy, tr: trs[0], w: D, h: D }, // |dx|=13 > D/2 ⇒ 沒中框;d=13 < 16 ⇒ 在半徑內
        { x: cx + 14, y: cy, tr: trs[1], w: D, h: D }, // 同上,且比第一台遠 ⇒ 不該是被選中的那台
      ];
      state._freqHits = [];
      return trs.map(t => String(t.train));
    }, { cx: CX, cy: CY });
    await click(CX, CY);
    const got4 = await followedNow(page);
    ok(`[${tag}] D4 兩台都在半徑內但都沒中框 直接跟最近那台不彈選單`,
      got4 === near2[0], `${String(got4).slice(0, 60)}　(期望 ${near2[0]},另一台 ${near2[1]})`);
  }

  await ctx.close();
}

// 手機組用真觸控跑核心判準:手指誤差正是這個 bug 的放大器,只驗桌面等於沒驗使用者的主要場景。
// 🔧 原版只有 1280 與 375——那是兩個媒體斷點的**兩端**,斷點之間的中間帶(414 手機大屏、
//    768 平板)一次都沒量到,而版面在那一段會換規則。360 是最窄的常見手機,牌擠在一起最兇。
//    中間三個只跑核心(場地/B/C/D):A 量的是繪製尺寸、與視窗寬無關,重複跑只是燒時間。
const VIEWPORTS = [
  [{ width: 1280, height: 800 }, false, '桌面1280'],
  [{ width: 375, height: 812, touch: true }, false, '手機375'],
  [{ width: 360, height: 780, touch: true }, true, '手機360'],
  [{ width: 414, height: 896, touch: true }, true, '手機414'],
  [{ width: 768, height: 1024, touch: true }, true, '平板768'],
];
// ONLY=chromium 只跑單引擎(突變回合用,省一半時間);不設就兩個引擎都跑
for (const [launcher, tag] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  if (process.env.ONLY && process.env.ONLY !== tag) continue;
  const browser = await launcher.launch();
  for (const [vp, coreOnly, vtag] of VIEWPORTS) {
    try { await run(browser, `${tag}/${vtag}`, vp, coreOnly); } catch (e) { ok(`[${tag}/${vtag}] 執行`, false, String(e).slice(0, 300)); }
  }
  await browser.close();
}

server.close();
const pass = results.filter(r => r.pass).length;
console.log(`\n=== 總計 ${pass}/${results.length} 通過 ===`);
if (allErrors.length) { console.log(`\n頁面錯誤 ${allErrors.length} 筆:`); allErrors.slice(0, 10).forEach(e => console.log('  ' + e)); }
process.exit(pass === results.length && allErrors.length === 0 ? 0 : 1);
