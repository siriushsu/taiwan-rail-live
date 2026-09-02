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

const idsOf = new Map();      // 檔名 → Set(id)
const tagsOf = new Map();     // 檔名 → [tag]

for (const file of layouts) {
  const xml = readFileSync(join(LAYOUT_DIR, file), 'utf8');
  const tags = [...xml.matchAll(/<([A-Za-z][\w.]*)/g)].map(m => m[1]).filter(t => t !== 'merge');
  tagsOf.set(file, tags);
  idsOf.set(file, new Set([...xml.matchAll(/android:id="@\+?id\/([a-z_0-9]+)"/g)].map(m => m[1])));

  for (const tag of new Set(tags)) {
    ok(ALLOWED.has(tag),
      `${file}：<${tag}> 不在 RemoteViews 白名單裡——上裝置會丟 "Class not allowed to be inflated"`);
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

// binder 綁的每一個 id，都要真的存在於它那一組版面裡
const render = readFileSync(join(JAVA, 'MetroWidgetPlateRender.java'), 'utf8');
const bound = new Set([...render.matchAll(/R\.id\.([a-z_0-9]+)/g)].map(m => m[1]));
ok(bound.size >= 30, `binder 綁的 id 只有 ${bound.size} 個，少於預期（是不是抓錯檔案）`);
const plateIds = idsOf.get('widget_plate_4x2.xml') ?? new Set();
const boardIds = idsOf.get('widget_board_4x2.xml') ?? new Set();
const messageIds = idsOf.get('widget_plate_message.xml') ?? new Set();
for (const id of bound) {
  const home = id.startsWith('wb_') ? boardIds : id.startsWith('wm_') ? messageIds : plateIds;
  const where = id.startsWith('wb_') ? '夜行看板' : id.startsWith('wm_') ? '訊息版面' : '琺瑯站牌';
  ok(home.has(id), `binder 綁了 ${id}，但 ${where} 版面裡沒有這個 id`);
}

// provider 用到的每一張版面都要存在
const provider = readFileSync(join(JAVA, 'MetroWidgetProvider.java'), 'utf8');
const used = new Set([...provider.matchAll(/R\.layout\.(widget_[a-z_0-9]+)/g)].map(m => m[1]));
ok(used.size === 6, `provider 應該用到 6 張版面（兩版型 × 三尺寸），實得 ${used.size}：${[...used]}`);
for (const name of used) {
  ok(layouts.includes(`${name}.xml`), `provider 用了 R.layout.${name}，但檔案不存在`);
}

// 夜行看板的三列都要在版面裡（provider 明確傳 maxRows 決定顯示幾列）
for (const file of groups.夜行看板) {
  const ids = idsOf.get(file) ?? new Set();
  for (const n of [1, 2, 3]) {
    ok(ids.has(`wb_r${n}`), `${file}：少了第 ${n} 列（三列必須都在版面裡，由 maxRows 決定顯示幾列）`);
  }
}

if (fails.length) {
  console.error(`版面 gate 失敗 ${fails.length} 項：`);
  for (const f of fails) console.error(' ✗ ' + f);
  process.exit(1);
}
console.log(`版面 gate 全過（${layouts.length} 張版面、${bound.size} 個綁定 id、白名單與 shape 尺寸都查過）`);
