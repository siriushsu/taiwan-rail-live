#!/usr/bin/env node
/**
 * Android 小工具版面的結構閘門。
 *
 * 🔴 為什麼要有這一支：RemoteViews 的限制**只有在裝置上 inflate 的那一刻**才會爆，
 *    而 gradle 編得過、XML 也合法。這一輪就實際踩到兩個，兩個都讓小工具整張畫不出來：
 *      1. `<View>` 不在 RemoteViews 的白名單裡 ⇒ inflate 當場丟
 *         「Class not allowed to be inflated android.view.View」，整個 activity／小工具死。
 *      2. shape drawable 沒有 `<size>` ⇒ 沒有 intrinsic 尺寸；當它是 ImageView 的 src
 *         而某一軸是 match_parent、容器又是 wrap_content 時，那一軸量出 0 ⇒
 *         **什麼都不畫**（站號徽章整顆消失，而且不是畫成白色，取樣到的就是卡片紙色）。
 *    兩者都是「靜態就看得出來」的，所以寫成 gate；狀態判定另有 verify_metro_plate_states.mjs。
 *
 * 🔴 2026-09-19 修正三條過期判準：main 從 09-03（f763d244）起一直紅，但這支不在出貨鏈上，
 *    紅了兩週多沒人看見——判準過期跟產品真的壞掉，從外面看一模一樣。三條都是這支寫好之後才加的東西：
 *      · `<include>`（09-06 的挑選器示範列）：它是 LayoutInflater 的指令，不是類別，不經過類別過濾。
 *      · 4×4 大張 widget_board_4x4 與它的 wl_* 列（09-02）：舊判準只認得 wg_／wb_／wm_ 三種前綴。
 *      · 同一張 4×4 讓 provider 用到 7 張版面，舊判準寫死「剛好 6 張」。
 *    現在掛在 verify-release.mjs（npm run build／npm run verify），緊接 verify_android_widget_parity。
 *
 * 跑法：node app/scripts/verify_widget_layouts.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RES = join(ROOT, 'app/android/app/src/main/res');
const LAYOUT_DIR = join(RES, 'layout');
const DRAWABLE_DIR = join(RES, 'drawable');
const JAVA = join(ROOT, 'app/android/app/src/main/java/tw/railisland/app');

const fails = [];
const ok = (cond, message) => { if (!cond) fails.push(message); };

/** RemoteViews 允許 inflate 的類別（@RemoteView 標註的那些）。不在表上的一律當紅。 */
const ALLOWED = new Set([
  'FrameLayout', 'LinearLayout', 'RelativeLayout', 'GridLayout',
  'TextView', 'ImageView', 'Button', 'ImageButton',
  'ProgressBar', 'Chronometer', 'AnalogClock', 'TextClock',
  'ViewFlipper', 'ViewStub', 'ListView', 'GridView', 'StackView', 'AdapterViewFlipper',
]);

const layouts = readdirSync(LAYOUT_DIR).filter(f => f.startsWith('widget_') && f.endsWith('.xml'));
ok(layouts.length >= 7, `小工具版面應有 7 張（三尺寸 × 兩版型 ＋ 訊息），實得 ${layouts.length}`);

// <include> 跟 <merge> 一樣是 LayoutInflater 自己展開的指令，不經過 RemoteViews 的類別過濾；
// 但【引入的內容照樣過濾】。2026-09-19 在 API 35 與 API 28 上實測 RemoteViews.apply：
// 「<include> 引入 TextView」可以、「<include> 引入 <View>」一樣丟 Class not allowed，
// 當時 23 張 widget_* 版面全部 inflate 成功。⇒ 放行 <include> 本身，並把它引入的版面
// （遞迴、不論檔名前綴）一起納入下面每一項檢查——只放行不追進去，等於替共用版面開一個洞。
const includedBy = new Map(layouts.map(f => [f, null]));   // 要掃的版面 → 誰 include 它（null＝本身就是 widget_*）
const queue = [...layouts];
while (queue.length) {
  const file = queue.shift();
  for (const [, attrs] of readFileSync(join(LAYOUT_DIR, file), 'utf8').matchAll(/<include\b([^>]*)>/g)) {
    const target = /\blayout="@layout\/([a-z_0-9]+)"/.exec(attrs)?.[1];
    ok(target, `${file}：<include${attrs}> 沒有 layout="@layout/…"`);
    if (!target || includedBy.has(`${target}.xml`)) continue;
    const exists = existsSync(join(LAYOUT_DIR, `${target}.xml`));
    ok(exists, `${file}：<include> 引入的 @layout/${target} 不存在`);
    if (exists) { includedBy.set(`${target}.xml`, file); queue.push(`${target}.xml`); }
  }
}

