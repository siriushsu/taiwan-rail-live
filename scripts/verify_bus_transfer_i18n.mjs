// 公車轉乘卡 i18n 掃描：英文／日文各開一次三階段卡片（規劃／接近／已抵達），把「其餘 N 條」
// 「更多」「路線細節」「接續旅程」等會展開的區塊全部展開，掃視覺上還看得到的中文。
//
// 背景：bus-transfer-ui.js 有一批字串（serviceText／renderPlanRoute／renderSlackRoute／slackOf／
// slackVerdict，以及 renderPlanBody／renderApproachingBody 的非助手分支）目前在 index.html 的三個
// BusTransferUI.mount() 呼叫點都不會被走到（全部走 assistant:true 且 plan.routes 固定是空陣列，
// 或 phase:'arrived' 完全不傳 plan）——所以本掃描分兩段：
//   1) 真實車站看板（臺南 fixture）：已抵達卡＋展開列表／車輛／接續旅程，用真實資料驗證，
//      站牌／路線／終點名是資料值，用 DATA_EXEMPT 排除，框架文字必須零殘留。
//   2) 直接呼叫 window.BusTransferUI.mount() 灌入合成路線資料（規劃／接近／已抵達三階段都灌），
//      這是上述那批函式在目前 wiring 下唯一能被走到的路徑；合成資料全部用純 ASCII 字串，
//      不需要任何豁免，掃到任何中文都是真正的框架漏翻。
//
// 用法：node scripts/verify_bus_transfer_i18n.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const modules = process.env.WORKSPACE_NODE_MODULES;
const playwrightUrl = modules
  ? path.join(modules, 'playwright/index.mjs')
  : 'playwright';
const { chromium, webkit } = await import(playwrightUrl);

const findings = [];
const failures = [];
function note(scenario, items) {
  for (const item of items) findings.push({ scenario, ...item });
  const tag = items.length ? `✗ ${items.length}` : '✓';
  console.log(`${tag} ${scenario}${items.length ? '\n    ' + items.map(i => `${i.where} :: ${i.text}`).join('\n    ') : ''}`);
}

// 兩種語言不能用同一套判準：
// - en 沒有任何合法漢字／假名，「看到漢字」本身就是漏翻，直接全稱掃描（blanket）。
// - ja 的正確譯文本身大量使用漢字（甚至偶爾巧合跟繁中原文同形，例如字典裡的「接近」→「接近」
//   共 108 組，是既有、與本次改動無關的巧合，不是漏翻）——blanket 掃漢字對 ja 有系統性誤報，
//   必須改成「掃描到的文字裡，含不含任一個『繁中原文≠日文譯文』的字典鍵」（dict-driven）：
//   完整未翻的字串與只翻一半漏了片段的字串都抓得到，巧合同形鍵不會誤觸。
// 注意：extract 會被 .toString() 後在 page.evaluate 裡用 new Function 重建，只有原始碼字面會
// 被帶過去、外層閉包（包含模組層的 const）一律取不到，所以 EXCLUDE_SEL 直接寫死在函式內。
// ops：豁免字面值與樣板 regex 「合併成一份、按錨定強度（可辨識固定文字長度）由長到短排序」的
// 單一清單（見 scanRoot 的 buildOps）。曾經拆成「先剝完所有字面值、再跑所有樣板」兩輪，會誤報：
// 字面值「乗換案内」剛好是樣板「乗換案内：候補{n}路線と時刻表」的字面前綴，字面值那輪先跑就把
// 樣板自己的錨點挖掉，留下「：候補5路線と」這種斷尾殘留——不管哪一輪先跑都一樣，只要字面值跟
// 樣板分兩輪處理，短字面值就永遠可能搶在長樣板之前把它的地盤咬一塊下來。合併成一份用「錨定強度」
// 統一排序、逐一比對，才能保證更具體、錨點更長的規則永遠先拿到匹配機會。
function extract(rootSelector, ops) {
  const EXCLUDE_SEL = 'script, style, noscript';
  const compiled = (ops || []).map(op => op.type === 'pattern' ? { re: new RegExp(op.value, 'g') } : { literal: op.value });
  const strip = (text) => {
    let out = text;
    for (const op of compiled) out = op.re ? out.replace(op.re, '') : out.split(op.literal).join('');
    return out;
  };
  const roots = [...document.querySelectorAll(rootSelector)];
  const where = el => {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 3; n = n.parentElement) {
      parts.unshift(n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ').slice(0, 2).join('.') : ''));
    }
    return parts.join('>');
  };
  const out = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const raw = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(EXCLUDE_SEL)) continue;
      const r = parent.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ where: where(parent), raw, stripped: strip(raw) });
    }
    for (const el of [root, ...root.querySelectorAll('[title],[aria-label],[placeholder]')]) {
      if (el.closest(EXCLUDE_SEL)) continue;
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        const value = el.getAttribute(attr) || '';
        if (value) out.push({ where: where(el) + '@' + attr, raw: value, stripped: strip(value) });
      }
    }
  }
  return out;
}

