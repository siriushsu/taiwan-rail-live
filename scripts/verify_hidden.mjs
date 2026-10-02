// 驗「2026-07-29 下架的兩個功能，預設真的看不到」——懸賞(GPS 校正旅程)與收集地圖。
// 為什麼要單獨一支：verify_bounty / verify_checkin 驗的是「實作對不對」，它們一律帶 ?bounty=1
// ／?collectmap=1 把功能點亮；那兩支全綠完全不保證使用者看到的是藏起來的樣子。
//
// 判準寫成雙向，否則會是一支恆綠的假閘門（心得 35）：
//   ・關掉時：三顆入口都不在、說明中心四節都不在、開機不打 /api/bounty-me、錄製不接回、護照沒有籌碼列
//   ・點亮時：同樣那些東西都回得來（證明斷言真的在看那些元素，不是選擇器打錯永遠找不到）
//   ・控制組：打卡站章／搭乘模式（刻意留著的）在兩種情況下都還在
//
//   用法：node scripts/verify_hidden.mjs [http://127.0.0.1:5178]
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const APP_GLOBALS = { RAIL_MUSIC_AVAILABLE: true, RAIL_ONLINE_BASEMAPS_AVAILABLE: true,
  RAIL_APP_CONFIG: { satRetina: true } };

// G0 自檢：伺服器吐的必須就是這棵樹的 index.html（這台機器同時有 20+ 個 worktree 各自起 server）
{
  const served = createHash('md5').update(Buffer.from(
    await (await fetch(BASE + '/index.html')).arrayBuffer())).digest('hex');
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  ok('G0 伺服器吐的 index.html ＝ 這棵工作樹的', served === disk, `${served.slice(0, 8)} vs ${disk.slice(0, 8)}`);
  if (served !== disk) { console.log('\n驗錯目標，停手'); process.exit(1); }
}

const browser = await chromium.launch();

// 一趟＝一個乾淨 context（sessionStorage 不能跨情境互相污染，旗標就記在那裡）
async function probe(qs, label, demoRec = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(g => { Object.assign(window, g); }, APP_GLOBALS); // 假裝原生殼：App 端的入口也要一起驗
  const page = await ctx.newPage();
  const apiHits = [];
  page.on('request', r => { if (r.url().includes('/api/bounty-me')) apiHits.push(r.url()); });
  // 先塞一筆「錄到一半」的旅程，驗開機會不會把人丟回錄製畫面
  await ctx.addInitScript(demo => {
    try {
      localStorage.setItem('trainmap-bounty-recording-v1', JSON.stringify({
        startedAt: Date.now() - 60000, cardId: 'probe', card: { seg_key: 'x', kind: 'track' },
        _buf: [{ t: Date.now() - 30000, d: 1000 }], segs: {}, demo,
      }));
    } catch (e) {}
  }, demoRec);
  await page.goto(BASE + '/index.html' + qs, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
  await page.waitForTimeout(1200);
  const seen = await page.evaluate(() => {
    // 種一段「搭過」的紀錄，讓 buildLineBars() 有理由長出收集地圖鈕（沒資料時它本來就不出現，
    // 那樣的「找不到鈕」是零資訊）。
    const net = lineNetwork();
    const rec = [...net.values()].find(r => r.segs.length >= 1);
    if (rec) {
      const sg = {}; sg[rec.segs[0].key] = 1;
      localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st: {}, sg }));
    }
    localStorage.setItem('trainmap-passport-open', '1'); // 展開護照：收合時整個 .ph-body 都是 display:none，量「看不看得到」才有意義
    renderPassport();
    const chipsEl = document.querySelector('#passport .ph-chips');
    const help = (typeof HELP_GROUPS !== 'undefined' ? HELP_GROUPS : [])
      .flatMap(g => g.secs || []).filter(it => !it.avail || it.avail()).map(it => it.key);
    return {
      seededRide: !!rec,
      bountyBtn: !!document.querySelector('#passport [data-act="bountyboard"]'),
      collectBtn: !!document.querySelector('#passport [data-act="collectmap"]'),
      correctSec: !!document.querySelector('#passport .ph-sec[data-sec="correct"]'),
      chipsRow: !!chipsEl,
      chipsRowShown: !!chipsEl && chipsEl.offsetParent !== null && chipsEl.getBoundingClientRect().height > 0,
      help,
      recording: !!state.recording,
      savedRecording: localStorage.getItem('trainmap-bounty-recording-v1') !== null,   // 裝置上保存的那一筆還在（不接回不等於刪掉）
      recordBarShown: !!(document.getElementById('recordBar') && !document.getElementById('recordBar').hidden),
      // 控制組：刻意留著的打卡家族（用說明中心的節，跟 H4/H11 同一個機制，不必另外種站章資料）
    };
  });
  await ctx.close();
  return { ...seen, apiHits: apiHits.length, label };
}

