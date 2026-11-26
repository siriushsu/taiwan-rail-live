// 沿線小故事（網站版）的規則對照：rail-stories.js 是 App railcore story/RailStoryRules.kt 的移植。
// 前半照 App 的 RailStoryRulesTest（native m9/release-210-1126）重點案例，後半用網站自己的資料跑真車次，
// 最後檢查網站有接上（script 標籤、資料清單、App 打包清單、CSP 放行配音網域）。
// 跑法：node scripts/verify_rail_stories.mjs（不需要 server、不開瀏覽器）。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const R = require(path.join(ROOT, 'rail-stories.js'));
const readJson = rel => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(name + '：' + (e && e.message || e)); }
}
function eq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error((msg ? msg + '：' : '') + '得到 ' + ja + '，應為 ' + jb);
}
function ok(v, msg) { if (!v) throw new Error(msg || '應為真'); }
const near = (a, b, msg) => ok(Math.abs(a - b) < 1e-6, (msg || '') + ' 得到 ' + a + '，應為 ' + b);

// ── 一、App 規則測試的移植（假資料：宜蘭線七站，車由北往南） ──
function item(id, stations, visible = '車上看得到', sys = 'tra_sched', line = '宜蘭線') {
  return { id, name: '故事' + id, category: '車站', storyType: '歷史', system: sys, lineId: line, nearStations: stations,
    lat: 24.9, lon: 121.9, visibleFromTrain: visible, intro: '介紹' + id, story: '內文' + id, confidence: '已查證',
    lineLabel: '台鐵｜宜蘭線（蘇澳–八堵）', sources: [{ title: '出處' + id, url: 'https://example.org/' + id }] };
}
const book = (...items) => R.parseBook(items);
const LINE = ['頭城', '外澳', '龜山', '大溪', '大里', '石城', '福隆'];
const NAMES = LINE.slice().reverse();
const DEP = NAMES.map((_, i) => 32400 + i * 360);
const ARR = NAMES.map((_, i) => (i === 0 ? 32400 : 32400 + i * 360 - 60));
const at = (i, plus = 0) => DEP[i] + plus;
const route = (b, n = NAMES) => R.schedRoute(b, 'tra_sched', n, ARR.slice(0, n.length), DEP.slice(0, n.length), id => (id === '宜蘭線' ? LINE : null));
const follow = (b, sec) => R.follow(route(b), sec, 1_800_000_000);
const cur = (f, read) => { const p = f && f.current(read || new Set()); return p ? p.story.id : null; };