// ja 一開始用「合併後整個 window.RAIL_I18N_MESSAGES.ja（2459 條，涵蓋成就／密度設定／法律頁等
// 全站無關字典）」當豁免來源試過，會誤報：字典裡任何短字面值或弱錨定樣板（例如某個完全無關
// 功能把「約」單獨翻成一個字、或「{n}分」只有 1 個字「分」當錨點）都可能是某段公車轉乘文字的
// 子字串，逐字／逐樣板剝除時會把它從「徒歩約{minutes}分」這種長樣板中間挖走一塊，留下「徒歩4」
// 這種斷尾殘留誤報——這不是排序能解的（不管先剝哪個，短鍵本來就不該對長句子的中段動手）。
// 改成「連核心 i18n/translations.js 一起載入」試過也不行：那份核心字典本身也有大量短樣板
// （'{n} 分'／'約 {distance}'／'{n} 秒'…），同樣的斷尾問題整批重現。
// 最終修法：豁免來源收斂到 i18n/bus-transfer-translations.js 自己的 ja 物件（範圍最小、碰撞面
// 最小），核心字典只手動白名單「bus-transfer-ui.js 真的會 tr() 到、但沒在本檔重複定義」的那
// 幾個詞——用 tr() 字面比對（mirror check_i18n.mjs 的 regex）掃過 bus-transfer-ui.js 全部
// tr() 呼叫，逐一核對本檔案是否已覆蓋，缺的只有 4 個（'分享中・管理'／'分享這段旅程'／
// '我上車了'／'取消'）；另外 '展開' 是透過 tr(view.planOpen ? '收合' : '展開') 三元運算式
// 呼叫，這類寫法連 check_i18n.mjs 自己的靜態掃描都掃不到（regex 只認得 tr(' 緊接引號），
// 純用人工讀原始碼找到、一併補上（'收合' 本檔已有，不必補）。
const CORE_REUSE_JA = {
  '分享中・管理': '共有中・管理',
  '分享這段旅程': 'この旅程を共有',
  '我上車了': '乗車する',
  '取消': 'キャンセル',
  '展開': '開く',
};
const busJaCtx = { window: {} };
vm.createContext(busJaCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'i18n/bus-transfer-translations.js'), 'utf8'), busJaCtx, { filename: 'i18n/bus-transfer-translations.js' });
const BUS_JA = busJaCtx.window.RAIL_I18N_MESSAGES.ja;
const busJaValues = Object.values(BUS_JA).flatMap(v => (v && typeof v === 'object') ? Object.values(v) : [v]).filter(Boolean)
  .concat(Object.values(CORE_REUSE_JA));
const WILDCARD_MARKER = '@@WILDCARD@@'; // 不用控制字元當標記，避免工具呼叫邊界把它消毒掉（曾實測被吃成空白）
const anchorLen = v => v.replace(/\{[a-zA-Z0-9_]+\}/g, '').length; // 樣板扣掉 {var} 後剩的固定文字長度；字面值就是自己整串的長度
function toPatternSrc(v) {
  return v
    .replace(/\{[a-zA-Z0-9_]+\}/g, WILDCARD_MARKER)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 萬用字元除了不吃漢字／假名，也不吃全形標點（U+3000-303F 中文標點、U+FF00-FFEF 全形符號，
    // 含「：」）——這類標點常常就是樣板之間的字面膠水（例如「照会：{age}」的「：」），
    // 一旦被萬用字元吃掉，換樣板自己的字面錨點就對不上、留下斷尾殘留。
    .split(WILDCARD_MARKER).join('[^㐀-鿿぀-ヿ　-〿＀-￯]*?');
}
// 字面值與樣板合併成一份、按錨定強度由長到短排序（見上面 extract() 開頭那則說明），
// 不能分兩輪跑。
const JA_OPS = busJaValues
  .map(v => v.includes('{') ? { type: 'pattern', value: toPatternSrc(v), anchor: anchorLen(v) } : { type: 'literal', value: v, anchor: anchorLen(v) })
  .sort((a, b) => b.anchor - a.anchor);

