package tw.railisland.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

/** iOS WidgetBundle 六項能力的 Android 真機資料／RemoteViews 煙霧測試。 */
@RunWith(AndroidJUnit4.class)
public final class WidgetParityInstrumentedTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void railCatalogCoversBothDirectionsAndCurrentThsrEndpoint() throws Exception {
        RailWidgetData.Catalog catalog = RailWidgetData.catalog(context);
        assertNotNull(catalog.byId.get("tra"));
        assertNotNull(catalog.byId.get("thsr"));
        assertTrue(catalog.composites.size() >= 5);

        // 有方向性資料硬性驗兩向：北上與南下不可只挑一邊通過。
        assertTrue(RailWidgetData.destinations(catalog, "tra", "臺北").contains("花蓮"));
        assertTrue(RailWidgetData.destinations(catalog, "tra", "花蓮").contains("臺北"));
        assertTrue(RailWidgetData.destinations(catalog, "thsr", "台北").contains("左營"));
        assertTrue(RailWidgetData.destinations(catalog, "thsr", "左營").contains("台北"));

        RailWidgetData.Snapshot south = RailWidgetData.fetch(context, "thsr", "台北", "左營");
        RailWidgetData.Snapshot north = RailWidgetData.fetch(context, "thsr", "左營", "台北");
        assertFalse("今日高鐵南下不應是空看板", south.rows.isEmpty());
        assertFalse("今日高鐵北上不應是空看板", north.rows.isEmpty());
        assertTrue(south.scheduleNote != null && south.scheduleNote.contains("當日班表"));
    }

    @Test
    public void allThreeProvidersArePackagedAndNewLayoutsInflate() throws Exception {
        PackageManager packages = context.getPackageManager();
        packages.getReceiverInfo(new ComponentName(context, MetroWidgetProvider.class), 0);
        packages.getReceiverInfo(new ComponentName(context, RailBoardWidgetProvider.class), 0);
        packages.getReceiverInfo(new ComponentName(context, MixedBoardWidgetProvider.class), 0);

        long now = System.currentTimeMillis();
        RailWidgetData.Snapshot rail = new RailWidgetData.Snapshot();
        rail.sys = "tra"; rail.systemLabel = "台鐵"; rail.origin = "板橋"; rail.destination = "";
        rail.generatedAt = now;
        RailWidgetData.Row train = new RailWidgetData.Row();
        train.sys = "tra"; train.no = "123"; train.type = "自強"; train.color = "#C0392B";
        train.terminus = "花蓮"; train.relation = RailWidgetData.Relation.DEPARTURE;
        train.scheduledAt = now + 10 * 60_000L; train.delayMinutes = 0;
        rail.rows.add(train);

        MetroWidgetData.Snapshot metro = new MetroWidgetData.Snapshot();
        metro.sys = "trtc"; metro.systemLabel = "台北捷運"; metro.station = "板橋";
        metro.precision = "seconds"; metro.dataAt = now / 1000.0;
        MetroWidgetData.Row arrival = new MetroWidgetData.Row();
        arrival.dest = "南港展覽館"; arrival.eta = now / 1000.0 + 240;
        arrival.color = "#0070BD"; arrival.lineLabel = "板南線"; arrival.lineId = "BL";
        metro.rows.add(arrival);

        FrameLayout host = new FrameLayout(context);
        RemoteViews railViews = RailWidgetRender.board(context, R.layout.widget_rail_4x4, rail, 8, false, false);
        assertNotNull(railViews.apply(context, host));
        RemoteViews mixedViews = MixedWidgetRender.board(context, rail, metro);
        assertNotNull(mixedViews.apply(context, host));
    }

    @Test
    public void readableRailBoardActuallyEnlargesPrimaryTextAndRows() {
        long now = System.currentTimeMillis();
        RailWidgetData.Snapshot rail = new RailWidgetData.Snapshot();
        rail.sys = "tra"; rail.systemLabel = "台鐵"; rail.origin = "板橋"; rail.destination = "";
        rail.generatedAt = now;
        RailWidgetData.Row train = new RailWidgetData.Row();
        train.sys = "tra"; train.no = "123"; train.type = "自強"; train.color = "#C0392B";
        train.terminus = "花蓮"; train.relation = RailWidgetData.Relation.DEPARTURE;
        train.scheduledAt = now + 10 * 60_000L; train.delayMinutes = 0;
        rail.rows.add(train);

        FrameLayout host = new FrameLayout(context);
        View standard = RailWidgetRender.board(
            context, R.layout.widget_rail_4x2, rail, 4, false, false).apply(context, host);
        View readable = RailWidgetRender.board(
            context, R.layout.widget_rail_4x2, rail, 4, true, false).apply(context, host);
        TextView standardTrain = standard.findViewById(R.id.wrr_train);
        TextView readableTrain = readable.findViewById(R.id.wrr_train);
        TextView standardTime = standard.findViewById(R.id.wrr_time);
        TextView readableTime = readable.findViewById(R.id.wrr_time);
        TextView standardStatus = standard.findViewById(R.id.wrr_status);
        TextView readableStatus = readable.findViewById(R.id.wrr_status);
        assertNotNull(standardTrain); assertNotNull(readableTrain);
        assertNotNull(standardTime); assertNotNull(readableTime);
        assertNotNull(standardStatus); assertNotNull(readableStatus);
        assertTrue("大字版班次至少要放大 25%", readableTrain.getTextSize() >= standardTrain.getTextSize() * 1.25f);
        assertTrue("大字版時刻至少要放大 35%", readableTime.getTextSize() >= standardTime.getTextSize() * 1.35f);
        assertTrue("大字版狀態不能仍停在 9sp", readableStatus.getTextSize() >= standardStatus.getTextSize() * 1.25f);
        View standardRow = (View) standardTrain.getParent().getParent();
        View readableRow = (View) readableTrain.getParent().getParent();
        assertTrue("放大文字也要同步增加列高，不能裁字",
            readableRow.getLayoutParams().height > standardRow.getLayoutParams().height);
        assertTrue("大字版應省略次要目的地列，把空間留給班次與時刻",
            readable.findViewById(R.id.wrr_dest).getVisibility() == View.GONE);
    }

    @Test
    public void customReviewAndUpdatePluginsAreRegisteredInTheRunningBridge() {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(intent);
        assertNotNull(activity.getBridge().getPlugin("RailReview"));
        assertNotNull(activity.getBridge().getPlugin("RailStore"));
        InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
    }

    @Test
    public void bothNewConfigurationScreensOpenWithoutCrashing() {
        openAndClose(RailWidgetConfigActivity.class, 61001);
        openAndClose(MixedWidgetConfigActivity.class, 61002);
    }

    private void openAndClose(Class<? extends Activity> type, int widgetId) {
        Intent intent = new Intent(context, type)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = InstrumentationRegistry.getInstrumentation().startActivitySync(intent);
        assertNotNull(type.getSimpleName() + " 未能開啟", activity);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
    }
}
