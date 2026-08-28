package tw.railisland.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.PowerManager;
import android.widget.RemoteViews;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Android 對應 iOS MixedBoardWidget：同一卡片顯示一個鐵路站與一個捷運站。 */
public final class MixedBoardWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "mixed_board_widget";
    static final String RAIL_CACHE = "mixed_board_rail_cache";
    static final String METRO_CACHE = "mixed_board_metro_cache";
    static final String ACTION_REFRESH = "tw.railisland.app.REFRESH_MIXED_BOARD_WIDGET";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) updateOneAsync(context, manager, id);
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
            editor.remove("rail_sys_" + id).remove("rail_origin_" + id)
                .remove("metro_sys_" + id).remove("metro_station_" + id).remove("metro_direction_" + id);
            context.getSharedPreferences(RAIL_CACHE, Context.MODE_PRIVATE).edit().remove("snapshot_" + id).apply();
            context.getSharedPreferences(METRO_CACHE, Context.MODE_PRIVATE).edit().remove("snapshot_" + id).apply();
            cancel(context, id);
        }
        editor.apply();
        MetroWidgetProvider.reconcileFreeStation(context);
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MixedBoardWidgetProvider.class));
        for (int id : ids) updateOneAsync(context, manager, id);
    }

    static void updateOneAsync(Context context, AppWidgetManager manager, int id) {
        Context app = context.getApplicationContext();
        EXECUTOR.execute(() -> updateOne(app, manager, id));
    }

    private static void updateOne(Context context, AppWidgetManager manager, int id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String railSys = prefs.getString("rail_sys_" + id, null);
        String railOrigin = prefs.getString("rail_origin_" + id, null);
        String metroSys = prefs.getString("metro_sys_" + id, null);
        String metroStation = prefs.getString("metro_station_" + id, null);
        String metroDirection = prefs.getString("metro_direction_" + id, "");
        if (railSys == null || railOrigin == null || metroSys == null || metroStation == null) {
            manager.updateAppWidget(id, configure(context, id,
                MixedWidgetRender.message(context, "設定雙看板", "點一下選鐵路站與捷運站")));
            return;
        }

        if (!hasMetroSlot(context, metroSys, metroStation)) {
            manager.updateAppWidget(id, passRequired(context, id));
            return;
        }
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (power != null && !power.isInteractive()) {
            schedule(context, id, System.currentTimeMillis() + 5 * 60_000L);
            return;
        }

        try {
            if (RailWidgetData.AUTO.equals(railOrigin)) {
                String nearest = RailWidgetData.nearest(context, RailWidgetData.catalog(context), railSys);
                if (nearest == null) throw new IllegalStateException("rail location unavailable");
                railOrigin = nearest;
            }
            if (MetroWidgetData.AUTO.equals(metroStation)) {
                MetroWidgetData.Catalog catalog = MetroWidgetData.catalog(context);
                MetroWidgetData.StationInfo nearest = MetroWidgetData.nearest(context, catalog);
                MetroWidgetData.SystemInfo system = MetroWidgetData.systemForStation(catalog, nearest);
                if (nearest == null || system == null) throw new IllegalStateException("metro location unavailable");
                metroSys = system.id;
                metroStation = nearest.name;
                metroDirection = "";
            }

            RailWidgetData.Snapshot rail = fetchRail(context, id, railSys, railOrigin);
            MetroWidgetData.Snapshot metro = fetchMetro(context, id, metroSys, metroStation, metroDirection);
            manager.updateAppWidget(id, tap(context, id, metroSys, metroStation,
                MixedWidgetRender.board(context, rail, metro)));
            schedule(context, id, System.currentTimeMillis() + 60_000L);
        } catch (Exception error) {
            RailWidgetData.Snapshot rail = RailWidgetData.cached(context, RAIL_CACHE, id);
            MetroWidgetData.Snapshot metro = MetroWidgetData.cached(context, METRO_CACHE, id);
            if (rail != null && metro != null) {
                rail.failed = true;
                metro.failed = true;
                manager.updateAppWidget(id, tap(context, id, metroSys, metroStation,
                    MixedWidgetRender.board(context, rail, metro)));
            } else {
                manager.updateAppWidget(id, configure(context, id,
                    MixedWidgetRender.message(context, "暫時連不上", "點一下檢查設定或開啟軌島")));
            }
            schedule(context, id, System.currentTimeMillis() + 2 * 60_000L);
        }
    }

    private static RailWidgetData.Snapshot fetchRail(Context context, int id, String sys, String origin)
        throws Exception {
        try {
            RailWidgetData.Snapshot value = RailWidgetData.fetch(context, sys, origin, "");
            RailWidgetData.cache(context, RAIL_CACHE, id, value);
            return value;
        } catch (Exception error) {
            RailWidgetData.Snapshot cached = RailWidgetData.cached(context, RAIL_CACHE, id);
            if (cached == null) throw error;
            cached.failed = true;
            return cached;
        }
    }

    private static MetroWidgetData.Snapshot fetchMetro(Context context, int id, String sys, String station,
                                                        String direction) throws Exception {
        try {
            MetroWidgetData.Snapshot value = MetroWidgetData.fetch(context, sys, station, direction);
            MetroWidgetData.cache(context, METRO_CACHE, id, value);
            return value;
        } catch (Exception error) {
            MetroWidgetData.Snapshot cached = MetroWidgetData.cached(context, METRO_CACHE, id);
            if (cached == null) throw error;
            cached.failed = true;
            return cached;
        }
    }

    private static boolean hasMetroSlot(Context context, String sys, String station) {
        SharedPreferences metroPrefs = context.getSharedPreferences(MetroWidgetProvider.PREFS, Context.MODE_PRIVATE);
        if (metroPrefs.getBoolean("plus_active", false)) return true;
        if (MetroWidgetData.AUTO.equals(station)) return false;
        String selected = sys + "|" + station;
        String free = metroPrefs.getString("free_station", null);
        if (free == null) {
            metroPrefs.edit().putString("free_station", selected).apply();
            return true;
        }
        return free.equals(selected);
    }

    private static RemoteViews configure(Context context, int id, RemoteViews views) {
        Intent intent = new Intent(context, MixedWidgetConfigActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        PendingIntent pending = PendingIntent.getActivity(context, id + 41000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.wmx_root, pending);
        return views;
    }

    private static RemoteViews passRequired(Context context, int id) {
        Uri uri = new Uri.Builder().scheme("railisland").authority("pass").build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, id + 42000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        RemoteViews views = MixedWidgetRender.message(context, "需要軌島通行證", "免費版可使用一個捷運站；點一下查看通行證");
        views.setOnClickPendingIntent(R.id.wmx_root, pending);
        return views;
    }

    private static RemoteViews tap(Context context, int id, String sys, String station, RemoteViews views) {
        Uri uri = new Uri.Builder().scheme("railisland").authority("metro-wait")
            .appendQueryParameter("sys", sys).appendQueryParameter("station", station).build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, id + 43000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.wmx_root, pending);
        return views;
    }

    private static PendingIntent alarm(Context context, int id) {
        Intent intent = new Intent(context, MixedBoardWidgetProvider.class).setAction(ACTION_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(context, id + 44000, intent,
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
