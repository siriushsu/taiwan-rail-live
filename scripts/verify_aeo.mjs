import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = message => failures.push(message);

const generatedRoots = ['about', 'accuracy', 'data-sources', 'stations', 'en/stations', 'ja/stations'];
const listHtml = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? listHtml(target) : entry.name.endsWith('.html') ? [target] : [];
});
const pages = generatedRoots.flatMap(name => listHtml(path.join(root, name)));
// 中文車站頁（既有的內容斷言只針對這一組）；en／ja 車站頁另列，套用同一組結構檢查。
const langOf = file => path.relative(root, file).startsWith(`en${path.sep}`) ? 'en' : path.relative(root, file).startsWith(`ja${path.sep}`) ? 'ja' : 'zh-Hant';
const isStationPage = file => file.includes(`${path.sep}stations${path.sep}`) && path.basename(path.dirname(file)) !== 'stations';
const stationPages = pages.filter(file => langOf(file) === 'zh-Hant' && isStationPage(file));
const stationPagesByLang = { en: pages.filter(file => langOf(file) === 'en' && isStationPage(file)), ja: pages.filter(file => langOf(file) === 'ja' && isStationPage(file)) };

// 3 個說明頁 + 車站索引 1 + 車站 23（zh），en／ja 各 索引 1 + 車站 23。
// 09-30 P2：車站頁 20 → 23（加苗栗、彰化、雲林三個高鐵站）、加 en／ja 兩套。
if (pages.length !== 3 + 24 + 24 + 24) fail(`AEO HTML 應為 75 頁（3 個說明頁 + 三語各 1 個車站索引 + 三語各 23 車站），實際 ${pages.length}`);
if (stationPages.length !== 23) fail(`中文車站資料頁應為 23 頁，實際 ${stationPages.length}`);
for (const lang of ['en', 'ja']) if (stationPagesByLang[lang].length !== 23) fail(`${lang} 車站資料頁應為 23 頁，實際 ${stationPagesByLang[lang].length}`);

