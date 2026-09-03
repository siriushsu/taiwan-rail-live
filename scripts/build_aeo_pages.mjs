import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteUrl = 'https://railisland.tw';
const updated = '2026-09-03';
const transfers = JSON.parse(fs.readFileSync(path.join(root, 'data/station_transfers.json'), 'utf8'));
const traInfo = JSON.parse(fs.readFileSync(path.join(root, 'data/tra_station_info.json'), 'utf8'));

const systemNames = {
  AFR: '阿里山林業鐵路',
  KRTC: '高雄捷運',
  THSR: '台灣高鐵',
  TMRT: '台中捷運',
  TRA: '台鐵',
  TRTC: '台北捷運',
  TYMC: '桃園機場捷運',
  NTMC: '新北捷運環狀線',
};

const routeNames = {
  'THSR:THSR': '台灣高鐵',
  ...Object.fromEntries(Object.entries(transfers.routes).map(([key, route]) => [key, route.name || systemNames[route.system] || key])),
};

const stations = [
  {
    slug: 'taipei',
    title: '台北車站',
    members: ['THSR:1000', 'TRA:1000', 'TRTC:BL12', 'TRTC:R10', 'TYMC:A1'],
    summary: '台北車站是台鐵、高鐵、台北捷運板南線與淡水信義線的共站區域；桃園機場捷運 A1 台北車站也在步行轉乘範圍內。軌島把這些系統分別呈現，再以轉乘資料連結。',
    transfer: '台鐵與高鐵站點相鄰；兩條台北捷運路線使用同一捷運站名。桃園機場捷運 A1 與台鐵站點在資料中相距約 304 公尺，屬步行轉乘，不代表同一月台。',
  },
  {
    slug: 'banqiao',
    title: '板橋車站',
    members: ['NTMC:Y16', 'THSR:1010', 'TRA:1020', 'TRTC:BL07'],
    summary: '板橋車站可轉乘台鐵、高鐵、台北捷運板南線與新北捷運環狀線，是新北市的多系統轉乘站。軌島會把同名但分屬不同系統的站點合併提示。',
    transfer: '台鐵與高鐵站點在資料中相距約 14 公尺；板南線與環狀線也在步行轉乘範圍內。各系統仍有自己的月台、班表與即時資訊。',
  },
  {
    slug: 'nangang',
    title: '南港車站',
    members: ['THSR:0990', 'TRA:0980', 'TRTC:BL22'],
    summary: '南港車站是台鐵、高鐵與台北捷運板南線的共站區域。軌島同時顯示三個系統，但不把「南港」與下一站「南港展覽館」混為一談。',
    transfer: '台鐵與高鐵站點相距約 25 公尺；板南線南港站在同一轉乘區域。南港展覽館是另一個捷運站，請依實際站內指標前往。',
  },
  {
    slug: 'songshan',
    title: '松山車站',
    members: ['TRA:0990', 'TRTC:G19'],
    summary: '松山車站可轉乘台鐵與台北捷運松山新店線。軌島會把兩個系統的同名站點連結，但列車位置、班表與看板仍各自依來源計算。',
    transfer: '台鐵松山站與捷運松山站在資料中相距約 166 公尺，屬步行轉乘。這裡的松山站不是松山機場站。',
  },
  {
    slug: 'taoyuan',
    title: '台鐵桃園車站',
    members: ['TRA:1080'],
    summary: '台鐵桃園車站位於桃園市桃園區，軌島以台鐵西部幹線的班表與官方即時誤點呈現列車。它不是位於青埔的高鐵桃園站。',
    transfer: '台鐵桃園站與高鐵桃園站是不同地點，不能在同一站體內轉乘；查詢與集合時應確認自己要去的是「台鐵桃園」或「高鐵桃園」。',
  },
  {
    slug: 'taoyuan-hsr',
    title: '高鐵桃園站',
    members: ['THSR:1020', 'TYMC:A18'],
    summary: '高鐵桃園站位於桃園青埔，可轉乘桃園機場捷運 A18 高鐵桃園站。軌島把高鐵與機場捷運分別呈現，再標示為可轉乘。',
    transfer: '高鐵與機場捷運站點在資料中相距約 119 公尺。本站與桃園市區的台鐵桃園車站不是同一站。',
  },
  {
    slug: 'hsinchu',
    title: '台鐵新竹車站',
    members: ['TRA:1210'],
    summary: '台鐵新竹車站位於新竹市區，軌島以台鐵西部幹線班表與官方即時誤點呈現列車。它與竹北六家地區的高鐵新竹站不是同一地點。',
    transfer: '要轉乘高鐵時，需前往高鐵新竹站／台鐵六家站的共站區域；不能把台鐵新竹站視為高鐵共站。',
  },
  {
    slug: 'hsinchu-hsr',
    title: '高鐵新竹站',
    members: ['THSR:1030', 'TRA:1194'],
    summary: '高鐵新竹站可步行轉乘台鐵六家線的六家站。軌島把高鐵新竹與台鐵六家視為轉乘組，但保留兩個實際站名。',
    transfer: '高鐵新竹站與台鐵六家站在資料中相距約 122 公尺。它們與新竹市區的台鐵新竹站是不同地點。',
  },
  {
    slug: 'taichung',
    title: '台鐵台中車站',
    members: ['TRA:3300'],
    summary: '台鐵台中車站位於台中市中區，軌島以台鐵西部幹線班表與官方即時誤點呈現列車。它不是烏日的高鐵台中站。',
    transfer: '高鐵台中站的鐵路轉乘點是台鐵新烏日站與台中捷運高鐵台中站；台鐵台中站是另一個車站。',
  },
  {
    slug: 'taichung-hsr',
    title: '高鐵台中站',
    members: ['THSR:1040', 'TMRT:G17', 'TRA:3340'],
    summary: '高鐵台中站位於烏日，可轉乘台鐵新烏日站與台中捷運高鐵台中站。軌島保留三個系統各自的站名與班表，再標示轉乘關係。',
    transfer: '台中捷運站與台鐵新烏日站在資料中相距約 84 公尺；高鐵站點與兩者也在步行轉乘範圍內。這裡不是台中市區的台鐵台中站。',
  },
  {
    slug: 'tainan',
    title: '台鐵台南車站',
    members: ['TRA:4220'],
    summary: '台鐵台南車站位於台南市東區，軌島以台鐵西部幹線班表與官方即時誤點呈現列車。它不是歸仁的高鐵台南站。',
    transfer: '前往高鐵台南站通常要轉往與高鐵共站的台鐵沙崙站；「台鐵台南」與「高鐵台南」不可當成同一站。',
  },
  {
    slug: 'tainan-hsr',
    title: '高鐵台南站',
    members: ['THSR:1060', 'TRA:4272'],
    summary: '高鐵台南站位於歸仁，可步行轉乘台鐵沙崙線的沙崙站。軌島把兩者列為轉乘組，但保留「台南」與「沙崙」兩個站名。',
    transfer: '高鐵台南站與台鐵沙崙站在資料中相距約 112 公尺。它們與台南市區的台鐵台南站是不同地點。',
  },
  {
    slug: 'zuoying',
    title: '左營轉乘站',
    members: ['KRTC:R16', 'THSR:1070', 'TRA:4340'],
    summary: '左營轉乘區可搭高鐵、台鐵新左營站與高雄捷運紅線左營站。軌島用各系統的正式站名顯示，再以轉乘組連結。',
    transfer: '高鐵左營與台鐵新左營站點相距約 74 公尺；捷運左營站也在步行轉乘範圍內。台鐵另外還有「左營（舊城）」站名脈絡，查詢時以畫面標示為準。',
  },
  {
    slug: 'kaohsiung',
    title: '高雄車站',
    members: ['KRTC:R11', 'TRA:4400'],
    summary: '高雄車站可轉乘台鐵與高雄捷運紅線。軌島會連結兩個系統的同名站點，但台鐵班表與捷運到站資訊仍分開處理。',
    transfer: '台鐵與高雄捷運站點在資料中相距約 34 公尺，屬同一轉乘區域。高鐵在左營，不在高雄車站停靠。',
  },
  {
    slug: 'hualien',
    title: '花蓮車站',
    members: ['TRA:7000'],
    summary: '花蓮車站是台鐵東部幹線的重要車站。軌島依官方班表繪製列車，並在台鐵即時資料可用時套用官方誤點。',
    transfer: '本站的主要鐵路服務是台鐵；軌島不會把公路客運或觀光接駁班次混入鐵路發車看板。實際轉乘請查看現場與營運單位資訊。',
  },
  {
    slug: 'taitung',
    title: '台東車站',
    members: ['TRA:6000'],
    summary: '台東車站是台鐵東部幹線與南迴線的交會站。軌島依官方班表呈現列車，並在即時資料可用時套用台鐵官方誤點。',
    transfer: '軌島的轉乘資料在本站著重鐵路路線交會，不代表不同月台間的實際步行時間。是否趕得上轉乘仍應以現場資訊判斷。',
  },
  {
    slug: 'yilan',
    title: '宜蘭車站',
    members: ['TRA:7190'],
    summary: '宜蘭車站位於台鐵東部幹線的宜蘭線。軌島依官方班表呈現列車，並在台鐵即時資料可用時套用官方誤點。',
    transfer: '本站的頁面提供穩定的車站與路線資訊；會隨時間變動的發車班次、停駛與誤點請直接回到軌島即時地圖查看。',
  },
  {
    slug: 'chiayi',
    title: '嘉義車站',
    members: ['AFR:360', 'TRA:4080'],
    summary: '嘉義車站可搭台鐵，也與阿里山林業鐵路嘉義站共站。軌島分別顯示兩種鐵路的班表與列車，再標示為可轉乘。',
    transfer: '台鐵與阿里山林鐵站點在資料中相距約 18 公尺。高鐵嘉義站位於另一地點，不屬於這個共站區域。',
  },
  {
    slug: 'chiayi-hsr',
    title: '高鐵嘉義站',
    members: ['THSR:1050'],
    summary: '高鐵嘉義站是台灣高鐵車站，與嘉義市區的台鐵嘉義站不是同一地點。軌島在地圖與索引中把兩者分開，避免同名誤認。',
    transfer: '本站頁面只描述軌島收錄的鐵路系統；接駁與公車班次可能變動，請以營運單位或現場資訊為準。',
  },
  {
    slug: 'formosa-boulevard',
    title: '美麗島站',
    members: ['KRTC:O5', 'KRTC:R10'],
    summary: '美麗島站是高雄捷運紅線與橘線的轉乘站。軌島會把兩條路線的同名站點合併為轉乘提示，但各線列車與到站資訊仍分開計算。',
    transfer: '紅線與橘線在同一捷運轉乘站交會。資料中的兩個路線站點座標略有差異，代表不同路線的定位點，不是兩座互不相通的車站。',
  },
];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function head({ title, description, pathname, schema }) {
  const canonical = `${siteUrl}${pathname}`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <meta property="og:locale" content="zh_TW">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="軌島 Rail Island">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${siteUrl}/og-1200x630.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-180.png">
  <meta name="theme-color" content="#F2EDE2">
  <link rel="stylesheet" href="/assets/aeo.css">
  <script type="application/ld+json">${jsonLd(schema)}</script>
</head>`;
}

function header() {
  return `<body>
  <a class="skip-link" href="#main">跳到主要內容</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="軌島首頁"><span class="brand-mark" aria-hidden="true">軌</span><span>軌島 Rail Island</span></a>
      <nav class="site-nav" aria-label="主要導覽">
        <a href="/about/">關於</a>
        <a href="/accuracy/">準確度</a>
        <a href="/data-sources/">資料來源</a>
        <a href="/stations/">車站索引</a>
        <a class="nav-live" href="/">打開即時地圖</a>
      </nav>
    </div>
  </header>`;
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="麵包屑"><ol>${items.map((item, index) => `<li>${index === items.length - 1 ? escapeHtml(item.label) : `<a href="${item.href}">${escapeHtml(item.label)}</a>`}</li>`).join('')}</ol></nav>`;
}

