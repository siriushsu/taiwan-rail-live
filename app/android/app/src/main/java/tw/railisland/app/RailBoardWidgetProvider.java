package tw.railisland.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import android.util.SizeF;
import android.widget.RemoteViews;

import java.util.HashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 台鐵／高鐵發車看板：Android 對應 iOS RailBoardWidget。 */
public final class RailBoardWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "rail_board_widget";
    static final String ACTION_REFRESH = "tw.railisland.app.REFRESH_RAIL_BOARD_WIDGET";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) updateOneAsync(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, android.os.Bundle options) {
        updateOneAsync(context, manager, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!ACTION_REFRESH.equals(intent.getAction())) return;
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) updateAll(context);
        else updateOneAsync(context, AppWidgetManager.getInstance(context), id);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : ids) {
            editor.remove("sys_" + id).remove("origin_" + id).remove("destination_" + id)
                .remove("readable_" + id).remove("filters_" + id).remove("snapshot_" + id);
            cancel(context, id);
        }
        editor.apply();
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, RailBoardWidgetProvider.class));
        for (int id : ids) updateOneAsync(context, manager, id);
    }

    static void updateOneAsync(Context context, AppWidgetManager manager, int id) {
        Context app = context.getApplicationContext();
        EXECUTOR.execute(() -> updateOne(app, manager, id));
    }

    private static void updateOne(Context context, AppWidgetManager manager, int id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String sys = prefs.getString("sys_" + id, null);
        String origin = prefs.getString("origin_" + id, null);
        String destination = prefs.getString("destination_" + id, "");
        boolean readable = prefs.getBoolean("readable_" + id, false);
        List<String> filters = new ArrayList<>();
        try {
            JSONArray rawFilters = new JSONArray(prefs.getString("filters_" + id, "[]"));
            for (int i = 0; i < rawFilters.length(); i++) filters.add(rawFilters.optString(i));
        } catch (Exception ignored) {}
        if (sys == null || origin == null) {
            manager.updateAppWidget(id, configure(context, id,
                RailWidgetRender.message(context, "設定發車看板", "點一下選台鐵、高鐵或共站")));
            return;
        }
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (power != null && !power.isInteractive()) {
            schedule(context, id, System.currentTimeMillis() + 5 * 60_000L);
            return;
        }
        try {
            if (RailWidgetData.AUTO.equals(origin)) {
                String nearest = RailWidgetData.nearest(context, RailWidgetData.catalog(context), sys);
                if (nearest == null) {
                    manager.updateAppWidget(id, tap(context, id,
                        RailWidgetRender.message(context, "需要位置", "開啟軌島定位後即可自動選最近車站")));
                    schedule(context, id, System.currentTimeMillis() + 5 * 60_000L);
                    return;
                }
                origin = nearest;
                destination = "";
            }
            RailWidgetData.Snapshot snapshot = RailWidgetData.fetch(context, sys, origin, destination, filters);
            RailWidgetData.cache(context, PREFS, id, snapshot);
            manager.updateAppWidget(id, sizes(context, id, snapshot, readable));
            long next = System.currentTimeMillis() + 5 * 60_000L;
            if (!snapshot.rows.isEmpty()) {
                long boundary = snapshot.rows.get(0).expectedAt();
                if (boundary > System.currentTimeMillis()) next = Math.min(next, boundary);
            }
            schedule(context, id, Math.max(System.currentTimeMillis() + 30_000L, next));
        } catch (Exception error) {
            RailWidgetData.Snapshot fallback = RailWidgetData.cached(context, PREFS, id);
            if (fallback != null) {
                fallback.failed = true;
                manager.updateAppWidget(id, sizes(context, id, fallback, readable));
            } else {
                manager.updateAppWidget(id, tap(context, id,
                    RailWidgetRender.message(context, "暫時連不上", "點卡片仍可開啟軌島查看班次")));
            }
            schedule(context, id, System.currentTimeMillis() + 2 * 60_000L);
        }
    }

    private static RemoteViews sizes(Context context, int id, RailWidgetData.Snapshot snapshot, boolean readable) {
        PendingIntent tap = openIntent(context, id);
        if (Build.VERSION.SDK_INT < 31) {
            return tap(RailWidgetRender.board(context, R.layout.widget_rail_4x2, snapshot, 4, readable, false), tap);
        }
        Map<SizeF, RemoteViews> layouts = new HashMap<>();
        layouts.put(new SizeF(110f, 100f), tap(
            RailWidgetRender.board(context, R.layout.widget_rail_2x2, snapshot, 2, readable, true), tap));
        layouts.put(new SizeF(200f, 100f), tap(
            RailWidgetRender.board(context, R.layout.widget_rail_4x2, snapshot, 4, readable, false), tap));
        layouts.put(new SizeF(200f, 250f), tap(
            RailWidgetRender.board(context, R.layout.widget_rail_4x4, snapshot, 8, readable, false), tap));
        return new RemoteViews(layouts);
    }

    private static RemoteViews configure(Context context, int id, RemoteViews views) {
        Intent intent = new Intent(context, RailWidgetConfigActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        PendingIntent pending = PendingIntent.getActivity(context, id + 31000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.wr_root, pending);
        return views;
    }

    private static RemoteViews tap(Context context, int id, RemoteViews views) {
        return tap(views, openIntent(context, id));
    }

    private static RemoteViews tap(RemoteViews views, PendingIntent pending) {
        views.setOnClickPendingIntent(R.id.wr_root, pending);
        return views;
    }

    private static PendingIntent openIntent(Context context, int id) {
        Intent intent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("railWidget", true);
        return PendingIntent.getActivity(context, id + 32000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent alarm(Context context, int id) {
        Intent intent = new Intent(context, RailBoardWidgetProvider.class)
            .setAction(ACTION_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(context, id + 33000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void schedule(Context context, int id, long at) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager != null) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(context, id));
    }

    private static void cancel(Context context, int id) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager != null) manager.cancel(alarm(context, id));
    }
}
