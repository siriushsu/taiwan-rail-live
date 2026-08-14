// 量「跳動」的實際幅度：同一台車、同一個區間，官方 arrEpoch 被改之後，
// 畫面上的位置（區間內比例 fraction）在同一個當下瞬間位移了多少。
const URL_ = 'https://railisland.tw/api/trtc-live';
const ROUNDS = Number(process.argv[2] || 24), EVERY_MS = Number(process.argv[3] || 5000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const frac = (v, now) => {
  const arr = Number(v.arrEpoch), run = Number(v.run);
  const dep = v.depEpoch == null ? arr - run : Number(v.depEpoch);
  if (!(dep < arr)) return null;
  return Math.max(0, Math.min(1, (now - dep) / (arr - dep)));
};

let prev = null;
const jumps = [], backwards = [], teleports = [];
for (let i = 0; i < ROUNDS; i++) {
  const t0 = Date.now();
  const j = await (await fetch(URL_, { headers: { 'Cache-Control': 'no-cache' } })).json();
  const vs = (j.boardPos && j.boardPos.vehicles) || [];
  const now = Date.now() / 1000;
  const by = new Map(vs.map(v => [String(v.vehicleId), v]));
  if (prev) {
    for (const [id, b] of by) {
      const a = prev.get(id);
      if (!a) continue;
      if (Number(a.from) !== Number(b.from) || Number(a.to) !== Number(b.to)) {
        // 換區間：若不是前進一站，就是瞬移
        const step = Number(b.dir) === 2 ? 1 : -1;
        if (Number(b.to) !== Number(a.to) + step && Number(b.to) !== Number(a.to)) {
          teleports.push({ id, from: `${a.from}→${a.to}`, to: `${b.from}→${b.to}`, dir: b.dir });
        }
        continue;
      }
      const fa = frac(a, now), fb = frac(b, now);
      if (fa == null || fb == null) continue;
      const d = fb - fa;
      if (Math.abs(d) > 1e-9) jumps.push(Math.abs(d));
      if (d < -0.01) backwards.push({ id, d: +d.toFixed(3) });
    }
  }
  prev = by;
  const wait = EVERY_MS - (Date.now() - t0);
  if (i < ROUNDS - 1 && wait > 0) await sleep(wait);
}

jumps.sort((a, b) => a - b);
const q = p => jumps.length ? jumps[Math.min(jumps.length - 1, Math.floor(jumps.length * p))] : 0;
const pct = x => (x * 100).toFixed(1) + '%';
console.log('同區間位置瞬移樣本數', jumps.length);
console.log('幅度(佔一個站間距的比例)  中位', pct(q(.5)), ' p90', pct(q(.9)), ' p99', pct(q(.99)), ' max', pct(q(1)));
console.log('超過站間距 10% 的次數', jumps.filter(x => x > .1).length, '｜超過 25%', jumps.filter(x => x > .25).length);
console.log('往後退(倒車)的次數', backwards.length, backwards.slice(0, 6).map(b => b.d).join(' '));
console.log('非相鄰跳站(瞬移)的次數', teleports.length, JSON.stringify(teleports.slice(0, 4)));