async function scanRoot(page, rootSelector, exempt = [], lang = 'en') {
  // DATA_EXEMPT（資料值字面）跟 ja 字典的 ops 一起排序：資料值理論上也可能是某個樣板的字面
  // 前綴／後綴，混在同一份由長到短排序的清單裡才能保證一致的優先序。
  const ops = lang === 'ja'
    ? [...exempt.map(v => ({ type: 'literal', value: v, anchor: v.length })), ...JA_OPS].sort((a, b) => b.anchor - a.anchor)
    : exempt.map(v => ({ type: 'literal', value: v, anchor: v.length }));
  return page.evaluate(({ rootSelector, extractSrc, ops }) => {
    const extract = new Function('rootSelector', 'ops', `${extractSrc}\nreturn extract(rootSelector, ops);`);
    // en 額外也擋假名字母（日文殘留一樣算漏翻），但要排除假名區段裡混的標點：
    // U+30FB「・」全形中點是整個 App（含 en/ja）共用的欄位分隔符號，U+30A0/U+30FC 同理是
    // 假名區段裡的符號不是字母，三個一起掃會把純 ASCII＋分隔符的合法英文句子也誤判成漏翻。
    const han = /[㐀-鿿ぁ-ゖゝ-ゟァ-ヺヽ-ヿ]/;
    return extract(rootSelector, ops).filter(item => han.test(item.stripped)).map(({ where, raw }) => ({ where, text: raw }));
  }, { rootSelector, extractSrc: extract.toString(), ops });
}

// 臺南 fixture 的站牌／路線／終點名——都是資料值，任何語言都不翻，見任務規則。
// '台南'（台，非臺）：站名經 index.html 的 stationName()->i18nCatalogValue('systems',...) 查表，
// 台鐵站名目錄本身就是這個異體字版本（跟 fixture 的「臺南」是同一站的兩種寫法），一樣是資料值。
const DATA_EXEMPT = ['臺南火車站（北站）', '安平／億載金城', '南紡購物中心', '億載金城', '小西門', '藍幹線', '臺南', '台南'];

