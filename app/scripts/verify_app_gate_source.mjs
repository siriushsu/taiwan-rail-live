#!/usr/bin/env node
// 強制更新閘門＋本版內建「更新了什麼」的判準(2026-08-22, 1.4.9 build 75 起)。
// 背景:build 74 實踩「剛更新完的彈窗抓 iTunes lookup 的線上版 releaseNotes,裝了 1.4.9
// 卻彈 1.4.8 的文」;同輪裁示加遠端最低版本閘門(fail-open)。
// 行為判準:cmpVer/appUpdateState/appGateShouldBlock 是純函式,從 index.html 抽出來真跑;
// 源碼判準:彈窗餵內建文案不餵 lookup notes、閘門無關閉鈕、消費端壞值不短路閘門。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail}`); }
};

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ── 抽純函式真跑 ─────────────────────────────────────────────────────────
function extractFn(name) {
  const m = html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`抽不到 function ${name}`);
  return m[0];
}
const fnSrc = [extractFn('cmpVer'), extractFn('appUpdateState'), extractFn('appGateShouldBlock')].join('\n');
const { appUpdateState, appGateShouldBlock } = new Function(
  `${fnSrc}\nreturn { appUpdateState, appGateShouldBlock };`)();

// G1 「剛更新完」不依賴 lookup:latest=null(斷網/lookup 掛)也要能判 showWhatsNew。
// build 74 之前這條是 false——c===null 直接回 none,冷啟沒網路永遠不彈。
const stFresh = { seen: '1.4.8', dismissed: null, whatsnewSeen: null };
ok('G1 lookup 掛掉(latest=null)仍判得出「剛更新完」',
   appUpdateState('1.4.9', null, stFresh).showWhatsNew === true, JSON.stringify(appUpdateState('1.4.9', null, stFresh)));
// G1r 反向:同版(seen===mine)不彈、看過(whatsnewSeen===mine)不彈——別把「解耦」做成「永遠彈」。
ok('G1r 同版不彈', appUpdateState('1.4.9', null, { seen: '1.4.9', whatsnewSeen: null }).showWhatsNew === false);
ok('G1r2 看過不彈', appUpdateState('1.4.9', null, { seen: '1.4.8', whatsnewSeen: '1.4.9' }).showWhatsNew === false);
// G1u 有新版可裝時升級橫幅優先,不彈 whatsnew(維持原設計)。
const up = appUpdateState('1.4.8', '1.4.9', stFresh);
ok('G1u 有新版時 hasUpdate=true 且不彈 whatsnew', up.hasUpdate === true && up.showWhatsNew === false, JSON.stringify(up));