const off = await probe('', '預設');
const on = await probe('?bounty=1&collectmap=1', '點亮');
// 示範流程（備援站看設計用）：錄程是假的、不需要新版 App，所以示範保存的那一筆照舊接回——點亮時「會接回」的對照改看這一個
const onDemo = await probe('?demo=bounty', '示範', true);

const HELP_KEYS = ['bounty', 'bountyrec', 'bountyme', 'collectmap'];
const helpOff = HELP_KEYS.filter(k => off.help.includes(k));
const helpOn = HELP_KEYS.filter(k => on.help.includes(k));

ok('H0 兩種情境都真的種到了乘車記錄（沒種到的話「找不到鈕」是零資訊）',
  off.seededRide && on.seededRide, `off=${off.seededRide} on=${on.seededRide}`);
ok('H1 預設看不到懸賞板入口', !off.bountyBtn);
ok('H2 預設看不到收集地圖入口', !off.collectBtn);
ok('H3 預設看不到護照的「校正貢獻」整節', !off.correctSec);
ok('H4 預設說明中心沒有那四節', helpOff.length === 0, `還看得到：${helpOff.join('、') || '無'}`);
ok('H5 預設開機不打 /api/bounty-me（那一節不渲染，問了也是白花 Worker 呼叫）',
  off.apiHits === 0, `${off.apiHits} 次`);
ok('H6 預設不把人接回錄製畫面（裝置上留著一筆錄到一半的旅程）',
  !off.recording && !off.recordBarShown, `state.recording=${off.recording} 常駐列=${off.recordBarShown}`);
const KEEP_KEYS = ['stncollect', 'riding'];
const keepOff = KEEP_KEYS.filter(k => off.help.includes(k));
ok('H7 控制組：刻意留著的打卡站章／搭乘模式沒被一起藏掉',
  keepOff.length === KEEP_KEYS.length, `看得到：${keepOff.join('、') || '無'}`);

ok('H8 點亮後懸賞板入口回得來（證明 H1 不是選擇器打錯的恆綠）', on.bountyBtn);
ok('H9 點亮後收集地圖入口回得來（H2 同理）', on.collectBtn);
ok('H10 點亮後「校正貢獻」節回得來（H3 同理）', on.correctSec);
ok('H11 點亮後說明中心四節回得來（H4 同理）',
  helpOn.length === HELP_KEYS.length, `看得到：${helpOn.join('、') || '無'}`);
// 現行 App 殼（網頁包成的那一版）錄不了程，開機不接回舊的錄製、也不開始取樣；所以「點亮後會接回」的對照改用示範流程
ok('H12 點亮後真的會接回錄製（示範流程 ?demo=bounty 保存著一筆示範的錄製；H6 同理，證明是旗標擋的不是那筆資料壞了）',
  onDemo.recording && onDemo.recordBarShown, `state.recording=${onDemo.recording} 常駐列=${onDemo.recordBarShown}`);
ok('H15 點亮後的現行 App 殼不接回錄製（要更新 App 才錄得了程），而且裝置上保存的那一筆還在（不刪、不改）',
  !on.recording && !on.recordBarShown && on.savedRecording, `state.recording=${on.recording} 常駐列=${on.recordBarShown} 保存的還在=${on.savedRecording}`);
ok('H13 預設看不到護照的籌碼列（護照已展開：整列不在 DOM，也沒有任何看得到的籌碼列）',
  !off.chipsRow && !off.chipsRowShown, `在 DOM=${off.chipsRow} 看得到=${off.chipsRowShown}`);
ok('H14 點亮後籌碼列看得到（H13 同理，證明不是選擇器打錯的恆綠：護照展開、列在 DOM、有高度、沒被藏掉）',
  on.chipsRow && on.chipsRowShown, `在 DOM=${on.chipsRow} 看得到=${on.chipsRowShown}`);

await browser.close();
const bad = R.filter(r => !r.p).length;
console.log(`\n${R.length - bad}/${R.length} 通過`);
process.exit(bad ? 1 : 0);
