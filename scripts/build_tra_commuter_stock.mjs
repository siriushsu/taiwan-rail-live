// 區間車車型推估表 → data/tra_special_trains.json 的 commuterStock。
//
// 官方班表分不出區間車世代：ODS CarClass 與 TDX 都只標「區間車／區間快」。TDX 代碼表雖然定義了
// 113A～113D（區間 EMU500／700／800／900），時刻表與即時看板都沒用（2026-11-05 實查）。
// 這份改編自臺灣鐵道維基館「附件:臺鐵區間車」的編組運用表（CC BY-SA 4.0），頁面自註僅供參考，
// 實際以當日調度為準，所以畫面一律寫「推估」。
// DRC1000 不收：支線柴客已由 isDr1000 依停站判定，2026-11-05 查過與這份表 103 班全數一致。
//
// 用法：node scripts/build_tra_commuter_stock.mjs          抓最新運用表，涵蓋率過關才寫回
//       node scripts/build_tra_commuter_stock.mjs --check  不上網，拿檔內的表對目前班表（出貨閘門）
// 涵蓋率掉到門檻以下代表改點換了車次、維基還沒跟上：不要放寬門檻，重跑一次；
// 維基確實還沒更新就把 commuterStock 整段拿掉，畫面會退回只寫「區間車」，不會標錯。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPECIAL = join(ROOT, 'data/tra_special_trains.json');
const SCHEDULE = join(ROOT, 'data/tra_schedule.json');
const WIKI = 'https://taiwanrailwiki.miraheze.org';
const PAGE = '附件:臺鐵區間車';
const MIN_COVERAGE = 0.95;
const DIESEL_BRANCH_IDS = new Set(['pingxi', 'jiji', 'shenao', 'neiwan']); // 同 index.html

const fail = message => { console.error(`❌ ${message}`); process.exit(1); };

// 取「編組運用」底下最新一版。每列車次串的記號：A、B、C 結尾是迴送不載客；
// 「輛」寫在列首，機務段與路段標題的括號裡是這一段會用到的車型。
export function parseRoster(raw) {
  const start = raw.indexOf('==編組運用==');
  const heading = /^===(\d{4})年(\d{2})月(\d{2})日起===$/m.exec(raw.slice(start));
  if (start < 0 || !heading) fail('維基頁面找不到「編組運用」的版本標題，頁面格式可能改了');
  const body = raw.slice(start + heading.index + heading[0].length);
  const end = body.search(/^==[^=]/m);
  const lines = (end < 0 ? body : body.slice(0, end)).split('\n');
  const models = text => text.match(/(?:EMU|DRC)\d+/g) || [];
  const trains = new Map();
  let depotModels = [], sectionModels = [];
  for (const line of lines) {
    if (line.startsWith('====')) { depotModels = models(line); sectionModels = depotModels; continue; }
    if (!line.startsWith('*')) continue;
    if (!line.startsWith('**')) { const own = models(line); sectionModels = own.length ? own : depotModels; continue; }
    const colon = line.indexOf('：');
    const head = colon < 0 ? '' : line.slice(0, colon), chain = line.slice(colon + 1);
    let rowModels = models(head).length ? models(head) : sectionModels;
    // EMU800 是 8 輛固定編組，混用段裡標「4輛」的列只可能是 EMU500。這是推論，不是表上寫的。
    if (/(^|[^\d])4輛/.test(head) && rowModels.includes('EMU500') && rowModels.includes('EMU800')) rowModels = ['EMU500'];
    for (const [no] of chain.matchAll(/(?<![\dA-Za-z])\d{3,4}(?![\dA-Z])/g)) {
      if (!trains.has(no)) trains.set(no, new Set());
      rowModels.forEach(m => trains.get(no).add(m));
    }
  }
  return { asOf: `${heading[1]}-${heading[2]}-${heading[3]}`, trains };
}