check('解析：欄位不齊的條目不收、記下 id', () => {
  const b = R.parseBook([item('a', ['外澳']), { id: 'bad', name: '缺站' }, item('c', ['大溪', '大溪'])]);
  eq(b.stories.map(s => s.id), ['a']); eq(b.skipped, ['bad', 'c']);
  const s = b.story('a'); eq(s.lineName, '宜蘭線'); eq(s.rank, 0); eq(s.sources[0].title, '出處a');
  eq(R.parseBook({ not: 'array' }), null); eq(R.parseBook('not json'), null);
});
check('台鐵以外的線名帶營運者', () => {
  const m = { ...item('m', ['劍潭'], undefined, 'mrt', 'R'), lineLabel: '台北捷運｜淡水信義線' };
  eq(book(m).story('m').lineName, '台北捷運 淡水信義線');
  const k = { ...item('k', ['雙城'], undefined, 'ntalrt', 'K'), lineLabel: '安坑輕軌｜安坑輕軌' };
  eq(book(k).story('k').lineName, '安坑輕軌');
});
check('綁一站：離開前一站到離開這一站', () => {
  const b = book(item('s', ['大溪'])); const k = NAMES.indexOf('大溪');
  eq(cur(follow(b, at(k - 1, -1))), null, '還沒離開前一站');
  eq(cur(follow(b, at(k - 1))), 's'); eq(cur(follow(b, at(k, -1))), 's'); eq(cur(follow(b, at(k))), null);
  const p = follow(b, at(k)).passes[0]; eq(p.place, '大溪'); eq(p.placeLine, '宜蘭線・大溪'); eq(p.tag, '大溪・車上看得到');
});
check('起站的故事：還沒開車就算', () => {
  const b = book(item('o', ['福隆']));
  eq(cur(follow(b, DEP[0] - 600)), 'o'); eq(cur(follow(b, DEP[0])), null);
});
check('綁兩站、中間隔站：照行車方向顯示', () => {
  const b = book(item('g', ['外澳', '大溪'])); const lo = NAMES.indexOf('大溪'), hi = NAMES.indexOf('外澳');
  eq(cur(follow(b, at(lo, -1))), null); eq(cur(follow(b, at(lo))), 'g'); eq(cur(follow(b, at(lo + 1, -30))), 'g');
  eq(cur(follow(b, ARR[hi] - 1)), 'g'); eq(cur(follow(b, ARR[hi])), null);
  const p = follow(b, at(lo)).passes[0]; eq(p.place, '大溪–外澳'); eq(p.placeLine, '宜蘭線・大溪–外澳之間');
});
check('只坐到半路的車也出得來；只碰一端或中間走別線不算', () => {
  const b = book(item('w', ['頭城', '福隆']));
  const f = R.follow(route(b, NAMES.slice(0, 3)), at(1), 0);
  eq(cur(f), 'w'); eq(f.passes[0].place, '福隆–頭城');
  eq(route(b, ['福隆', '別線甲', '別線乙']).passes.length, 0); eq(route(b, ['福隆', '別線甲', '頭城']).passes.length, 0);
});
check('同一段好幾則：看得到的先、範圍小的先，讀過的換下一則', () => {
  const b = book(item('off', ['大溪'], '要下車'), item('see', ['大溪']), item('part', ['大溪'], '部分路段看得到'), item('wide', ['頭城', '福隆']));
  const f = follow(b, at(NAMES.indexOf('大溪') - 1, 10));
  eq(cur(f), 'see'); eq(cur(f, new Set(['see'])), 'wide'); eq(cur(f, new Set(['see', 'wide'])), 'part');
  eq(cur(f, ['see', 'wide', 'part']), 'off'); eq(cur(f, ['see', 'wide', 'part', 'off']), null);
  eq(f.count, 4); eq(f.seenCount, 3);
});
check('換段就換、沒有就收起', () => {
  const b = book(item('a', ['石城']), item('b', ['大溪'])); const k = NAMES.indexOf('石城');
  eq(cur(follow(b, at(k, -1))), 'a'); eq(cur(follow(b, at(k, 1))), null); eq(cur(follow(b, at(NAMES.indexOf('大里'), 1))), 'b');
});
check('清單的狀態與時刻', () => {
  const b = book(item('a', ['石城']), item('b', ['大溪']), item('c', ['頭城']));
  const f = follow(b, at(NAMES.indexOf('大里'), 1));
  eq(f.passes.map(f.state), ['past', 'now', 'ahead']); eq(f.next().story.id, 'c');
  near(f.epochSec(f.passes[1]), 1_800_000_000 - 1);
});
check('捷運：照站序、下一站與方向', () => {
  const st = ['甲', '乙', '丙', '丁'];
  const b = book(item('s', ['丙'], undefined, 'mrt', 'R'), item('p', ['乙', '丙'], '要下車', 'mrt', 'R'),
    item('x', ['丙'], undefined, 'mrt', 'BL'), item('y', ['丙'], undefined, 'krtc', 'R'));
  eq(R.metroStep(st, '乙', '丁', null, null), 1); eq(R.metroStep(st, '乙', '甲', null, null), -1);
  eq(R.metroStep(st, '丁', '丁', null, null), 1); eq(R.metroStep(st, '甲', '甲', null, null), -1);
  eq(R.metroStep(st, '丙', '丙', null, null), 0); eq(R.metroStep(st, '丙', '丙', null, false), -1);
  eq(R.metroStep(st, '乙', null, -1, null), -1);
  const fwd = R.metroRoute(b, 'mrt', 'R', st, 1); eq(fwd.passes.map(p => p.story.id), ['p', 's']);
  const f = next => R.follow(fwd, 0, 0, fwd.names.indexOf(next));
  eq(cur(f('乙')), null); eq(cur(f('丙')), 's'); eq(cur(f('丙'), ['s']), 'p'); eq(cur(f('丁')), null);
  eq(f('丙').epochSec(fwd.passes[0]), null);
  const back = R.metroRoute(b, 'mrt', 'R', st, -1); const g = R.follow(back, 0, 0, back.names.indexOf('乙'));
  eq(cur(g), 'p'); eq(g.current(new Set()).place, '丙–乙'); eq(g.state(back.passes.find(p => p.story.id === 's')), 'past');
});
check('車站卡只列綁單一車站的', () => {
  const b = book(item('off', ['大溪'], '要下車'), item('see', ['大溪']), item('pair', ['大溪', '外澳']), item('metro', ['大溪'], undefined, 'mrt', 'R'));
  eq(b.atStation('大溪').map(s => s.id), ['see', 'metro', 'off']); eq(b.atStation('大溪', ['tra_sched']).map(s => s.id), ['see', 'off']);
  eq(b.atStation('外澳').length, 0); eq(b.story('pair').place, '大溪–外澳之間');
});
check('字幕頁只切不改、長句在逗號分開、每頁時間照字數', () => {
  const long = '它用鉚釘一顆顆組起來，棚架上還雕著日式唐草花紋，被鐵道迷比成縮小版的門司港站，站前還有一座圓環。';
  const b = R.parseBook([{ id: 'p', name: '基隆車站', system: 'tra_sched', lineId: '宜蘭線', nearStations: ['大溪'],
    intro: '月台上有座百年雨棚。', story: '他說：「真的嗎？」沒有人回答。' + long + '尾巴沒有句號' }]);
  const pages = R.playPages(route(b).passes[0]);
  eq(pages[0], '基隆車站'); eq(pages[1], '月台上有座百年雨棚。'); eq(pages[2], '他說：「真的嗎？」'); eq(pages[3], '沒有人回答。');
  eq(pages[pages.length - 1], '尾巴沒有句號');
  eq(pages.join(''), '基隆車站月台上有座百年雨棚。他說：「真的嗎？」沒有人回答。' + long + '尾巴沒有句號');
  const split = pages.slice(4, -1); eq(split.length, 2);
  ok(split.every(s => s.length <= R.PLAY_PAGE_MAX && (s.endsWith('，') || s.endsWith('。'))), JSON.stringify(split));
  eq(R.playPageMs('短句。'), 3500); eq(R.playPageMs('一'.repeat(20)), 1500 + 180 * 20); eq(R.playPageMs('一'.repeat(80)), 9000);
});

