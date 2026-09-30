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
import android.text.TextPaint;
import android.view.LayoutInflater;
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

    // ── 點擊目標 ───────────────────────────────────────────────────────────────

    /**
     * 「蓋章」按鈕與整張卡各綁哪一顆 PendingIntent。用 RemoteViews.apply(…, InteractionHandler) 攔下 launcher 點擊時會送出的
     * PendingIntent（handler 回 true＝不真的開 App），再拿去跟【測試自己用字面值建的】PendingIntent 比對：
     * FLAG_NO_CREATE 只有系統端真的存在「同 request code＋同 Intent」那一筆才回非 null，PendingIntent.equals 比的是系統端同一筆記錄。
     * 期望值不取自 CollectionWidgetProvider 的任何函式（同源時「相等」是零資訊）。結果寫進 files/collect-out/stamp.json。
     */
    @Test
    public void stampBinding() throws Exception {
        File casesDir = new File(context.getFilesDir(), "collect-cases");
        File outDir = new File(context.getFilesDir(), "collect-out");
        outDir.mkdirs();
        RailNativeL10n.setLanguage(context, "zh-TW");
        assertTrue(CollectionStore.write(context, new String(readAll(new File(casesDir, "sample.json")), StandardCharsets.UTF_8)));
        float density = context.getResources().getDisplayMetrics().density;
        JSONArray results = new JSONArray();
        int index = 0;
        for (String family : new String[] { WidgetFamily.MEDIUM, WidgetFamily.SMALL }) {
            int id = 9700 + index++;
            boolean small = WidgetFamily.SMALL.equals(family);
            int wDp = small ? 158 : 360, hDp = 158;
            RemoteViews views = CollectionWidgetProvider.views(context, id, family, "all", wDp, hDp);
            // launcher 點擊時走 RemoteViews 預設處理：view.getContext().startIntentSender(pending.getIntentSender(), …)。
            // 這裡把 context 換成會「攔下 IntentSender、不真的開 App」的包裝，就能對每個點擊入口拿到它綁的那一顆。
            CapturingContext capture = new CapturingContext(context);
            View root = views.apply(capture, new FrameLayout(context));
            int wPx = Math.round(wDp * density), hPx = Math.round(hDp * density);
            root.measure(View.MeasureSpec.makeMeasureSpec(wPx, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(hPx, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, wPx, hPx);
            final android.content.IntentSender[] hit = new android.content.IntentSender[2];
            View container = root.findViewById(R.id.wc_stamp_hit);
            View pill = root.findViewById(R.id.wc_stamp);
            assertNotNull("版面裡沒有 wc_stamp_hit：" + family, container);
            assertNotNull("版面裡沒有 wc_stamp：" + family, pill);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                capture.last = null;
                container.performClick();       // 綁 PendingIntent 的是外面的透明容器，不是膠囊
                hit[0] = capture.last;
                capture.last = null;
                root.performClick();
                hit[1] = capture.last;
            });
            android.content.IntentSender checkin = sender(literal(id + 47000, "checkin"));
            android.content.IntentSender passport = sender(literal(id + 46000, "passport"));
            JSONObject o = new JSONObject();
            o.put("family", family);
            o.put("stampClicked", hit[0] != null);
            o.put("rootClicked", hit[1] != null);
            o.put("literalCheckinExists", checkin != null);
            o.put("literalPassportExists", passport != null);
            o.put("stampIsCheckin", hit[0] != null && hit[0].equals(checkin));
            o.put("stampIsPassport", hit[0] != null && hit[0].equals(passport));
            o.put("rootIsPassport", hit[1] != null && hit[1].equals(passport));
            o.put("rootIsCheckin", hit[1] != null && hit[1].equals(checkin));
            o.put("samePending", hit[0] != null && hit[0].equals(hit[1]));
            o.put("stampCreator", hit[0] == null ? "" : hit[0].getCreatorPackage());
            // 觸控命中：用【自己重做的一份 Android 命中規則】（點必須落在每一層祖先的邊界內、由上而下第一個可點的 view）
            // 掃整張卡，量「按下去會落到膠囊容器」的實際範圍——不是量容器的框（伸出祖先邊界的部分點不到）。
            float[] pillOrigin = originOf(pill, root);
            o.put("pillHitId", idName(hitTest(root, pillOrigin[0] + pill.getWidth() / 2f, pillOrigin[1] + pill.getHeight() / 2f)));
            View title = root.findViewById(R.id.wc_title);
            float[] titleOrigin = originOf(title, root);
            o.put("titleHitId", idName(hitTest(root, titleOrigin[0] + 4, titleOrigin[1] + title.getHeight() / 2f)));
            float step = 0.5f * density;
            float minX = Float.MAX_VALUE, minY = Float.MAX_VALUE, maxX = -1, maxY = -1;
            int count = 0;
            for (float y = 0; y < hPx; y += step) {
                for (float x = 0; x < wPx; x += step) {
                    if (hitTest(root, x, y) != container) continue;
                    count++;
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x + step);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y + step);
                }
            }
            o.put("effective", count == 0 ? new JSONArray() : rect(minX, minY, maxX, maxY, density));
            o.put("effectiveFilled", count == 0 ? 0 : count * step * step / ((maxX - minX) * (maxY - minY)));
            results.put(o);
        }
        try (FileOutputStream out = new FileOutputStream(new File(outDir, "stamp.json"))) {
            out.write(results.toString(1).getBytes(StandardCharsets.UTF_8));
        }
    }

    /** Android 的觸控命中規則（ViewGroup.dispatchTouchEvent 的重做）：點在 v 的邊界內才往下找；子 view 由上（後加）往下；沒有子 view 接住才輪到 v 自己（可點才算）。 */
    private static View hitTest(View v, float x, float y) {
        if (x < 0 || y < 0 || x >= v.getWidth() || y >= v.getHeight() || v.getVisibility() != View.VISIBLE) return null;
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = g.getChildCount() - 1; i >= 0; i--) {
                View c = g.getChildAt(i);
                View hit = hitTest(c, x - c.getLeft() + g.getScrollX(), y - c.getTop() + g.getScrollY());
                if (hit != null) return hit;
            }
        }
        return v.isClickable() ? v : null;
    }

    /** 會攔下 startIntentSender 的 Context 包裝：RemoteViews 的點擊最後都走到這裡（測試裡不能真的開 App）。 */
    private static final class CapturingContext extends android.content.ContextWrapper {
        android.content.IntentSender last;

        CapturingContext(Context base) { super(base); }

        @Override
        public void startIntentSender(android.content.IntentSender intent, android.content.Intent fill, int mask, int values, int extra,
                                      android.os.Bundle options) { last = intent; }

        @Override
        public void startIntentSender(android.content.IntentSender intent, android.content.Intent fill, int mask, int values, int extra) { last = intent; }
    }

    private static android.content.IntentSender sender(android.app.PendingIntent pending) { return pending == null ? null : pending.getIntentSender(); }

    /** 系統端是否已有「這個 request code＋railisland://host＋指名 MainActivity＋FLAG_IMMUTABLE」的 PendingIntent（沒有回 null，不新建）。 */
    private android.app.PendingIntent literal(int requestCode, String host) {
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW,
            android.net.Uri.parse("railisland://" + host), context, MainActivity.class);
        return android.app.PendingIntent.getActivity(context, requestCode, intent,
            android.app.PendingIntent.FLAG_NO_CREATE | android.app.PendingIntent.FLAG_IMMUTABLE);
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
        for (File old : outDir.listFiles()) if (!old.getName().equals("reapply.json") && !old.getName().equals("state.json") && !old.getName().equals("stamp.json")) old.delete();
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
            obs.put("head", headMeasure(themedContext, family, c.optString("scope", "all"), root, density));
            obs.put("bitmapBytes", bitmapBytes[0]);
            results.put(obs);
        }
        try (FileOutputStream out = new FileOutputStream(new File(outDir, "obs.json"))) {
            out.write(results.toString(1).getBytes(StandardCharsets.UTF_8));
        }
    }

    /**
     * 標題列的「自然寬度」（dp）：兩個名稱各自在版面 XML 宣告的基準字級與粗細下的 Paint.measureText。
     * 只回報量到的寬度與那一行的可用寬（rowBox），放不放得下、該留哪一個，由預言機判斷（不讀實作的任何字寬估計或常數）。
     * 小卡：範圍名（標題，粗體）、「車站收集」（副標，一般）、「車站收集」當標題（粗體）；中卡：「範圍 · 車站收集」（粗體）。
     */
    private JSONObject headMeasure(Context ctx, String family, String scope, View root, float density) throws Exception {
        JSONObject o = new JSONObject();
        CollectionData data = CollectionData.load(ctx);
        View title = root.findViewById(R.id.wc_title);
        if (data == null || title == null) return o;
        CollectionData.Figures fg = data.figures(scope, RailNativeL10n.text(ctx, "全台"));
        String kicker = RailNativeL10n.text(ctx, "車站收集");
        boolean small = "small".equals(family);
        View base = LayoutInflater.from(ctx).inflate(small ? R.layout.widget_collect_small : R.layout.widget_collect_medium, new FrameLayout(ctx), false);
        // 基準字級取版面 XML 宣告的值（inflate 後的像素換回 sp，取最近的 0.5sp）；量寬度用「同一個 sp 換成浮點像素」的 Paint——
        // Render 也是用 setTextViewTextSize 設浮點字級（XML 宣告的字級會被取整成整數像素，CJK 的字寬隨整數像素跳，實測差到 2.7dp）。
        TextView baseTitle = base.findViewById(R.id.wc_title);
        float titlePx = baseTitle.getAutoSizeMaxTextSize() > 0 ? baseTitle.getAutoSizeMaxTextSize() : baseTitle.getTextSize();
        float titleSp = Math.round(titlePx / density * 2) / 2f;
        android.util.DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
        TextPaint tp = new TextPaint(baseTitle.getPaint());
        tp.setTextSize(android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, titleSp, dm));
        o.put("scope", fg.title);
        o.put("kicker", kicker);
        o.put("titleBaseSp", titleSp);
        o.put("wScope", tp.measureText(fg.title) / density);
        o.put("wKickerAsTitle", tp.measureText(kicker) / density);
        if (small) {
            TextView baseSub = base.findViewById(R.id.wc_subtitle);
            TextPaint sp = new TextPaint(baseSub.getPaint());
            sp.setTextSize(android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, Math.round(baseSub.getTextSize() / density * 2) / 2f, dm));
            o.put("wKicker", sp.measureText(kicker) / density);
        } else {
            o.put("wBoth", tp.measureText(fg.title + " · " + kicker) / density);
        }
        View row = small ? (View) title.getParent() : title;
        float[] origin = originOf(row, root);
        o.put("rowBox", rect(origin[0], origin[1], origin[0] + row.getWidth(), origin[1] + row.getHeight(), density));
        return o;
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

    /**
     * 這個 view 實際會被畫出來的區域（root 座標、像素）：從自己一路往上到 root，
     * 被父層 clipChildren 的 view 取自己的邊界（軟體繪製時每個孩子被裁在自己的邊界裡）；
     * clipToPadding（預設 true）且有內距的祖先取內距框（dispatchDraw 會 clipRect 內距框）。
     * 文字欄 paddingBottom 12dp＋clipToPadding 預設 true，就是這樣把溢出欄上緣的百分比裁掉的。
     */
    private static float[] visibleClip(View v, View root) {
        float l = -1e9f, t = -1e9f, r = 1e9f, b = 1e9f;
        for (View cur = v; cur != null; ) {
            float[] o = originOf(cur, root);
            if (cur.getParent() instanceof ViewGroup && ((ViewGroup) cur.getParent()).getClipChildren()) {
                l = Math.max(l, o[0]);
                t = Math.max(t, o[1]);
                r = Math.min(r, o[0] + cur.getWidth());
                b = Math.min(b, o[1] + cur.getHeight());
            }
            if (cur != v && cur instanceof ViewGroup) {
                ViewGroup g = (ViewGroup) cur;
                boolean padded = g.getPaddingLeft() != 0 || g.getPaddingTop() != 0 || g.getPaddingRight() != 0 || g.getPaddingBottom() != 0;
                if (g.getClipToPadding() && padded) {
                    l = Math.max(l, o[0] + g.getPaddingLeft());
                    t = Math.max(t, o[1] + g.getPaddingTop());
                    r = Math.min(r, o[0] + g.getWidth() - g.getPaddingRight());
                    b = Math.min(b, o[1] + g.getHeight() - g.getPaddingBottom());
                }
            }
            if (cur == root) break;
            cur = cur.getParent() instanceof View ? (View) cur.getParent() : null;
        }
        return new float[] { l, t, r, b };
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
                // 祖先造成的裁切區（clippedV 只看 view 自己，看不到祖先把它裁掉）
                float[] clip = visibleClip(v, root);
                o.put("clip", rect(clip[0], clip[1], clip[2], clip[3], density));
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
        if (v instanceof FrameLayout && name.equals("wc_stamp_hit")) {
            JSONObject o = new JSONObject();
            o.put("kind", "hit");
            o.put("id", name);
            o.put("visible", shown(v, root));
            o.put("clickable", v.hasOnClickListeners());
            float[] origin = originOf(v, root);
            o.put("box", rect(origin[0], origin[1], origin[0] + v.getWidth(), origin[1] + v.getHeight(), density));
            out.put(o);
        }
        if (v instanceof ViewGroup && name.equals("wc_rows")) {
            JSONObject o = new JSONObject();
            o.put("kind", "group");
            o.put("id", name);
            o.put("visible", shown(v, root));
            float[] origin = originOf(v, root);
            o.put("box", rect(origin[0], origin[1], origin[0] + v.getWidth(), origin[1] + v.getHeight(), density));
            out.put(o);
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) walk(g.getChildAt(i), root, density, out, outDir, caseId, bytes);
        }
    }
}
