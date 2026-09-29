#!/usr/bin/env node
// 捷運路線圖頁（SEO 階段 A，2026-09-29）的靜態驗收。不開瀏覽器，只讀 metro／en/metro／ja/metro 的產物、
// data/、i18n/、sitemap.xml 與入口頁。瀏覽器那一半在 scripts/verify_aeo_browser.mjs。
//
// 兩段，且第二段刻意不 import 任何 build_*（產生器算錯，這裡才照得到）：
//   A. 逐頁結構：lang／title／description／canonical／hreflang 互指／og／JSON-LD／麵包屑／內部連結全部可解析／
//      深連結參數／sitemap／入口頁連結／英文頁漏譯／紅線用語／必備句／特殊時段附註與 data/special_ops.json 的雙向一致
//   B. 資料抽驗：14 條路線的站數與端點（全部）＋隨機 N 條（預設 3，--all 全部）的首末班車與班距，
//      三語頁面逐項對 data/*_times.json 直接計算的結果。
//
// 用法：node scripts/verify_metro_pages.mjs [--seed=<字串>] [--sample=<N>] [--all] [--quiet]
//   抽樣預設每次不同，seed 一定會印出來；失敗時用同一個 --seed 可以原樣重跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEC, SYS_IDS, DICT_OF, geoLine } from './lib/metro_page_spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://railisland.tw';
const GITHUB = 'https://github.com/siriushsu/taiwan-rail-live';
const ROOTS = { zh: 'metro', en: 'en/metro', ja: 'ja/metro' };
const HTML_LANG = { zh: 'zh-Hant', en: 'en', ja: 'ja' };
const OG_LOCALE = { zh: 'zh_TW', en: 'en_US', ja: 'ja_JP' };
const HOME = { zh: '/', en: '/en/', ja: '/ja/' };

const opt = { all: false, sample: 3, seed: null, quiet: false };
for (const a of process.argv.slice(2)) {
  if (a === '--all') opt.all = true;
  else if (a === '--quiet') opt.quiet = true;
  else if (a.startsWith('--seed=')) opt.seed = a.slice(7);
  else if (a.startsWith('--sample=')) opt.sample = Number(a.slice(9));
  else { console.error(`未知參數：${a}`); process.exit(2); }
}
if (!Number.isInteger(opt.sample) || opt.sample < 1) { console.error('--sample 要是正整數'); process.exit(2); }

let checks = 0;
const failures = [];
const log = msg => { if (!opt.quiet) console.log(msg); };
function ok(cond, name, detail = '') {
  checks++;
  if (!cond) { failures.push(`${name}${detail ? `：${detail}` : ''}`); console.log(`NG  ${name}${detail ? `：${detail}` : ''}`); }
  return !!cond;
}