function footer() {
  return `<footer class="site-footer">
    <div class="site-footer-inner">
      <div>軌島是獨立維護、原始碼公開可查的台灣鐵道即時動畫地圖，與各營運機構無關。</div>
      <div class="footer-links"><a href="/accuracy/">準確度與限制</a><a href="/data-sources/">資料來源</a><a href="https://github.com/siriushsu/taiwan-rail-live">GitHub 原始碼</a></div>
    </div>
  </footer>
</body>
</html>
`;
}

function pageSchema({ title, description, pathname, type = 'WebPage', extra = {} }) {
  return {
    '@context': 'https://schema.org',
    '@type': type,
    name: title,
    description,
    url: `${siteUrl}${pathname}`,
    inLanguage: 'zh-Hant',
    dateModified: updated,
    isPartOf: { '@type': 'WebSite', name: '軌島 Rail Island', url: `${siteUrl}/` },
    ...extra,
  };
}

function renderPage({ title, description, pathname, eyebrow, heading, lede, content, schema, crumbs = [] }) {
  return `${head({ title, description, pathname, schema })}
${header()}
  <main class="page-shell" id="main">
    ${breadcrumbs([{ label: '首頁', href: '/' }, ...crumbs, { label: heading }])}
    <section class="hero">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">${escapeHtml(lede)}</p>
      <div class="hero-actions"><a class="button" href="/">打開即時地圖</a><a class="button secondary" href="/stations/">查車站資料</a></div>
    </section>
    ${content}
  </main>
${footer()}`;
}