const idsOf = new Map();      // 檔名 → Set(id)
const tagsOf = new Map();     // 檔名 → [tag]

for (const file of includedBy.keys()) {
  const where = includedBy.get(file) ? `${file}（由 ${includedBy.get(file)} 以 <include> 引入）` : file;
  const xml = readFileSync(join(LAYOUT_DIR, file), 'utf8');
  const tags = [...xml.matchAll(/<([A-Za-z][\w.]*)/g)].map(m => m[1]).filter(t => t !== 'merge' && t !== 'include');
  tagsOf.set(file, tags);
  idsOf.set(file, new Set([...xml.matchAll(/android:id="@\+?id\/([a-z_0-9]+)"/g)].map(m => m[1])));

  for (const tag of new Set(tags)) {
    ok(ALLOWED.has(tag),
      `${where}：<${tag}> 不在 RemoteViews 白名單裡——上裝置會丟 "Class not allowed to be inflated"`);
  }

  // ImageView × shape drawable × 非固定尺寸 ⇒ 量出 0，整塊消失
  for (const block of xml.split(/<(?=[A-Za-z])/).filter(b => b.startsWith('ImageView'))) {
    const src = /android:src="@drawable\/([a-z_0-9]+)"/.exec(block);
    if (!src) continue;
    const drawable = join(DRAWABLE_DIR, `${src[1]}.xml`);
    if (!existsSync(drawable)) continue;
    const shape = readFileSync(drawable, 'utf8');
    if (!/<shape/.test(shape) || /<size/.test(shape)) continue;
    const w = /android:layout_width="([^"]+)"/.exec(block)?.[1] ?? '';
    const h = /android:layout_height="([^"]+)"/.exec(block)?.[1] ?? '';
    const id = /android:id="@\+?id\/([a-z_0-9]+)"/.exec(block)?.[1] ?? '(無 id)';
    for (const [axis, value] of [['寬', w], ['高', h]]) {
      ok(value.endsWith('dp'),
        `${file}:${id}：src=@drawable/${src[1]} 是沒有 <size> 的 shape，` +
        `${axis}又是 ${value} ⇒ 那一軸量出 0，整塊不會畫出來（給 shape 加 <size> 或改成固定 dp）`);
    }
  }
}

// 同版型三尺寸的 id 必須完全相同——binder 只有一份，靠這個契約成立
const groups = {
  琺瑯站牌: ['widget_plate_4x2.xml', 'widget_plate_4x3.xml', 'widget_plate_2x2.xml'],
  夜行看板: ['widget_board_4x2.xml', 'widget_board_4x3.xml', 'widget_board_2x2.xml'],
};
for (const [name, files] of Object.entries(groups)) {
  const base = idsOf.get(files[0]);
  ok(base && base.size > 0, `${name}：找不到 ${files[0]} 的 id`);
  for (const file of files.slice(1)) {
    const other = idsOf.get(file) ?? new Set();
    const missing = [...base].filter(id => !other.has(id));
    const extra = [...other].filter(id => !base.has(id));
    ok(missing.length === 0, `${name}：${file} 少了 ${missing.join(', ')}（binder 會對空氣設值）`);
    ok(extra.length === 0, `${name}：${file} 多了 ${extra.join(', ')}（binder 永遠不會碰它）`);
  }
}

