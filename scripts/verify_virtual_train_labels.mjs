// 山海號／平原號「虛構專列」標示驗收：兩個真實瀏覽器、四種手機寬度、真觸控。
// 用法：node scripts/verify_virtual_train_labels.mjs [URL]
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
      Array.isArray(state.trains) && state.trains.some(train => train.loop), null, { timeout: 90000 });

    const helpers = await page.evaluate(() => {
      selectGroup(GROUPS.find(group => group.id === 'tra'));
      state.playing = false;
      setSimSec(8 * 3600);
      document.documentElement.setAttribute('data-fs', 'xlarge');
      document.body.classList.add('fs');
      const loops = state.trains.filter(train => train.loop);
      const real = state.trains.find(train => !train.loop && /^\d+$/.test(String(train.train)));
      return {
        loops: loops.map(train => ({ no: trainDisplayNo(train), kind: trainDisplayKind(train), width: tagW(train) })),
        real: real && { raw: String(real.train), no: trainDisplayNo(real), kind: trainDisplayKind(real), width: tagW(real) },
      };
    });
    ok(`${engineName} ${width}px：兩列虛構列車都有明確車次與名稱標示`,
      helpers.loops.length === 2 && helpers.loops.every(item => item.no.startsWith('虛構 ') && item.kind.endsWith('・軌島虛構專列')),
      JSON.stringify(helpers.loops));
    ok(`${engineName} ${width}px：真實列車車次顯示不變`,
      helpers.real && helpers.real.no === helpers.real.raw && !helpers.real.kind.includes('虛構'), JSON.stringify(helpers.real));
    ok(`${engineName} ${width}px：地圖車牌寬度依完整虛構標示重算`,
      helpers.loops.every(item => item.width > helpers.real.width), JSON.stringify(helpers));

    await page.evaluate(() => {
      const station = state.schedStations.find(item => item.name === '臺北' && item.sys === 'tra_sched');
      openBoard(station);
    });
    await page.waitForSelector('#board .row[data-no="8888"]');
    const board = await page.evaluate(() => {
      const panel = document.getElementById('board');
      const rows = ['8888', '8889'].map(no => {
        const row = panel.querySelector(`.row[data-no="${no}"]`);
        return { no, text: row?.innerText || '' };
      });
      const row = panel.querySelector('.row[data-no="8888"]');
      row.scrollIntoView({ block: 'center' });
      const rect = row.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        rows,
        hit: hit === row || row.contains(hit),
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 &&
          panel.scrollWidth <= panel.clientWidth + 1,
      };
    });
    // 特大字模式刻意把次要的車種／方向收在「›」後；第一眼仍必須直接看見「虛構」，
    // 點進跟車卡後則由下一個斷言確認完整的「山海號・軌島虛構專列」名稱。
    ok(`${engineName} ${width}px：臺北車站看板第一眼直接寫虛構`,
      board.rows.every(row => row.text.includes(`虛構 ${row.no}`)), JSON.stringify(board.rows));
    ok(`${engineName} ${width}px：虛構班次列可由座標命中且無水平溢出`,
      board.hit && board.noHorizontalOverflow, JSON.stringify(board));

    await page.tap('#board .row[data-no="8888"]');
    await page.waitForFunction(() => document.getElementById('fpTrain')?.textContent.includes('虛構 8888'));
    const cards = await page.evaluate(() => ({
      followNo: document.getElementById('fpTrain')?.textContent || '',
      followKind: document.getElementById('fpKind')?.textContent || '',
      cardNo: document.getElementById('tcNo')?.textContent || '',
      cardKind: document.getElementById('tcKind')?.textContent || '',
      followBar: document.getElementById('followBar')?.innerText || '',
    }));
    ok(`${engineName} ${width}px：觸控跟車後大小資訊卡都標示虛構`,
      cards.followNo === '虛構 8888' && cards.cardNo === '虛構 8888' &&
      cards.followKind === '山海號・軌島虛構專列' && cards.cardKind === '山海號・軌島虛構專列' &&
      cards.followBar.includes('軌島虛構專列'), JSON.stringify(cards));

    const search = await page.evaluate(() => {
      const input = document.getElementById('trainSearch');
      input.value = '8888';
      renderSearchDrop();
      return document.querySelector('#searchDrop .tr-row')?.innerText || '';
    });
    ok(`${engineName} ${width}px：搜尋結果直接標示虛構專列`,
      search.includes('虛構 8888') && search.includes('軌島虛構專列'), search);
    ok(`${engineName} ${width}px：全程零 pageerror`, errors.length === 0, JSON.stringify(errors));
    await context.close();
  }
  await browser.close();
}

for (const [lang, expectedNo, expectedKind] of [
  ['en', 'Fictional 8888', 'Mountain & Sea・Rail Island fictional special'],
  ['ja', '架空 8888', '山海号・軌島の架空特別列車'],
]) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
  await page.addInitScript(language => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-language', language); } catch (error) {}
  }, lang);
  await page.goto(target + (target.includes('?') ? '&' : '?') + `lang=${lang}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true && state.trains?.some(train => train.loop), null, { timeout: 90000 });
  const labels = await page.evaluate(() => {
    const train = state.trains.find(item => String(item.train) === '8888' && item.loop);
    return [trainDisplayNo(train), trainDisplayKind(train)];
  });
  ok(`${lang}：虛構車次與專列名稱已翻譯`, labels[0] === expectedNo && labels[1] === expectedKind, JSON.stringify(labels));
  await browser.close();
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass}／${pass + fail}`);
process.exit(fail ? 1 : 0);