const aboutDescription = '軌島是一張依官方時刻表與可用即時資料，呈現台灣台鐵、高鐵、捷運、輕軌與阿里山林鐵列車的動畫地圖，也能查看車站、班次與營運公告。';
write('about/index.html', renderPage({
  title: '關於軌島：台灣鐵道即時動畫地圖',
  description: aboutDescription,
  pathname: '/about/',
  eyebrow: 'ABOUT RAIL ISLAND',
  heading: '軌島是什麼？',
  lede: aboutDescription,
  schema: pageSchema({ title: '關於軌島：台灣鐵道即時動畫地圖', description: aboutDescription, pathname: '/about/', type: 'AboutPage' }),
  content: `<section class="content-section"><h2>它怎麼運作</h2><div class="card-grid">
    <article class="card"><h3>收進同一張地圖</h3><p>台鐵、高鐵、各地捷運與輕軌、阿里山林鐵使用不同資料格式；軌島先整理路線、車站與班表，再放到同一時間軸。</p><a class="card-link" href="/data-sources/">看資料來源 →</a></article>
    <article class="card"><h3>依證據區分即時與推估</h3><p>有官方即時訊號的系統會用來校正；沒有逐車 GPS 的系統，列車位置是依班表、站間時間或官方到站倒數推演。</p><a class="card-link" href="/accuracy/">看準確度說明 →</a></article>
    <article class="card"><h3>免費、原始碼公開、獨立維護</h3><p>這是個人興趣專案，不是營運機構的官方服務。原始碼依 source-available 授權公開，可供檢視與個人研究；網站基本地圖與列車資訊免費使用。</p><a class="card-link" href="https://github.com/siriushsu/taiwan-rail-live">查看原始碼與授權 →</a></article>
  </div></section>
  <section class="content-section"><h2>軌島適合回答什麼</h2><div class="answer-box"><ul class="answer-list">
    <li>現在地圖上有哪些台鐵、高鐵、捷運與輕軌列車？</li>
    <li>某個車站屬於哪些系統、可在哪裡轉乘？</li>
    <li>台鐵列車在官方即時資料可用時，目前大約準點或誤點多久？</li>
    <li>某個系統的列車位置是即時訊號，還是依班表推估？</li>
  </ul></div></section>
  <section class="content-section"><h2>不能取代官方行車資訊</h2><div class="notice"><strong>重要：</strong>軌島適合探索與輔助理解路網，不應作為趕車、安全決策或營運調度的唯一依據。臨時停駛、月台異動與現場狀況請以營運機構公告為準。</div></section>`,
}));