const dir = (toward, side, from, to, text, audio) => ({ toward, side, say: '', from, to, story: text, key: 'k', audio });
const dirs = obj => ({ 說明: '…', stories: obj });
const dirStory = (line, north, south) => ({ line, name: 'x', byDirection: { 北上: north, 南下: south } });
const turtle = dirStory('tra_sched|宜蘭線', dir('福隆', '右側', '頭城', '外澳', '北上版', 't_up'), dir('頭城', '左側', '福隆', '石城', '南下版', 't_down'));

check('方向版跟著車走、移動開始的地方', () => {
  const b = R.parseBook([item('t', ['外澳', '大溪'])], dirs({ t: turtle }));
  eq(b.directionSkipped, []);
  const s = route(b).passes[0];
  eq(s.direction.label, '南下'); eq(s.text, '南下版'); eq(s.direction.audio, 't_down'); eq(s.tag, '大溪–外澳・左側看得到');
  eq(s.place, '大溪–外澳'); eq(s.enterSec, DEP[0]); eq(s.exitSec, ARR[NAMES.indexOf('外澳')]);
  eq(R.playPages(s), ['故事t', '介紹t', '南下版']);
  const n = R.schedRoute(b, 'tra_sched', LINE, ARR, DEP, id => (id === '宜蘭線' ? LINE : null)).passes[0];
  eq(n.direction.label, '北上'); eq(n.text, '北上版'); eq(n.tag, '外澳–大溪・右側看得到');
  eq(n.enterSec, DEP[0]); eq(n.exitSec, ARR[LINE.indexOf('大溪')]);
});
check('沒坐到兩端的區間車也判得出方向；開始站沒經過就照綁的站', () => {
  const b = R.parseBook([item('t', ['外澳', '大溪'])], dirs({ t: turtle }));
  const short = ['大里', '大溪', '龜山', '外澳']; const p = route(b, short).passes[0];
  eq(p.direction.label, '南下'); eq(p.enterSec, DEP[short.indexOf('大溪')]); eq(p.exitSec, ARR[short.indexOf('外澳')]);
});
check('線上相鄰兩站的故事平均分在行車時間裡', () => {
  const b = book(item('a', ['大溪', '龜山'], '要下車'), item('b', ['龜山', '大溪']), item('c', ['大溪', '龜山']),
    item('solo', ['石城', '大里']), item('one', ['大里']), item('wide', ['大溪', '外澳']));
  const r = route(b); const from = DEP[3], run = ARR[4] - DEP[3];
  eq(r.passes.filter(p => p.lo === 3 && p.hi === 4).map(p => [p.story.id, p.enterSec]),
    [['b', from + run * 1 / 4], ['c', from + run * 2 / 4], ['a', from + run * 3 / 4]]);
  ok(r.passes.filter(p => p.lo === 3 && p.hi === 4).every(p => p.exitSec === ARR[4]));
  eq(r.passes.find(p => p.story.id === 'solo').enterSec, DEP[1] + (ARR[2] - DEP[1]) / 2);
  eq(r.passes.find(p => p.story.id === 'one').enterSec, DEP[1]);
  eq(r.passes.find(p => p.story.id === 'wide').enterSec, DEP[3]);
  const f = R.follow(r, from + run / 4 + 1, 1_800_000_000);
  eq(['b', 'c', 'a'].map(id => f.state(r.passes.find(p => p.story.id === id))), ['now', 'ahead', 'ahead']);
});
check('綁一站的方向版', () => {
  const same = dirStory('tra_sched|宜蘭線', dir('福隆', '右側', '大溪', '大溪', '北', 'a_up'), dir('頭城', '左側', '大溪', '大溪', '南', 'a_down'));
  const after = dirStory('tra_sched|宜蘭線', dir('福隆', '右側', '大溪', '大里', '北', 'b_up'), dir('頭城', null, '大溪', '龜山', '南', 'b_down'));
  const b = R.parseBook([item('a', ['大溪']), item('b', ['大溪'])], dirs({ a: same, b: after }));
  const k = NAMES.indexOf('大溪'); const ps = Object.fromEntries(route(b).passes.map(p => [p.story.id, p]));
  eq(ps.a.text, '南'); eq(ps.a.enterSec, DEP[k - 1]); eq(ps.a.exitSec, DEP[k]);
  eq(ps.b.enterSec, DEP[k]); eq(ps.b.exitSec, ARR[k + 1]); eq(ps.b.tag, '大溪・車上看得到');
});
check('方向掛在別條線上：走山線照線判、走海線看端點站', () => {
  const mountain = ['竹南', '豐原', '成功', '彰化'];
  const house = { line: 'tra_sched|山線', name: 'h', byDirection: { 南下: dir('彰化', '右側', '彰化', '彰化', '南下版', 'h_down'), 北上: dir('竹南', '左側', '彰化', '彰化', '北上版', 'h_up') } };
  const b = R.parseBook([item('h', ['彰化'], undefined, 'tra_sched', '縱貫線南段')], dirs({ h: house }));
  const pick = n => { const p = R.schedRoute(b, 'tra_sched', n, ARR.slice(0, n.length), DEP.slice(0, n.length), id => (id === '山線' ? mountain : null)).passes[0]; return p.direction ? p.direction.label : null; };
  eq(pick(['竹南', '豐原', '成功', '彰化', '花壇']), '南下'); eq(pick(['花壇', '彰化', '成功', '豐原']), '北上');
  eq(pick(['竹南', '大甲', '追分', '彰化', '花壇']), '南下'); eq(pick(['花壇', '彰化', '追分', '大甲', '竹南']), '北上');
  eq(pick(['員林', '花壇', '彰化']), null);
});
check('對不上的方向資料記下來、整則用通用版', () => {
  const half = { line: 'tra_sched|宜蘭線', name: 'x', byDirection: { 北上: dir('福隆', null, null, null, '北', 'x_up'), 南下: { toward: '頭城' } } };
  const wrongSys = dirStory('mrt|R', dir('福隆', null, null, null, '北', 'y_up'), dir('頭城', null, null, null, '南', 'y_down'));
  const missing = dirStory('tra_sched|宜蘭線', dir('福隆', null, null, null, '北', 'z_up'), dir('頭城', null, null, null, '南', 'z_down'));
  const b = R.parseBook([item('x', ['大溪']), item('y', ['大溪'])], dirs({ x: half, y: wrongSys, z: missing }));
  eq(b.directionSkipped.slice().sort(), ['x', 'y', 'z']); ok(b.stories.every(s => !s.directions.length));
  ok(route(b).passes.every(p => !p.direction && p.text === p.story.story));
  eq(R.parseBook([item('x', ['大溪']), item('y', ['大溪'])], 'not json').stories.length, 2);
});
check('捷運方向版：往哪個端點站開就用哪一版', () => {
  const st = ['甲', '乙', '丙', '丁'];
  const d = { m: { line: 'mrt|R', name: 'm', byDirection: { 往丁: dir('丁', null, null, null, '往丁版', 'm_d'), 往甲: dir('甲', null, null, null, '往甲版', 'm_a') } } };
  const b = R.parseBook([item('m', ['乙'], undefined, 'mrt', 'R')], dirs(d));
  eq(R.metroRoute(b, 'mrt', 'R', st, 1).passes[0].text, '往丁版'); eq(R.metroRoute(b, 'mrt', 'R', st, -1).passes[0].text, '往甲版');
});
check('配音網址、頁、切點', () => {
  const b = R.parseBook([item('t', ['外澳', '大溪']), item('s', ['大溪'])], dirs({ t: turtle }));
  const ps = Object.fromEntries(route(b).passes.map(p => [p.story.id, p]));
  eq(R.voiceUrl(ps.t), 'https://tiles.railisland.tw/rail-stories/voice/zh_pulcherrima/t_down.m4a');
  eq(R.voiceUrl(ps.s, ''), 'https://tiles.railisland.tw/rail-stories/voice/zh_pulcherrima/s.m4a');
  eq(R.voicePages(ps.t), ['故事t', '南下版']);
  const cuts = R.voiceCuts(['甲乙丙', '一二三四五六七八。', '完成了。'], 20000); eq(cuts, [5000, 15000, 20000]);
  eq(R.voicePage(cuts, 0), 0); eq(R.voicePage(cuts, 5000), 1); eq(R.voicePage(cuts, 19999), 2); eq(R.voicePage(cuts, 25000), 2);
});
check('補通過站：兩個停靠站之間照里程內插', () => {
  const line = [{ name: 'A', d: 0 }, { name: 'B', d: 10 }, { name: 'C', d: 30 }, { name: 'D', d: 40 }];
  const r = R.withPassStations(['A', 'D'], [0, 400], [0, 400], line);
  eq(r.names, ['A', 'B', 'C', 'D']); eq(r.arrSec, [0, 100, 300, 400]); eq(r.depSec, [0, 100, 300, 400]);
  const back = R.withPassStations(['D', 'B'], [0, 300], [0, 300], line);
  eq(back.names, ['D', 'C', 'B']); eq(back.arrSec, [0, 100, 300]);
});

