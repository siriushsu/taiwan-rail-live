package tw.railisland.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Android 16 真機 gate：不能只證明 Java 編得過，必須證明系統收到的真的是可提升 ProgressStyle。 */
@RunWith(AndroidJUnit4.class)
public final class RailWaitNotificationInstrumentedTest {
    private static final String TAG = "RailWaitNowBarTest";

    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @After
    public void cleanUp() {
        RailWaitNotification.stop(context);
        // NotificationManager 的 cancel 是非同步的；避免下一個案例沿用同一 ID 時被前次 cancel 清掉。
        SystemClock.sleep(150);
    }

    @Test
    public void android16TimedEtaPostsPromotableProgressStyle() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 36);
        Assume.assumeTrue(RailWaitNotification.canNotify(context));

        long now = System.currentTimeMillis();
        JSONObject state = new JSONObject()
            .put("active", true)
            .put("sys", "trtc")
            .put("station", "忠孝復興")
            .put("lineLabel", "板南線")
            .put("color", "#0070BD")
            .put("nextDest", "南港展覽館")
            .put("nextEta", (now + 5 * 60_000L) / 1000.0)
            .put("secondDest", "昆陽")
            .put("secondEta", (now + 11 * 60_000L) / 1000.0)
            .put("dataAt", now / 1000.0)
            .put("endAt", (now + 30 * 60_000L) / 1000.0);

        RailWaitNotification.createChannel(context);
        RailWaitNotification.post(context, state);

        Notification notification = findActiveNotification();
        assertNotNull("系統沒有收到等車通知", notification);
        Notification.Style style = Notification.Builder.recoverBuilder(context, notification).getStyle();
        assertNotNull("通知沒有原生 style", style);
        assertEquals(Notification.ProgressStyle.class, style.getClass());
        assertTrue("Android 16 判定這張通知不具提升資格", notification.hasPromotableCharacteristics());
        assertTrue("等車通知必須是 ongoing", (notification.flags & Notification.FLAG_ONGOING_EVENT) != 0);

        JSONObject promotion = RailWaitNotification.promotionStatus(context);
        Log.i(TAG, "promotion=" + promotion);
        assertTrue("promotionStatus 沒讀到通知資格", promotion.optBoolean("eligible"));
    }

    @Test
    public void android16MinuteOnlyEtaStaysHonestAndPromotable() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 36);
        Assume.assumeTrue(RailWaitNotification.canNotify(context));

        long now = System.currentTimeMillis();
        JSONObject state = new JSONObject()
            .put("active", true)
            .put("sys", "krtc")
            .put("station", "美麗島")
            .put("lineLabel", "紅線")
            .put("color", "#E4002B")
            .put("nextDest", "岡山車站")
            .put("nextMinutes", 4)
            .put("dataAt", now / 1000.0)
            .put("endAt", (now + 30 * 60_000L) / 1000.0);

        RailWaitNotification.createChannel(context);
        RailWaitNotification.post(context, state);

        Notification notification = findActiveNotification();
        assertNotNull("系統沒有收到分鐘級等車通知", notification);
        Notification.Style style = Notification.Builder.recoverBuilder(context, notification).getStyle();
        assertNotNull("分鐘級通知沒有原生 style", style);
        assertEquals(Notification.ProgressStyle.class, style.getClass());
        Notification.ProgressStyle progress = (Notification.ProgressStyle) style;
        assertTrue("只有分鐘級資料時必須用不定進度，不能偽造秒級 ETA", progress.isProgressIndeterminate());
        assertTrue("分鐘級通知也應具提升資格", notification.hasPromotableCharacteristics());

        JSONObject promotion = RailWaitNotification.promotionStatus(context);
        Log.i(TAG, "minuteOnlyPromotion=" + promotion);
        assertTrue("分鐘級通知未被 Samsung 提升至 Now Bar", promotion.optBoolean("promoted"));
    }

    @Test
    public void android16TraWaitShowsClockTimeWithoutFakeCountdown() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 36);
        Assume.assumeTrue(RailWaitNotification.canNotify(context));

        long now = System.currentTimeMillis();
        JSONObject state = new JSONObject()
            .put("active", true)
            .put("kind", RailWaitNotification.KIND_TRA)
            .put("station", "板橋")
            .put("trainNo", "123")
            .put("trainType", "自強")
            .put("dest", "花蓮")
            .put("color", "#C0392B")
            .put("schedSec", (now + 12 * 60_000L) / 1000.0)
            .put("delayMin", 3)
            .put("dataAt", now / 1000.0)
            .put("endAt", (now + 60 * 60_000L) / 1000.0);

        RailWaitNotification.post(context, state);

        Notification notification = findActiveNotification();
        assertNotNull("系統沒有收到台鐵等站通知", notification);
        Notification.Builder recovered = Notification.Builder.recoverBuilder(context, notification);
        assertEquals(Notification.ProgressStyle.class, recovered.getStyle().getClass());
        assertTrue("台鐵等站卡必須是 ongoing", (notification.flags & Notification.FLAG_ONGOING_EVENT) != 0);
        assertFalse("台鐵等站卡不准用 chronometer 偽造秒級倒數",
            notification.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER, false));
        String text = String.valueOf(notification.extras.getCharSequence(Notification.EXTRA_TEXT));
        assertTrue("台鐵等站卡必須標明實際約到站", text.contains("實際約"));
        assertTrue("台鐵等站卡必須保留目的地", text.contains("花蓮"));
        assertTrue("台鐵等站卡應具提升資格", notification.hasPromotableCharacteristics());
    }

    @Test
    public void traWaitOwnsSharedSlotAndUsesBoundedEndTime() throws Exception {
        long before = System.currentTimeMillis();
        double schedSec = before / 1000.0 + 12 * 60;
        JSONObject tra = new JSONObject()
            .put("station", "板橋")
            .put("trainNo", "123")
            .put("trainType", "自強")
            .put("dest", "花蓮")
            .put("schedSec", schedSec)
            .put("delayMin", 3);

        long endAt = RailWaitNotification.startTra(context, tra);
        JSONObject active = RailWaitNotification.status(context);
        assertNotNull("台鐵等站狀態沒有保存", active);
        assertEquals("共用等車卡必須標記成台鐵模式", RailWaitNotification.KIND_TRA,
            active.optString("kind"));
        assertEquals("台鐵等站卡沒有保留指定車次", "123", active.optString("trainNo"));
        long expected = (long) ((schedSec + 3 * 60 + 30 * 60) * 1000);
        assertTrue("台鐵等站結束時間沒有依抵達時間加 30 分鐘",
            Math.abs(endAt - expected) < 2_000L);

        JSONObject metro = new JSONObject()
            .put("station", "忠孝復興")
            .put("durationMin", 30);
        RailWaitNotification.start(context, metro);
        JSONObject replaced = RailWaitNotification.status(context);
        assertNotNull("捷運等車狀態沒有保存", replaced);
        assertEquals("啟動捷運卡後必須取代同一槽位的台鐵卡", RailWaitNotification.KIND_METRO,
            replaced.optString("kind"));
    }

    // ── 進站軌道（B 方案）──────────────────────────────────────────────
    // 期望值直接寫字面量（上一站、站間秒、路線色），不呼叫 RailWaitTrack 產生「期望」。
    // `-e holdMs 7000`：貼完停在畫面上，給主機端 adb screencap 截圖用；不帶就不停。

    @Test
    public void trackHopLookupMatchesCatalogOrder() throws Exception {
        MetroWidgetData.Catalog catalog = MetroWidgetData.catalog(context);
        RailWaitTrack.Hop h = RailWaitTrack.hop(catalog, "trtc", "台北車站", "象山");
        assertNotNull("台北車站往象山要查得到上一站", h);
        assertEquals("中山", h.prev);
        assertEquals(68.0, h.runSec, 0.001);
        assertEquals("淡水信義線", h.lineName);
        assertEquals("#E3002C", h.color);
        RailWaitTrack.Hop bl = RailWaitTrack.hop(catalog, "trtc", "台北車站", "頂埔");
        assertNotNull(bl);
        assertEquals("善導寺", bl.prev);
        assertEquals(R.drawable.la_side_c321, bl.carDrawable());
        RailWaitTrack.Hop br = RailWaitTrack.hop(catalog, "trtc", "忠孝復興", "動物園");
        assertNotNull(br);
        assertEquals("南京復興", br.prev);
        assertEquals(R.drawable.la_side_val256, br.carDrawable());
        RailWaitTrack.Hop o = RailWaitTrack.hop(catalog, "trtc", "古亭", "南勢角");
        assertNotNull("共線段兩條支線上一站相同，不算歧義", o);
        assertEquals("東門", o.prev);
        assertEquals("中和新蘆線", o.lineName);
        RailWaitTrack.Hop y = RailWaitTrack.hop(catalog, "trtc", "十四張", "新北產業園區");
        assertNotNull(y);
        assertEquals("大坪林", y.prev);
        assertEquals(R.drawable.la_side_y100, y.carDrawable());
        assertNotNull("官方帶「站」尾綴的終點也要對得回目錄", RailWaitTrack.hop(catalog, "trtc", "台北車站", "象山站"));
        assertEquals("兩條線上一站不同 ⇒ 不猜", null, RailWaitTrack.hop(catalog, "trtc", "忠孝復興", "南港展覽館"));
        assertEquals("兩條支線各自一站 ⇒ 不猜", null, RailWaitTrack.hop(catalog, "trtc", "大橋頭", "南勢角"));
        assertEquals("本站是起點 ⇒ 沒有上一站", null, RailWaitTrack.hop(catalog, "trtc", "淡水", "象山"));
        assertEquals("分鐘級系統不畫車", null, RailWaitTrack.hop(catalog, "krtc", "哈瑪星", "小港"));
    }

    @Test
    public void android16TrackRunning() throws Exception {
        Notification.ProgressStyle p = (Notification.ProgressStyle) postTrack(40, false);
        assertNotNull("行駛中：左端是上一站", p.getProgressStartIcon());
        assertNotNull("行駛中：右端是本站站牌", p.getProgressEndIcon());
        assertNotNull("行駛中：要畫車", p.getProgressTrackerIcon());
        assertFalse("分段顏色自己給，不讓系統依進度淡化", p.isStyledByProgress());
        assertEquals("走過的灰＋剩下的路線色", 2, p.getProgressSegments().size());
        assertEquals(0xFFE3002C, p.getProgressSegments().get(1).getColor());
        assertTrackerNotCropped(p);
        assertTextHas("中山 → 台北車站");
        hold();
    }

    @Test
    public void android16TrackNotYetAtPrev() throws Exception {
        Notification.ProgressStyle p = (Notification.ProgressStyle) postTrack(200, false);
        assertEquals("還沒到上一站：上一站改畫成進度條上的點", null, p.getProgressStartIcon());
        assertEquals(1, p.getProgressPoints().size());
        assertNotNull(p.getProgressTrackerIcon());
        assertTrue("車要在上一站左邊", p.getProgress() < p.getProgressPoints().get(0).getPosition());
        hold();
    }

    @Test
    public void android16TrackArriving() throws Exception {
        Notification.ProgressStyle p = (Notification.ProgressStyle) postTrack(-5, false);
        assertNotNull(p.getProgressTrackerIcon());
        assertEquals("進站：整段都走過了", 1, p.getProgressSegments().size());
        hold();
    }

    @Test
    public void android16TrackOfflineDrawsNoCar() throws Exception {
        Notification.ProgressStyle p = (Notification.ProgressStyle) postTrack(40, true);
        assertEquals("抓不到資料就不畫車", null, p.getProgressTrackerIcon());
        assertNotNull(p.getProgressStartIcon());
        assertNotNull(p.getProgressEndIcon());
        hold();
    }

    @Test
    public void android16AmbiguousHopKeepsLegacyProgress() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 36);
        Assume.assumeTrue(RailWaitNotification.canNotify(context));
        long now = System.currentTimeMillis();
        RailWaitNotification.createChannel(context);
        RailWaitNotification.post(context, new JSONObject()
            .put("active", true).put("sys", "trtc").put("station", "忠孝復興").put("lineLabel", "板南線")
            .put("color", "#0070BD").put("nextDest", "南港展覽館").put("nextEta", (now + 40_000L) / 1000.0)
            .put("dataAt", now / 1000.0).put("endAt", (now + 30 * 60_000L) / 1000.0));
        Notification n = findActiveNotification();
        assertNotNull(n);
        Notification.ProgressStyle p = (Notification.ProgressStyle) Notification.Builder.recoverBuilder(context, n).getStyle();
        assertEquals("上一站有歧義 ⇒ 維持原本的進度條（沒有兩端圖示）", null, p.getProgressStartIcon());
        assertTrue(p.isStyledByProgress());
    }

    /** 走真的 start()→鬧鐘→refreshAsync：車在區間內時約 20 秒本機重貼一次，車要真的往前挪。 */
    @Test
    public void android16TrackMovesOnLocalTick() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 36);
        Assume.assumeTrue(RailWaitNotification.canNotify(context));
        long now = System.currentTimeMillis();
        // fetchedAt＝剛抓過 ⇒ 接下來 55 秒內的鬧鐘只重貼、不上網（結果不受當下官方資料影響）。
        RailWaitNotification.start(context, new JSONObject()
            .put("sys", "trtc").put("station", "台北車站").put("lineLabel", "淡水信義線")
            .put("color", "#E3002C").put("nextDest", "象山").put("nextEta", now / 1000.0 + 60)
            .put("dataAt", now / 1000.0).put("fetchedAt", now).put("durationMin", 30));
        int first = currentProgress();
        // 鬧鐘是非精確的（setAndAllowWhileIdle）：要 20 秒，系統可延到約 35 秒。等「車動了」這個訊號，
        // 不等固定秒數；50 秒還沒動才算紅。
        long t0 = SystemClock.uptimeMillis();
        int later = first;
        while (later == first && SystemClock.uptimeMillis() - t0 < 50_000) {
            SystemClock.sleep(1_000);
            later = currentProgress();
        }
        Log.i(TAG, "local tick progress " + first + " -> " + later + " after "
            + (SystemClock.uptimeMillis() - t0) + " ms");
        assertTrue("本機重貼之後車要往前走：" + first + " → " + later, later > first);
    }

    private int currentProgress() {
        Notification n = findActiveNotification();
        assertNotNull(n);
        return ((Notification.ProgressStyle) Notification.Builder.recoverBuilder(context, n).getStyle()).getProgress();
    }

    // 🔴 輔助函式的簽名不准出現 Notification.ProgressStyle（API 36 才有）：JUnit 掃方法時會解析簽名型別，
    //    API 35 以下整個類別載入失敗，連不需要 Android 16 的測試也跑不了（09-23 在 API 35 模擬器實見）。
    //    方法內文的區域變數不受影響，那些測試開頭有 Assume 擋住。
    private Notification.Style postTrack(long etaOffsetSec, boolean offline) throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 36);
        Assume.assumeTrue(RailWaitNotification.canNotify(context));
        long now = System.currentTimeMillis();
        JSONObject state = new JSONObject()
            .put("active", true)
            .put("sys", "trtc")
            .put("station", "台北車站")
            .put("lineLabel", "淡水信義線")
            .put("color", "#E3002C")
            .put("nextDest", "象山")
            .put("nextEta", now / 1000.0 + etaOffsetSec)
            .put("secondDest", "大安")
            .put("secondEta", now / 1000.0 + etaOffsetSec + 300)
            .put("crowd", new org.json.JSONArray("[1,1,2,1,1,1]"))
            .put("dataAt", now / 1000.0)
            .put("endAt", (now + 30 * 60_000L) / 1000.0);
        if (offline) state.put("trackOffline", true);
        RailWaitNotification.createChannel(context);
        RailWaitNotification.post(context, state);
        Notification n = findActiveNotification();
        assertNotNull("系統沒有收到等車通知", n);
        assertTrue("進站軌道也要具提升資格", n.hasPromotableCharacteristics());
        Notification.Style style = Notification.Builder.recoverBuilder(context, n).getStyle();
        assertEquals(Notification.ProgressStyle.class, style.getClass());
        Log.i(TAG, "track eta+" + etaOffsetSec + " offline=" + offline + " promotion="
            + RailWaitNotification.promotionStatus(context));
        return style;
    }

    /**
     * 站牌深色版＝同一塊白瓷壓暗一階（09-23 使用者裁示；網站那組深藍瓷放在黑灰卡片上不搭）。
     * 深色靠 createConfigurationContext 切，不動手機的系統深色設定（別的 session 可能正在用這支手機）。
     * 兩張圖存在 cache/plate-{light,dark}.png，可用 run-as 拉出來看。
     */
    @Test
    public void plateStaysEnamelInDarkMode() throws Exception {
        RailWaitTrack.Hop hop = RailWaitTrack.hop(context, "trtc", "台北車站", "象山");
        assertNotNull(hop);
        int[] face = new int[2];
        for (int i = 0; i < 2; i++) {
            android.content.res.Configuration conf =
                new android.content.res.Configuration(context.getResources().getConfiguration());
            conf.uiMode = (conf.uiMode & ~android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                | (i == 1 ? android.content.res.Configuration.UI_MODE_NIGHT_YES
                          : android.content.res.Configuration.UI_MODE_NIGHT_NO);
            Context c = context.createConfigurationContext(conf);
            android.graphics.drawable.Drawable d =
                RailWaitTrack.style(c, hop, 0.5, "#E3002C").getProgressEndIcon().loadDrawable(c);
            int w = d.getIntrinsicWidth(), h = d.getIntrinsicHeight();
            android.graphics.Bitmap b = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888);
            d.setBounds(0, 0, w, h);
            d.draw(new android.graphics.Canvas(b));
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(
                    new java.io.File(context.getCacheDir(), "plate-" + (i == 1 ? "dark" : "light") + ".png"))) {
                b.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
            }
            // 瓷面取樣點：「站」字左側、色帶上方（字約佔寬度中間一半，色帶從 68% 高開始）。
            face[i] = b.getPixel(Math.round(w * 0.15f), Math.round(h * 0.45f));
        }
        for (int px : face) {
            assertTrue("站牌瓷面要是白瓷（淺色），深色模式也一樣：#" + Integer.toHexString(px),
                android.graphics.Color.red(px) > 190 && android.graphics.Color.green(px) > 190
                    && android.graphics.Color.blue(px) > 180);
        }
        assertTrue("深色版要比淺色版壓暗一階：淺 #" + Integer.toHexString(face[0]) + " 深 #" + Integer.toHexString(face[1]),
            android.graphics.Color.red(face[1]) < android.graphics.Color.red(face[0]));
    }

    /** 系統 tracker 寬最多 2 倍高，超過的會被從中間裁掉（車頭車尾不見）。 */
    private void assertTrackerNotCropped(Notification.Style style) {
        Notification.ProgressStyle p = (Notification.ProgressStyle) style;
        android.graphics.drawable.Drawable d = p.getProgressTrackerIcon().loadDrawable(context);
        assertNotNull(d);
        assertTrue("車模圖寬高比 " + d.getIntrinsicWidth() + "×" + d.getIntrinsicHeight() + " 超過 2:1 會被裁",
            d.getIntrinsicWidth() <= 2 * d.getIntrinsicHeight());
    }

    private void assertTextHas(String needle) {
        Notification n = findActiveNotification();
        String text = String.valueOf(n.extras.getCharSequence(Notification.EXTRA_TEXT));
        assertTrue("內文要寫站名：" + text, text.contains(needle));
    }

    private void hold() {
        String raw = InstrumentationRegistry.getArguments().getString("holdMs");
        if (raw != null) SystemClock.sleep(Long.parseLong(raw));
    }

    private Notification findActiveNotification() {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull("NotificationManager 不存在", manager);
        long deadline = SystemClock.uptimeMillis() + 750;
        do {
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (active.getId() == RailWaitNotification.NOTIFICATION_ID) return active.getNotification();
            }
            SystemClock.sleep(25);
        } while (SystemClock.uptimeMillis() < deadline);
        return null;
    }
}
