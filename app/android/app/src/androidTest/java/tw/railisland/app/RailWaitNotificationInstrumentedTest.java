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