// ── 二、網站自己的資料 ──
const BOOK = R.parseBook(readJson('data/rail_stories.json'), readJson('data/rail_story_directions.json'));
const LINE_FILES = { tra_sched: 'tra', thsr_sched: 'thsr_track', afr_sched: 'afr', mrt: 'trtc', krtc: 'krtc', ntalrt: 'ntalrt',
  ntdlrt: 'ntdlrt', sanying: 'sanying', tmrt: 'tmrt', tymc: 'tymc' };
const LINES = Object.fromEntries(Object.entries(LINE_FILES).map(([sys, f]) => [sys, readJson('data/' + f + '.json').lines]));
const lineNames = (sys, id) => { const l = (LINES[sys] || []).find(x => x.id === id); return l ? l.stations.map(s => s.name) : null; };
const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.round(s % 60)].map(v => String(v).padStart(2, '0')).join(':');

check('資料：344 則都收得進來、21 則有方向版', () => {
  eq(BOOK.stories.length, 344); eq(BOOK.skipped, []); eq(BOOK.directionSkipped, []);
  eq(new Set(BOOK.stories.map(s => s.id)).size, 344); eq(BOOK.stories.filter(s => s.directions.length).length, 21);
});
check('資料：每一則的線與站在網站的線檔找得到', () => {
  const bad = [];
  for (const s of BOOK.stories) {
    const names = lineNames(s.system, s.lineId);
    if (!names) { bad.push(s.id + ' 找不到線 ' + s.system + '|' + s.lineId); continue; }
    for (const n of s.stations) if (!names.includes(n)) bad.push(s.id + ' ' + s.lineId + ' 沒有站 ' + n);
  }
  eq(bad, []);
});
check('資料：方向版的 toward 是那條線的兩端、開始站找得到', () => {
  const bad = [];
  for (const s of BOOK.stories.filter(x => x.directions.length)) {
    const names = lineNames(s.system, s.directions[0].lineId);
    if (!names) { bad.push(s.id + ' 找不到線 ' + s.directions[0].lineId); continue; }
    const ends = new Set([names[0], names[names.length - 1]]);
    if (s.directions.length !== 2 || !s.directions.every(d => ends.has(d.toward))) bad.push(s.id + ' toward 不是兩端');
    const all = new Set(LINES[s.system].flatMap(l => l.stations.map(x => x.name)));
    for (const d of s.directions) for (const n of [d.from, d.to]) if (n && !all.has(n)) bad.push(s.id + ' ' + d.label + ' 找不到站 ' + n);
  }
  eq(bad, []);
});
check('資料：344 則字幕頁接起來等於原文、最長一頁不超過 44 字', () => {
  let longest = '';
  for (const s of BOOK.stories) {
    const p = { story: s, text: s.story, direction: null };
    const pages = R.playPages(p);
    eq(pages.join(''), s.name + s.intro + s.story, s.id);
    ok(pages.length >= 3, s.id + ' 只有 ' + pages.length + ' 頁');
    for (const x of pages) if (x.length > longest.length) longest = x;
  }
  ok(longest.length <= 44, '最長一頁 ' + longest.length + ' 字：' + longest);
});

