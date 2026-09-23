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

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class RailFollowNotificationInstrumentedTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Before
    public void grantNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(
            context.getPackageName(), android.Manifest.permission.POST_NOTIFICATIONS);
        assertEquals(android.content.pm.PackageManager.PERMISSION_GRANTED,
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS));
    }

    @After
    public void cleanUp() {
        RailFollowNotification.stop(context);
        SystemClock.sleep(150);
    }

    @Test
    public void android16PostsPromotableRailProgressAndAdvancesInBackground() throws Exception {
        assertTrue("此真機 gate 需要 Android 16", Build.VERSION.SDK_INT >= 36);
        long now = System.currentTimeMillis() / 1000;
        JSONArray stops = new JSONArray()
            .put(new JSONObject().put("name", "板橋").put("arrivalAt", now - 5).put("advanceAt", now - 1)
                .put("departedAt", now - 300).put("prevStop", "萬華"))
            .put(new JSONObject().put("name", "樹林").put("arrivalAt", now + 300).put("advanceAt", now + 300)
                .put("departedAt", now).put("prevStop", "板橋"));
        JSONObject state = new JSONObject()
            .put("trainNo", "123").put("kind", "自強").put("sys", "tra_sched")
            .put("color", "#C0392B").put("nextStop", "板橋").put("prevStop", "萬華")
            .put("terminus", "花蓮").put("arrivalAt", now + 120).put("departedAt", now - 180)
            .put("advanceAt", now + 120).put("delaySec", 180).put("remainingStops", stops);
        RailFollowNotification.start(context, state);

        Notification notification = findActive();
        assertNotNull("系統沒有收到跟車通知", notification);
        Notification.Style style = Notification.Builder.recoverBuilder(context, notification).getStyle();
        assertNotNull(style);
        assertEquals(Notification.ProgressStyle.class, style.getClass());
        assertTrue("跟車通知必須具 Android 16 提升資格", notification.hasPromotableCharacteristics());
        Notification promoted = findPromoted();
        assertNotNull("Samsung 未將跟車 Live Update 提升至 Now Bar", promoted);

        RailFollowNotification.advance(context);
        JSONObject advanced = RailFollowNotification.status(context);
        assertNotNull(advanced);
        assertEquals("樹林", advanced.optString("nextStop"));
        assertEquals("板橋", advanced.optString("prevStop"));
    }

    @Test
    public void officialObservationUpdatesDelayStationAndStoppingWithoutWebView() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        JSONArray stops = new JSONArray()
            .put(new JSONObject().put("name", "板橋").put("code", "1020")
                .put("arrivalAt", now + 120).put("advanceAt", now + 150)
                .put("departedAt", now - 180).put("prevStop", "萬華"))
            .put(new JSONObject().put("name", "樹林").put("code", "1040")
                .put("arrivalAt", now + 420).put("advanceAt", now + 450)
                .put("departedAt", now + 150).put("prevStop", "板橋"));
        JSONObject state = new JSONObject().put("trainNo", "123").put("sys", "tra_sched")
            .put("nextStop", "板橋").put("arrivalAt", now + 120).put("advanceAt", now + 150)
            .put("departedAt", now - 180).put("delaySec", 60).put("remainingStops", stops)
            .put("staMap", new JSONObject().put("1030", 1));
        JSONObject live = new JSONObject().put("no", "123").put("delay", 3)
            .put("sta", "1040").put("status", 1);

        assertTrue(RailFollowNotification.applyOfficial(state, live));
        assertEquals("樹林", state.optString("nextStop"));
        assertTrue(state.optBoolean("stopping"));
        assertEquals(180, state.optInt("delaySec"));
        assertEquals("誤點差值必須套進下一站預估時刻", now + 540,
            Math.round(state.optDouble("arrivalAt")));
    }

    // ── 進站軌道（B 方案）純函式：不需要 SDK 36，API 35 也驗得到。 ──────────────────

    @Test
    public void followCarPositionCoversRunningStoppingAndNoCarCases() {
        // 沒有上一站（始發前）⇒ 不畫車。
        assertEquals(-1, RailWaitTrack.followCarPosition(false, false, false, 0, 100, 50), 0);
        // 轉乘等待中 ⇒ 不畫車，即使有上一站。
        assertEquals(-1, RailWaitTrack.followCarPosition(true, true, false, 0, 100, 50), 0);
        // 停靠中固定回 1，不看時刻。
        assertEquals(1, RailWaitTrack.followCarPosition(true, false, true, 0, 100, 30), 0);
        // 行駛中：發車→到站比例，超出範圍要夾住。
        assertEquals(0.3, RailWaitTrack.followCarPosition(true, false, false, 1000, 2000, 1300), 1e-9);
        assertEquals(0, RailWaitTrack.followCarPosition(true, false, false, 1000, 2000, 500), 0);
        assertEquals(1, RailWaitTrack.followCarPosition(true, false, false, 1000, 2000, 2500), 0);
    }

    @Test
    public void applyAdvanceRunsThenStopsThenAdvancesWhenDepAtPresent() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        // 板橋：到站 now+10、發車 now+40；樹林：到站 now+300。
        JSONArray stops = new JSONArray()
            .put(new JSONObject().put("name", "板橋").put("arrivalAt", now + 10).put("depAt", now + 40))
            .put(new JSONObject().put("name", "樹林").put("arrivalAt", now + 300).put("depAt", now + 330)
                .put("advanceAt", now + 300));
        JSONObject state = new JSONObject().put("nextStop", "板橋").put("arrivalAt", now + 10)
            .put("stopping", false).put("remainingStops", stops);

        // 還沒到本站：不動。
        assertTrue(RailFollowNotification.applyAdvance(state, now));
        assertFalse(state.optBoolean("stopping"));
        assertEquals("板橋", state.optString("nextStop"));

        // 已到本站、還沒發車：停靠中，仍顯示本站。
        assertTrue(RailFollowNotification.applyAdvance(state, now + 20));
        assertTrue(state.optBoolean("stopping"));
        assertEquals("板橋", state.optString("nextStop"));

        // 已過發車時刻：換下一站。
        assertTrue(RailFollowNotification.applyAdvance(state, now + 50));
        assertEquals("樹林", state.optString("nextStop"));
        assertEquals("板橋", state.optString("prevStop"));
        assertFalse(state.optBoolean("stopping"));
        assertEquals("換站時 departedAt 要接上本站的 depAt", now + 40, state.optDouble("departedAt"), 0);
    }

    @Test
    public void applyAdvanceReturnsFalseWhenNoMoreStopsAfterCurrent() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        JSONArray stops = new JSONArray()
            .put(new JSONObject().put("name", "花蓮").put("arrivalAt", now - 10).put("depAt", now - 5));
        JSONObject state = new JSONObject().put("nextStop", "花蓮").put("arrivalAt", now - 10)
            .put("remainingStops", stops);
        assertFalse("終點站發車後沒有下一站可換 ⇒ 收班", RailFollowNotification.applyAdvance(state, now));
    }

    @Test
    public void applyAdvanceLegacyPayloadWithoutDepAtMatchesPreviousBehavior() throws Exception {
        // 完全比照 android16PostsPromotableRailProgressAndAdvancesInBackground 的資料，
        // 但這裡只驗純函式本身（不必連 SDK 36 的通知一起測）。
        long now = System.currentTimeMillis() / 1000;
        JSONArray stops = new JSONArray()
            .put(new JSONObject().put("name", "板橋").put("arrivalAt", now - 5).put("advanceAt", now - 1)
                .put("departedAt", now - 300).put("prevStop", "萬華"))
            .put(new JSONObject().put("name", "樹林").put("arrivalAt", now + 300).put("advanceAt", now + 300)
                .put("departedAt", now).put("prevStop", "板橋"));
        JSONObject state = new JSONObject().put("nextStop", "板橋").put("arrivalAt", now + 120)
            .put("remainingStops", stops);
        assertTrue(RailFollowNotification.applyAdvance(state, now));
        assertEquals("樹林", state.optString("nextStop"));
        assertEquals("板橋", state.optString("prevStop"));
        assertEquals(now + 300, state.optDouble("arrivalAt"), 0);
        assertEquals(now, state.optDouble("departedAt"), 0);
        assertFalse(state.optBoolean("stopping"));
    }

    @Test
    public void moveTickEligibleGatesOnSystemAssetPrevStopTransferAndStopping() throws Exception {
        JSONObject base = new JSONObject().put("sys", "tra_sched").put("carModel", "emu3000")
            .put("prevStop", "板橋");
        assertTrue("台鐵、有素材、有上一站、非停靠 ⇒ 需要重貼",
            RailFollowNotification.moveTickEligible(base));

        assertFalse("其他系統不畫進站軌道",
            RailFollowNotification.moveTickEligible(new JSONObject(base.toString()).put("sys", "trtc")));
        assertFalse("沒有素材的車型不畫車",
            RailFollowNotification.moveTickEligible(new JSONObject(base.toString()).put("carModel", "no-such")));
        assertFalse("始發前（沒有上一站）不畫車",
            RailFollowNotification.moveTickEligible(new JSONObject(base.toString()).put("prevStop", "")));
        assertFalse("轉乘等待中不畫車",
            RailFollowNotification.moveTickEligible(new JSONObject(base.toString()).put("transferWaiting", true)));
        assertFalse("停靠中車已經在站牌旁，不必再挪",
            RailFollowNotification.moveTickEligible(new JSONObject(base.toString()).put("stopping", true)));

        // shouldTickMove 額外疊了 SDK 檢查；在這台 API 35 模擬器上恆為 false。
        if (Build.VERSION.SDK_INT < 36) {
            assertFalse("API 35 沒有 ProgressStyle，恆不排 20 秒鬧鐘",
                RailFollowNotification.shouldTickMove(base));
        }
    }

    // ── 進站軌道（B 方案）Android 16 真機 gate：API 35 上結構性只能 Assume-skip，
    //    同檔既有的 postTrack／postTraTrack 系列（RailWaitNotificationInstrumentedTest）也是同樣待遇；
    //    上面的純函式測試才是這台模擬器驗得到的部分。 ──────────────────

    @Test
    public void android16FollowTrackSplitsAtCarHeadWithNoPoint() throws Exception {
        Notification.ProgressStyle p = (Notification.ProgressStyle) postFollowTrack(200, 1400, "emu3000");
        assertEquals("跟車卡不再用方塊", 0, p.getProgressPoints().size());
        assertEquals("分段在車頭切開：車後灰、車前路線色", 2, p.getProgressSegments().size());
        assertEquals(0xFFC0392B, p.getProgressSegments().get(1).getColor());
        assertNotNull(p.getProgressStartIcon());
        assertNotNull(p.getProgressEndIcon());
        assertNotNull(p.getProgressTrackerIcon());
    }

    @Test
    public void android16FollowTrackStoppingIsFullGrayAtPlate() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        JSONObject state = baseFollowState("emu3000").put("stopping", true)
            .put("arrivalAt", now - 60).put("departedAt", now - 300);
        Notification.ProgressStyle p = (Notification.ProgressStyle) post(state);
        assertEquals("停靠中：整條都走過了", 1, p.getProgressSegments().size());
        assertNotNull("停靠中車仍要畫在站牌旁", p.getProgressTrackerIcon());
    }

    @Test
    public void android16FollowTrackDrawsNoCarWithoutPrevStopOrWhileTransferWaiting() throws Exception {
        Notification.ProgressStyle noPrev =
            (Notification.ProgressStyle) post(baseFollowState("emu3000").put("prevStop", ""));
        assertEquals("始發前不畫車：只剩軌道", null, noPrev.getProgressTrackerIcon());
        assertNotNull(noPrev.getProgressStartIcon());
        assertNotNull(noPrev.getProgressEndIcon());

        Notification.ProgressStyle transferring =
            (Notification.ProgressStyle) post(baseFollowState("emu3000").put("transferWaiting", true));
        assertEquals("轉乘等待中不畫車", null, transferring.getProgressTrackerIcon());
    }

    @Test
    public void android16FollowTrackFallsBackToGenericStyleWithoutCarAsset() throws Exception {
        Notification.ProgressStyle noModel = (Notification.ProgressStyle) post(baseFollowState(null));
        assertTrue("沒有車型素材：維持通用進度樣式（帶終點方塊）", noModel.isStyledByProgress());
        assertEquals(1, noModel.getProgressPoints().size());

        JSONObject metro = baseFollowState("emu3000").put("sys", "trtc");
        assertTrue("非台鐵／高鐵：維持通用進度樣式",
            ((Notification.ProgressStyle) post(metro)).isStyledByProgress());
    }

    /** 走真的 start()→鬧鐘→本機重貼：車在區間內時約 20 秒重貼一次，車頭要真的往前挪。 */
    @Test
    public void android16FollowTrackMovesOnLocalTick() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 36);
        long now = System.currentTimeMillis() / 1000;
        JSONArray stops = new JSONArray()
            .put(new JSONObject().put("name", "樹林").put("arrivalAt", now + 3600).put("depAt", now + 3630));
        RailFollowNotification.start(context, new JSONObject()
            .put("trainNo", "123").put("kind", "自強").put("sys", "tra_sched").put("carModel", "emu3000")
            .put("color", "#C0392B").put("nextStop", "樹林").put("prevStop", "板橋")
            .put("terminus", "花蓮").put("arrivalAt", now + 3600).put("departedAt", now - 60)
            .put("remainingStops", stops));
        int first = currentProgress();
        long t0 = SystemClock.uptimeMillis();
        int later = first;
        while (later == first && SystemClock.uptimeMillis() - t0 < 50_000) {
            SystemClock.sleep(1_000);
            later = currentProgress();
        }
        Log.i("RailFollowTrackTest", "local tick progress " + first + " -> " + later);
        assertTrue("本機重貼之後車要往前走：" + first + " → " + later, later > first);
    }

    private int currentProgress() {
        Notification n = findActive();
        assertNotNull(n);
        return ((Notification.ProgressStyle) Notification.Builder.recoverBuilder(context, n).getStyle()).getProgress();
    }

    private JSONObject baseFollowState(String carModel) throws Exception {
        long now = System.currentTimeMillis() / 1000;
        JSONObject state = new JSONObject()
            .put("trainNo", "123").put("kind", "自強").put("sys", "tra_sched")
            .put("color", "#C0392B").put("nextStop", "板橋").put("prevStop", "萬華")
            .put("terminus", "花蓮").put("arrivalAt", now + 400).put("departedAt", now - 200)
            .put("remainingStops", new JSONArray());
        if (carModel != null) state.put("carModel", carModel);
        return state;
    }

    // 🔴 輔助函式的簽名不准出現 Notification.ProgressStyle（API 36 才有）：JUnit 掃方法時會解析簽名型別，
    //    API 35 以下整個類別載入失敗（同 RailWaitNotificationInstrumentedTest 的既有註解）。
    //    方法內文的區域變數不受影響。
    private Notification.Style postFollowTrack(long departedOffsetSec, long arrivalOffsetSec,
            String carModel) throws Exception {
        long now = System.currentTimeMillis() / 1000;
        JSONObject state = baseFollowState(carModel)
            .put("departedAt", now - departedOffsetSec).put("arrivalAt", now + arrivalOffsetSec);
        return post(state);
    }

    /** 貼出一張跟車通知並取回其 style；SDK &lt; 36 直接 Assume-skip（結構性驗不到）。 */
    private Notification.Style post(JSONObject state) throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 36);
        RailFollowNotification.start(context, state);
        Notification n = findActive();
        assertNotNull("系統沒有收到跟車通知", n);
        Notification.Style style = Notification.Builder.recoverBuilder(context, n).getStyle();
        assertEquals(Notification.ProgressStyle.class, style.getClass());
        return style;
    }

    private Notification findActive() {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull(manager);
        long deadline = SystemClock.uptimeMillis() + 750;
        do {
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (active.getId() == RailFollowNotification.NOTIFICATION_ID) return active.getNotification();
            }
            SystemClock.sleep(25);
        } while (SystemClock.uptimeMillis() < deadline);
        return null;
    }

    private Notification findPromoted() {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull(manager);
        long deadline = SystemClock.uptimeMillis() + 3000;
        do {
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                Notification notification = active.getNotification();
                if (active.getId() == RailFollowNotification.NOTIFICATION_ID
                    && (notification.flags & Notification.FLAG_PROMOTED_ONGOING) != 0) {
                    return notification;
                }
            }
            SystemClock.sleep(50);
        } while (SystemClock.uptimeMillis() < deadline);
        return null;
    }
}