async function realBoardFlow(browserType, lang, base) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 900 }, isMobile: true, hasTouch: true });
  await context.addInitScript(lang => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-language', lang);
  }, lang);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(`${base}/?lang=${lang}`, { waitUntil: 'domcontentloaded' });
    // 用 #howtoGo／#trainSearch 這些語系無關的穩定 id，不用中文按鈕文字比對
    // （比照 verify_bus_transfer_ui_browser.mjs 既有的 translated() 寫法）。
    const start = page.locator('#howtoGo');
    if (await start.isVisible().catch(() => false)) await start.click();
    const input = page.locator('#trainSearch');
    if (!await input.isVisible()) await page.locator('#tabSearch').tap();
    await input.fill('臺南');
    await page.locator('.stn-row').first().waitFor({ state: 'visible' });
    await page.locator('.stn-row').first().click();
    await page.locator('[data-bus-transfer-slot]').waitFor({ state: 'visible' });

    await page.locator('button.btu-primary').tap();
    await page.locator('.btu-rowbtn').first().waitFor({ state: 'visible' });
    note(`${lang}/${browserType.name()} 已抵達卡（展開前）`, await scanRoot(page, '[data-bus-transfer-slot]', DATA_EXEMPT, lang));

    const more = page.locator('[data-btu-act="more"]');
    if (await more.isVisible().catch(() => false)) await more.tap();
    note(`${lang}/${browserType.name()} 已抵達卡（其餘筆數展開後）`, await scanRoot(page, '[data-bus-transfer-slot]', DATA_EXEMPT, lang));

    await page.locator('.btu-rowbtn').first().tap();
    await page.waitForTimeout(400);
    note(`${lang}/${browserType.name()} 車輛路線明細（已點開一路）`, await scanRoot(page, '[data-bus-transfer-slot]', DATA_EXEMPT, lang));

    const continueBtn = page.locator('[data-btu-act="journey-pick"]').first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.tap();
      const alight = page.locator('[data-btu-role="alight"]');
      await alight.waitFor({ state: 'visible' });
      await alight.selectOption({ index: 0 });
      note(`${lang}/${browserType.name()} 選下車站面板`, await scanRoot(page, '[data-bus-transfer-slot]', DATA_EXEMPT, lang));
      await page.locator('[data-btu-act="journey-start"]').tap();
      await page.waitForTimeout(300);
      note(`${lang}/${browserType.name()} 接續旅程（等車中）`, await scanRoot(page, '.btu-journey', DATA_EXEMPT, lang));
      const board = page.locator('[data-btu-act="journey-board"]');
      if (await board.isVisible().catch(() => false)) {
        await board.tap();
        await page.waitForTimeout(300);
        note(`${lang}/${browserType.name()} 接續旅程（搭車中）`, await scanRoot(page, '.btu-journey', DATA_EXEMPT, lang));
      }
    }
    if (errors.length) failures.push(`${lang}/${browserType.name()} 真實看板流程頁面錯誤：${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close();
  }
}

// 合成路線資料，全部純 ASCII——task 已確認的 9 個受影響函式，用 assistant:false 直接餵資料，
// 因為目前 index.html 沒有任何呼叫點會用非空 routes 走到這條路徑（見檔頭說明）。
function syntheticRoutes() {
  const now = Date.now();
  return [
    { // 完整欄位，一般案例
      routeName: 'R1', subRouteName: '', headsign: 'DestOne', boardStopName: 'BoardStopOne',
      alightStopName: 'AlightStopOne', boardStopPosition: { lat: 23.0, lon: 120.2 },
      access: { estimatedWalkMin: 4, estimatedWalkM: 260 },
      service: { firstBus: '06:00', lastBus: '23:00', headwayMin: 12, days: 'weekday' },
      busEtaAt: new Date(now + 9 * 60000).toISOString(),
    },
    { // 沒有站牌名／沒有 access／沒有 service → 站牌未定／距離未知／營運時間未提供
      routeName: 'R2', subRouteName: 'R2sub', headsign: '', boardStopName: '',
      alightStopName: '', boardStopPosition: null, access: null, service: null,
    },
    { // 只有 lastBus 沒有 firstBus → 末班 {time}；沒有 headwayMin → 無法估算等候
      routeName: 'R3', subRouteName: '', headsign: 'DestThree', boardStopName: 'BoardStopThree',
      alightStopName: 'AlightStopThree', boardStopPosition: { lat: 23.01, lon: 120.21 },
      access: { estimatedWalkMin: 6, estimatedWalkM: 400 },
      service: { lastBus: '22:30', days: 'weekday' },
      busEtaAt: new Date(now + 40 * 60000).toISOString(),
    },
    { // 沒有 busEtaAt → slackVerdict unknown；沒有 access → slackOf 無法估算
      routeName: 'R4', subRouteName: '', headsign: 'DestFour', boardStopName: 'BoardStopFour',
      alightStopName: 'AlightStopFour', boardStopPosition: { lat: 23.02, lon: 120.22 },
      access: null, service: { headwayMin: 20 },
    },
    { // busEtaAt 早於預估抵達時間扣掉步行與安全緩衝 → slackVerdict miss；lastBus 早於抵達 clock → caveat
      routeName: 'R5', subRouteName: '', headsign: 'DestFive', boardStopName: 'BoardStopFive',
      alightStopName: 'AlightStopFive', boardStopPosition: { lat: 23.03, lon: 120.23 },
      access: { estimatedWalkMin: 15, estimatedWalkM: 900 },
      service: { headwayMin: 30, lastBus: '00:01' },
      busEtaAt: new Date(now + 2 * 60000).toISOString(),
    },
  ];
}

async function syntheticMountFlow(browserType, lang, base) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 380, height: 900 } });
  await context.addInitScript(lang => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-language', lang);
  }, lang);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(`${base}/?lang=${lang}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.BusTransferUI);

    await page.evaluate(({ routes }) => {
      const root = document.createElement('div');
      root.id = 'i18n-synth-planning';
      root.style.cssText = 'position:fixed;left:4px;top:4px;width:340px;max-height:1400px;overflow:auto;z-index:99999;background:#fff';
      document.body.appendChild(root);
      window.BusTransferUI.mount({
        root, stationId: 'RI:SYNTH_PLAN', stationName: 'SynthStation', phase: 'planning', assistant: false, translate: window.t,
        viewKey: 'RI:SYNTH_PLAN|i18n-synth-planning',
        plan: { stationPosition: { lat: 23, lon: 120.2 }, routes },
      });
    }, { routes: syntheticRoutes() });
    note(`${lang}/${browserType.name()} 合成規劃卡（展開前）`, await scanRoot(page, '#i18n-synth-planning', [], lang));
    const more = page.locator('#i18n-synth-planning [data-btu-act="more"]');
    if (await more.isVisible().catch(() => false)) await more.click();
    note(`${lang}/${browserType.name()} 合成規劃卡（其餘條展開後）`, await scanRoot(page, '#i18n-synth-planning', [], lang));

    await page.evaluate(({ routes }) => {
      const root = document.createElement('div');
      root.id = 'i18n-synth-approach';
      root.style.cssText = 'position:fixed;left:4px;top:4px;width:340px;max-height:1400px;overflow:auto;z-index:99999;background:#fff';
      document.body.appendChild(root);
      window.BusTransferUI.mount({
        root, stationId: 'RI:SYNTH_APPR', stationName: 'SynthStation', phase: 'approaching', assistant: false, translate: window.t,
        viewKey: 'RI:SYNTH_APPR|i18n-synth-approach',
        trainEta: { arrivalAt: new Date(Date.now() + 12 * 60000).toISOString(), ageSec: 5, source: 'TRA timetable estimate' },
        plan: { stationPosition: { lat: 23, lon: 120.2 }, routes },
      });
    }, { routes: syntheticRoutes() });
    note(`${lang}/${browserType.name()} 合成接近卡（展開前）`, await scanRoot(page, '#i18n-synth-approach', [], lang));
    const planToggle = page.locator('#i18n-synth-approach [data-btu-act="plan"]');
    if (await planToggle.isVisible().catch(() => false)) await planToggle.click();
    note(`${lang}/${browserType.name()} 合成接近卡（其餘候選路線展開後）`, await scanRoot(page, '#i18n-synth-approach', [], lang));

    await page.evaluate(({ routes }) => {
      const root = document.createElement('div');
      root.id = 'i18n-synth-arrived';
      root.style.cssText = 'position:fixed;left:4px;top:4px;width:340px;max-height:1400px;overflow:auto;z-index:99999;background:#fff';
      document.body.appendChild(root);
      window.BusTransferUI.mount({
        root, stationId: 'RI:SYNTH_ARR', stationName: 'SynthStation', phase: 'arrived', assistant: false, translate: window.t,
        viewKey: 'RI:SYNTH_ARR|i18n-synth-arrived',
        plan: { stationPosition: { lat: 23, lon: 120.2 }, routes },
      });
    }, { routes: syntheticRoutes() });
    note(`${lang}/${browserType.name()} 合成已抵達卡摘要（展開前）`, await scanRoot(page, '#i18n-synth-arrived', [], lang));
    const arrPlanToggle = page.locator('#i18n-synth-arrived [data-btu-act="plan"]');
    if (await arrPlanToggle.isVisible().catch(() => false)) await arrPlanToggle.click();
    note(`${lang}/${browserType.name()} 合成已抵達卡摘要（轉乘規劃展開後）`, await scanRoot(page, '#i18n-synth-arrived', [], lang));

    if (errors.length) failures.push(`${lang}/${browserType.name()} 合成掛載頁面錯誤：${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const server = spawn(NODE, [path.join(ROOT, 'scripts', 'verify_bus_transfer_ui_server.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.on('exit', () => server.kill('SIGTERM')); // 等待就緒逾時的 reject 在 try 外面，finally 收不到
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1)); // 單打 pid 的 kill／pkill -f 不會觸發 'exit'，轉成 process.exit 讓上一行收得到
  let out = '', err = '';
  server.stdout.setEncoding('utf8'); server.stderr.setEncoding('utf8');
  server.stdout.on('data', c => out += c);
  server.stderr.on('data', c => err += c);
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture server 啟動逾時\n${out}\n${err}`)), 10_000);
    server.stdout.on('data', () => {
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture server 提前結束（${code}）\n${out}\n${err}`)); });
  });
  try {
    for (const [engine, lang] of [[chromium, 'en'], [chromium, 'ja'], [webkit, 'en'], [webkit, 'ja']]) {
      await realBoardFlow(engine, lang, base);
      await syntheticMountFlow(engine, lang, base);
    }
  } finally {
    server.kill('SIGTERM');
  }
  console.log(`\n共 ${findings.length} 處中文殘留${failures.length ? '；另有 ' + failures.length + ' 項錯誤：\n' + failures.join('\n') : ''}`);
  if (findings.length || failures.length) process.exit(1);
  console.log('公車轉乘卡 en/ja 三階段＋展開 i18n 掃描全部通過。');
}
await main();