const accuracyDescription = '軌島不是所有列車的 GPS 地圖：台鐵套用官方即時誤點；其他系統依可取得的官方到站資訊、時刻表或班距推演，並清楚標示限制。';
write('accuracy/index.html', renderPage({
  title: '軌島準確嗎？即時資料、推估方式與限制',
  description: accuracyDescription,
  pathname: '/accuracy/',
  eyebrow: 'ACCURACY & LIMITS',
  heading: '軌島準確嗎？',
  lede: accuracyDescription,
  schema: pageSchema({ title: '軌島準確嗎？即時資料、推估方式與限制', description: accuracyDescription, pathname: '/accuracy/' }),
  content: `<section class="content-section"><h2>一眼看懂資料層級</h2><div class="fact-table">
    <div class="fact-row"><div class="fact-label">台鐵</div><div class="fact-value">以官方時刻表為基礎；官方即時誤點可用時，校正列車在時間軸上的位置。資料過舊時會退回推估，不把舊資料假裝成 LIVE。</div></div>
    <div class="fact-row"><div class="fact-label">高鐵</div><div class="fact-value">依官方時刻表推演；軌島目前不宣稱有高鐵逐車 GPS 或官方即時誤點。</div></div>
    <div class="fact-row"><div class="fact-label">捷運與輕軌</div><div class="fact-value">依各系統可取得的官方逐班時刻、班距、到站倒數或列車動態校正。不同系統的即時程度不同。</div></div>
    <div class="fact-row"><div class="fact-label">阿里山林鐵</div><div class="fact-value">依公開班表與路線資料推演；日出相關列車會依日期資料處理，但仍應以官方公告為準。</div></div>
  </div></section>
  <section class="content-section"><h2>「列車在這裡」代表什麼</h2><div class="answer-box"><p>多數營運機構不提供可公開使用的逐車 GPS 座標。因此地圖上的移動位置常是把官方班表、站間行駛時間、停站時間與可用的即時到站訊號放在一起推算的結果。它能呈現列車大致行進情形，但不是安全定位設備。</p><p>隧道、臨時調度、上游斷訊、裝置時間不準或瀏覽器暫停背景分頁，都可能讓畫面與現場產生差異。</p></div></section>
  <section class="content-section"><h2>怎麼判斷最新狀態</h2><div class="card-grid">
    <article class="card"><h3>看畫面標示</h3><p>軌島會區分即時、推估與中斷等狀態。顯示推估時，不應把分鐘數當成官方保證。</p><a class="card-link" href="/">打開地圖 →</a></article>
    <article class="card"><h3>看資料狀態</h3><p>狀態頁整理資料源目前是否能連線，協助分辨是上游服務或裝置網路問題。</p><a class="card-link" href="/status.html">資料源狀態 →</a></article>
    <article class="card"><h3>最後以官方為準</h3><p>要趕車、確認停駛或月台時，請再查營運機構 App、網站、車站看板或現場廣播。</p><a class="card-link" href="/data-sources/">資料來源 →</a></article>
  </div></section>`,
}));

