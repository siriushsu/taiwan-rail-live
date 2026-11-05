// 成就的頭牌圖、章、車牌框。機務段與跟車卡畫 2D，rail-3d/roundhouse-stage.js 拿同一張圖貼在車頭。
// 頭牌的 id 跟成就同一個（my-train-plan.js 的 HONOR_GROUPS），圖都畫在 100×100 的格子裡，字由呼叫端給，翻譯才換得掉。
(() => {
  'use strict';
  const { PI, sin, cos } = Math;
  const FONT = '-apple-system,"PingFang TC","Noto Sans TC",sans-serif';
  const I = '#FFF7E6', A = '#E9B949', HAND = '#2F5D50', LINE = '#2A4A73', TIME = '#B5622A', FEST = '#A8321F', WX = '#4A6E80';
  const ISLAND = [58.8, 26.5, 57.6, 27.8, 58.1, 30.1, 57.9, 31.2, 55.8, 34.9, 56, 35.6, 53.9, 43.2, 54.1, 43.9, 52.1, 46.5, 52, 47.4, 50.7, 48.3, 49.5, 51.4, 49.3, 55.5, 48.4, 54.9, 47.9, 55.1, 48, 53.5,
    46.9, 51.1, 44.3, 49.4, 43.3, 45.5, 42.6, 44.8, 42, 44.5, 43.2, 41.4, 42.8, 39.1, 43.1, 37.7, 48, 30.1, 49.2, 29.1, 50.9, 25.9, 53.8, 24.9, 54.3, 23.9, 55.4, 23.5, 56.6, 24.8, 58.4, 25.1, 58.5, 26, 59.1, 26.2];
  const ln = (g, p, w = 3.4, c = I) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = g.lineJoin = 'round'; g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke(); };
  const dot = (g, x, y, r, c = I) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  const poly = (g, p, c = I) => { g.fillStyle = c; g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.fill(); };
  const wave = (g, y, c = I, w = 3) => { const p = []; for (let x = 26; x <= 74; x += 2) p.push([x, y + sin(x * .42) * 2.4]); ln(g, p, w, c); };
  const half = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, PI, 0); g.closePath(); g.fill(); };
  const clock = (g, a, b) => {
    g.strokeStyle = I; g.lineWidth = 3.2; g.beginPath(); g.arc(50, 39, 18, 0, 7); g.stroke();
    for (let i = 0; i < 4; i++) { const t = i * PI / 2; ln(g, [[50 + sin(t) * 14, 39 - cos(t) * 14], [50 + sin(t) * 16, 39 - cos(t) * 16]], 2.2); }
    ln(g, [[50, 39], [50 + sin(a) * 9, 39 - cos(a) * 9]], 3.4, A); ln(g, [[50, 39], [50 + sin(b) * 13.5, 39 - cos(b) * 13.5]], 2.6); dot(g, 50, 39, 2.2, A);
  };
  const cloud = (g, x, y) => { dot(g, x - 9, y, 6.5); dot(g, x, y - 4, 8.5); dot(g, x + 9, y, 6); g.fillStyle = I; g.fillRect(x - 9, y, 18, 6.5); };
  const MARKS = {
    maiden: [HAND, g => { ln(g, [[32, 58], [68, 58]], 4); ln(g, [[42, 57], [58, 27]], 4.4); dot(g, 59.5, 24, 6, A); }],
    dawn: [HAND, g => clock(g, 5.75 * PI / 6, -.17 * PI * 2 + 2 * PI)],
    late: [HAND, g => clock(g, 11.2 * PI / 6, .33 * PI)],
    east: [LINE, g => { poly(g, [[24, 52], [41, 24], [52, 40], [60, 30], [76, 52]]); wave(g, 58, A); }],
    south: [LINE, g => { g.fillStyle = I; g.beginPath(); g.arc(50, 50, 22, PI, 0); g.lineTo(62, 50); g.arc(50, 50, 12, 0, PI, true); g.lineTo(28, 50); g.fill(); ln(g, [[42, 62], [47, 50]], 2.6, A); ln(g, [[58, 62], [53, 50]], 2.6, A); }],
    loop: [LINE, g => {
      g.fillStyle = I; g.beginPath();
      for (let i = 0; i < ISLAND.length; i += 2) (i ? g.lineTo(ISLAND[i], ISLAND[i + 1]) : g.moveTo(ISLAND[i], ISLAND[i + 1]));
      g.closePath(); g.fill(); g.strokeStyle = A; g.lineWidth = 2.8; g.beginPath(); g.arc(50, 39, 22, .3, 2 * PI - .3); g.stroke();
    }],
    coast: [LINE, g => { wave(g, 30); wave(g, 41, A); wave(g, 52); }],
    alishan: [LINE, g => { poly(g, [[24, 58], [50, 20], [76, 58]]); ln(g, [[35, 54], [59, 47], [42, 39], [54, 33], [50, 27]], 2.6, A); }],
    sunrise: [TIME, g => { half(g, 50, 50, 15, A); for (let i = 0; i < 7; i++) { const t = -PI + (i + .5) * PI / 7; ln(g, [[50 + cos(t) * 19, 50 + sin(t) * 19], [50 + cos(t) * 25, 50 + sin(t) * 25]], 2.6); } ln(g, [[24, 50], [76, 50]], 3); wave(g, 58); }],
    sunset: [TIME, g => { dot(g, 50, 38, 15, A); g.fillStyle = TIME; g.fillRect(30, 41, 40, 2.4); g.fillRect(30, 46.5, 40, 3); ln(g, [[24, 53], [76, 53]], 3); ln(g, [[36, 59], [64, 59]], 2.6); }],
    tropic: [TIME, g => { dot(g, 50, 39, 10, A); g.setLineDash([5, 5]); ln(g, [[22, 56], [78, 24]], 3); g.setLineDash([]); }],
    midnight: [TIME, g => { dot(g, 47, 39, 17); dot(g, 54, 34, 14.5, TIME); dot(g, 62, 48, 2.4, A); dot(g, 68, 34, 2, A); dot(g, 57, 24, 1.8); }],
    newyear: [FEST, g => { for (let i = 0; i < 12; i++) { const t = i * PI / 6; ln(g, [[50 + cos(t) * 8, 39 + sin(t) * 8], [50 + cos(t) * 22, 39 + sin(t) * 22]], 2.6, i % 2 ? A : I); } dot(g, 50, 39, 3.4, A); }],
    lunar: [FEST, g => { g.fillStyle = A; g.beginPath(); g.ellipse(50, 39, 17, 14, 0, 0, 7); g.fill(); ln(g, [[50, 26], [50, 52]], 1.8, FEST); ln(g, [[40, 28], [40, 50]], 1.6, FEST); ln(g, [[60, 28], [60, 50]], 1.6, FEST); ln(g, [[42, 24], [58, 24]], 3.4); ln(g, [[42, 54], [58, 54]], 3.4); ln(g, [[50, 55], [50, 62]], 2.4); }],
    birthday: [FEST, g => { g.fillStyle = I; g.fillRect(31, 42, 38, 16); g.fillStyle = A; g.fillRect(31, 47, 38, 3); ln(g, [[50, 41], [50, 30]], 3); dot(g, 50, 25, 3.4, A); }],
    rain: [WX, g => { cloud(g, 50, 32); for (const x of [37, 49, 61]) ln(g, [[x, 46], [x - 4, 58]], 3, A); }],
    fog: [WX, g => { ln(g, [[28, 28], [64, 28]], 3.4); ln(g, [[38, 38], [74, 38]], 3.4, A); ln(g, [[26, 48], [60, 48]], 3.4); ln(g, [[42, 58], [72, 58]], 3.4, A); }],
    clear: [WX, g => { dot(g, 58, 33, 11, A); for (let i = 0; i < 8; i++) { const t = i * PI / 4; ln(g, [[58 + cos(t) * 14.5, 33 + sin(t) * 14.5], [58 + cos(t) * 19, 33 + sin(t) * 19]], 2.4, A); } cloud(g, 42, 50); }],
  };
  // 圓牌：外圈金邊、底色分組，下方一行字。字太長就縮到放得下。
  function canvas(id, size, label) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), [color, art] = MARKS[id];
    c.width = c.height = size;
    g.scale(size / 100, size / 100);
    for (const [r, fill] of [[50, '#C9A24A'], [47, '#8C6E2C'], [45.5, color]]) dot(g, 50, 50, r, fill);
    g.strokeStyle = 'rgba(255,247,230,.65)'; g.lineWidth = 1.2; g.beginPath(); g.arc(50, 50, 41.5, 0, 7); g.stroke();
    art(g);
    g.fillStyle = I; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 15px ${FONT}`;
    const fit = Math.max(8, Math.min(15, 15 * 62 / g.measureText(label).width));
    g.font = `900 ${fit}px ${FONT}`;
    g.fillText(label, 50, 75);
    return c;
  }
  const urls = new Map();
  function url(id, label) {
    const key = id + '|' + label;
    if (!urls.has(key)) urls.set(key, canvas(id, 128, label).toDataURL());
    return urls.get(key);
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 成就章。拿到的紅色雙圈，還沒拿到的虛線。顏色走 CSS 變數，亮暗色由頁面給。
  function stamp(label, got, cls = '') {
    const c = got ? 'var(--mt-stamp)' : 'var(--line)', ink = got ? 'var(--mt-stamp)' : 'var(--mt-faint)';
    const width = [...label].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 1 : .58), 0), size = Math.max(7.5, Math.min(19, 40 / width));
    return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-8 32 32)"><circle cx="32" cy="32" r="28" fill="none" stroke="${c}" stroke-width="${got ? 3 : 2}" ${got ? '' : 'stroke-dasharray="4 4"'}/>`
      + `${got ? `<circle cx="32" cy="32" r="23.5" fill="none" stroke="${c}" stroke-width="1.2"/>` : ''}<text x="32" y="${32 + size * .36}" text-anchor="middle" font-size="${size}" font-weight="900" fill="${ink}" font-family='${FONT}'>${esc(label)}</text></g></svg>`;
  }
  globalThis.MyTrainMarks = { canvas, url, stamp };
})();
