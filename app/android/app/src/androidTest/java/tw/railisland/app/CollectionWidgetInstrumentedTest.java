package tw.railisland.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.text.Layout;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.RemoteViews;
import android.widget.TextView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 車站收集小工具的裝置端驗收。這支只【回報觀察到的東西】，不判定「畫面對不對」：
 * 期望值一律由 app/scripts/verify_android_collect_widget.mjs 從 payload 用另一份實作獨立重算再比對，
 * 這裡不准拿 Provider 算出的值當期望值（判準盲點：同源時「相等」是零資訊）。
 *
 * 兩個測試：
 *  · renderCases：讀 files/collect-cases/cases.json，逐案把「Provider 實際會交給 launcher 的 RemoteViews」
 *    用 RemoteViews.apply 展開成真的 View 樹、量好版、畫成 PNG（淺／深用 createConfigurationContext 模擬，不動系統設定），
 *    並把每個 TextView／ProgressBar／ImageView 的實際文字、進度、字形範圍、被截斷與否寫進 files/collect-out/obs.json。
 *  · storeValidation／storeAtomicWrite：外掛驗證表（手寫輸入＋期望「收」或「拒」）與原子寫入，直接打 CollectionStore。
 */
@RunWith(AndroidJUnit4.class)
public final class CollectionWidgetInstrumentedTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @After
    public void restoreLanguage() {
        RailNativeL10n.setLanguage(context, "zh-TW");
    }

    // ── 外掛驗證（跟 iOS RailCollectionPlugin 同一套）────────────────────────────

    private static String repeat(String s, int n) {
        StringBuilder b = new StringBuilder(s.length() * n);
        for (int i = 0; i < n; i++) b.append(s);
        return b.toString();
    }

    @Test
    public void storeValidation() {
        // 每列：名稱、輸入、期望（null＝收；否則＝reject 訊息應包含的字串）
        Object[][] table = {
            { "缺 json（null）", null, "Missing json string" },
            { "空字串", "", "Empty json" },
            { "空白字串", "   ", "not a JSON object" },
            { "陣列不是物件", "[]", "not a JSON object" },
            { "數字不是物件", "1", "not a JSON object" },
            { "字串不是物件", "\"x\"", "not a JSON object" },
            { "null 不是物件", "null", "not a JSON object" },
            { "壞 JSON", "{\"v\":", "not a JSON object" },
            { "沒有 v", "{}", "Unsupported payload version" },
            { "v=2", "{\"v\":2}", "Unsupported payload version" },
            { "v=0", "{\"v\":0}", "Unsupported payload version" },
            { "v 是字串 \"1\"", "{\"v\":\"1\"}", "Unsupported payload version" },
            { "v=true", "{\"v\":true}", "Unsupported payload version" },
            { "v=1.5", "{\"v\":1.5}", "Unsupported payload version" },
            { "v=null", "{\"v\":null}", "Unsupported payload version" },
            { "單引號鍵（org.json 會放行）", "{'v':1}", "not a JSON object" },
            { "沒有引號的鍵（org.json 會放行）", "{v:1}", "not a JSON object" },
            { "結尾逗號", "{\"v\":1,}", "not a JSON object" },
            { "物件後面有多餘文字（org.json 會放行）", "{\"v\":1} trailing", "not a JSON object" },
            { "兩個物件黏在一起", "{\"v\":1}{\"v\":1}", "not a JSON object" },
            { "v=1", "{\"v\":1}", null },
            { "v=1.0", "{\"v\":1.0}", null },
            { "v=1e0", "{\"v\":1e0}", null },
            { "前後空白", " \n{\"v\":1}\n ", null },
            { "含中文", "{\"v\":1,\"lang\":\"車站收集\"}", null },
            // 以位元組計，不是字元數：20 萬個「車」＝ 60 萬位元組，但字元數遠小於 512K
            { "以 UTF-8 位元組計超過 512KB", "{\"v\":1,\"pad\":\"" + repeat("車", 200_000) + "\"}", "Payload too large" },
            { "剛好 512KB 收", "{\"v\":1,\"pad\":\"" + repeat("x", CollectionStore.MAX_BYTES - "{\"v\":1,\"pad\":\"\"}".length()) + "\"}", null },
            { "512KB＋1 拒", "{\"v\":1,\"pad\":\"" + repeat("x", CollectionStore.MAX_BYTES - "{\"v\":1,\"pad\":\"\"}".length() + 1) + "\"}", "Payload too large" },
        };
        for (Object[] row : table) {
            String name = (String) row[0];
            String problem = CollectionStore.validate((String) row[1]);
            if (row[2] == null) {
                assertNull("應該收：" + name + "（實際回 " + problem + "）", problem);
            } else {
                assertNotNull("應該拒：" + name, problem);
                assertTrue("拒絕訊息不對：" + name + "（實際：" + problem + "）", problem.contains((String) row[2]));
            }
        }
    }

    @Test
    public void storeAtomicWrite() throws Exception {
        File file = CollectionData.file(context);
        String a = "{\"v\":1,\"tag\":\"a\"}";
        String b = "{\"v\":1,\"tag\":\"bb\"}";
        assertTrue(CollectionStore.write(context, a));
        assertEquals(a, CollectionStore.read(context));
        assertTrue(CollectionStore.write(context, b));
        assertEquals(b, CollectionStore.read(context));
        assertFalse("不留暫存檔", new File(file.getParentFile(), "collection.json.tmp").exists());
        assertTrue(file.delete());
        assertNull("沒有檔案回 null", CollectionStore.read(context));
    }

    // ── 真桌面放置 ──────────────────────────────────────────────────────────────

    /**
     * 要求 launcher 把小工具釘到桌面；接著由 adb／uiautomator 點掉 launcher 的確認框。
     * -e family small|medium 挑車站收集的小／中卡；-e provider MetroWidgetSmallProvider 之類可改釘別的 provider（對照組用）。
     */
    @Test
    public void pinWidget() throws Exception {
        // 整個類別一起跑時不釘（會跳 launcher 的確認框擋住畫面）；只有明講 -e family 才釘
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("family") != null);
        String family = InstrumentationRegistry.getArguments().getString("family", "medium");
        String named = InstrumentationRegistry.getArguments().getString("provider", "");
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        assertTrue("launcher 不支援 requestPinAppWidget", manager.isRequestPinAppWidgetSupported());
        Class<?> provider = !named.isEmpty() ? Class.forName("tw.railisland.app." + named)
            : "small".equals(family) ? CollectionWidgetSmallProvider.class : CollectionWidgetProvider.class;
        assertTrue(manager.requestPinAppWidget(new ComponentName(context, provider), null, null));
    }

    // ── launcher 的 reapply 行為 ──────────────────────────────────────────────────

    /** 整棵 View 樹的狀態指紋（類別、可見性、文字、進度、圖片尺寸、字級、子數量…）。 */
    private static void signature(View v, String path, StringBuilder out) {
        out.append(path).append('|').append(v.getClass().getSimpleName()).append('|').append(idName(v))
            .append("|vis=").append(v.getVisibility()).append("|alpha=").append(v.getAlpha());
        // 看不見的節點（含整棵子樹）只比可見性：畫不出來的舊文字不算漏進畫面，重新變成可見時各分支都會重設內容
        if (v.getVisibility() != View.VISIBLE) { out.append('\n'); return; }
        if (v.getContentDescription() != null) out.append("|desc=").append(v.getContentDescription());
        if (v instanceof TextView) {
            TextView t = (TextView) v;
            out.append("|text=").append(t.getText()).append("|px=").append(t.getTextSize());
        }
        if (v instanceof ProgressBar) out.append("|prog=").append(((ProgressBar) v).getProgress());
        if (v instanceof ImageView) {
            Drawable d = ((ImageView) v).getDrawable();
            if (d instanceof BitmapDrawable) {
                Bitmap b = ((BitmapDrawable) d).getBitmap();
                out.append("|bmp=").append(b.getWidth()).append('x').append(b.getHeight());
            }
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            out.append("|children=").append(g.getChildCount());
            for (int i = 0; i < g.getChildCount(); i++) signature(g.getChildAt(i), path + "/" + i, out);
        }
        out.append('\n');
    }

    private static String firstDiff(String a, String b) {
        String[] x = a.split("\n"), y = b.split("\n");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            String l = i < x.length ? x[i] : "(無)";
            String r = i < y.length ? y[i] : "(無)";
            if (!l.equals(r)) return "reapply：" + l + "  ⇢  重新 inflate：" + r;
        }
        return "";
    }

    /**
     * launcher（AppWidgetHostView）收到「同一個 layout」的新 RemoteViews 時，是 reapply 到舊的 View 樹上，不是重新 inflate。
     * 所以「上一張長什麼樣」會漏進「這一張」：addView 會累加、沒被新 RemoteViews 提到的屬性會停在舊值。
     * 這裡照 launcher 的做法走一串真實會發生的狀態轉換（空↔有資料、全台↔單一系統、換語言、窄卡↔寬卡…），
     * 每一步都拿「reapply 之後的樹」跟「同一個 RemoteViews 全新 inflate 的樹」比對指紋；不同就是舊狀態漏進新畫面。
     * 結果寫進 files/collect-out/reapply.json，由 verify_android_collect_widget.mjs 判定。
     */
    @Test
    public void reapplyTransitions() throws Exception {
        File casesDir = new File(context.getFilesDir(), "collect-cases");
        File outDir = new File(context.getFilesDir(), "collect-out");
        outDir.mkdirs();
        // [payload, scope, lang, wDp, hDp]：同一個 widget id 依序收到的更新
        String[][] steps = {
            { "sample.json", "all", "zh-TW", "368", "221" },
            { "empty.json", "all", "zh-TW", "368", "221" },
            { "sample.json", "all", "zh-TW", "368", "221" },
            { "sample.json", "krtc", "zh-TW", "368", "221" },
            { "sample.json", "all", "zh-TW", "368", "221" },
            { "one.json", "all", "zh-TW", "368", "221" },
            { "full.json", "all", "zh-TW", "368", "221" },
            { "sample.json", "trtc", "zh-TW", "368", "221" },
            { "sample.json", "krtc", "zh-TW", "368", "221" },
            { "sample-en.json", "krtc", "en", "368", "221" },
            { "sample-en.json", "all", "en", "368", "221" },
            { "sample.json", "all", "zh-TW", "368", "150" },
            { "sample.json", "all", "zh-TW", "368", "221" },
        };
        String[][] smallSteps = {
            { "sample.json", "all", "zh-TW", "140", "221" },
            { "empty.json", "all", "zh-TW", "140", "221" },
            { "sample.json", "all", "zh-TW", "140", "221" },
            { "sample.json", "krtc", "zh-TW", "140", "221" },
            { "sample.json", "all", "zh-TW", "110", "110" },
            { "sample.json", "all", "zh-TW", "140", "221" },
            { "empty.json", "all", "zh-TW", "110", "110" },
            { "sample.json", "krtc", "zh-TW", "140", "221" },
            { "sample.json", "all", "zh-TW", "137", "137" },
            { "full.json", "all", "zh-TW", "140", "221" },
        };
        JSONArray results = new JSONArray();
        for (String family : new String[] { WidgetFamily.MEDIUM, WidgetFamily.SMALL }) {
            String[][] list = WidgetFamily.SMALL.equals(family) ? smallSteps : steps;
            FrameLayout host = new FrameLayout(context);
            View live = null;
            int liveLayout = -1;
            for (int i = 0; i < list.length; i++) {
                String[] st = list[i];
                RailNativeL10n.setLanguage(context, st[2]);
                String json = new String(readAll(new File(casesDir, st[0])), StandardCharsets.UTF_8);
                assertTrue(CollectionStore.write(context, json));
                RemoteViews views = CollectionWidgetProvider.views(context, 9900, family, st[1], Integer.parseInt(st[3]), Integer.parseInt(st[4]));
                FrameLayout freshHost = new FrameLayout(context);
                View fresh = views.apply(context, freshHost);
                if (live != null && liveLayout == views.getLayoutId()) {
                    views.reapply(context, live);     // launcher 的做法
                } else {
                    host.removeAllViews();             // layout 不同：launcher 會整個換掉
                    live = views.apply(context, host);
                }
                liveLayout = views.getLayoutId();
                StringBuilder a = new StringBuilder(), b = new StringBuilder();
                signature(live, "r", a);
                signature(fresh, "r", b);
                JSONObject o = new JSONObject();
                o.put("family", family);
                o.put("step", i);
                o.put("label", st[0] + " " + st[1] + " " + st[2] + " " + st[3] + "x" + st[4]);
                o.put("same", a.toString().equals(b.toString()));
                o.put("diff", firstDiff(a.toString(), b.toString()));
                o.put("nodes", b.toString().split("\n").length);
                results.put(o);
            }
        }
        try (FileOutputStream out = new FileOutputStream(new File(outDir, "reapply.json"))) {
            out.write(results.toString(1).getBytes(StandardCharsets.UTF_8));
        }
    }

    // ── launcher 的「存檔再還原 View 狀態」──────────────────────────────────────────────

    private static void progressOf(View v, java.util.List<Integer> out) {
        if (v instanceof ProgressBar) out.add(((ProgressBar) v).getProgress());
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) progressOf(g.getChildAt(i), out);
        }
    }

    /**
     * launcher 在螢幕方向或深淺色切換時，會把整棵 View 樹的狀態存下來，用新資源重新 inflate 後再還原；
     * 還原是「以 id 對應」，同一張卡有好幾條同 id 的進度條（全台的系統列）就會全被塞回最後一條的進度。
     * 這裡在 emulator 上用 saveHierarchyState／restoreHierarchyState 重現那條路徑，記下前後每條進度條的值，
     * 由 verify_android_collect_widget.mjs 判定「前＝後」，並要求前的各條值不全相同（否則這個測試量不到東西）。
     */
    @Test
    public void stateRoundTrip() throws Exception {
        File casesDir = new File(context.getFilesDir(), "collect-cases");
        File outDir = new File(context.getFilesDir(), "collect-out");
        outDir.mkdirs();
        RailNativeL10n.setLanguage(context, "zh-TW");
        String json = new String(readAll(new File(casesDir, "sample.json")), StandardCharsets.UTF_8);
        assertTrue(CollectionStore.write(context, json));
        JSONArray results = new JSONArray();
        String[][] runs = { { "medium", "all", "368", "221" }, { "medium", "krtc", "368", "221" }, { "small", "all", "140", "221" } };
        for (String[] run : runs) {
            RemoteViews views = CollectionWidgetProvider.views(context, 9901, run[0], run[1], Integer.parseInt(run[2]), Integer.parseInt(run[3]));
            View first = views.apply(context, new FrameLayout(context));
            java.util.List<Integer> before = new java.util.ArrayList<>();
            progressOf(first, before);
            android.util.SparseArray<android.os.Parcelable> saved = new android.util.SparseArray<>();
            first.saveHierarchyState(saved);
            View second = views.apply(context, new FrameLayout(context));      // 深淺色切換後 launcher 重新 inflate
            second.restoreHierarchyState(saved);
            java.util.List<Integer> after = new java.util.ArrayList<>();
            progressOf(second, after);
            JSONObject o = new JSONObject();
            o.put("label", run[0] + " " + run[1]);
            o.put("before", new JSONArray(before));
            o.put("after", new JSONArray(after));
            results.put(o);
        }
        try (FileOutputStream out = new FileOutputStream(new File(outDir, "state.json"))) {
            out.write(results.toString(1).getBytes(StandardCharsets.UTF_8));
        }
    }

    // ── 逐案算圖 ───────────────────────────────────────────────────────────────

    private static byte[] readAll(File f) throws Exception {
        try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) >= 0;) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private Context themed(boolean night) {
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK)
            | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
        return context.createConfigurationContext(config);
    }

    private static void savePng(Bitmap bitmap, File file) throws Exception {
        try (FileOutputStream out = new FileOutputStream(file)) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        }
    }

    @Test
    public void renderCases() throws Exception {
        File casesDir = new File(context.getFilesDir(), "collect-cases");
        File outDir = new File(context.getFilesDir(), "collect-out");
        outDir.mkdirs();
        for (File old : outDir.listFiles()) if (!old.getName().equals("reapply.json") && !old.getName().equals("state.json")) old.delete();
        JSONArray cases = new JSONArray(new String(readAll(new File(casesDir, "cases.json")), StandardCharsets.UTF_8));
        JSONArray results = new JSONArray();
        float density = context.getResources().getDisplayMetrics().density;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            String id = c.getString("id");
            RailNativeL10n.setLanguage(context, c.optString("lang", "zh-TW"));
            String payload = c.optString("payload", "");
            File collection = CollectionData.file(context);
            if (payload.isEmpty()) {
                collection.delete();
            } else {
                String json = new String(readAll(new File(casesDir, payload)), StandardCharsets.UTF_8);
                assertTrue("寫入 collection.json 失敗：" + id, CollectionStore.write(context, json));
            }
            String family = c.getString("family");
            int wDp = c.getInt("wDp");
            int hDp = c.getInt("hDp");
            boolean night = "dark".equals(c.optString("theme", "light"));
            RemoteViews views = CollectionWidgetProvider.views(context, 9000 + i, family, c.optString("scope", "all"), wDp, hDp);

            Context themedContext = themed(night);
            FrameLayout host = new FrameLayout(themedContext);
            View root = views.apply(themedContext, host);
            int wPx = Math.round(wDp * density);
            int hPx = Math.round(hDp * density);
            root.measure(View.MeasureSpec.makeMeasureSpec(wPx, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(hPx, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, wPx, hPx);

            // 卡片 PNG：疊在一張中性「桌布」色上，才看得出卡片邊緣
            Bitmap card = Bitmap.createBitmap(wPx, hPx, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(card);
            canvas.drawColor(night ? 0xFF0B0F14 : 0xFFB9C4CF);
            root.draw(canvas);
            savePng(card, new File(outDir, id + ".card.png"));

            JSONObject obs = new JSONObject();
            obs.put("id", id);
            obs.put("density", density);
            obs.put("wDp", wDp);
            obs.put("hDp", hDp);
            obs.put("wPx", wPx);
            obs.put("hPx", hPx);
            JSONArray nodes = new JSONArray();
            long[] bitmapBytes = { 0 };
            walk(root, root, density, nodes, outDir, id, bitmapBytes);
            obs.put("nodes", nodes);
            obs.put("bitmapBytes", bitmapBytes[0]);
            results.put(obs);
        }
        try (FileOutputStream out = new FileOutputStream(new File(outDir, "obs.json"))) {
            out.write(results.toString(1).getBytes(StandardCharsets.UTF_8));
        }
    }

    private static boolean shown(View v, View root) {
        for (View cur = v; ; ) {
            if (cur.getVisibility() != View.VISIBLE) return false;
            if (cur == root) return true;
            if (!(cur.getParent() instanceof View)) return true;
            cur = (View) cur.getParent();
        }
    }

    private static float[] originOf(View v, View root) {
        float x = 0, y = 0;
        for (View cur = v; cur != root && cur != null; ) {
            x += cur.getLeft();
            y += cur.getTop();
            cur = cur.getParent() instanceof View ? (View) cur.getParent() : null;
        }
        return new float[] { x, y };
    }

    private static String idName(View v) {
        if (v.getId() == View.NO_ID) return "";
        try {
            return v.getResources().getResourceEntryName(v.getId());
        } catch (Exception error) {
            return "";
        }
    }

    private static JSONArray rect(float l, float t, float r, float b, float density) throws Exception {
        return new JSONArray().put(l / density).put(t / density).put(r / density).put(b / density);
    }

    private void walk(View v, View root, float density, JSONArray out, File outDir, String caseId, long[] bytes) throws Exception {
        String name = idName(v);
        if (v instanceof TextView && !name.isEmpty()) {
            TextView t = (TextView) v;
            JSONObject o = new JSONObject();
            o.put("kind", "text");
            o.put("id", name);
            o.put("text", t.getText().toString());
            boolean visible = shown(v, root);
            o.put("visible", visible);
            Layout layout = t.getLayout();
            float[] origin = originOf(v, root);
            o.put("box", rect(origin[0], origin[1], origin[0] + v.getWidth(), origin[1] + v.getHeight(), density));
            o.put("sp", t.getTextSize() / density);
            if (visible && layout != null) {
                boolean ellipsized = false;
                float maxRight = 0, minLeft = Float.MAX_VALUE;
                for (int line = 0; line < layout.getLineCount(); line++) {
                    if (layout.getEllipsisCount(line) > 0) ellipsized = true;
                    minLeft = Math.min(minLeft, layout.getLineLeft(line));
                    maxRight = Math.max(maxRight, layout.getLineRight(line));
                }
                o.put("lines", layout.getLineCount());
                // maxLines 以下的行才畫得出來；多出來的行（例如「37%」折成兩行、「%」落到第二行）被裁掉，人眼看到的是缺字
                int maxLines = t.getMaxLines();
                o.put("maxLines", maxLines);
                o.put("hiddenLines", maxLines > 0 && maxLines < Integer.MAX_VALUE ? Math.max(0, layout.getLineCount() - maxLines) : 0);
                o.put("ellipsized", ellipsized);
                // 字形範圍（不是元素框）：文字實際畫到的地方
                float gl = origin[0] + t.getCompoundPaddingLeft() + (minLeft == Float.MAX_VALUE ? 0 : minLeft);
                float gr = origin[0] + t.getCompoundPaddingLeft() + maxRight;
                float gt = origin[1] + t.getCompoundPaddingTop();
                float gb = gt + layout.getHeight();
                o.put("glyph", rect(gl, gt, gr, gb, density));
                // 水平被裁：最寬的一行比可用寬度寬（沒有 ellipsize 的關鍵數字就是這樣被裁掉的）
                float avail = v.getWidth() - t.getCompoundPaddingLeft() - t.getCompoundPaddingRight();
                o.put("clippedH", layout.getLineCount() > 0 && (maxRight - minLeft) > avail + 0.5f);
                // 垂直被裁：LinearLayout 給的高度比文字需要的矮
                float need = layout.getHeight() + t.getCompoundPaddingTop() + t.getCompoundPaddingBottom();
                o.put("clippedV", v.getHeight() + 0.5f < need);
            }
            out.put(o);
        } else if (v instanceof ProgressBar && !name.isEmpty()) {
            ProgressBar p = (ProgressBar) v;
            JSONObject o = new JSONObject();
            o.put("kind", "progress");
            o.put("id", name);
            o.put("progress", p.getProgress());
            o.put("max", p.getMax());
            o.put("visible", shown(v, root));
            float[] origin = originOf(v, root);
            o.put("box", rect(origin[0], origin[1], origin[0] + v.getWidth(), origin[1] + v.getHeight(), density));
            out.put(o);
        } else if (v instanceof ImageView && !name.isEmpty()) {
            ImageView iv = (ImageView) v;
            Drawable d = iv.getDrawable();
            JSONObject o = new JSONObject();
            o.put("kind", "image");
            o.put("id", name);
            o.put("alpha", iv.getAlpha());
            o.put("visible", shown(v, root));
            float[] origin = originOf(v, root);
            o.put("box", rect(origin[0], origin[1], origin[0] + v.getWidth(), origin[1] + v.getHeight(), density));
            if (d instanceof BitmapDrawable) {
                Bitmap bmp = ((BitmapDrawable) d).getBitmap();
                o.put("bitmapW", bmp.getWidth());
                o.put("bitmapH", bmp.getHeight());
                o.put("bitmapBytes", bmp.getByteCount());
                bytes[0] += bmp.getByteCount();
                // 實際畫出來的矩形（fitEnd 縮放後貼右下）
                Matrix m = iv.getImageMatrix();
                RectF drawn = new RectF(0, 0, bmp.getWidth(), bmp.getHeight());
                m.mapRect(drawn);
                o.put("drawn", rect(origin[0] + iv.getPaddingLeft() + drawn.left, origin[1] + iv.getPaddingTop() + drawn.top,
                    origin[0] + iv.getPaddingLeft() + drawn.right, origin[1] + iv.getPaddingTop() + drawn.bottom, density));
                // 這一張 Bitmap 就是 RemoteViews 帶去給 launcher 的那一張，逐案存下來給 node 讀像素
                String file = caseId + "." + name + ".png";
                savePng(bmp, new File(outDir, file));
                o.put("png", file);
            }
            out.put(o);
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) walk(g.getChildAt(i), root, density, out, outDir, caseId, bytes);
        }
    }
}