const sourcesDescription = '軌島整合台鐵 OpenData、交通部 TDX、各捷運營運機構公開資料與 OpenStreetMap；不同資料分別負責班表、即時校正、車站與軌道幾何。';
write('data-sources/index.html', renderPage({
  title: '軌島資料來源：台鐵、TDX、捷運與 OpenStreetMap',
  description: sourcesDescription,
  pathname: '/data-sources/',
  eyebrow: 'DATA PROVENANCE',
  heading: '軌島的資料從哪裡來？',
  lede: sourcesDescription,
  schema: pageSchema({ title: '軌島資料來源：台鐵、TDX、捷運與 OpenStreetMap', description: sourcesDescription, pathname: '/data-sources/' }),
  content: `<section class="content-section"><h2>主要來源與用途</h2><div class="fact-table">
    <div class="fact-row"><div class="fact-label">台鐵 OpenData</div><div class="fact-value">每日時刻表、車站基本資料與車種代碼等穩定資料。</div></div>
    <div class="fact-row"><div class="fact-label">交通部 TDX</div><div class="fact-value">台鐵即時誤點與車站資訊，以及高鐵、捷運、輕軌等系統的路線、站序、時刻表或班距資料，依政府資料開放授權條款第1版使用。<a href="https://motc-ptx.gitbook.io/tdx-xin-shou-zhi-yin/api-shi-yong-shuo-ming/zi-liao-shi-yong-chang-jian-wen-ti"><img src="/assets/tdx-logo.svg" alt="TDX 運輸資料流通服務標章 / Transport Data eXchange" width="184" height="34" style="display:block;max-width:100%;height:auto;margin-top:8px"></a></div></div>
    <div class="fact-row"><div class="fact-label">營運機構資料</div><div class="fact-value">在授權與技術條件允許時，使用各營運機構的到站倒數、列車動態或營運公告校正畫面。</div></div>
    <div class="fact-row"><div class="fact-label">OpenStreetMap</div><div class="fact-value">補足部分軌道幾何；資料來自 OpenStreetMap 貢獻者並依 ODbL 使用。</div></div>
    <div class="fact-row"><div class="fact-label">地圖圖磚</div><div class="fact-value">網站街道圖使用 OpenFreeMap，衛星影像使用 Esri World Imagery；App 的 OpenFreeMap 載入失敗時改用 Stadia Maps。實際授權標示會顯示在地圖上。</div></div>
  </div></section>
  <section class="content-section"><h2>為什麼不只用一個 API</h2><div class="answer-box"><p>班表、站點、路線幾何、逐車狀態與營運公告通常分散在不同來源，而且每個鐵道系統公開的欄位不同。軌島保留來源差異：有即時訊號就校正，只有班表就明確當作推演，不用一種資料精度冒充所有系統。</p></div></section>
  <section class="content-section"><h2>更新與可追溯性</h2><div class="card-grid">
    <article class="card"><h3>資料狀態</h3><p>查看網站目前能否連上各項上游資料。</p><a class="card-link" href="/status.html">開啟狀態頁 →</a></article>
    <article class="card"><h3>公開原始碼</h3><p>資料管線與前端呈現方式都能在 GitHub 查閱。</p><a class="card-link" href="https://github.com/siriushsu/taiwan-rail-live">查看 GitHub →</a></article>
    <article class="card"><h3>解讀限制</h3><p>了解「即時」、「官方到站校正」與「班表推演」之間的差異。</p><a class="card-link" href="/accuracy/">準確度說明 →</a></article>
  </div></section>`,
}));

