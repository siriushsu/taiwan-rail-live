import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = message => failures.push(message);

const generatedRoots = ['about', 'accuracy', 'data-sources', 'stations'];
const listHtml = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? listHtml(target) : entry.name.endsWith('.html') ? [target] : [];
});
const pages = generatedRoots.flatMap(name => listHtml(path.join(root, name)));
const stationPages = pages.filter(file => file.includes(`${path.sep}stations${path.sep}`) && file !== path.join(root, 'stations/index.html'));

if (pages.length !== 24) fail(`AEO HTML 應為 24 頁（4 個說明／索引 + 20 車站），實際 ${pages.length}`);
if (stationPages.length !== 20) fail(`車站資料頁應為 20 頁，實際 ${stationPages.length}`);

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
  if (!/<html lang="zh-Hant">/i.test(source)) fail(`${relative} 語言不是 zh-Hant`);
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
  if (!stationBodies.some(source => source.includes(`<h1>${required}</h1>`))) fail(`缺少同名異站頁：${required}`);
}

const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
if (!/User-agent: OAI-SearchBot\s+Allow: \//.test(robots)) fail('robots.txt 未明確允許 OAI-SearchBot');
if (!robots.includes('Sitemap: https://railisland.tw/sitemap.xml')) fail('robots.txt 缺少正式 sitemap 位址');
if (/Disallow:\s*\//.test(robots)) fail('robots.txt 意外封鎖全站');

const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
if (locations.length !== 28) fail(`sitemap 應有 28 個網址，實際 ${locations.length}`);
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
if (!index.includes('data-cl-of="aeo"') || !index.includes('data-cl="aeo"')) fail('公開更新紀錄未加入 AEO 最近項目與正本');
if (!index.includes("const BUILD = 'v0903h'")) fail('BUILD 尚未更新為 v0903h');

const before = new Map([...pages, path.join(root, 'robots.txt'), path.join(root, 'sitemap.xml')].map(file => [file, fs.readFileSync(file)]));
execFileSync(process.execPath, [path.join(root, 'scripts/build_aeo_pages.mjs')], { cwd: root, stdio: 'ignore' });
for (const [file, original] of before) if (!original.equals(fs.readFileSync(file))) fail(`產生器不是可重現的：${path.relative(root, file)}`);

if (failures.length) {
  console.error(`AEO 驗收失敗（${failures.length} 項）`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`AEO 靜態驗收通過：${pages.length} 頁、${stationPages.length} 車站、${locations.length} sitemap 網址`);
