// 為什麼整條線同一個方向的車會集體換號？盯 BL dir 1 的 groupKey（line|dir|dest）組成。
const URL_ = 'https://railisland.tw/api/trtc-live';
const R = Number(process.argv[2] || 14), E = Number(process.argv[3] || 8000);
const LINE = process.argv[4] || 'BL', DIR = Number(process.argv[5] || 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let prevRev = null, prevIds = null;
for (let i = 0; i < R; i++) {
  const t0 = Date.now();
  let j = null; try { j = await (await fetch(URL_, { headers: { 'Cache-Control': 'no-cache' } })).json(); } catch {}
  const bp = j && j.boardPos, vs = ((bp && bp.vehicles) || []).filter(v => v.line === LINE && Number(v.dir) === DIR);
  const rev = bp ? Number(bp.sourceRevision) : NaN;
  const dests = {}; for (const v of vs) dests[v.dest] = (dests[v.dest] || 0) + 1;
  const ids = new Set(vs.map(v => String(v.vehicleId)));
  const gone = prevIds ? [...prevIds].filter(x => !ids.has(x)).length : 0;
  const born = prevIds ? [...ids].filter(x => !prevIds.has(x)).length : 0;
  const noCount = vs.filter(v => v.officialNo).length;
  console.log(JSON.stringify({ i, rev, changed: rev !== prevRev, n: vs.length,
    destBuckets: dests, gone, born, withOfficialNo: noCount }));
  prevRev = rev; if (rev !== prevRev || true) prevIds = ids;
  const w = E - (Date.now() - t0); if (i < R - 1 && w > 0) await sleep(w);
}
