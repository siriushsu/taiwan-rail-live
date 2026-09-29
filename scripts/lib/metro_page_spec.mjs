// 捷運路線圖頁（SEO 階段 A）的驗收規格：5 個系統、14 條營運路線（支線併進主線頁）各對到哪些資料線。
// 給 scripts/verify_metro_pages.mjs（靜態）與 scripts/verify_aeo_browser.mjs（瀏覽器）共用。
// 這份是「規格」不是產生器的一部分——刻意不 import scripts/build_metro_pages.mjs：產生器把路線對錯資料線時，
// 驗收端才看得出來。要改頁面結構（加路線、拆頁）先改這裡，再讓產生器跟上，兩邊對不上驗收就紅。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SYS_IDS = ['taipei', 'taoyuan-airport', 'new-taipei', 'taichung', 'kaohsiung'];
// file＝data/<file>.json（幾何＋站序）與 data/<file>_times.json；main＝頁面主體的資料線（各自有端點與首末班）；
// attached＝併進頁面的短支線；prefix＝幾條資料線共用前段站序、頁面拆成「共用路段＋各分支」。
export const SPEC = [
  { sys: 'taipei', slug: 'wenhu', file: 'trtc', main: ['BR'], attached: [] },
  { sys: 'taipei', slug: 'tamsui-xinyi', file: 'trtc', main: ['R'], attached: ['R_XBT'] },
  { sys: 'taipei', slug: 'songshan-xindian', file: 'trtc', main: ['G'], attached: ['G_XBT'] },
  { sys: 'taipei', slug: 'zhonghe-xinlu', file: 'trtc', main: ['O_XINZHUANG', 'O_LUZHOU'], attached: [], prefix: true },
  { sys: 'taipei', slug: 'bannan', file: 'trtc', main: ['BL'], attached: [] },
  { sys: 'taipei', slug: 'circular', file: 'trtc', main: ['Y'], attached: [] },
  { sys: 'taoyuan-airport', slug: 'airport-mrt', file: 'tymc', main: ['A'], attached: [] },
  { sys: 'new-taipei', slug: 'danhai', file: 'ntdlrt', main: ['V', 'VB'], attached: [], prefix: true },
  { sys: 'new-taipei', slug: 'ankeng', file: 'ntalrt', main: ['K'], attached: [] },
  { sys: 'new-taipei', slug: 'sanying', file: 'sanying', main: ['LB'], attached: [] },
  { sys: 'taichung', slug: 'green', file: 'tmrt', main: ['TG'], attached: [] },
  { sys: 'kaohsiung', slug: 'red', file: 'krtc', main: ['KR'], attached: [] },
  { sys: 'kaohsiung', slug: 'orange', file: 'krtc', main: ['KO'], attached: [] },
  { sys: 'kaohsiung', slug: 'circular-lrt', file: 'krtc', main: ['C'], attached: [] },
];
export const DICT_OF = { trtc: 'mrt', tymc: 'tymc', ntdlrt: 'ntdlrt', ntalrt: 'ntalrt', sanying: 'sanying', krtc: 'krtc', tmrt: 'tmrt' };

const geoCache = new Map();
export function geoOf(file) {
  if (!geoCache.has(file)) geoCache.set(file, JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${file}.json`), 'utf8')));
  return geoCache.get(file);
}
export const geoLine = (file, id) => geoOf(file).lines.find(l => l.id === id);

// 頁面涵蓋的站點座標範圍 [南, 西, 北, 東]（直接取 data/<file>.json 的站點，不看幾何線）：
//   路線頁＝該頁主線＋支線的全部站；系統頁＝旗下全部路線頁；總覽頁＝null
export function bboxOfEntries(entries) {
  let b = null;
  for (const e of entries) {
    for (const id of [...e.main, ...e.attached]) {
      for (const s of geoLine(e.file, id).stations) {
        b = b ? [Math.min(b[0], s.lat), Math.min(b[1], s.lon), Math.max(b[2], s.lat), Math.max(b[3], s.lon)] : [s.lat, s.lon, s.lat, s.lon];
      }
    }
  }
  return b;
}
export function pageBBox(sys, slug) {
  if (!sys) return null;
  return bboxOfEntries(SPEC.filter(e => e.sys === sys && (!slug || e.slug === slug)));
}