function stationDetails(config) {
  return config.members.map(key => {
    const item = transfers.stations[key];
    if (!item) throw new Error(`${config.slug} 找不到站點 ${key}`);
    return { key, ...item };
  });
}

function stationAddress(details) {
  const tra = details.find(item => item.system === 'TRA');
  if (!tra) return '';
  const info = Object.values(traInfo).find(item => String(item.id) === String(tra.stationId));
  return info?.address || '';
}

function stationSystems(details) {
  return [...new Set(details.map(item => systemNames[item.system] || item.system))];
}

function stationRoutes(details) {
  return [...new Set(details.flatMap(item => item.routes).map(route => routeNames[route] || route))];
}

function stationPage(config, index) {
  const details = stationDetails(config);
  const systems = stationSystems(details);
  const routes = stationRoutes(details);
  const address = stationAddress(details);
  const position = details[0].position;
  const pathname = `/stations/${config.slug}/`;
  const description = `${config.summary} 查看收錄系統、路線、轉乘判讀與資料限制。`;
  const related = [stations[(index + 1) % stations.length], stations[(index + stations.length - 1) % stations.length]];
  const place = {
    '@type': 'Place',
    name: config.title,
    geo: { '@type': 'GeoCoordinates', latitude: position[0], longitude: position[1] },
    ...(address ? { address } : {}),
  };
  const schema = pageSchema({
    title: `${config.title}：路線、轉乘與軌島資料說明`,
    description,
    pathname,
    extra: { about: place, mainEntity: place },
  });
  return `${head({ title: `${config.title}：路線、轉乘與軌島資料說明`, description, pathname, schema })}
${header()}
  <main class="page-shell" id="main">
    ${breadcrumbs([{ label: '車站索引', href: '/stations/' }, { label: config.title }])}
    <section class="hero">
      <p class="eyebrow">STATION GUIDE</p>
      <h1>${escapeHtml(config.title)}</h1>
      <p class="lede">${escapeHtml(config.summary)}</p>
      <div class="tag-row">${systems.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join('')}${routes.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join('')}</div>
      <div class="hero-actions"><a class="button" href="/">在即時地圖查看</a><a class="button secondary" href="/stations/">回車站索引</a></div>
    </section>
    <section class="content-section"><h2>本站可以搭什麼</h2><div class="fact-table">
      <div class="fact-row"><div class="fact-label">收錄系統</div><div class="fact-value">${systems.map(escapeHtml).join('、')}</div></div>
      <div class="fact-row"><div class="fact-label">路線</div><div class="fact-value">${routes.map(escapeHtml).join('、')}</div></div>
      <div class="fact-row"><div class="fact-label">軌島站點</div><div class="fact-value">${details.map(item => `${escapeHtml(systemNames[item.system] || item.system)} ${escapeHtml(item.name)}（${escapeHtml(item.stationId)}）`).join('；')}</div></div>
${address ? `      <div class="fact-row"><div class="fact-label">台鐵地址</div><div class="fact-value">${escapeHtml(address)}</div></div>\n` : ''}      <div class="fact-row"><div class="fact-label">參考座標</div><div class="fact-value">${position[0].toFixed(6)}, ${position[1].toFixed(6)}</div></div>
    </div></section>
    <section class="content-section"><h2>轉乘與站體判讀</h2><div class="answer-box"><p>${escapeHtml(config.transfer)}</p><p>資料中的距離用於辨識共站與步行轉乘關係，不是站內導航，也不等於月台之間的實際步行時間。</p></div></section>
    <section class="content-section"><h2>軌島怎麼顯示這一站</h2><div class="answer-box"><p>${systems.includes('台鐵') ? '台鐵列車以官方班表為基礎，官方即時誤點可用時會校正時間軸位置。' : ''}${systems.includes('台灣高鐵') ? '高鐵列車依官方時刻表推演，本站頁面不宣稱有高鐵逐車 GPS。' : ''}${systems.some(item => item.includes('捷運')) ? '捷運列車依各營運機構可取得的官方時刻、班距、到站倒數或列車動態呈現；不同系統的即時程度不同。' : ''}${systems.includes('阿里山林業鐵路') ? '阿里山林鐵依公開班表與路線資料推演。' : ''}</p><p>這一頁只放不會每分鐘過期的車站資訊。當下班次、誤點、停駛與營運公告請回即時地圖查看，並以營運機構現場資訊為準。</p></div></section>
    <section class="content-section"><h2>附近的車站資料頁</h2><div class="card-grid">${related.map(item => `<article class="card station-card"><div class="station-systems">車站資料</div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p><a class="card-link" href="/stations/${item.slug}/">查看 ${escapeHtml(item.title)} →</a></article>`).join('')}</div></section>
  </main>
${footer()}`;
}