function groupsOf(trains) {
  const groups = new Map();
  for (const [no, set] of trains) {
    if (set.has('DRC1000') || !set.size) continue;
    const key = [...set].sort().join('/');
    if (!groups.has(key)) groups.set(key, { models: key.split('/'), trains: [] });
    groups.get(key).trains.push(no);
  }
  return [...groups.values()].sort((a, b) => a.models.length - b.models.length || a.models.join().localeCompare(b.models.join()))
    .map(g => ({ ...g, trains: g.trains.sort((a, b) => a - b) }));
}

// 分母是班表裡還沒被支線規則認成 DR1000 的區間類列車。
function coverage(groups) {
  const special = JSON.parse(readFileSync(SPECIAL, 'utf8'));
  const diesel = special.branchLines.filter(b => DIESEL_BRANCH_IDS.has(b.id)).map(b => new Set(b.matchStations));
  const known = new Set(groups.flatMap(g => g.trains));
  const nos = new Set(JSON.parse(readFileSync(SCHEDULE, 'utf8')).trains
    .filter(t => /區間/.test(t.carName || '') && !diesel.some(set => t.stops.some(s => set.has(s.name))))
    .map(t => t.train));
  const missing = [...nos].filter(no => !known.has(no));
  if (!nos.size) fail('班表裡找不到區間類列車，比對沒有意義');
  return { total: nos.size, missing, ratio: (nos.size - missing.length) / nos.size };
}

function report(c) {
  console.log(`區間車車型涵蓋率 ${(c.ratio * 100).toFixed(1)}%（${c.total - c.missing.length}／${c.total}）`
    + (c.missing.length ? `，表內沒有：${c.missing.slice(0, 12).join('、')}` : ''));
  if (c.ratio < MIN_COVERAGE) fail(`涵蓋率低於 ${MIN_COVERAGE * 100}%：車次多半已改，先看檔頭的處理方式`);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'railisland-data-build (+https://railisland.tw)' } });
  if (!res.ok) fail(`${url} 回 ${res.status}`);
  return res;
}

// 檔案不是 JSON.stringify 的排版，整份重寫會弄亂全部差異；這段永遠放在最後，只換尾巴。
function writeBlock(block) {
  const text = readFileSync(SPECIAL, 'utf8');
  const cut = text.indexOf(',\n  "commuterStock":');
  const head = (cut < 0 ? text.replace(/\n}\n$/, '') : text.slice(0, cut));
  const lines = JSON.stringify(block, null, 2).split('\n').map((line, i) => (i ? '  ' : '') + line).join('\n')
    .replace(/("(?:models|trains)": \[)([^\]]*)\]/g, (_, key, items) => key + items.replace(/\s+/g, ' ').trim().replace(/, /g, ',') + ']');
  writeFileSync(SPECIAL, `${head},\n  "commuterStock": ${lines}\n}\n`);
}

if (process.argv.includes('--check')) {
  const stock = JSON.parse(readFileSync(SPECIAL, 'utf8')).commuterStock;
  if (!stock) { console.log('commuterStock 已拿掉，畫面只寫區間車，略過涵蓋率'); process.exit(0); }
  report(coverage(stock.groups));
} else {
  const title = encodeURIComponent(PAGE);
  const raw = await (await get(`${WIKI}/w/index.php?title=${title}&action=raw`)).text();
  const rev = await (await get(`${WIKI}/w/api.php?action=query&prop=revisions&rvlimit=1&rvprop=ids|timestamp&format=json&formatversion=2&titles=${title}`)).json();
  const latest = rev.query.pages[0].revisions[0];
  const { asOf, trains } = parseRoster(raw);
  const groups = groupsOf(trains);
  report(coverage(groups));
  writeBlock({ asOf, revision: latest.revid, fetchedRevisionAt: latest.timestamp,
    source: `臺灣鐵道維基館「${PAGE}」編組運用表`, sourceUrl: `${WIKI}/wiki/${title}`, license: 'CC BY-SA 4.0',
    note: '官方班表分不出區間車世代，這份是社群整理的推估；頁面自註僅供參考，實際以當日調度為準。由 scripts/build_tra_commuter_stock.mjs 產生，勿手改。',
    groups });
  for (const g of groups) console.log(`  ${g.models.join('／')}：${g.trains.length} 班`);
}
