// 火車站看板「完整班次」App 驗收：真實觸控、特大字、四個寬度、Chromium + WebKit。
// 用法：node scripts/verify_board_all_departures.mjs [URL]
import { chromium, webkit } from 'playwright';

const target = process.argv[2] || 'http://127.0.0.1:5399/';
let pass = 0, fail = 0;
const ok = (name, cond, got = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : `　實測：${got}`}`);
};

for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await engine.launch();
  for (const width of [360, 375, 414, 768]) {
    const height = width === 768 ? 1024 : 844;
    const context = await browser.newContext({
      viewport: { width, height }, screen: { width, height }, locale: 'zh-TW',
      isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      try {
        localStorage.setItem('trainmap-howto-seen', '1');
        localStorage.setItem('trainmap-fontscale', 'xlarge');
      } catch (error) {}
    });
    await page.goto(target + (target.includes('?') ? '&' : '?') + 'lang=zh-TW', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true &&
      Array.isArray(state.trains) && state.trains.length > 0, null, { timeout: 90000 });
    await page.evaluate(() => {
      selectGroup(GROUPS.find(group => group.id === 'tra'));
      state.playing = false;
      setSimSec(8 * 3600);
      document.documentElement.setAttribute('data-fs', 'xlarge');
      document.body.classList.add('fs');
      const station = state.schedStations.find(item => item.name === '竹南' && item.sys === 'tra_sched');
      openBoard(station);
    });
    await page.waitForSelector('.board-all-toggle[aria-expanded="false"]');

    const before = await page.evaluate(() => {
      const board = document.getElementById('board');
      const button = board.querySelector('.board-all-toggle');
      button.scrollIntoView({ block: 'center' });
      const br = board.getBoundingClientRect(), tr = button.getBoundingClientRect();
      const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
      return {
        rows: board.querySelectorAll('.row[data-no]').length,
        buttonHeight: tr.height,
        hit: hit === button || button.contains(hit),
        boardInViewport: br.left >= -1 && br.right <= innerWidth + 1 && br.top >= -1 && br.bottom <= innerHeight + 1,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 &&
          board.scrollWidth <= board.clientWidth + 1,
      };
    });
    ok(`${engineName} ${width}px 特大字：完整班次鈕可由座標命中`, before.hit, JSON.stringify(before));
    ok(`${engineName} ${width}px 特大字：觸控目標至少 60px`, before.buttonHeight >= 59.5, before.buttonHeight);
    ok(`${engineName} ${width}px：面板在 viewport 內且沒有水平溢出`,
      before.boardInViewport && before.noHorizontalOverflow, JSON.stringify(before));

    await page.tap('.board-all-toggle');
    await page.waitForFunction(count => {
      const board = document.getElementById('board');
      return board.querySelector('.board-all-toggle')?.getAttribute('aria-expanded') === 'true' &&
        board.querySelectorAll('.row[data-no]').length > count;
    }, before.rows);
    const expanded = await page.evaluate(() => ({
      rows: document.querySelectorAll('#board .row[data-no]').length,
      expanded: document.querySelector('#board .board-all-toggle')?.getAttribute('aria-expanded'),
      showAll: document.getElementById('board').classList.contains('show-all'),
    }));
    ok(`${engineName} ${width}px：page.tap() 展開後列數增加`,
      expanded.expanded === 'true' && expanded.showAll && expanded.rows > before.rows, JSON.stringify(expanded));

    await page.evaluate(() => document.querySelector('#board .board-all-toggle').scrollIntoView({ block: 'center' }));
    await page.tap('.board-all-toggle');
    await page.waitForFunction(count => document.querySelectorAll('#board .row[data-no]').length === count &&
      document.querySelector('#board .board-all-toggle')?.getAttribute('aria-expanded') === 'false', before.rows);
    ok(`${engineName} ${width}px：同一顆按鈕可收回精簡清單`, true);

    const reset = await page.evaluate(() => {
      document.getElementById('board').classList.add('show-all');
      const station = state.schedStations.find(item => item.name === '二水' && item.sys === 'tra_sched');
      openBoard(station);
      return !document.getElementById('board').classList.contains('show-all');
    });
    ok(`${engineName} ${width}px：切站不沿用上一站的完整清單狀態`, reset);
    ok(`${engineName} ${width}px：全程零 pageerror`, errors.length === 0, JSON.stringify(errors));
    await context.close();
  }
  await browser.close();
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass}／${pass + fail}`);
process.exit(fail ? 1 : 0);