for (const [index, station] of stations.entries()) write(`stations/${station.slug}/index.html`, stationPage(station, index));

const stationsDescription = `軌島車站索引整理 ${stations.length} 個常查詢的台灣鐵路轉乘站與同名站，說明台鐵、高鐵、捷運及林鐵的路線、共站關係與資料限制。`;
write('stations/index.html', renderPage({
  title: '台灣鐵路車站與轉乘站索引｜軌島',
  description: stationsDescription,
  pathname: '/stations/',
  eyebrow: 'STATION INDEX',
  heading: '車站與轉乘站索引',
  lede: stationsDescription,
  schema: pageSchema({
    title: '台灣鐵路車站與轉乘站索引｜軌島',
    description: stationsDescription,
    pathname: '/stations/',
    type: 'CollectionPage',
    extra: { mainEntity: { '@type': 'ItemList', numberOfItems: stations.length, itemListElement: stations.map((station, index) => ({ '@type': 'ListItem', position: index + 1, name: station.title, url: `${siteUrl}/stations/${station.slug}/` })) } },
  }),
  content: `<section class="content-section"><h2>常查詢車站</h2><p class="section-intro">同名不一定同站。索引特別把台鐵與高鐵的桃園、新竹、台中、台南、嘉義分開，避免搜尋時把不同地點誤認成同一站。</p><div class="card-grid station-grid">${stations.map(station => {
    const details = stationDetails(station);
    return `<article class="card station-card"><div class="station-systems">${stationSystems(details).map(escapeHtml).join(' · ')}</div><h3>${escapeHtml(station.title)}</h3><p>${escapeHtml(station.summary)}</p><a class="card-link" href="/stations/${station.slug}/">查看車站資料 →</a></article>`;
  }).join('')}</div></section>
  <section class="content-section"><div class="notice"><strong>沒有列出的車站不代表軌島沒有收錄。</strong>這是第一批供搜尋與引用的穩定資料頁；完整站點與當下發車資訊仍在即時地圖中。</div></section>`,
}));

write('robots.txt', `User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);

const sitemapPaths = [
  '/',
  '/about/',
  '/accuracy/',
  '/data-sources/',
  '/stations/',
  ...stations.map(station => `/stations/${station.slug}/`),
  '/status.html',
  '/privacy.html',
  '/terms.html',
];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPaths.map(pathname => `  <url><loc>${siteUrl}${pathname}</loc><lastmod>${updated}</lastmod></url>`).join('\n')}\n</urlset>\n`);

console.log(`AEO pages built: ${stations.length} station pages + 4 guide pages + robots/sitemap`);