// G2 彈窗餵的是內建文案,不是 lookup 的 notes:showWhatsNew 分支裡只准出現 appWhatsNewText,
// 不准出現 latest(.notes/.v)——那正是 build 74 的缺陷形狀。
const wnBranchRaw = (html.match(/if \(state\.showWhatsNew[\s\S]*?appverWrite\(APPVER_KEYS\.whatsnew[\s\S]*?\n  \}/) || [''])[0];
// 剝注釋再比:注釋裡本來就會提到 latest.notes(講為什麼不能用它)。
const wnBranch = wnBranchRaw.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
ok('G2 showWhatsNew 分支存在且餵內建文案', wnBranch.includes('appWhatsNewText()'), wnBranchRaw.slice(0, 80));
ok('G2r showWhatsNew 分支不再引用 latest', !/latest\./.test(wnBranch), wnBranch);

// G3 閘門 fail-open 行為表:唯一會擋的形狀=「兩邊都是合法版號且本機較舊」。
const T = (mine, min) => appGateShouldBlock(mine, min);
ok('G3a 沒設定(null)不擋', T('1.4.9', null) === false);
ok('G3b 缺欄位(undefined)不擋', T('1.4.9', undefined) === false);
ok('G3c 空字串不擋', T('1.4.9', '') === false);
ok('G3d 壞格式(1.4.x)不擋', T('1.4.9', '1.4.x') === false);
ok('G3e 本機版本壞(網站版 undefined)不擋', T(undefined, '1.4.8') === false);
ok('G3f 同版不擋', T('1.4.9', '1.4.9') === false);
ok('G3g 本機較新不擋', T('1.4.9', '1.4.8') === false);
// G3 反向對照(這條紅了=閘門根本沒有牙,「乾脆全不擋」也能讓上面七條全綠):
ok('G3r 本機較舊要擋', T('1.4.8', '1.4.9') === true);
ok('G3r2 多段版號較舊要擋', T('1.4.8', '1.4.10') === true);

// G4 擋下畫面的源碼契約:無關閉鈕、有前往更新、掛 body 層。
const gateFn = (html.match(/function appGateCheck\([\s\S]*?\n\}/) || [''])[0];
ok('G4a appGateCheck 存在', gateFn.length > 0);
ok('G4b 無關閉鈕(不含 aria-label="關閉"/×)', !/關閉|×/.test(gateFn), '(強更畫面不該可關)');
ok('G4c 有「前往更新」且開商店連結(平台分流版)', gateFn.includes('前往更新') && gateFn.includes('storeUrl()'));
ok('G4d 掛 body 層', gateFn.includes('document.body.appendChild'));
ok('G4e 重複呼叫不疊層', gateFn.includes("getElementById('appGate')"));

// G5 消費端:street 壞值不得短路閘門——appGateCheck 的呼叫必須在 street 值判斷之外。
const feed = (html.match(/fetch\(apiUrl\('api\/basemap-src'\)[\s\S]{0,600}/) || [''])[0];
ok('G5 basemap-src 消費端有呼叫 appGateCheck', feed.includes('appGateCheck(d)'), feed.slice(0, 120));
ok('G5r street 壞值不 early-return(舊的 if…return 形狀已移除)', !/!== 'ofm'[\s\S]{0,40}return/.test(feed));

// G6 worker 端:minAppVersion 有格式閘且沒設=null。
const worker = readFileSync(join(ROOT, 'worker.js'), 'utf8');
const bs = (worker.match(/async function basemapSrc[\s\S]*?\n\}/) || [''])[0];
ok('G6a worker 下發 minAppVersion', bs.includes('minAppVersion'));
ok('G6b 有格式驗證(regex)且 fallback null', /\^\\d\+\(\\\.\\d\+\)\*\$/.test(bs) && bs.includes(': null'));

// G8 跨平台:index 是 iOS/Android 共用檔——商店連結要分流、Android 不得拿 iTunes lookup
// (查的是 iOS 版號)當升級資訊源。
ok('G8a 商店連結有平台分流(storeUrl)', /getPlatform\(\) === 'android' \? PLAY_STORE_URL : APP_STORE_URL/.test(html));
ok('G8b 閘門按鈕走 storeUrl() 不寫死 Apple', gateFn.includes('storeUrl()') && !gateFn.includes('APP_STORE_URL,'));
const flv = (html.match(/async function fetchLatestAppVersion[\s\S]*?\n\}/) || [''])[0];
ok('G8c Android 上 lookup 直接回 null', /'android'\) return null/.test(flv), flv.slice(0, 120));

// G7 prepare-web 注入 RAIL_APP_WHATS_NEW(verify-release 另有版號一致 gate,這裡只驗注入存在)。
const prep = readFileSync(join(ROOT, 'app/scripts/prepare-web.mjs'), 'utf8');
ok('G7 prepare-web 注入 RAIL_APP_WHATS_NEW', prep.includes('window.RAIL_APP_WHATS_NEW='));
const srm = readFileSync(join(ROOT, 'app/scripts/set-release-mode.mjs'), 'utf8');
ok('G7b set-release-mode 把 why 傳進 RAIL_WHATS_NEW', srm.includes('env.RAIL_WHATS_NEW = cfg.why'));

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
