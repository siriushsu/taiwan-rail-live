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
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** 1.5.0 三語 gate：網頁切語言後，三種小工具與兩類 Android 即時卡也必須一起切。 */
@RunWith(AndroidJUnit4.class)
public final class NativeLocalizationInstrumentedTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Before
    public void grantNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(
                context.getPackageName(), android.Manifest.permission.POST_NOTIFICATIONS);
        }
    }

    @After
    public void cleanUp() {
        RailWaitNotification.stop(context);
        RailFollowNotification.stop(context);
        RailNativeL10n.setLanguage(context, "zh-TW");
        SystemClock.sleep(120);
    }

    @Test
    public void catalogUsesOfficialNamesAndSafeTraditionalChineseFallback() {
        assertTrue(RailNativeL10n.setLanguage(context, "en"));
        assertEquals("Banqiao", RailNativeL10n.name(context, "板橋"));
        assertEquals("Bannan Line", RailNativeL10n.name(context, "板南線"));
        assertEquals("Unknown Test Station", RailNativeL10n.name(context, "Unknown Test Station"));
        assertEquals("3 min late", RailNativeL10n.text(context, "誤點 {n} 分", "n", "3"));

        assertTrue(RailNativeL10n.setLanguage(context, "ja"));
        assertEquals("南港展覧館", RailNativeL10n.name(context, "南港展覽館"));
        assertEquals("自強号 123列車", RailNativeL10n.text(context, "{trainType} {trainNo} 次列車",
            "trainType", RailNativeL10n.name(context, "自強"), "trainNo", "123"));
    }

    @Test
    public void allThreeWidgetsRenderEnglishAndJapaneseWithoutReconfiguration() {
        long now = System.currentTimeMillis();
        RailWidgetData.Snapshot rail = railSnapshot(now);
        MetroWidgetData.Snapshot metro = metroSnapshot(now);
        FrameLayout host = new FrameLayout(context);

        RailNativeL10n.setLanguage(context, "en");
        View railEn = RailWidgetRender.board(context, R.layout.widget_rail_4x2, rail, 3, false, false)
            .apply(context, host);
        assertEquals("Banqiao departures", text(railEn, R.id.wr_head));
        assertTrue(text(railEn, R.id.wrr_dest).contains("Hualien"));

        View mixedEn = MixedWidgetRender.board(context, rail, metro).apply(context, host);
        assertEquals("Banqiao dual board", text(mixedEn, R.id.wmx_head));
        assertEquals("Metro · Taipei Metro · Banqiao", text(mixedEn, R.id.wmx_metro_head));

        MetroWidgetPlate.Input input = new MetroWidgetPlate.Input();
        input.texts = RailNativeL10n.plateTexts(context);
        input.nowEpochSec = now / 1000.0;
        input.station = "板橋";
        input.lineLabel = "板南線";
        input.dest = "南港展覽館";
        input.etaEpochSec = input.nowEpochSec + 240;
        input.dataAtEpochSec = input.nowEpochSec;
        View metroEn = MetroWidgetPlateRender.plate(context, R.layout.widget_plate_4x2,
            MetroWidgetPlate.of(input)).apply(context, host);
        assertEquals("Banqiao", text(metroEn, R.id.wg_station));
        assertEquals("Bannan Line", text(metroEn, R.id.wg_line));
        assertEquals("To Taipei Nangang Exhibition Center", text(metroEn, R.id.wg_dest));

        RailNativeL10n.setLanguage(context, "ja");
        View railJa = RailWidgetRender.board(context, R.layout.widget_rail_4x2, rail, 3, false, false)
            .apply(context, host);
        assertEquals("板橋・発車案内", text(railJa, R.id.wr_head));
        View mixedJa = MixedWidgetRender.board(context, rail, metro).apply(context, host);
        assertEquals("板橋・二面案内", text(mixedJa, R.id.wmx_head));
    }

    @Test
    public void waitAndFollowNotificationsRefreshInSelectedLanguage() throws Exception {
        long now = System.currentTimeMillis();
        RailNativeL10n.setLanguage(context, "en");
        JSONObject wait = new JSONObject()
            .put("active", true).put("sys", "trtc").put("station", "忠孝復興")
            .put("lineLabel", "板南線").put("nextDest", "南港展覽館")
            .put("nextMinutes", 4).put("dataAt", now / 1000.0)
            .put("endAt", (now + 30 * 60_000L) / 1000.0);
        RailWaitNotification.createChannel(context);
        RailWaitNotification.post(context, wait);
        Notification waitEn = find(RailWaitNotification.NOTIFICATION_ID);
        assertNotNull(waitEn);
        assertEquals("Zhongxiao Fuxing", String.valueOf(
            waitEn.extras.getCharSequence(Notification.EXTRA_TITLE)));
        assertTrue(String.valueOf(waitEn.extras.getCharSequence(Notification.EXTRA_TEXT))
            .contains("To Taipei Nangang Exhibition Center"));
        assertEquals("End", String.valueOf(waitEn.actions[0].title));

        JSONObject follow = new JSONObject()
            .put("trainNo", "123").put("kind", "自強").put("nextStop", "板橋")
            .put("prevStop", "萬華").put("terminus", "花蓮")
            .put("arrivalAt", (now + 5 * 60_000L) / 1000.0)
            .put("departedAt", (now - 5 * 60_000L) / 1000.0).put("delaySec", 180);
        RailFollowNotification.post(context, follow);
        Notification followEn = find(RailFollowNotification.NOTIFICATION_ID);
        assertNotNull(followEn);
        assertTrue(String.valueOf(followEn.extras.getCharSequence(Notification.EXTRA_TITLE))
            .contains("Tze-Chiang Limited Express"));
        assertTrue(String.valueOf(followEn.extras.getCharSequence(Notification.EXTRA_TEXT))
            .contains("Next stop Banqiao"));
        assertEquals("End following", String.valueOf(followEn.actions[0].title));

        RailNativeL10n.setLanguage(context, "ja");
        RailWaitNotification.post(context, wait);
        Notification waitJa = findWithText(RailWaitNotification.NOTIFICATION_ID, "南港展覧館方面");
        assertNotNull(waitJa);
        assertTrue(String.valueOf(waitJa.extras.getCharSequence(Notification.EXTRA_TEXT))
            .contains("南港展覧館方面"));
        assertEquals("終了", String.valueOf(waitJa.actions[0].title));
    }

    private RailWidgetData.Snapshot railSnapshot(long now) {
        RailWidgetData.Snapshot rail = new RailWidgetData.Snapshot();
        rail.sys = "tra"; rail.systemLabel = "台鐵"; rail.origin = "板橋"; rail.generatedAt = now;
        RailWidgetData.Row train = new RailWidgetData.Row();
        train.sys = "tra"; train.no = "123"; train.type = "自強"; train.color = "#C0392B";
        train.terminus = "花蓮"; train.relation = RailWidgetData.Relation.DEPARTURE;
        train.scheduledAt = now + 10 * 60_000L; train.delayMinutes = 0;
        rail.rows.add(train);
        return rail;
    }

    private MetroWidgetData.Snapshot metroSnapshot(long now) {
        MetroWidgetData.Snapshot metro = new MetroWidgetData.Snapshot();
        metro.sys = "trtc"; metro.systemLabel = "台北捷運"; metro.station = "板橋";
        metro.precision = "seconds"; metro.dataAt = now / 1000.0;
        MetroWidgetData.Row arrival = new MetroWidgetData.Row();
        arrival.dest = "南港展覽館"; arrival.eta = now / 1000.0 + 240;
        arrival.color = "#0070BD"; arrival.lineLabel = "板南線"; arrival.lineId = "BL";
        metro.rows.add(arrival);
        return metro;
    }

    private String text(View root, int id) {
        TextView view = root.findViewById(id);
        assertNotNull(view);
        return String.valueOf(view.getText());
    }

    private Notification find(int id) {
        return findWithText(id, null);
    }

    private Notification findWithText(int id, String expectedText) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull(manager);
        long deadline = SystemClock.uptimeMillis() + 1000;
        do {
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (active.getId() != id) continue;
                Notification notification = active.getNotification();
                if (expectedText == null || String.valueOf(
                    notification.extras.getCharSequence(Notification.EXTRA_TEXT)).contains(expectedText)) {
                    return notification;
                }
            }
            SystemClock.sleep(25);
        } while (SystemClock.uptimeMillis() < deadline);
        return null;
    }
}
