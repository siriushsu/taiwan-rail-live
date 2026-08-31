// 台鐵官方別名站併回同一個名字。
//
// 2026-08-31 使用者裁示:「台北車站的火車就都併在一起,不要多環島那一個,太多了」。
// 實例:臺北(官方站碼 1000)與臺北-環島(1001)——後者是環島之星繞完一圈回到台北的終點,
// 兩點實測相距 74 公尺,所以既有的「座標完全相同才併」那套(index.html 的 checkinAliasMap)
// 從來沒併到它,站清單就多出一顆。
//
// 判準寫「是什麼關係」不寫站名清單,免得台鐵日後再開一個別名就漏掉:
//   名字是 `X-…`、X 在同一份班表裡也是站名、且兩者 200 公尺內 → 併成 X。
// 全台鐵 240 個站名今天只有「臺北-環島」符合(已實測全掃),不會誤傷
// (「新城 (太魯閣)」「左營(舊城)」用括號不用連字號,而且 2026-08-16 起已在
//  densify_schedule.py 正名;「高雄-潮州」這種區間名不是站名不在此列)。
//
// index.html 另有一份同判準的內嵌副本(單檔頁面沒法 import),改判準時兩邊要一起改。

const EARTH_RADIUS_M = 6371000;

const metresBetween = (a, b) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** 就地改寫 trains[].stops[].name,回傳 Map<別名, 正名>(沒併到就是空的)。 */
export function canonicalizeAliasStops(trains) {
  const anyStopNamed = new Map();
  for (const train of trains) {
    for (const stop of train.stops) if (!anyStopNamed.has(stop.name)) anyStopNamed.set(stop.name, stop);
  }
  const canonical = new Map();
  for (const [name, stop] of anyStopNamed) {
    const dash = name.indexOf('-');
    if (dash <= 0) continue;
    const base = anyStopNamed.get(name.slice(0, dash));
    if (!base || metresBetween(stop, base) > 200) continue;
    canonical.set(name, base.name);
  }
  if (canonical.size) {
    for (const train of trains) {
      for (const stop of train.stops) {
        const to = canonical.get(stop.name);
        if (to) stop.name = to;
      }
    }
  }
  return canonical;
}

/** 併完後印一行,讓「今天到底併了什麼」在每次產生時都留下紀錄。 */
export function reportAliasMerge(tag, merged) {
  if (merged.size) console.log(`[${tag}] 別名站已併:${[...merged].map(([a, b]) => `${a}→${b}`).join('、')}`);
}
