// 正式站功能煙測:停駛偵測有沒有真的在跑。判準取【頁面自己算出來的 state.traDaily】,
// 不是端點回什麼——端點好但前端沒接上,是這批最可能的失敗形態。
import { chromium } from 'playwright';
const URL = process.env.PURL || 'https://railisland.tw/';
let fail = 0; const ck = (o, m) => { console.log((o ? '  ✓ ' : '  ✗ ') + m); if (!o) fail++; };
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1280, height: 800 } });
await pg.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
  null, { timeout: 120000 });
const r = await pg.evaluate(() => ({
  td: state.traDaily || null,
  cancelled: (state.traCancelled || []).length,
  nTrains: state.trains.length,
  schedDay: (state.systems.find(x => x.id === 'tra_sched') || {}).data?._schedDay,
  build: (document.getElementById('diagStrip') || {}).textContent || '',
}));
console.log('  → ' + JSON.stringify(r.td) + '  名冊 ' + r.nTrains + ' 班  營運日 ' + r.schedDay);
ck(!!r.td, '前端有拿到今日官方名冊物件（state.traDaily 存在）');
ck(r.td && r.td.ok === true, `判定成立（ok=${r.td && r.td.ok}${r.td && r.td.reason ? '，reason=' + r.td.reason : ''}）`);
ck(r.td && r.td.date === r.schedDay, `官方名冊營運日與畫面相符（${r.td && r.td.date}）`);
ck(r.td && !!r.td.updateTime, `帶得出官方更新時刻（${r.td && r.td.updateTime}）`);
ck(r.cancelled === (r.td ? r.td.cancelled : -1), `state.traCancelled 與統計一致（${r.cancelled}）`);
ck(r.nTrains > 500, `名冊沒被砍空（${r.nTrains}）`);
ck(errs.length === 0, `零 pageerror${errs.length ? '：' + errs[0] : ''}`);
await br.close();
console.log(fail ? `\nFAIL ${fail}` : '\n✅ 正式站停駛偵測確實在跑');
process.exit(fail ? 1 : 0);
