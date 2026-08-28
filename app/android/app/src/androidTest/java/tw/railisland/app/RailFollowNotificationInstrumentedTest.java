package tw.railisland.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
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