// ── 小工具 ───────────────────────────────────────────────────────────────────────
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = rel => JSON.parse(read(rel));
const exists = rel => fs.existsSync(path.join(root, rel));
const decode = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
// 標點也算漏譯：英文頁不該出現全形／中日文標點；中日文頁不該出現「中日文字 + 半形逗號冒號分號 + 空白」（站名裡的半形括號不算）
const FULLWIDTH_PUNCT = /[\u3000-\u303f\uff01-\uff5e]/;
const ASCII_PUNCT_AFTER_CJK = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef][,:;] |[\u3040-\u30ff\u3400-\u9fff]\.\s/;
const hmOf = sec => { const m = Math.round(sec / 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const textOf = frag => decode(frag.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const dropScripts = html => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// ── 讀頁 ─────────────────────────────────────────────────────────────────────────
const pages = [];
const strayFiles = [];
for (const [lang, dir] of Object.entries(ROOTS)) {
  for (const file of walk(path.join(root, dir))) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (path.basename(file) !== 'index.html') { strayFiles.push(rel); continue; }
    const urlPath = `/${rel.replace(/index\.html$/, '')}`;
    const key = urlPath.slice(`/${dir}/`.length).replace(/\/$/, '');
    const depth = key === '' ? 0 : key.split('/').length;
    const html = fs.readFileSync(file, 'utf8');
    pages.push({ lang, rel, urlPath, key, kind: ['overview', 'system', 'line'][depth], sys: key.split('/')[0] || null, slug: key.split('/')[1] || null, html });
  }
}
const byUrl = new Map(pages.map(p => [p.urlPath, p]));
const pageAt = (lang, key) => byUrl.get(`/${ROOTS[lang]}/${key ? `${key}/` : ''}`);

// ═══ A. 逐頁結構 ═════════════════════════════════════════════════════════════════════
console.log('── A. 逐頁結構 ──');
ok(pages.length > 0, '找得到捷運路線圖頁', `頁數 ${pages.length}`);
ok(strayFiles.length === 0, '三個目錄裡只有 index.html', strayFiles.join('、'));
{
  const per = Object.fromEntries(Object.keys(ROOTS).map(l => [l, pages.filter(p => p.lang === l)]));
  const kinds = l => ['overview', 'system', 'line'].map(k => per[l].filter(p => p.kind === k).length).join('/');
  console.log(`總頁數 ${pages.length}（zh ${per.zh.length}［${kinds('zh')}］、en ${per.en.length}［${kinds('en')}］、ja ${per.ja.length}［${kinds('ja')}］；括號＝總覽/系統/路線）`);
  for (const l of Object.keys(ROOTS)) {
    ok(per[l].filter(p => p.kind === 'overview').length === 1, `${l} 有一頁總覽`);
    ok(per[l].filter(p => p.kind === 'system').length === SYS_IDS.length, `${l} 有 ${SYS_IDS.length} 個系統頁`);
    ok(per[l].filter(p => p.kind === 'line').length === SPEC.length, `${l} 有 ${SPEC.length} 個路線頁`);
  }
  const keysOf = l => per[l].map(p => p.key).sort().join('|');
  ok(keysOf('zh') === keysOf('en') && keysOf('zh') === keysOf('ja'), '三語的頁面路徑集合一致');
  for (const s of SPEC) for (const l of Object.keys(ROOTS)) ok(pageAt(l, `${s.sys}/${s.slug}`), `${l} 有 ${s.sys}/${s.slug}`);
}

const titleSeen = new Map(), descSeen = new Map();
const allSitemap = (() => {
  const xml = read('sitemap.xml');
  const rows = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map(m => ({ loc: m[1], lastmod: m[2] || null }));
  return rows;
})();
const sitemapAt = new Map(allSitemap.map(r => [r.loc, r]));
const genDateOf = p => { const m = p.html.match(/(?:頁面產生日期：|Page generated on |ページ生成日：)(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
const NOTICE = {
  zh: '臨時班表與異動以營運單位公告為準',
  en: "Temporary timetables and service changes are subject to the operator's announcements",
  ja: '臨時ダイヤや運行変更は、運営会社の発表を優先してください',
};
const RUNS_ON_TIMETABLE = { zh: /依時刻表在地圖上跑/, en: /run(?:ning)? on the timetable on the map/, ja: /時刻表どおりに地図上を走ります/ };
// 台北捷運（含文湖線、環狀線）照站上導言：位置與車站倒數來自官方逐班即時資料（真值另在「入口頁」段驗 index.html 導言還這樣寫）
const TRTC_LIVE = { zh: /官方逐班即時資料/, en: /official train-by-train live data/, ja: /公式の列車ごとのリアルタイムデータ/ };
const RED_WORDS = /票價|運賃|料金|\bfares?\b|通行證|付費|訂閱|收費|錄影|録画|\brecord(?:ing)?\b/i;
const RED_PRODUCT_WORDS = /\bPlus\b|\bPass\b|Islander/;
const OPERATOR_WORDS = /新北捷運|New Taipei Metro|新北メトロ|營運商|運營商/;

for (const p of pages) {
  const tag = `${p.lang} ${p.key || '(總覽)'}`;
  const html = p.html;
  const head = html.slice(0, html.indexOf('</head>') + 7);
  // lang／meta
  ok((html.match(/<html[^>]*\slang="([^"]*)"/) || [])[1] === HTML_LANG[p.lang], `${tag} html lang=${HTML_LANG[p.lang]}`);
  const titles = [...head.matchAll(/<title>([^<]*)<\/title>/g)].map(m => decode(m[1]));
  ok(titles.length === 1 && titles[0].length >= 12, `${tag} 恰有一個 title`, titles.join('｜'));
  const title = titles[0] || '';
  const descs = [...head.matchAll(/<meta name="description" content="([^"]*)"/g)].map(m => decode(m[1]));
  ok(descs.length === 1 && descs[0].length >= 30, `${tag} 恰有一個 description`, `${descs.length} 個`);
  const desc = descs[0] || '';
  ok(!titleSeen.has(title), `${tag} title 全站唯一`, `與 ${titleSeen.get(title)} 相同`);
  titleSeen.set(title, tag);
  ok(!descSeen.has(desc), `${tag} description 全站唯一`, `與 ${descSeen.get(desc)} 相同`);
  descSeen.set(desc, tag);
  ok(title.length <= 100, `${tag} title 不超過 100 字`, `${title.length}`);
  ok(desc.length <= 330, `${tag} description 不超過 330 字`, `${desc.length}`);
  // 標題句型（使用者指定的三種句型；系統／總覽頁另有句型）
  if (p.kind === 'line') {
    const re = { zh: /^.+路線圖、車站與(首末班車|營運時間)(｜.+)?｜軌島$/, en: /^.+ Map, Stations & (First\/Last Trains|Operating Hours)( \| .+)? \| Rail Island$/, ja: /^.+ 路線図・駅一覧・(始発終電|運行時間)(｜.+)?｜軌島$/ }[p.lang];
    ok(re.test(title), `${tag} 路線頁 title 句型`, title);
  } else {
    ok(p.lang === 'en' ? / \| Rail Island$/.test(title) : /｜軌島$/.test(title), `${tag} title 以站名結尾`, title);
  }
  // canonical／hreflang
  const canon = [...head.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map(m => m[1]);
  ok(canon.length === 1 && canon[0] === SITE + p.urlPath, `${tag} canonical 指向自己`, canon.join('、'));
  const alts = Object.fromEntries([...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const altKeys = Object.keys(alts).sort().join(',');
  ok(altKeys === 'en,ja,x-default,zh-Hant', `${tag} hreflang 恰為 zh-Hant／en／ja／x-default`, altKeys);
  ok(alts['x-default'] === alts['zh-Hant'], `${tag} x-default 指向中文版`);
  const ownAlt = { zh: alts['zh-Hant'], en: alts.en, ja: alts.ja }[p.lang];
  ok(ownAlt === SITE + p.urlPath, `${tag} 自己語言的 hreflang＝canonical`);
  p.alts = alts;
  for (const [l, href] of [['zh', alts['zh-Hant']], ['en', alts.en], ['ja', alts.ja]]) {
    const want = `${SITE}/${ROOTS[l]}/${p.key ? `${p.key}/` : ''}`;
    ok(href === want, `${tag} hreflang ${l} 指向同一頁的 ${l} 版`, href);
    ok(byUrl.has(href ? href.replace(SITE, '') : ''), `${tag} hreflang ${l} 的目標檔存在`, href);
  }
  // og
  const og = Object.fromEntries([...head.matchAll(/<meta property="og:([\w:]+)" content="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
  ok(og.title === title && og.description === desc && og.url === SITE + p.urlPath, `${tag} og:title／description／url 與頁面一致`);
  ok(og.locale === OG_LOCALE[p.lang], `${tag} og:locale=${OG_LOCALE[p.lang]}`, og.locale);
  ok(/index,follow/.test(head) && !/noindex/i.test(head), `${tag} robots 可索引`);
  // JSON-LD
  const blocks = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  ok(blocks.length === 1, `${tag} 有一段 JSON-LD`, `${blocks.length} 段`);
  let ld = null;
  try { ld = JSON.parse(blocks[0] || 'null'); } catch (e) { ok(false, `${tag} JSON-LD 可解析`, e.message); }
  if (ld) {
    const graph = ld['@graph'] || [];
    const web = graph.find(n => n['@type'] === 'WebPage' || n['@type'] === 'CollectionPage');
    const crumb = graph.find(n => n['@type'] === 'BreadcrumbList');
    ok(!!web && web.url === SITE + p.urlPath && web.inLanguage === HTML_LANG[p.lang], `${tag} JSON-LD 頁面節點 url／inLanguage`);
    ok(!!web && web.name === title && web.description === desc, `${tag} JSON-LD name／description 與頁面一致`);
    ok(!!web && /^\d{4}-\d{2}-\d{2}$/.test(web.dateModified || ''), `${tag} JSON-LD dateModified 是日期`, web && web.dateModified);
    ok(!!crumb, `${tag} 有 BreadcrumbList`);
    if (crumb) {
      const items = crumb.itemListElement || [];
      const wantLen = { overview: 2, system: 3, line: 4 }[p.kind];
      ok(items.length === wantLen, `${tag} 麵包屑層數 ${wantLen}`, `${items.length}`);
      ok(items.every((it, i) => it.position === i + 1 && it.name && /^https:\/\/railisland\.tw\//.test(it.item)), `${tag} 麵包屑 position 連續、name／item 齊全`);
      ok(items.length && items[0].item === SITE + HOME[p.lang], `${tag} 麵包屑第一層是該語言首頁`, items[0] && items[0].item);
      ok(items.length && items[items.length - 1].item === SITE + p.urlPath, `${tag} 麵包屑最後一層是本頁`);
      for (const it of items.slice(1)) ok(byUrl.has(it.item.replace(SITE, '')), `${tag} 麵包屑「${it.name}」指向存在的頁`, it.item);
      if (p.kind !== 'overview') ok(items[1].item === `${SITE}/${ROOTS[p.lang]}/`, `${tag} 麵包屑第二層是本語言總覽`);
    }
    if (web && web.mainEntity && web.mainEntity['@type'] === 'ItemList') {
      const list = web.mainEntity;
      ok(list.numberOfItems === list.itemListElement.length && list.itemListElement.every((x, i) => x.position === i + 1 && x.name), `${tag} 站列 ItemList 筆數與 position`);
      p.ldCount = list.numberOfItems;
    }
    if (p.kind === 'line') ok(p.ldCount > 0, `${tag} 路線頁的站列 ItemList 非空`);
  }
  // 結構
  ok((html.match(/<h1[ >]/g) || []).length === 1, `${tag} 恰有一個 h1`);
  ok(/<main class="page-shell" id="main">/.test(html) && /class="skip-link" href="#main"/.test(html), `${tag} main#main 與 skip-link`);
  ok(/<meta name="viewport" content="width=device-width, initial-scale=1/.test(head), `${tag} viewport`);
  // sitemap
  const sm = sitemapAt.get(SITE + p.urlPath);
  ok(!!sm, `${tag} 在 sitemap.xml 裡`);
  ok(!!sm && /^\d{4}-\d{2}-\d{2}$/.test(sm.lastmod || ''), `${tag} sitemap 有 lastmod`);
  const gen = genDateOf(p);
  ok(!!gen && (!sm || sm.lastmod === gen) && (!ld || !ld['@graph'] || ld['@graph'].every(n => !n.dateModified || n.dateModified === gen)), `${tag} 頁面產生日期＝sitemap lastmod＝JSON-LD dateModified`, `${gen} / ${sm && sm.lastmod}`);

  // 內部連結、深連結
  const hrefs = [...html.matchAll(/<(?:a|link)\s[^>]*?href="([^"]*)"/g)].map(m => decode(m[1]));
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  p.hrefs = hrefs;
  for (const href of hrefs) {
    if (href.startsWith('#')) { ok(ids.has(href.slice(1)), `${tag} 頁內錨點 ${href} 存在`); continue; }
    if (href === GITHUB) continue;
    let u;
    try { u = new URL(href, SITE + p.urlPath); } catch { ok(false, `${tag} 連結可解析`, href); continue; }
    if (u.origin !== SITE) { ok(false, `${tag} 不預期的外部連結`, href); continue; }
    ok(!href.startsWith('.') && (href.startsWith('/') || href.startsWith(SITE)), `${tag} 連結用絕對路徑`, href);
    const file = u.pathname.endsWith('/') ? `${u.pathname.slice(1)}index.html` : u.pathname.slice(1);
    ok(exists(decodeURIComponent(file)), `${tag} 連結目標存在 ${u.pathname}`);
    if (u.searchParams.has('g')) {
      const at = u.searchParams.get('at'), z = u.searchParams.get('z'), lang = u.searchParams.get('lang');
      ok(u.pathname === '/' && u.searchParams.get('g') === 'metro', `${tag} 深連結是 /?g=metro`, href);
      if (at !== null) {
        const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(at);
        ok(!!m && +m[1] > 21.5 && +m[1] < 26.5 && +m[2] > 118 && +m[2] < 123, `${tag} 深連結 at 是台灣範圍內的 lat,lon`, at);
        ok(/^\d+$/.test(z || '') && +z >= 7 && +z <= 18, `${tag} 深連結 z 是 7–18 的整數`, z);
      } else ok(z === null, `${tag} 沒有 at 就不帶 z`);
      ok(p.lang === 'zh' ? lang === null : lang === p.lang, `${tag} 深連結 lang 參數符合頁面語言`, `${lang}`);
    }
  }
  ok(hrefs.filter(h => h.startsWith('/?g=metro')).length >= 1, `${tag} 有「在地圖上看即時列車」深連結`);
  // 文字內容
  const body = html.slice(html.indexOf('<body'));
  const bodyText = textOf(dropScripts(body));
  ok(!RED_WORDS.test(bodyText) && !RED_PRODUCT_WORDS.test(bodyText), `${tag} 沒有收費／通行證／錄影／票價字樣`, (bodyText.match(RED_WORDS) || bodyText.match(RED_PRODUCT_WORDS) || [])[0]);
  ok(bodyText.includes(NOTICE[p.lang]), `${tag} 有「${NOTICE.zh}」對應句`);
  // 地圖上怎麼跑：台北捷運寫官方逐班即時、不准寫成「依時刻表在地圖上跑」（09-29 驗收抓到文湖線頁這樣寫＝不實）；
  // 其餘系統要有「依時刻表在地圖上跑」；總覽兩句都要有
  const isTaipei = p.key === 'taipei' || String(p.key || '').startsWith('taipei/');
  if (p.kind === 'overview') ok(TRTC_LIVE[p.lang].test(bodyText) && RUNS_ON_TIMETABLE[p.lang].test(bodyText), `${tag} 總覽同時寫台北捷運官方逐班即時與其他系統依時刻表跑`);
  else if (isTaipei) ok(TRTC_LIVE[p.lang].test(bodyText) && !RUNS_ON_TIMETABLE[p.lang].test(bodyText), `${tag} 台北捷運寫官方逐班即時資料、不寫「依時刻表在地圖上跑」`);
  else ok(RUNS_ON_TIMETABLE[p.lang].test(bodyText) && !TRTC_LIVE[p.lang].test(bodyText), `${tag} 有「依時刻表在地圖上跑」對應句`);
  ok(genDateOf(p) !== null && /GitHub|github|資料來源|Data sources|データの出典/.test(bodyText), `${tag} 有資料來源與產生日期`);
  // 分段
  const secs = Object.fromEntries([...html.matchAll(/<section class="[^"]*" id="([\w-]+)">([\s\S]*?)<\/section>/g)].map(m => [m[1], m[2]]));
  p.secs = secs;
  if (p.kind === 'line') {
    for (const id of ['answer', 'stops', 'live', 'related', 'source']) ok(secs[id] !== undefined, `${tag} 有 #${id} 段`);
    ok((secs.stops || '').includes('class="stop'), `${tag} 站序段有站列`);
  }
  if (p.kind === 'system') {
    ok(/<svg class="geo-map"/.test(html), `${tag} 系統頁有內嵌地理路線圖 SVG`);
    ok(/<svg class="geo-map"[^>]*viewBox="0 0 360 [\d.]+"/.test(html), `${tag} SVG viewBox 寬 360`);
    ok(/<text class="lbl"/.test(html), `${tag} SVG 有站名標籤`);
  }
  // 英文頁不得殘留中文（zh-Hant 標註的副名、品牌、語言切換除外）
  if (p.lang === 'en') {
    const cleaned = dropScripts(body).replace(/<a class="brand"[\s\S]*?<\/a>/, ' ').replace(/<(\w+)\b[^>]*\slang="[^"]*"[^>]*>[\s\S]*?<\/\1>/g, ' ');
    const left = cleaned.replace(/<[^>]+>/g, ' ');
    ok(!CJK.test(left), `${tag} 英文頁沒有漏譯的中日文`, (left.match(/.{0,12}[\u3040-\u30ff\u3400-\u9fff]+.{0,12}/) || [])[0]);
    ok(!CJK.test(title + desc), `${tag} 英文 title／description 沒有中日文`);
    ok(!FULLWIDTH_PUNCT.test(left) && !FULLWIDTH_PUNCT.test(title + desc), `${tag} 英文頁沒有全形／中日文標點`, (left.match(/.{0,20}[\u3000-\u303f\uff01-\uff5e].{0,20}/) || [])[0]);
  }
  if (p.lang === 'ja') ok(/[\u3040-\u309f\u30a0-\u30ff]/.test(textOf(secs.answer || secs.lines || '')), `${tag} 日文頁正文含假名`);
  if (p.lang !== 'en') ok(!ASCII_PUNCT_AFTER_CJK.test(bodyText), `${tag} 中日文頁沒有接在中日文字後的半形標點`, (bodyText.match(/.{0,20}(?:[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef][,:;] |[\u3040-\u30ff\u3400-\u9fff]\.\s).{0,20}/) || [])[0]);
  // 環狀線不寫營運單位（依指示歸台北捷運；資料在 trtc.json 內，但頁面不提是誰營運）
  if (p.key === 'taipei/circular') {
    const mainText = ['answer', 'stops', 'times', 'stationTimes', 'live', 'source'].map(id => textOf(secs[id] || '')).join(' ') + ' ' + textOf(html.match(/<section class="hero">[\s\S]*?<\/section>/)?.[0] || '');
    ok(!OPERATOR_WORDS.test(mainText), `${tag} 環狀線頁不寫營運單位`, (mainText.match(OPERATOR_WORDS) || [])[0]);
  }
}

// 反查：每一頁都能從總覽爬到（三語各自），系統頁列出旗下每條路線
for (const lang of Object.keys(ROOTS)) {
  const start = pageAt(lang, '');
  const seen = new Set([start.urlPath]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const h of cur.hrefs || []) {
      const u = new URL(h, SITE + cur.urlPath);
      if (u.origin !== SITE || !u.pathname.startsWith(`/${ROOTS[lang]}/`) || seen.has(u.pathname) || !byUrl.has(u.pathname)) continue;
      seen.add(u.pathname);
      queue.push(byUrl.get(u.pathname));
    }
  }
  const total = pages.filter(p => p.lang === lang).length;
  ok(seen.size === total, `${lang} 從總覽沿連結爬得到全部 ${total} 頁`, `${seen.size}`);
  for (const s of SPEC) {
    const sysPage = pageAt(lang, s.sys);
    ok(sysPage && sysPage.hrefs.includes(`/${ROOTS[lang]}/${s.sys}/${s.slug}/`), `${lang} ${s.sys} 系統頁連到 ${s.slug}`);
  }
  for (const id of SYS_IDS) ok(pageAt(lang, '').hrefs.includes(`/${ROOTS[lang]}/${id}/`), `${lang} 總覽連到 ${id}`);
}

// sitemap
{
  const metroLocs = allSitemap.filter(r => /^https:\/\/railisland\.tw\/(?:en\/|ja\/)?metro\//.test(r.loc));
  ok(metroLocs.length === pages.length, `sitemap 的捷運路線圖網址數＝頁數`, `${metroLocs.length}/${pages.length}`);
  ok(new Set(allSitemap.map(r => r.loc)).size === allSitemap.length, 'sitemap 沒有重複網址');
  const missing = allSitemap.filter(r => { const rel = r.loc.replace(SITE + '/', ''); return !exists(rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel); });
  ok(missing.length === 0, 'sitemap 每個網址都有對應檔案', missing.map(r => r.loc).join('、'));
}

// 入口頁：/about/、/stations/、/en/、/ja/、首頁兩處
{
  const need = [['about/index.html', '/metro/'], ['stations/index.html', '/metro/'], ['en/index.html', '/en/metro/'], ['ja/index.html', '/ja/metro/']];
  for (const [rel, href] of need) {
    const h = read(rel);
    ok(h.includes(`href="${href}"`), `${rel} 連到 ${href}`);
    ok(sitemapAt.get(SITE + `/${rel.replace(/index\.html$/, '')}`)?.lastmod >= '2026-09-29', `${rel} 的 sitemap lastmod 已更新`);
  }
  const idx = read('index.html');
  const idxLinks = idx.match(/<a href="metro\/" data-metro-link>捷運路線圖<\/a>/g) || [];
  ok(idxLinks.length === 2, '首頁 .ms-aeo-links／頁尾兩處都有「捷運路線圖」入口', `${idxLinks.length} 處`);
  ok(/APP_REPLACE_START aeo-links-foot[\s\S]*?href="metro\/"[\s\S]*?APP_REPLACE_END aeo-links-foot/.test(idx) && /APP_REPLACE_START aeo-links-ms[\s\S]*?href="metro\/"[\s\S]*?APP_REPLACE_END aeo-links-ms/.test(idx), '入口放在 APP_REPLACE 區間內（App build 才會換成絕對網址）');
  ok(idx.includes('台北捷運九線的列車位置與車站倒數都是官方逐班即時'), 'index.html 捷運頁導言仍寫台北捷運九線位置來自官方逐班即時（路線圖頁的「地圖上怎麼跑」照它寫；導言改了這裡就紅）');
  ok(/\['metro', '捷運路線圖'\]/.test(read('app/scripts/prepare-web.mjs')), 'App build 的說明連結也有「捷運路線圖」（正式站絕對網址）');
  const tr = read('i18n/translations.js');
  ok(/'捷運路線圖': 'Metro maps'/.test(tr) && /'捷運路線圖': 'メトロ路線図'/.test(tr), 'i18n 有「捷運路線圖」的 en／ja 詞條');
  const pkg = readJson('package.json');
  for (const name of ['sync-metro', 'fetch-schedule']) {
    const tail = String(pkg.scripts[name] || '').split('&&').pop().trim();
    ok(tail === 'node scripts/build_aeo_pages.mjs', `npm run ${name} 尾端接產生器`, tail);
  }
  ok(/build_aeo_pages\.mjs --check/.test(pkg.scripts['check-metro-pages'] || ''), 'npm run check-metro-pages 含 --check');
}

// 特殊時段附註與 data/special_ops.json 雙向一致（op 在就要有、被刪就要消失）
{
  const ops = readJson('data/special_ops.json').ops;
  const op = ops.find(o => o.id === 'tymc-20261012-post-expo');
  for (const lang of Object.keys(ROOTS)) {
    const p = pageAt(lang, 'taoyuan-airport/airport-mrt');
    const has = { zh: /設計展/, en: /Design Expo/, ja: /デザイン展/ }[lang].test(textOf(dropScripts(p.html)));
    const want = !!op && genDateOf(p) <= '2026-10-11'; // 疏運期最後一天（special_ops quote）；頁面日期越過它，附註要消失
    ok(has === want, `${lang} 機場捷運頁的特殊時段附註${want ? '存在（op 仍在 special_ops.json、頁面日期未過 10/11）' : '不存在（op 已刪或頁面日期已過 10/11）'}`);
    const q = pageAt(lang, 'taipei/bannan');
    ok(!{ zh: /設計展/, en: /Design Expo/, ja: /デザイン展/ }[lang].test(textOf(dropScripts(q.html))), `${lang} 其他路線頁不出現機場的特殊時段附註`);
  }
  if (op) console.log(`  （special_ops 仍有 ${op.id}：附註要在，且首末班車＝一般班表計算結果）`);
}

// ═══ B. 資料抽驗（不 import 產生器）═══════════════════════════════════════════════════
console.log('── B. 資料抽驗 ──');
const stationsDict = readJson('i18n/stations.json').systems;
const TIMES = {};
for (const f of Object.keys(DICT_OF)) TIMES[f] = readJson(`data/${f}_times.json`);
const nameSet = (lang, zh) => {
  if (lang === 'zh') return new Set([zh]);
  const out = new Set();
  for (const d of Object.values(stationsDict)) {
    const v = d[zh] && d[zh][lang];
    if (!v) continue;
    out.add(v);
    out.add(lang === 'en' ? v.replace(/ Station$/, '') : v.replace(/駅$/, '')); // 頁面內文去掉「 Station」「駅」尾巴
  }
  return out;
};
const hasName = (lang, text, zh) => [...nameSet(lang, zh)].some(n => text.includes(n)) || (lang !== 'zh' && nameSet(lang, zh).size === 0 && text.includes(zh));
// a 在 b 前面（「A → B」「A 出發，往 B」「From A toward B」）
const namesInOrder = (lang, text, zhA, zhB) => [...nameSet(lang, zhA)].some(a => { const i = text.indexOf(a); return i >= 0 && [...nameSet(lang, zhB)].some(b => text.indexOf(b, i + a.length) >= 0); });

// 星期標籤（頁面以 days[3]＝週三所屬班表為準；標籤＝這個班表涵蓋的星期）
function dayLabel(lang, days, holiday) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const runs = [];
  let cur = null;
  for (const d of order) { if (days.includes(d)) { if (cur) cur.push(d); else { cur = [d]; runs.push(cur); } } else cur = null; }
  const nm = { zh: d => `週${'日一二三四五六'[d]}`, en: d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d], ja: d => `${'日月火水木金土'[d]}曜` }[lang];
  const sep = { zh: '、', en: ', ', ja: '・' }[lang];
  const range = { zh: (a, b) => `${a}至${b}`, en: (a, b) => `${a}–${b}`, ja: (a, b) => `${a.replace('曜', '')}〜${b}` }[lang];
  const parts = runs.map(r => (r.length >= 3 ? range(nm(r[0]), nm(r[r.length - 1])) : r.map(nm).join(sep)));
  if (holiday) parts.push({ zh: '國定假日', en: 'public holidays', ja: '祝日' }[lang]);
  return parts.join(sep);
}
const answerItems = p => [...((p.secs.answer || '').matchAll(/<li>([\s\S]*?)<\/li>/g))].map(m => ({ html: m[1], text: textOf(m[1]), strong: textOf((m[1].match(/<strong>([\s\S]*?)<\/strong>/) || [, ''])[1]) }));
const TIME_RE = {
  zh: /首班 (\d\d:\d\d)(（次日）)?、末班 (\d\d:\d\d)(（次日）)?/,
  en: /first (\d\d:\d\d)( \(next day\))?, last (\d\d:\d\d)( \(next day\))?/,
  ja: /始発 (\d\d:\d\d)(（翌日）)?、終電 (\d\d:\d\d)(（翌日）)?/,
};
// prefix＝兩個方向的班距不同時，頁面會在數字前寫「<起點站>發車」「from <起點站>,」「<起點站>発：」
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEADWAY_RE = {
  zh: (m1, m2, o) => new RegExp(`${o ? `(?:${o.map(reEsc).join('|')})發車 ` : ''}07:00–09:00 約每 ${m1} 分鐘一班、12:00–14:00 約每 ${m2} 分鐘一班`),
  en: (m1, m2, o) => new RegExp(`${o ? `from (?:${o.map(reEsc).join('|')}), ` : ''}about every ${m1} min from 07:00 to 09:00, about every ${m2} min from 12:00 to 14:00`),
  ja: (m1, m2, o) => new RegExp(`${o ? `(?:${o.map(reEsc).join('|')})発：` : ''}07:00〜09:00は約${m1}分おき、12:00〜14:00は約${m2}分おき`),
};

const wednesdaySet = tl => tl.days[3];
const daysOfSet = (tl, name) => [0, 1, 2, 3, 4, 5, 6].filter(d => tl.days[d] === name);

// 每條資料線在「週三所屬班表」的首末班（開到終點站的列車在起點站的最早／最晚發車）
function expectedServices(file, lineId) {
  const g = geoLine(file, lineId), tl = TIMES[file].lines[lineId];
  const n = g.stations.length, loop = !!g.loop;
  const setName = wednesdaySet(tl);
  const trains = (tl.sets[setName] || []).filter(t => t.length >= 4);
  const kinds = tl.kinds ? tl.kinds[setName] : null;
  const services = [];
  const pairsOf = list => {
    const dep = list.map(t => t[1]);
    return dep.length ? { first: Math.min(...dep), last: Math.max(...dep), count: dep.length } : null;
  };
  if (loop) {
    // 環線沒有終點站：從站序 0 出發、往 +1（正向）或 -1（反向）的所有發車
    for (const [dir, next] of [['fwd', 1], ['bwd', n - 1]]) {
      const dep = trains.filter(t => t[0] === 0 && t[2] === next);
      if (dep.length) services.push({ dir, origin: 0, second: next, dest: null, kind: null, ...pairsOf(dep) });
    }
  } else if (tl.kinds) {
    // 有車種（機捷）：每個車種、每個方向取「所有一般班表合併後最常見的起點與終點」
    const sets = new Set([...[1, 2, 3, 4, 5, 6, 0].map(d => tl.days[d]), tl.holiday]);
    for (const kind of ['1', '2']) {
      for (const dir of ['fwd', 'bwd']) {
        const pool = [];
        for (const s of sets) (tl.sets[s] || []).forEach((t, i) => { if (t.length >= 4 && tl.kinds[s][i] === kind && (t[2] > t[0] ? 'fwd' : 'bwd') === dir) pool.push(t); });
        if (!pool.length) continue;
        const modal = arr => { const c = new Map(); arr.forEach(x => c.set(x, (c.get(x) || 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]; };
        const origin = modal(pool.map(t => t[0]));
        const dest = modal(pool.filter(t => t[0] === origin).map(t => t[t.length - 2]));
        const thru = trains.filter((t, i) => kinds && kinds[i] === kind && t[0] === origin && t[t.length - 2] === dest);
        if (thru.length) services.push({ dir, origin, dest, kind, ...pairsOf(thru) });
      }
    }
  } else {
    for (const [dir, origin, dest] of [['fwd', 0, n - 1], ['bwd', n - 1, 0]]) {
      const thru = trains.filter(t => t[0] === origin && t[t.length - 2] === dest);
      if (thru.length) services.push({ dir, origin, dest, kind: null, ...pairsOf(thru) });
    }
  }
  return { g, tl, n, loop, setName, days: daysOfSet(tl, setName), holiday: tl.holiday === setName, trains, services };
}
// 起點站相鄰兩班發車間隔的中位數（分鐘），07:00–09:00 與 12:00–14:00（含車種合計）
function expectedHeadway(exp, origin, next) {
  const dep = exp.trains.filter(t => t[0] === origin && (next == null || t[2] === next)).map(t => t[1]);
  const gaps = win => {
    const xs = dep.filter(x => x >= win[0] * 3600 && x < win[1] * 3600).sort((a, b) => a - b);
    const d = []; for (let i = 1; i < xs.length; i++) d.push((xs[i] - xs[i - 1]) / 60);
    return d.length >= 3 ? Math.max(1, Math.round(median(d))) : null;
  };
  return { morning: gaps([7, 9]), midday: gaps([12, 14]) };
}

// B1. 全部 14 條：站數、端點、系統站數
console.log('B1. 站數與端點（14 條，全部）');
const sysStations = {};
for (const s of SPEC) {
  const names = new Set();
  for (const id of [...s.main, ...s.attached]) for (const st of geoLine(s.file, id).stations) names.add(st.name);
  s.count = names.size;
  (sysStations[s.sys] ||= new Set());
  for (const nm of names) sysStations[s.sys].add(nm);
  const first = geoLine(s.file, s.main[0]);
  const loop = !!first.loop;
  s.origin = first.stations[0].name;
  s.ends = s.main.map(id => { const st = geoLine(s.file, id).stations; return st[st.length - 1].name; });
  for (const lang of Object.keys(ROOTS)) {
    const p = pageAt(lang, `${s.sys}/${s.slug}`);
    if (!p) continue;
    const lede = textOf((p.html.match(/<p class="lede">([\s\S]*?)<\/p>/) || [, ''])[1]);
    const n = new RegExp(`(?<![\\d])${s.count}(?![\\d])`);
    const okCount = n.test(lede) && p.ldCount === s.count;
    const wantNames = s.prefix ? [s.origin, ...s.ends] : loop ? [] : [s.origin, s.ends[0]];
    const okNames = wantNames.every(zh => hasName(lang, lede, zh));
    ok(okCount, `${lang} ${s.slug} 站數 ${s.count}（data 站名去重）＝頁面 lede 與 JSON-LD`, `lede「${lede.slice(0, 80)}」JSON-LD ${p.ldCount}`);
    ok(okNames, `${lang} ${s.slug} lede 含端點 ${wantNames.join('／') || '（環狀線無端點）'}`, lede.slice(0, 120));
    if (lang === 'zh') log(`  ${s.slug.padEnd(17)} ${String(s.count).padStart(2)} 站  ${loop ? '環狀' : `${s.origin} → ${s.ends.join('／')}`}`);
  }
}
for (const id of SYS_IDS) {
  for (const lang of Object.keys(ROOTS)) {
    const p = pageAt(lang, id);
    const lede = textOf((p.html.match(/<p class="lede">([\s\S]*?)<\/p>/) || [, ''])[1]);
    const lines = SPEC.filter(s => s.sys === id).length;
    ok(new RegExp(`(?<!\\d)${lines}(?!\\d)`).test(lede) && new RegExp(`(?<!\\d)${sysStations[id].size}(?!\\d)`).test(lede), `${lang} ${id} 系統頁 lede 的路線數 ${lines}、站數 ${sysStations[id].size}（各線站名合併去重）`, lede.slice(0, 90));
  }
}

// B2. 抽樣的首末班車與班距
const seed = opt.seed ?? `${Date.now()}`;
function prng(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h = Math.imul(h ^ (h >>> 16), 2246822507)) ^ (h >>> 13), t = 0;
  return () => { a = (a + 0x6D2B79F5) | 0; t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = prng(seed);
const pool = [...SPEC];
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = opt.all ? SPEC : pool.slice(0, Math.min(opt.sample, SPEC.length));
console.log(`B2. 首末班車與班距抽驗（seed=${seed}；${opt.all ? '全部 14 條' : `隨機 ${sample.length} 條：${sample.map(s => s.slug).join('、')}`}）`);

for (const s of sample) {
  console.log(`  ▸ ${s.sys}/${s.slug}`);
  for (const id of s.main) {
    const exp = expectedServices(s.file, id);
    const est = !!(TIMES[s.file].estimated || TIMES[s.file].lines[id].estimated);
    const stationName = i => exp.g.stations[i].name;
    if (est) {
      // 沒有公開逐班時刻表：頁面只列營運時段與班距，不列首末班
      const all = exp.services;
      const first = Math.min(...all.map(x => x.first)), last = Math.max(...all.map(x => x.last));
      const peak = Math.round(exp.g.peakHeadwaySec / 60), off = Math.round(exp.g.offpeakHeadwaySec / 60);
      for (const lang of Object.keys(ROOTS)) {
        const p = pageAt(lang, `${s.sys}/${s.slug}`);
        const txt = textOf(p.secs.answer || '');
        const span = `${hmOf(first)}–${hmOf(last)}`;
        const next = last >= 86400 ? { zh: '（次日）', en: ' (next day)', ja: '（翌日）' }[lang] : '';
        ok(txt.includes(`${span}${next}`), `${lang} ${id} 營運時段 ${span}${next}（data 逐班最早／最晚發車）`, txt.slice(0, 140));
        ok(!TIME_RE[lang].test(txt), `${lang} ${id} 估算路線不列首班／末班`);
        const hw = { zh: `尖峰約每 ${peak} 分鐘、離峰約每 ${off} 分鐘一班`, en: `peak about every ${peak} min, off-peak about every ${off} min`, ja: `ピーク時は約${peak}分おき、オフピーク時は約${off}分おき` }[lang];
        ok(txt.includes(hw) || new RegExp(`${peak}[^\\d]{1,20}${off}`).test(txt), `${lang} ${id} 資料標示的班距 尖峰 ${peak}／離峰 ${off}`, txt.slice(0, 200));
        ok(/軌島的資料來源沒有這條路線的逐班時刻表|no train-by-train timetable for this line|この路線の列車ごとの時刻表がない/.test(txt), `${lang} ${id} 註明資料來源沒有逐班時刻表`);
        const flagged = !!exp.g.headway_estimated;
        ok(/資料標示為估算|estimate in the data|データ上の推定値/.test(txt) === flagged, `${lang} ${id} 班距${flagged ? '標「資料標示為估算」（資料 headway_estimated）' : '不標估算（資料的班距不是估算值）'}`);
      }
      log(`    ${id}：營運時段 ${hmOf(first)}–${hmOf(last)}${last >= 86400 ? '(+1)' : ''}，班距 尖峰 ${peak}／離峰 ${off}（估算，不列首末班）`);
      continue;
    }
    for (const svc of exp.services) {
      const toName = svc.dest != null ? stationName(svc.dest) : stationName(svc.second);
      const fromName = stationName(svc.origin);
      const wantFirst = hmOf(svc.first), wantLast = hmOf(svc.last);
      const firstNext = svc.first >= 86400, lastNext = svc.last >= 86400;
      for (const lang of Object.keys(ROOTS)) {
        const p = pageAt(lang, `${s.sys}/${s.slug}`);
        const li = answerItems(p).find(it => namesInOrder(lang, it.strong, fromName, toName) && (svc.kind == null || it.html.includes({ '1': { zh: '普通車', en: 'Commuter', ja: '普通列車' }, '2': { zh: '直達車', en: 'Express', ja: '直達列車' } }[svc.kind][lang])) && TIME_RE[lang].test(it.text));
        if (!ok(!!li, `${lang} ${id} 頁面有「${fromName} → ${toName}」${svc.kind ? `（${svc.kind === '1' ? '普通車' : '直達車'}）` : ''}的首末班列`, answerItems(p).map(x => x.text).join(' / ').slice(0, 260))) continue;
        const m = TIME_RE[lang].exec(li.text);
        const got = { first: m[1], firstNext: !!m[2], last: m[3], lastNext: !!m[4] };
        ok(got.first === wantFirst && got.firstNext === firstNext, `${lang} ${id} ${fromName}→${toName} 首班 頁面 ${got.first}${got.firstNext ? '(+1)' : ''}／data ${wantFirst}${firstNext ? '(+1)' : ''}（${svc.first} 秒）`);
        ok(got.last === wantLast && got.lastNext === lastNext, `${lang} ${id} ${fromName}→${toName} 末班 頁面 ${got.last}${got.lastNext ? '(+1)' : ''}／data ${wantLast}${lastNext ? '(+1)' : ''}（${svc.last} 秒）`);
        ok(li.text.includes(dayLabel(lang, exp.days, exp.holiday)), `${lang} ${id} ${fromName}→${toName} 班表日標籤＝${dayLabel(lang, exp.days, exp.holiday)}（週三所屬班表涵蓋的星期）`, li.text.slice(0, 90));
      }
      log(`    ${fromName} → ${toName}${svc.kind ? `（${svc.kind === '1' ? '普通車' : '直達車'}）` : ''} ${dayLabel('zh', exp.days, exp.holiday)}：首班 ${wantFirst}${firstNext ? '(+1)' : ''}、末班 ${wantLast}${lastNext ? '(+1)' : ''}（${svc.count} 班）`);
    }
    // 班距（起點站相鄰兩班發車間隔的中位數；兩方向不同就分開寫）
    const dirs = exp.loop ? [{ origin: 0, next: 1 }] : [{ origin: 0, next: null }, { origin: exp.n - 1, next: null }];
    const hw = dirs.map(d => ({ ...d, ...expectedHeadway(exp, d.origin, d.next) }));
    for (const lang of Object.keys(ROOTS)) {
      const p = pageAt(lang, `${s.sys}/${s.slug}`);
      const item = answerItems(p).filter(it => /班距|Headway|運転間隔/.test(it.text));
      const txt = item.map(it => it.text).join(' ');
      const differ = hw.length === 2 && (hw[0].morning !== hw[1].morning || hw[0].midday !== hw[1].midday);
      for (const d of hw) {
        if (d.morning == null || d.midday == null) continue;
        const o = differ ? [...nameSet(lang, exp.g.stations[d.origin].name)] : null;
        ok(HEADWAY_RE[lang](d.morning, d.midday, o).test(txt), `${lang} ${id} ${exp.g.stations[d.origin].name}發車 07–09 時每 ${d.morning} 分、12–14 時每 ${d.midday} 分${differ ? '（兩方向不同，數字前要有起點站）' : ''}`, txt.slice(0, 220));
      }
    }
    log(`    班距：${hw.map(d => `${exp.g.stations[d.origin].name}發車 ${d.morning ?? '—'}／${d.midday ?? '—'} 分`).join('；')}`);
  }
}

console.log('────');
if (failures.length) {
  console.error(`捷運路線圖頁驗收失敗：${failures.length} 項不過（共檢查 ${checks} 項，${pages.length} 頁，seed=${seed}）`);
  process.exit(1);
}
console.log(`捷運路線圖頁驗收通過：${pages.length} 頁（zh／en／ja 各 ${pages.length / 3}）、${checks} 項檢查，資料抽驗 ${opt.all ? '全部 14 條' : `${sample.length} 條 [${sample.map(s => s.slug).join('、')}]`}，seed=${seed}`);
