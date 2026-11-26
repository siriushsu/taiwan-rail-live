/* 沿線小故事的規則（純函式，網站版）。
 * 照 App 的 railcore story/RailStory.kt 與 RailStoryRules.kt（native m9/release-210-1126）逐條移植，
 * 對照測試在 scripts/verify_rail_stories.mjs（App 的 RailStoryRulesTest 重點案例＋真資料幾班車）。
 * 故事的字是故事線定的原檔（data/rail_stories.json、data/rail_story_directions.json），這裡只切不改。
 * 畫面（字幕、配音、清單）在 index.html 的「沿線小故事」段。 */
(function (root) {
  'use strict';

  /** 車上看不看得到（資料檔 visibleFromTrain 四種原字）。小的排前面。 */
  const VIS_RANK = { '車上看得到': 0, '部分路段看得到': 1, '要下車': 3 };
  const visRank = raw => (raw in VIS_RANK ? VIS_RANK[raw] : 2);

  const VOICE_BASE = 'https://tiles.railisland.tw/rail-stories/voice/';
  const VOICE_DEFAULT = 'zh_pulcherrima';
  /** 播放時一頁最多幾個字。 */
  const PLAY_PAGE_MAX = 34;

  const str = v => (typeof v === 'string' && v.trim() ? v : null);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const parseMaybe = v => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return undefined; }
  };

  function makeStory(o, directions) {
    const lineLabel = str(o.lineLabel) || '';
    const owner = lineLabel.split('｜')[0].trim();
    const afterBar = lineLabel.includes('｜') ? lineLabel.slice(lineLabel.indexOf('｜') + 1) : lineLabel;
    const line = afterBar.split('（')[0].trim();
    const stations = o.nearStations.filter(n => str(n));
    const visibleLabel = str(o.visibleFromTrain) || '不確定';
    const rank = visRank(visibleLabel);
    return {
      id: o.id, name: o.name, category: str(o.category) || '', storyType: str(o.storyType) || '',
      system: o.system, lineId: o.lineId, lineLabel, stations,
      lat: typeof o.lat === 'number' ? o.lat : NaN, lon: typeof o.lon === 'number' ? o.lon : NaN,
      visibleLabel, rank, notifiable: rank <= 1,
      intro: str(o.intro) || '', story: o.story,
      sources: (Array.isArray(o.sources) ? o.sources : []).filter(s => s && str(s.title))
        .map(s => ({ title: s.title, url: typeof s.url === 'string' ? s.url : '' })),
      directions: directions || [],
      // 「〈線〉・A–B 之間」的線名：台鐵只寫線名，其他系統帶營運者
      lineName: (o.system === 'tra_sched' || owner === line || !owner) ? line : owner + ' ' + line,
      // 沒有跟車時（車站卡）的地點字
      place: stations.length >= 2 ? stations[0] + '–' + stations[1] + '之間' : (stations[0] || ''),
    };
  }

  /** 故事 id → [系統, 各方向版]。一則裡有哪個方向欄位不齊，整則不收（不混用半套）。 */
  function parseDirections(raw, skipped) {
    const root = parseMaybe(raw);
    const stories = root && typeof root === 'object' && root.stories && typeof root.stories === 'object' ? root.stories : null;
    const out = new Map();
    if (!stories) return out;
    for (const id of Object.keys(stories)) {
      const o = stories[id] || {};
      const line = typeof o.line === 'string' ? o.line : '';
      const by = o.byDirection && typeof o.byDirection === 'object' ? o.byDirection : null;
      const keys = by ? Object.keys(by) : [];
      const list = [];
      for (const label of keys) {
        const d = by[label] || {};
        const toward = str(d.toward), story = str(d.story), audio = str(d.audio);
        if (!toward || !story || !audio) continue;
        list.push({ label, lineId: line.slice(line.indexOf('|') + 1), toward, side: str(d.side),
          from: str(d.from), to: str(d.to), story, audio });
      }
      if (!line.includes('|') || !by || list.length < 2 || list.length !== keys.length) { skipped.push(id); continue; }
      out.set(id, [line.slice(0, line.indexOf('|')), list]);
    }
    return out;
  }

  /**
   * 整份故事。[stories]＝rail_stories.json（陣列，或它的字串）；[directions]＝rail_story_directions.json（可缺）。
   * 最外層不是陣列＝null（整個功能不出現）。欄位不齊的條目不收，id 記在 skipped。
   */
  function parseBook(stories, directions) {
    const directionSkipped = [];
    const dirs = directions == null ? new Map() : parseDirections(directions, directionSkipped);
    const arr = parseMaybe(stories);
    if (!Array.isArray(arr)) return null;
    const out = [], skipped = [];
    arr.forEach((o, i) => {
      o = o && typeof o === 'object' ? o : {};
      const st = Array.isArray(o.nearStations) ? o.nearStations.filter(n => str(n)) : null;
      if (!str(o.id) || !str(o.name) || !str(o.system) || !str(o.lineId) || !str(o.story) ||
          !st || !st.length || st.length > 2 || (st.length === 2 && st[0] === st[1])) {
        skipped.push(str(o.id) || '#' + i);
        return;
      }
      const d = dirs.get(o.id);
      out.push(makeStory(o, d && d[0] === o.system ? d[1] : null));
    });
    const known = new Map(out.map(s => [s.id, s]));
    for (const [id, d] of dirs) if (!known.has(id) || known.get(id).system !== d[0]) directionSkipped.push(id);
    return {
      stories: out, skipped, directionSkipped,
      story: id => known.get(id) || null,
      /** 車站卡「這站的故事」：只收綁單一車站的；[systems] 給了就只留這幾個系統。車上看得到的排前面。 */
      atStation(name, systems) {
        return out.filter(s => s.stations.length === 1 && s.stations[0] === name && (!systems || systems.includes(s.system)))
          .map((s, i) => [s, i]).sort((a, b) => a[0].rank - b[0].rank || a[1] - b[1]).map(x => x[0]);
      },
    };
  }

  /** 這班車會經過的一則故事。站序照行車方向；時刻是這班車的班表秒，捷運沒有逐站時刻＝NaN。 */
  function makePass(story, from, to, lo, hi, enterSec, exitSec, fromOrigin, direction) {
    const place = to == null ? from : from + '–' + to;
    return {
      story, from, to, lo, hi, enterSec, exitSec, fromOrigin, direction: direction || null, place,
      /** 這班車看到的故事字：有方向版用方向版。 */
      text: direction ? direction.story : story.story,
      /** 字幕上那行小字：「大溪–外澳・車上看得到」；知道在哪一側、車上又看得到的寫「大溪–外澳・右側看得到」。 */
      tag: direction && direction.side && story.notifiable ? place + '・' + direction.side + '看得到' : place + '・' + story.visibleLabel,
      /** 全文卡的位置行：「宜蘭線・大溪–外澳之間」／「宜蘭線・外澳」。 */
      placeLine: to == null ? story.lineName + '・' + from : story.lineName + '・' + from + '–' + to + '之間',
    };
  }
  const withTimes = (p, enterSec) => makePass(p.story, p.from, p.to, p.lo, p.hi, enterSec, p.exitSec, false, p.direction);

  /**
   * 這班車對到哪個方向版。[names]＝這班車照行車方向的站序，[lo]、[hi]＝故事在裡面的位置。
   * 先看方向版那條線：這班車在故事附近連續兩站都在線上，就知道往線頭還是線尾開；
   * 再看這班車自己的站：toward 在故事前面＝這一版；兩版裡有一版的 toward 已經過了＝另一版。都判不出來＝null。
   */
  function pickDirection(s, names, index, lo, hi, lineStations) {
    const dirs = s.directions;
    if (!dirs.length) return null;
    const line = lineStations ? lineStations(dirs[0].lineId) : null;
    if (line) {
      const pos = new Map();
      line.forEach((n, i) => pos.set(n, i));
      for (const i of [lo, hi, lo - 1]) {
        const a = pos.get(names[i]); const b = pos.get(names[i + 1]);
        if (a == null || b == null) continue;
        if (a === b) continue;
        const end = b > a ? line[line.length - 1] : line[0];
        const hit = dirs.find(d => d.toward === end);
        if (hit) return hit;
        break;
      }
    }
    const ahead = dirs.find(d => (index.has(d.toward) ? index.get(d.toward) : -1) > hi);
    if (ahead) return ahead;
    if (dirs.length === 2) {
      const behind = dirs.filter(d => index.has(d.toward) && index.get(d.toward) < lo);
      if (behind.length === 1) return dirs.find(d => d !== behind[0]);
    }
    return null;
  }

  /** 班表車的方向版：對到方向就換字；給了開始播的站間，就從離開 from 開始，結束取兩者較晚的。顯示的站不變。 */
  function directed(p, names, index, arrSec, depSec, lineStations) {
    const d = pickDirection(p.story, names, index, p.lo, p.hi, lineStations);
    if (!d) return p;
    const f = d.from != null && index.has(d.from) ? index.get(d.from) : null;
    const t = d.to != null && index.has(d.to) ? index.get(d.to) : null;
    if (f == null || t == null || f > t) return makePass(p.story, p.from, p.to, p.lo, p.hi, p.enterSec, p.exitSec, p.fromOrigin, d);
    const hi = Math.max(t, p.hi);
    const enter = f < t ? depSec[f] : f === 0 ? depSec[0] : depSec[f - 1];
    const exit = Math.max(p.exitSec, f < t ? arrSec[t] : depSec[t]);
    return makePass(p.story, p.from, p.to, Math.min(f, hi), hi, enter, exit, f === 0 && f === t, d);
  }

  const firstIndex = names => {
    const index = new Map();
    names.forEach((n, i) => { if (!index.has(n)) index.set(n, i); });
    return index;
  };

  /**
   * 班表車（台鐵、高鐵、林鐵）沿途的故事：照這班車自己的站序（含通過站）與班表秒，只看同系統的。
   * 綁一站＝經過那站就算，開始是離開前一站（起站＝開車前就算）；綁兩站＝用線上站序取區間，這班車連續經過兩站以上就算。
   * 綁的兩站在線上相鄰：平均分在那段行車時間裡（第 k 則／共 n 則在 k/(n+1) 處），車上看得到的排前面。
   */
  function schedRoute(book, sys, names, arrSec, depSec, lineStations) {
    const index = firstIndex(names);
    const passes = [];
    const whole = new Map();   // 'lo,hi' → 綁線上相鄰兩站的
    for (const s of book.stories) {
      if (s.system !== sys) continue;
      if (s.stations.length === 1) {
        const a = index.get(s.stations[0]);
        if (a == null) continue;
        passes.push(directed(makePass(s, names[a], null, a, a, a === 0 ? depSec[0] : depSec[a - 1], depSec[a], a === 0),
          names, index, arrSec, depSec, lineStations));
        continue;
      }
      const line = lineStations(s.lineId);
      if (!line) continue;
      const a = line.indexOf(s.stations[0]); const b = line.indexOf(s.stations[1]);
      if (a < 0 || b < 0) continue;
      const span = new Set(line.slice(Math.min(a, b), Math.max(a, b) + 1));
      // 這班車在這段裡連續經過的最長一串站
      let lo = -1, hi = -1, start = -1;
      for (let i = 0; i <= names.length; i++) {
        const inside = i < names.length && span.has(names[i]);
        if (inside && start < 0) start = i;
        if (!inside && start >= 0) {
          if (i - 1 - start > hi - lo) { lo = start; hi = i - 1; }
          start = -1;
        }
      }
      if (lo < 0 || hi <= lo) continue;
      const forward = line.indexOf(names[lo]) <= line.indexOf(names[hi]);
      const first = forward === (a <= b) ? s.stations[0] : s.stations[1];
      const second = first === s.stations[0] ? s.stations[1] : s.stations[0];
      const p = makePass(s, first, second, lo, hi, depSec[lo], arrSec[hi], false, null);
      const d = directed(p, names, index, arrSec, depSec, lineStations);
      // 方向版把開始的地方移到別段的照方向版，不算進這一對站的則數
      if (Math.abs(a - b) === 1 && d.enterSec === p.enterSec) {
        const k = lo + ',' + hi;
        if (!whole.has(k)) whole.set(k, { lo, hi, list: [] });
        whole.get(k).list.push(d);
      } else passes.push(d);
    }
    for (const { lo, hi, list: group } of whole.values()) {
      const n = group.length;
      const from = depSec[lo]; const run = arrSec[hi] - from;
      group.map((p, i) => [p, i]).sort((x, y) => x[0].story.rank - y[0].story.rank || x[1] - y[1])
        .forEach(([p], k) => passes.push(withTimes(p, from + run * (k + 1) / (n + 1))));
    }
    passes.sort((x, y) => x.enterSec - y.enterSec || x.lo - y.lo || x.story.rank - y.story.rank ||
      (x.hi - x.lo) - (y.hi - y.lo) || cmp(x.story.id, y.story.id));
    return { passes, timed: true, names, arrSec };
  }

  /**
   * 捷運、輕軌：沒有逐站時刻，照線上的站序與下一站判斷。[stations]＝線檔站序；[step]＝1 照站序、-1 反向。
   * 只收同系統、同一條線、兩站都在這條線上的故事。方向版只換字。
   */
  function metroRoute(book, sys, lineId, stations, step) {
    const names = step < 0 ? stations.slice().reverse() : stations.slice();
    const index = firstIndex(names);
    const passes = [];
    for (const s of book.stories) {
      if (s.system !== sys || s.lineId !== lineId) continue;
      const a = index.get(s.stations[0]);
      if (a == null) continue;
      if (s.stations.length === 1) {
        passes.push(makePass(s, names[a], null, a, a, NaN, NaN, false, pickDirection(s, names, index, a, a, null)));
      } else {
        const b = index.get(s.stations[1]);
        if (b == null) continue;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        passes.push(makePass(s, names[lo], names[hi], lo, hi, NaN, NaN, false, pickDirection(s, names, index, lo, hi, null)));
      }
    }
    passes.sort((x, y) => x.lo - y.lo || x.story.rank - y.story.rank || (x.hi - x.lo) - (y.hi - y.lo) || cmp(x.story.id, y.story.id));
    return { passes, timed: false, names, arrSec: null };
  }

  /**
   * 捷運的行車方向：環線用攤平站序的方向；其他看終點在下一站的哪一邊；下一站就是終點時看終點在線頭或線尾；
   * 再不行用 [forward]（true＝照站序）。都沒有＝0（判不出方向，這班車不出故事）。
   */
  function metroStep(stations, next, dest, routeDirection, forward) {
    if (routeDirection != null && routeDirection !== 0) return routeDirection > 0 ? 1 : -1;
    const n = next != null ? stations.indexOf(next) : -1;
    const d = dest != null ? stations.indexOf(dest) : -1;
    if (n >= 0 && d >= 0 && n !== d) return d > n ? 1 : -1;
    if (d === stations.length - 1 && d > 0) return 1;
    if (d === 0 && stations.length > 1) return -1;
    return forward === true ? 1 : forward === false ? -1 : 0;
  }

  /**
   * 路線加上現在位置。[effectiveSec]＝這班車跑到班表哪一秒；[atEpochSec]＝同一刻的 epoch 秒；
   * [nextNode]＝捷運下一站在行車方向站序裡的位置（班表車不用）。沿途沒有故事＝null。
   */
  function follow(route, effectiveSec, atEpochSec, nextNode) {
    if (!route.passes.length) return null;
    const n = nextNode == null ? -1 : nextNode;
    const state = p => {
      if (!route.timed) {
        if (p.lo === p.hi) return p.lo < n ? 'past' : p.lo === n ? 'now' : 'ahead';
        return n <= p.lo ? 'ahead' : n <= p.hi ? 'now' : 'past';
      }
      if (effectiveSec >= p.exitSec) return 'past';
      if (p.fromOrigin || effectiveSec >= p.enterSec) return 'now';
      return 'ahead';
    };
    return {
      passes: route.passes,
      count: route.passes.length,
      stations: route.names,
      seenCount: route.passes.filter(p => p.story.notifiable).length,
      timed: route.timed,
      state,
      /** 開進這一段的時刻（epoch 秒）；捷運＝null。 */
      epochSec: p => (route.timed ? atEpochSec + (p.enterSec - effectiveSec) : null),
      /**
       * 現在所在路段、還沒讀過的那一則。同一段好幾則：車上看得到的優先，再來範圍小的，再來剛開進去的。
       * [read]＝Set 或陣列。
       */
      current(read) {
        const has = read ? (read.has ? id => read.has(id) : id => read.includes(id)) : () => false;
        let best = null;
        for (const p of route.passes) {
          if (has(p.story.id) || state(p) !== 'now') continue;
          if (!best) { best = p; continue; }
          const c = p.story.rank - best.story.rank || (p.hi - p.lo) - (best.hi - best.lo) ||
            (route.timed ? best.enterSec - p.enterSec : best.lo - p.lo) || cmp(p.story.id, best.story.id);
          if (c < 0) best = p;
        }
        return best;
      },
      /** 第一則還沒到的。 */
      next: () => route.passes.find(p => state(p) === 'ahead') || null,
    };
  }

  /**
   * 班表只有停靠站的車（網站的高鐵班表）補上通過站：線上兩個停靠站之間的站照里程 d 內插時刻（到＝開）。
   * [line]＝線檔站序 [{name, d}]。兩站不在同一條線上、或線上相鄰，就照原本。
   */
  function withPassStations(names, arrSec, depSec, line) {
    if (!line || !line.length) return { names, arrSec, depSec };
    const pos = new Map(line.map((s, i) => [s.name, i]));
    const N = [], A = [], D = [];
    for (let i = 0; i < names.length; i++) {
      if (i > 0) {
        const a = pos.get(names[i - 1]), b = pos.get(names[i]);
        if (a != null && b != null && Math.abs(b - a) > 1) {
          const da = line[a].d, db = line[b].d, t0 = depSec[i - 1], t1 = arrSec[i];
          const stepI = b > a ? 1 : -1;
          for (let k = a + stepI; k !== b; k += stepI) {
            const f = Number.isFinite(da) && Number.isFinite(db) && db !== da ? (line[k].d - da) / (db - da) : (k - a) / (b - a);
            const t = t0 + (t1 - t0) * f;
            N.push(line[k].name); A.push(t); D.push(t);
          }
        }
      }
      N.push(names[i]); A.push(arrSec[i]); D.push(depSec[i]);
    }
    return { names: N, arrSec: A, depSec: D };
  }

  // ── 字幕頁與配音 ──

  function playSentences(text) {
    const out = [];
    let sb = '';
    for (let i = 0; i < text.length; i++) {
      sb += text[i];
      if ('。！？'.includes(text[i])) {
        while (i + 1 < text.length && '」』）'.includes(text[i + 1])) sb += text[++i];
        out.push(sb); sb = '';
      }
    }
    if (sb.trim()) out.push(sb);
    return out;
  }

  function playSplit(sentence) {
    if (sentence.length <= PLAY_PAGE_MAX) return [sentence];
    const clauses = [];
    let start = 0;
    for (let i = 0; i < sentence.length; i++) if ('，；：'.includes(sentence[i])) { clauses.push(sentence.slice(start, i + 1)); start = i + 1; }
    if (start < sentence.length) clauses.push(sentence.slice(start));
    const target = sentence.length / Math.ceil(sentence.length / PLAY_PAGE_MAX);
    const out = [];
    let sb = '';
    for (const c of clauses) {
      if (sb && (sb.length + c.length > PLAY_PAGE_MAX || sb.length >= target)) { out.push(sb); sb = ''; }
      sb += c;
    }
    if (sb) out.push(sb);
    return out;
  }

  /** 只有字時的字幕頁：名稱、介紹，接著故事一句一頁；太長的句子在「，；：」分開。只切不改。 */
  function playPages(pass) {
    return [pass.story.name].concat([pass.story.intro].concat(playSentences(pass.text)).filter(s => s.trim()).flatMap(playSplit));
  }
  /** 有聲音時的字幕頁：音檔念「名稱。故事」、不念介紹。 */
  function voicePages(pass) {
    return [pass.story.name].concat(playSentences(pass.text).flatMap(playSplit));
  }
  /** 這一則的音檔：檔名是方向版的 audio，沒有方向版＝故事 id。 */
  function voiceUrl(pass, base) {
    return (base && String(base).trim() ? base : VOICE_BASE + VOICE_DEFAULT + '/') + (pass.direction ? pass.direction.audio : pass.story.id) + '.m4a';
  }
  /** 各頁在音檔裡結束的毫秒：總長照各頁念得出來的字數（每頁加兩個字的停頓）分，最後一頁到結尾。 */
  function voiceCuts(pages, totalMs) {
    const weight = pages.map(p => (p.match(/[\p{L}\p{Nd}]/gu) || []).length + 2);
    const sum = Math.max(1, weight.reduce((a, b) => a + b, 0));
    let acc = 0;
    return weight.map((w, i) => { acc += w; return i === pages.length - 1 ? totalMs : Math.floor(totalMs * acc / sum); });
  }
  /** 音檔播到 [ms] 時顯示哪一頁。 */
  function voicePage(cuts, ms) {
    const i = cuts.findIndex(c => ms < c);
    return i < 0 ? cuts.length - 1 : i;
  }
  /** 一頁停多久（毫秒）：照字數，最短 3.5 秒、最長 9 秒。 */
  function playPageMs(page) { return Math.min(9000, Math.max(3500, 1500 + 180 * page.length)); }

  const api = { PLAY_PAGE_MAX, VOICE_BASE, VOICE_DEFAULT, parseBook, schedRoute, metroRoute, metroStep, follow,
    withPassStations, playPages, voicePages, voiceUrl, voiceCuts, voicePage, playPageMs };
  root.RailStories = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this);
