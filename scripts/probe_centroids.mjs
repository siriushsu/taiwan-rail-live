// 對齊探針質心(純函式,無 I/O):輸入 RGBA buffer,輸出洋紅(#ff00ff,底圖引擎畫)與青色(#00ffff,overlay 畫)兩顆探針的質心。
// 顏色門檻放寬到影片壓縮(yuv420p 色度次取樣)後仍抓得到;先算整張的粗質心,再只用粗質心 REFINE_R 半徑內的像素
// 重算一次(把畫面上其他洋紅/青色 UI 排除掉)。像素數 < MIN_PIX 視為「這一幀沒有探針」回 null。
export const MIN_PIX = 12, REFINE_R = 40;
export function probeCentroids(rgba, w, h) {
  const isMag = (r, g, b) => r >= 150 && b >= 150 && g <= 110;
  const isCyn = (r, g, b) => g >= 150 && b >= 150 && r <= 110;
  const pass = (test, within) => {
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!test(rgba[i], rgba[i + 1], rgba[i + 2])) continue;
      if (within && Math.hypot(x - within.x, y - within.y) > REFINE_R) continue;
      sx += x; sy += y; n++;
    }
    return n >= MIN_PIX ? { x: sx / n, y: sy / n, n } : null;
  };
  const m0 = pass(isMag, null), c0 = pass(isCyn, null);
  return { mag: m0 && pass(isMag, m0), cyn: c0 && pass(isCyn, c0) };
}
