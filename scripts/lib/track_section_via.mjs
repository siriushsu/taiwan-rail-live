// 派車表沒有、班表卻排在兩個派車站中間的台鐵站（2026-10 起的平鎮臨時站 1105）在站對實體路徑上的位置。
// 立體地圖讓官方停靠這種站的班次停在「那一站座標投影到原本那一段路徑上」的點（rail-3d/physical/motion.js），
// 前後兩截各自照跑段剖面走；index.html 拿這裡算的距離當那兩截剖面長的下限（點速 ≤ 剖面速度，理由見 schedSegKmOf）。
// 投影用 route-runtime 的 unfold().path.locate()，與畫車端是同一段程式、同一份站座標（班表 tr.stops 的 lat/lon）。
// 產生器 scripts/build_tra_track_sections.mjs 用它寫股道表的 via；verify_tra_plan_binding.mjs 用它做合成站的單元檢查。
import { normSta, sectionKey } from './parallel_tracks.mjs';

// 班表裡夾在兩個已知站（known＝股道表的站名，已正規化）之間的站 → 站對鍵 → 站名 → 座標（[lon,lat] 字串去重）。
// 起訖站不在表裡的不算：立體地圖本來就綁不到那種班次（plan-binding.js）。
export function unknownStationsBetween(trains, known) {
  const out = new Map();
  for (const tr of trains) {
    const s = tr.stops || [];
    for (let i = 0; i < s.length - 1; i++) {
      if (!known.has(normSta(s[i].name))) continue;
      let j = i + 1; while (j < s.length && !known.has(normSta(s[j].name))) j++;
      if (j === s.length) break;
      if (j > i + 1) {
        const pk = sectionKey(s[i].name, s[j].name), byName = out.get(pk) || out.set(pk, new Map()).get(pk);
        for (let k = i + 1; k < j; k++) if (Number.isFinite(s[k].lat) && Number.isFinite(s[k].lon))
          (byName.get(normSta(s[k].name)) || byName.set(normSta(s[k].name), new Set()).get(normSta(s[k].name))).add(s[k].lon + ',' + s[k].lat);
      }
      i = j - 1;
    }
  }
  return out;
}

// 座標投影到這個站對每一條派過的路徑上，離鍵的第一站、第二站各最遠多少公尺（未進位）與最大投影誤差。
// paths：路徑 id → 這條路徑是不是從鍵的第一站出發。
export function farthestAlong(runtime, paths, coords) {
  let first = 0, second = 0, errorM = 0;
  for (const c of coords) for (const [pid, startsAtFirst] of paths) {
    const p = runtime.unfold(String(pid)).path, loc = p.locate(c), fromStart = loc.s, fromEnd = p.length - loc.s;
    first = Math.max(first, startsAtFirst ? fromStart : fromEnd);
    second = Math.max(second, startsAtFirst ? fromEnd : fromStart);
    errorM = Math.max(errorM, loc.error);
  }
  return { first, second, errorM };
}