const TRA = readJson('data/tra_schedule_dense.json').trains;
function traRoute(train) {
  const tr = TRA.find(t => t.train === train);
  ok(tr, '班表裡沒有 ' + train);
  const r = R.schedRoute(BOOK, 'tra_sched', tr.stops.map(s => s.name), tr.stops.map(s => s.arrSec), tr.stops.map(s => s.depSec), id => lineNames('tra_sched', id));
  return { tr, r, dep: n => tr.stops.find(s => s.name === n).depSec };
}
check('2173 次（基隆→嘉義）：沿途 71 則、三義–泰安三則平均分', () => {
  const { r, dep } = traRoute('2173');
  eq(r.passes.length, 71);
  const seg = r.passes.filter(p => p.place === '三義–泰安' || p.place === '泰安–三義');
  eq(seg.map(p => hms(p.enterSec)), ['12:31:45', '12:33:30', '12:35:15']);
  const fire = r.passes.find(p => p.story.id === 'w-015');
  eq(fire.direction && fire.direction.label, '南下'); ok(fire.text !== fire.story.story);
  ok(r.passes.every((p, i, a) => i === 0 || a[i - 1].enterSec <= p.enterSec), '照時間排');
  eq(dep('三義'), 45000);
});
check('4172 次（往蘇澳）：龜山島南下版、離開福隆就開始', () => {
  const { r, dep } = traRoute('4172');
  const t = r.passes.find(p => p.story.id === 'n-024');
  eq(t.direction.label, '南下'); eq(t.place, '大溪–外澳'); eq(t.placeLine, '宜蘭線・大溪–外澳之間');
  eq(t.tag, '大溪–外澳・左側看得到'); ok(t.text.includes('左手邊')); eq(t.enterSec, dep('福隆'));
  eq(R.playPages(t).join(''), t.story.name + t.story.intro + t.text);
});
check('4171 次（往樹林）：龜山島北上版、離開頭城才開始', () => {
  const { r, dep } = traRoute('4171');
  const t = r.passes.find(p => p.story.id === 'n-024');
  eq(t.direction.label, '北上'); eq(t.place, '外澳–大溪'); eq(t.enterSec, dep('頭城'));
});
check('高鐵：只停靠站的班表補上通過站，直達車也碰得到綁在跳過站的故事', () => {
  const trains = readJson('data/thsr_schedule_dense.json').trains;
  const line = LINES.thsr_sched.find(l => l.id === 'THSR').stations;
  const fast = trains.slice().sort((a, b) => a.stops.length - b.stops.length)[0];
  const stops = fast.stops.map(s => s.name);
  const full = R.withPassStations(stops, fast.stops.map(s => s.arrSec), fast.stops.map(s => s.depSec), line);
  const skipped = full.names.filter(n => !stops.includes(n));
  ok(skipped.length > 0, fast.train + ' 沒有跳站');
  ok(full.arrSec.every((t, i, a) => i === 0 || a[i - 1] <= t), '時刻要遞增');
  const r = R.schedRoute(BOOK, 'thsr_sched', full.names, full.arrSec, full.depSec, id => lineNames('thsr_sched', id));
  const raw = R.schedRoute(BOOK, 'thsr_sched', stops, fast.stops.map(s => s.arrSec), fast.stops.map(s => s.depSec), id => lineNames('thsr_sched', id));
  const hit = r.passes.filter(p => p.story.stations.length === 1 && skipped.includes(p.story.stations[0]));
  ok(hit.length > 0, fast.train + ' 跳過 ' + skipped.join('、') + '，但沒有綁在那幾站的故事');
  ok(r.passes.length > raw.passes.length, '補站後沒有多出故事');
});
check('高捷紅線：世運站分往岡山、往小港兩版', () => {
  const st = lineNames('krtc', 'KR');
  const up = R.metroRoute(BOOK, 'krtc', 'KR', st, 1).passes.find(p => p.story.id === 'm-053');
  const down = R.metroRoute(BOOK, 'krtc', 'KR', st, -1).passes.find(p => p.story.id === 'm-053');
  eq(new Set([up.direction.label, down.direction.label]).size, 2);
  eq([up.direction.label, down.direction.label].sort(), ['往小港', '往岡山'].sort());
});

// ── 三、網站有接上 ──
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('index.html 載入 rail-stories.js', () => ok(html.includes('<script src="./rail-stories.js"></script>')));
check('資料檔用 ./data/ 字面路徑（data_manifest 掃得到）', () => {
  ok(html.includes("'./data/rail_stories.json'")); ok(html.includes("'./data/rail_story_directions.json'"));
  const m = readJson('data/data_manifest.json'); ok(m['data/rail_stories.json'] && m['data/rail_story_directions.json'], 'data_manifest 沒有故事資料');
});
check('App 打包清單有 rail-stories.js', () => ok(readFileSync(path.join(ROOT, 'app/scripts/prepare-web.mjs'), 'utf8').includes("'rail-stories.js'")));
check('CSP 的 media-src 放行配音網域', () => {
  const line = readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n').find(l => l.includes('Content-Security-Policy')) || '';
  const media = (line.match(/media-src[^;]*/) || [''])[0];
  ok(media.includes('https://tiles.railisland.tw'), media || '找不到 media-src');
});

console.log(`verify_rail_stories：${pass} 項通過，${fails.length} 項失敗`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