function first(source, regex) { return regex.exec(source)?.[1]?.trim() || ''; }
function text(source) { return source.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function fileForUrl(urlString) {
  const url = new URL(urlString, 'https://railisland.tw');
  if (url.origin !== 'https://railisland.tw') return null;
  const clean = decodeURIComponent(url.pathname);
  if (clean === '/') return path.join(root, 'index.html');
  if (clean.endsWith('/')) return path.join(root, clean, 'index.html');
  return path.join(root, clean);
}

const canonicals = new Set();
const descriptions = new Set();
for (const file of pages) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  const title = first(source, /<title>([^<]+)<\/title>/i);
  const description = first(source, /<meta name="description" content="([^"]+)"/i);
  const canonical = first(source, /<link rel="canonical" href="([^"]+)"/i);
  const h1s = [...source.matchAll(/<h1\b[^>]*>/gi)].length;
  const ldBlocks = [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  if (!/^<!doctype html>/i.test(source)) fail(`${relative} 缺少 doctype`);
  if (!source.includes(`<html lang="${langOf(file)}">`)) fail(`${relative} 語言不是 ${langOf(file)}`);
  if (!title) fail(`${relative} 缺少 title`);
  if (!description || description.length < 55) fail(`${relative} description 太短或不存在`);
  if (!/^https:\/\/railisland\.tw\//.test(canonical)) fail(`${relative} canonical 不正確：${canonical}`);
  if (h1s !== 1) fail(`${relative} 應有且只有一個 h1，實際 ${h1s}`);
  if (!/<main\b[^>]*id="main"/i.test(source)) fail(`${relative} 缺少 main#main`);
  if (!/<meta name="robots" content="index,follow,max-image-preview:large">/i.test(source)) fail(`${relative} 缺少可索引 robots meta`);
  if (!/<meta property="og:url"/i.test(source) || !/<meta property="og:image"/i.test(source)) fail(`${relative} Open Graph 不完整`);
  if (!source.includes('/assets/aeo.css')) fail(`${relative} 未載入共用 AEO 樣式`);
  if (!ldBlocks.length) fail(`${relative} 缺少 JSON-LD`);
  for (const block of ldBlocks) {
    try { JSON.parse(block[1]); } catch (error) { fail(`${relative} JSON-LD 無法解析：${error.message}`); }
  }
  if (canonicals.has(canonical)) fail(`canonical 重複：${canonical}`);
  canonicals.add(canonical);
  if (descriptions.has(description)) fail(`description 重複：${relative}`);
  descriptions.add(description);
  if (text(source).length < 430) fail(`${relative} 可讀正文過薄（${text(source).length} 字）`);
  for (const match of source.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    const target = fileForUrl(href);
    if (target && !fs.existsSync(target)) fail(`${relative} 內部連結不存在：${href}`);
  }
}

const stationBodies = stationPages.map(file => fs.readFileSync(file, 'utf8'));
for (const required of ['轉乘與站體判讀', '軌島怎麼顯示這一站', '當下班次、誤點、停駛與營運公告']) {
  const missing = stationBodies.filter(source => !source.includes(required)).length;
  if (missing) fail(`${missing} 個車站頁缺少必要說明「${required}」`);
}
for (const required of ['台鐵桃園車站', '高鐵桃園站', '台鐵新竹車站', '高鐵新竹站', '台鐵台中車站', '高鐵台中站', '台鐵台南車站', '高鐵台南站', '嘉義車站', '高鐵嘉義站']) {
  // 09-30 P2：h1 由「站名」改成「站名＋時刻表：…」（頁面加了逐班時刻表），所以比對前綴而不是整句；
  // 「同名異站要各有一頁」的意圖不變（台鐵桃園車站與高鐵桃園站仍是兩個不同的 h1）。
  if (!stationBodies.some(source => source.includes(`<h1>${required}時刻表`))) fail(`缺少同名異站頁：${required}`);
}

// 09-30 P2：三語車站頁（含索引）互相指向——zh-Hant／en／ja 各一條、x-default＝中文，且 canonical 是自己那一語。
for (const file of pages.filter(f => f.includes(`${path.sep}stations${path.sep}`))) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  const tail = relative.replace(/^(en|ja)\//, '');
  const url = prefix => `https://railisland.tw/${prefix}${tail.replace(/index\.html$/, '')}`;
  const want = { 'zh-Hant': url(''), en: url('en/'), ja: url('ja/'), 'x-default': url('') };
  const got = Object.fromEntries([...source.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => [m[1], m[2]]));
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${relative} hreflang 不符：${JSON.stringify(got)}`);
  const canonical = first(source, /<link rel="canonical" href="([^"]+)"/i);
  if (canonical !== want[langOf(file) === 'zh-Hant' ? 'zh-Hant' : langOf(file)]) fail(`${relative} canonical 不是自己那一語：${canonical}`);
}

const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
if (!/User-agent: OAI-SearchBot\s+Allow: \//.test(robots)) fail('robots.txt 未明確允許 OAI-SearchBot');
if (!robots.includes('Sitemap: https://railisland.tw/sitemap.xml')) fail('robots.txt 缺少正式 sitemap 位址');
if (/Disallow:\s*\//.test(robots)) fail('robots.txt 意外封鎖全站');

const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
// 原本寫死 28 筆（09-03 上線當下的數量），09-29 加了 /en/、/ja/ 與捷運路線圖頁就結構性變紅。
// 改驗「是什麼」：首頁在；每筆都指到存在的檔（下面迴圈）；本檔驗的每一頁 canonical 都在（再下一行）。
// en／ja／metro 各頁是否收齊，由 build_aeo_pages.mjs --check（sitemap 逐 byte 重產比對）與 verify_metro_pages.mjs 負責。
if (!locations.includes('https://railisland.tw/')) fail('sitemap 缺少首頁');
if (new Set(locations).size !== locations.length) fail('sitemap 有重複網址');
for (const location of locations) {
  const file = fileForUrl(location);
  if (!file || !fs.existsSync(file)) fail(`sitemap 指向不存在的檔案：${location}`);
}
for (const canonical of canonicals) if (!locations.includes(canonical)) fail(`AEO canonical 未列入 sitemap：${canonical}`);

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rootLd = [...index.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => {
  try { return JSON.parse(match[1]); } catch { return null; }
}).filter(Boolean);
const rootTypes = new Set(rootLd.flatMap(item => item['@graph'] || [item]).map(item => item['@type']));
if (!rootTypes.has('WebSite') || !rootTypes.has('SoftwareApplication')) fail('首頁 JSON-LD 缺少 WebSite 或 SoftwareApplication');
for (const href of ['about/', 'accuracy/', 'stations/']) if (!index.includes(`href="${href}"`)) fail(`首頁未提供可見入口：${href}`);
// 「最近更新」只放最近 8 條、會輪替，09-03 的 AEO 摘要早就被擠出去了；要守的是那次上線的正本仍在完整歷史裡。
// 原本另有一行寫死 BUILD 必須是 'v0903i'——那是出貨當下的戳記，下一次改版就紅；版號由 ship_web 的
// 「內容與正式站不同卻共用版號就停」檢查負責，不在這裡重複。
if (!index.includes('data-cl="aeo"')) fail('完整更新歷史缺少 AEO 上線的正本（data-cl="aeo"）');

const before = new Map([...pages, path.join(root, 'robots.txt'), path.join(root, 'sitemap.xml')].map(file => [file, fs.readFileSync(file)]));
execFileSync(process.execPath, [path.join(root, 'scripts/build_aeo_pages.mjs')], { cwd: root, stdio: 'ignore' });
for (const [file, original] of before) if (!original.equals(fs.readFileSync(file))) fail(`產生器不是可重現的：${path.relative(root, file)}`);

if (failures.length) {
  console.error(`AEO 驗收失敗（${failures.length} 項）`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`AEO 靜態驗收通過：${pages.length} 頁、${stationPages.length} 車站（en／ja 各 ${stationPagesByLang.en.length}／${stationPagesByLang.ja.length}）、${locations.length} sitemap 網址`);