// binder 綁的每一個 id，都要真的存在於「會拿它來綁」的每一張版面裡。
// 🔴 綁到版面裡沒有的 id 不會丟例外，只會靜默不顯示（2026-09-19 裝置實測：把 wl_* 綁到沒有它們的
//    版面，七列全部無聲落空）——這一層只有靜態閘門擋得住。前綴 → 會拿它來綁的版面：
const render = readFileSync(join(JAVA, 'MetroWidgetPlateRender.java'), 'utf8');
const bound = new Set([...render.matchAll(/R\.id\.([a-z_0-9]+)/g)].map(m => m[1]));
ok(bound.size >= 30, `binder 綁的 id 只有 ${bound.size} 個，少於預期（是不是抓錯檔案）`);
const LARGE = 'widget_board_4x4.xml';
const homes = {
  wg_: { name: '琺瑯站牌', files: groups.琺瑯站牌 },
  wb_: { name: '夜行看板', files: [...groups.夜行看板, LARGE] },   // 4×4 大張的 large() 先走一次 board()
  wl_: { name: '4×4 大張', files: [LARGE] },                      // large() 的「接下來」七列
  wm_: { name: '訊息版面', files: ['widget_plate_message.xml'] },
};
// large() 呼叫 board(…, maxRows, …)：超過 maxRows 的看板列，board() 只會把它設 GONE，而 4×4 本來就沒有
// 那幾列——對版面裡沒有的 view 設 GONE 是 no-op（同一次裝置實測），所以只有那幾列可以不在 4×4 裡。
// maxRows 從原始碼讀、不手打：哪天 large() 改成兩列，第 2 列就會變成必須在 4×4 裡。
const largeRows = Number(/static RemoteViews large\([\s\S]*?\bboard\(\s*c\s*,\s*layoutRes\s*,\s*rows\s*,\s*(\d+)\s*,/.exec(render)?.[1]);
ok(largeRows >= 1, 'binder 的 large() 裡找不到 board(c, layoutRes, rows, N, …)——讀不到 4×4 大張有幾列看板列，請更新本閘門');
for (const id of bound) {
  const prefix = Object.keys(homes).find(p => id.startsWith(p));
  ok(prefix, `binder 綁了 ${id}，但前綴不在本閘門的前綴表裡（${Object.keys(homes).join('／')}）——先登記它住在哪幾張版面`);
  if (!prefix) continue;
  for (const file of homes[prefix].files) {
    if (file === LARGE && Number(/^wb_r(\d+)(?:_|$)/.exec(id)?.[1]) > largeRows) continue;
    ok(idsOf.get(file)?.has(id), `binder 綁了 ${id}，但${homes[prefix].name}的 ${file} 裡沒有這個 id`);
  }
}

// provider 用到的版面＝前綴表登記、由 provider 交給 binder 的那幾張，一張不多一張不少。
// 🔴 以前寫死「剛好 6 張」：09-02 加了 4×4 之後它只會說「實得 7」，那張 4×4 的 id 從此沒被核對過。
//    多一張沒登記的＝它的 id 沒人驗；少一張＝provider 掉了一個尺寸。
const provider = readFileSync(join(JAVA, 'MetroWidgetProvider.java'), 'utf8');
const used = new Set([...provider.matchAll(/R\.layout\.(widget_[a-z_0-9]+)/g)].map(m => m[1]));
const binderOwn = new Set([...render.matchAll(/R\.layout\.(widget_[a-z_0-9]+)/g)].map(m => m[1]));   // 訊息版面由 binder 自己開
const registered = new Set(Object.values(homes).flatMap(h => h.files).map(f => f.replace(/\.xml$/, ''))
  .filter(name => !binderOwn.has(name)));
for (const name of used) {
  ok(layouts.includes(`${name}.xml`), `provider 用了 R.layout.${name}，但檔案不存在`);
  ok(registered.has(name), `provider 用了 R.layout.${name}，但本閘門沒登記它由哪個 binder 入口綁、該有哪些 id（加進上面的前綴表）`);
}
for (const name of registered) {
  ok(used.has(name), `前綴表登記了 ${name}，但 provider 沒用到它（provider 掉了一個尺寸，還是登記表過期？）`);
}

// 夜行看板的三列都要在版面裡（provider 明確傳 maxRows 決定顯示幾列）
for (const file of groups.夜行看板) {
  const ids = idsOf.get(file) ?? new Set();
  for (const n of [1, 2, 3]) {
    ok(ids.has(`wb_r${n}`), `${file}：少了第 ${n} 列（三列必須都在版面裡，由 maxRows 決定顯示幾列）`);
  }
}

// ── 車站收集（widget_collect_*）：binder 是 CollectionWidgetRender.java ───────────────────────────
// 綁到版面裡沒有的 id 一樣是靜默不顯示；所以逐一登記「哪個 id 住在哪幾張版面」，binder 綁的每個 id 都要在表上、
// 表上的每個 id 都要真的在那幾張版面裡、版面裡的 wc_* id 也都要有人綁（多的是死 id，通常代表改版改一半）。
const collectRender = readFileSync(join(JAVA, 'CollectionWidgetRender.java'), 'utf8');
const collectBound = new Set([...collectRender.matchAll(/R\.id\.(wc_[a-z_0-9]+)/g)].map(m => m[1]));
ok(collectBound.size >= 20, `車站收集 binder 綁的 id 只有 ${collectBound.size} 個，少於預期（是不是抓錯檔案）`);
const CS = 'widget_collect_small.xml', CM = 'widget_collect_medium.xml', CMSG = 'widget_collect_message.xml';
const collectHomes = {
  wc_root: [CS, CM, CMSG],
  wc_title: [CS, CM, CMSG], wc_subtitle: [CS], wc_pct: [CS, CM], wc_count: [CS, CM], wc_remain: [CS],
  wc_empty_title: [CS, 'widget_collect_empty.xml'], wc_empty_hint: [CS, 'widget_collect_empty.xml'],
  wc_stamp: [CS, CM],   // 「蓋章」膠囊（小卡在數字下方、中卡在百分比下方），只管長相
  wc_stamp_hit: [CS, CM],   // 膠囊外面的透明可點容器（約 48dp 寬），綁 railisland://checkin
  wc_map_slot: [CS], wc_map_light: [CS, CM], wc_map_dark: [CS, CM], wc_rows: [CM], wc_message: [CMSG],
  wc_row_label: ['widget_collect_sysrow.xml', 'widget_collect_sysrow_wide.xml'],
  wc_row_bar: ['widget_collect_sysrow.xml', 'widget_collect_sysrow_wide.xml'],
  wc_row_count: ['widget_collect_sysrow.xml', 'widget_collect_sysrow_wide.xml'],
  wc_scope_bar: ['widget_collect_bar_row.xml'], wc_remain_line: ['widget_collect_remain.xml'],
  wc_note_line: ['widget_collect_note.xml'],
  wc_recent_date: ['widget_collect_recent.xml'], wc_recent_name: ['widget_collect_recent.xml'], wc_recent_line: ['widget_collect_recent.xml'],
  wc_legend_solid: ['widget_collect_legend.xml'], wc_legend_follow: ['widget_collect_legend.xml'],
};
for (const id of collectBound) ok(collectHomes[id], `車站收集 binder 綁了 ${id}，但本閘門的 collectHomes 沒登記它住在哪幾張版面`);
for (const [id, files] of Object.entries(collectHomes)) {
  ok(collectBound.has(id), `collectHomes 登記了 ${id}，但 CollectionWidgetRender 沒綁它（死 id，或登記表過期）`);
  for (const file of files) ok(idsOf.get(file)?.has(id), `車站收集：${file} 裡沒有 ${id}（binder 會對空氣設值）`);
}
// 版面裡出現的 wc_* id 也都要登記（版面新增了 id 卻沒人綁）
for (const file of layouts.filter(f => f.startsWith('widget_collect_') && !f.endsWith('_preview.xml'))) {
  for (const id of idsOf.get(file) ?? []) {
    ok(collectHomes[id]?.includes(file), `車站收集：${file} 有 ${id}，但登記表沒把它列在這張版面（binder 不會碰它）`);
  }
}
// 同一組列版面（中文 34dp／英文 62dp）id 要一樣，binder 只有一份
{
  const a = idsOf.get('widget_collect_sysrow.xml') ?? new Set(), b = idsOf.get('widget_collect_sysrow_wide.xml') ?? new Set();
  ok(a.size > 0 && [...a].every(id => b.has(id)) && [...b].every(id => a.has(id)), 'widget_collect_sysrow 與 _wide 的 id 必須一致');
}
// binder 用到的每一張 widget_collect_* 都要存在；非預覽的每一張也都要被 binder 用到
const collectUsed = new Set([...collectRender.matchAll(/R\.layout\.(widget_collect_[a-z_0-9]+)/g)].map(m => m[1]));
for (const name of collectUsed) ok(layouts.includes(`${name}.xml`), `車站收集 binder 用了 R.layout.${name}，但檔案不存在`);
for (const file of layouts.filter(f => f.startsWith('widget_collect_') && !f.endsWith('_preview.xml'))) {
  ok(collectUsed.has(file.replace(/\.xml$/, '')), `${file} 沒有被 CollectionWidgetRender 用到（孤兒版面）`);
}
// 🔴 同 id 的 ProgressBar（全台列有好幾條）＋launcher 切深淺色／轉向時「以 id 還原 View 狀態」＝五條進度條變一樣長；
//    saveEnabled=false 是唯一解，2026-09-30 真桌面踩到。所有 widget_collect_* 的 ProgressBar（含預覽）都要有。
for (const file of layouts.filter(f => f.startsWith('widget_collect_'))) {
  const xml = readFileSync(join(LAYOUT_DIR, file), 'utf8');
  for (const [tag] of xml.matchAll(/<ProgressBar\b[^>]*>/g)) {
    ok(/android:saveEnabled="false"/.test(tag), `${file}：ProgressBar 沒有 android:saveEnabled="false"（切深淺色後同 id 的進度條會被還原成一樣長）`);
  }
}
// 🔴 launcher 對同一個 layout 的新 RemoteViews 是 reapply 到舊 View 樹：addView 會累加，所以往 wc_rows 加列之前
//    一定要先 removeAllViews（2026-09-30 真桌面看到全台列重複兩列）。行為面的把關在 instrumentation reapplyTransitions。
if (/addView\(\s*R\.id\.wc_rows/.test(collectRender)) {
  ok(/removeAllViews\(\s*R\.id\.wc_rows\s*\)/.test(collectRender), 'CollectionWidgetRender 往 wc_rows addView，卻沒有先 removeAllViews(R.id.wc_rows)（reapply 後列會累加）');
}
// 地圖淺／深兩張 Bitmap 疊同一格：兩個 ImageView 的 alpha 必須分別綁到 wc_alpha_light／wc_alpha_dark，
// 且 values 與 values-night 的兩個值相反（淺色 1／0，深色 0／1），少一個資料夾就會兩張同時露出或同時消失。
for (const file of [CS, CM]) {
  const xml = readFileSync(join(LAYOUT_DIR, file), 'utf8');
  for (const [which, dimen] of [['wc_map_light', 'wc_alpha_light'], ['wc_map_dark', 'wc_alpha_dark']]) {
    const tag = new RegExp(`<ImageView\\b[^>]*android:id="@\\+id/${which}"[^>]*>`).exec(xml)?.[0] ?? '';
    ok(tag.includes(`android:alpha="@dimen/${dimen}"`), `${file}：${which} 的 alpha 沒有綁 @dimen/${dimen}`);
  }
}
{
  const dimenVal = (dir, name) => new RegExp(`<item name="${name}"[^>]*>([\\d.]+)</item>`).exec(
    readFileSync(join(RES, dir, 'dimens_collect.xml'), 'utf8'))?.[1];
  ok(dimenVal('values', 'wc_alpha_light') === '1' && dimenVal('values', 'wc_alpha_dark') === '0', 'values/dimens_collect.xml：淺色模式應為 淺=1、深=0');
  ok(dimenVal('values-night', 'wc_alpha_light') === '0' && dimenVal('values-night', 'wc_alpha_dark') === '1', 'values-night/dimens_collect.xml：深色模式應為 淺=0、深=1');
}

if (fails.length) {
  console.error(`版面 gate 失敗 ${fails.length} 項：`);
  for (const f of fails) console.error(' ✗ ' + f);
  process.exit(1);
}
console.log(`版面 gate 全過（${layouts.length} 張版面＋${includedBy.size - layouts.length} 張只經 <include> 引入、` +
  `${bound.size} 個綁定 id、provider 的 ${used.size} 張版面都已登記、白名單與 shape 尺寸都查過；` +
  `車站收集 ${collectBound.size} 個綁定 id／${collectUsed.size} 張版面／saveEnabled／removeAllViews／深淺 alpha 都查過）`);
