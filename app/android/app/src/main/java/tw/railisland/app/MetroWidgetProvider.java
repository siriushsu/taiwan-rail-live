package tw.railisland.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MetroWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "metro_widget";
    static final String ACTION_REFRESH = "tw.railisland.app.REFRESH_METRO_WIDGET";
    static final String AUTO = MetroWidgetData.AUTO;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) updateOneAsync(context, manager, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!ACTION_REFRESH.equals(intent.getAction())) return;
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) updateAll(context);
        else updateOneAsync(context, manager, id);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : appWidgetIds) {
            editor.remove("sys_" + id).remove("station_" + id).remove("direction_" + id)
                .remove("snapshot_" + id);
            cancelBoundary(context, id);
        }
        // 先同步落盤再重算免費站名額，避免刪除／重設小工具後舊站永久占著名額。
        editor.commit();
        reconcileFreeStation(context);
    }

    /** 免費版只有一個站名額；名額必須永遠對應到目前仍存在的小工具。 */
    static void reconcileFreeStation(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean("plus_active", false)) return;
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MetroWidgetProvider.class));
        java.util.LinkedHashSet<String> active = new java.util.LinkedHashSet<>();
        for (int id : ids) {
            String sys = prefs.getString("sys_" + id, null);
            String station = prefs.getString("station_" + id, null);
            if (sys != null && station != null && !AUTO.equals(station)) active.add(sys + "|" + station);
        }
        String free = prefs.getString("free_station", null);
        if (free != null && active.contains(free)) return;
        SharedPreferences.Editor editor = prefs.edit();
        if (active.isEmpty()) editor.remove("free_station");
        else editor.putString("free_station", active.iterator().next());
        editor.commit();
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MetroWidgetProvider.class));
        for (int id : ids) updateOneAsync(context, manager, id);
    }

    static void updateOneAsync(Context context, AppWidgetManager manager, int id) {
        Context app = context.getApplicationContext();
        manager.updateAppWidget(id, loading(app, id));
        EXECUTOR.execute(() -> updateOne(app, manager, id));
    }

    private static void updateOne(Context context, AppWidgetManager manager, int id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String sys = prefs.getString("sys_" + id, null);
        String station = prefs.getString("station_" + id, null);
        String direction = prefs.getString("direction_" + id, "");
        if (sys == null || station == null) {
            manager.updateAppWidget(id, unconfigured(context, id));
            return;
        }
        if (!prefs.getBoolean("plus_active", false)) {
            String free = prefs.getString("free_station", null);
            String selected = AUTO.equals(station) ? AUTO : sys + "|" + station;
            if (free == null) prefs.edit().putString("free_station", selected).apply();
            else if (!free.equals(selected)) {
                manager.updateAppWidget(id, passRequired(context, id));
                return;
            }
        }
        try {
            if (AUTO.equals(station)) {
                if (!prefs.getBoolean("plus_active", false)) {
                    manager.updateAppWidget(id, passRequired(context, id));
                    return;
                }
                MetroWidgetData.Catalog catalog = MetroWidgetData.catalog(context);
                MetroWidgetData.StationInfo nearest = MetroWidgetData.nearest(context, catalog);
                MetroWidgetData.SystemInfo nearestSystem = MetroWidgetData.systemForStation(catalog, nearest);
                if (nearest == null || nearestSystem == null) {
                    manager.updateAppWidget(id, message(context, id, "自動選站", "請先開啟軌島並允許模糊位置", true));
                    return;
                }
                sys = nearestSystem.id;
                station = nearest.name;
                direction = "";
            }
            MetroWidgetData.Snapshot snapshot = MetroWidgetData.fetch(context, sys, station, direction);
            if (!snapshot.rows.isEmpty()) MetroWidgetData.cache(context, id, snapshot);
            manager.updateAppWidget(id, render(context, id, snapshot));
        } catch (Exception error) {
            MetroWidgetData.Snapshot fallback = MetroWidgetData.cached(context, id);
            if (fallback != null) {
                fallback.failed = true;
                manager.updateAppWidget(id, render(context, id, fallback));
            } else {
                manager.updateAppWidget(id, message(context, id, station, "目前無法取得官方班次，點 ↻ 重試", false));
            }
        }
    }

    private static RemoteViews render(Context context, int id, MetroWidgetData.Snapshot snapshot) {
        RemoteViews views = base(context, id);
        views.setTextViewText(R.id.widget_station, snapshot.station);
        String line = snapshot.systemLabel;
        if (!snapshot.rows.isEmpty() && snapshot.rows.get(0).lineLabel != null) line = snapshot.rows.get(0).lineLabel;
        views.setTextViewText(R.id.widget_line, line);
        views.setTextViewText(R.id.widget_updated,
            (snapshot.failed ? "⚠ " : "") + formatTime((long) (snapshot.dataAt * 1000)) + " 更新");
        setAccent(views, snapshot.stationColor);
        views.setViewVisibility(R.id.widget_message, View.GONE);
        views.setViewVisibility(R.id.widget_rows, View.VISIBLE);
        long now = System.currentTimeMillis();
        bindRow(views, 0, snapshot.rows.size() > 0 ? snapshot.rows.get(0) : null, now);
        bindRow(views, 1, snapshot.rows.size() > 1 ? snapshot.rows.get(1) : null, now);
        if (snapshot.lastTrain == null || snapshot.lastTrain.isEmpty()) {
            views.setViewVisibility(R.id.widget_last_train, View.GONE);
        } else {
            views.setViewVisibility(R.id.widget_last_train, View.VISIBLE);
            views.setTextViewText(R.id.widget_last_train, "末班 " + snapshot.lastTrain);
        }
        if (snapshot.rows.isEmpty()) {
            views.setViewVisibility(R.id.widget_rows, View.GONE);
            views.setViewVisibility(R.id.widget_message, View.VISIBLE);
            views.setTextViewText(R.id.widget_message, "官方目前沒有這一站的班次資訊");
        } else {
            long boundary = Long.MAX_VALUE;
            for (MetroWidgetData.Row row : snapshot.rows) {
                if (row.eta != null && row.eta * 1000 > now) {
                    long eta = (long) (row.eta * 1000);
                    // 先於倒數歸零喚醒：Android Chronometer 不會停在 00:00，若等到
                    // 到站後才更新，AlarmManager 的批次視窗會讓桌面短暫出現負數。
                    long next = eta > now + 60_000L
                        ? Math.max(now + 1_000L, eta - 60_000L)
                        : eta + 31_000L;
                    boundary = Math.min(boundary, next);
                }
            }
            if (snapshot.failed) boundary = Math.min(boundary, now + 120_000L);
            if (boundary != Long.MAX_VALUE) scheduleBoundary(context, id, boundary);
        }
        setOpenIntent(context, views, id, snapshot.sys, snapshot.station);
        return views;
    }

    private static void bindRow(RemoteViews views, int index, MetroWidgetData.Row row, long now) {
        int container = index == 0 ? R.id.widget_row1 : R.id.widget_row2;
        int dot = index == 0 ? R.id.widget_row1_dot : R.id.widget_row2_dot;
        int dest = index == 0 ? R.id.widget_row1_dest : R.id.widget_row2_dest;
        int chrono = index == 0 ? R.id.widget_row1_chrono : R.id.widget_row2_chrono;
        int time = index == 0 ? R.id.widget_row1_time : R.id.widget_row2_time;
        int crowd = index == 0 ? R.id.widget_row1_crowd : R.id.widget_row2_crowd;
        if (row == null) {
            views.setViewVisibility(container, View.INVISIBLE);
            return;
        }
        views.setViewVisibility(container, View.VISIBLE);
        views.setTextViewText(dest, "往 " + row.dest);
        if (row.color == null || row.color.isEmpty()) views.setViewVisibility(dot, View.INVISIBLE);
        else {
            views.setViewVisibility(dot, View.VISIBLE);
            try { views.setInt(dot, "setColorFilter", Color.parseColor(row.color)); }
            catch (IllegalArgumentException ignored) { views.setViewVisibility(dot, View.INVISIBLE); }
        }
        if (row.eta != null) {
            long eta = (long) (row.eta * 1000);
            if (eta <= now + 60_000) {
                views.setViewVisibility(chrono, View.GONE);
                views.setViewVisibility(time, View.VISIBLE);
                views.setTextViewText(time, "進站");
                views.setTextColor(time, Color.rgb(74, 222, 128));
            } else {
                views.setViewVisibility(time, View.GONE);
                views.setViewVisibility(chrono, View.VISIBLE);
                long base = SystemClock.elapsedRealtime() + (eta - now);
                views.setChronometer(chrono, base, null, true);
                if (Build.VERSION.SDK_INT >= 24) views.setChronometerCountDown(chrono, true);
            }
        } else {
            views.setViewVisibility(chrono, View.GONE);
            views.setViewVisibility(time, View.VISIBLE);
            views.setTextColor(time, Color.WHITE);
            views.setTextViewText(time, row.minutes == null ? "—" : "約 " + row.minutes + " 分");
        }
        String crowdText = crowdText(row.crowd);
        views.setTextViewText(crowd, crowdText);
        views.setViewVisibility(crowd, crowdText.isEmpty() ? View.INVISIBLE : View.VISIBLE);
    }

    private static RemoteViews loading(Context context, int id) {
        return message(context, id, "捷運看板", "正在讀取官方班次…", false);
    }

    private static RemoteViews unconfigured(Context context, int id) {
        RemoteViews views = message(context, id, "捷運看板", "點一下選擇捷運站", true);
        Intent config = new Intent(context, MetroWidgetConfigActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        PendingIntent pending = PendingIntent.getActivity(context, id, config,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);
        return views;
    }

    private static RemoteViews passRequired(Context context, int id) {
        RemoteViews views = message(context, id, "再加一站", "免費版可設定一站；點一下用通行證解鎖多站與自動選站", true);
        Uri uri = new Uri.Builder().scheme("railisland").authority("pass").build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, id + 81000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);
        return views;
    }

    private static RemoteViews message(Context context, int id, String title, String text, boolean accent) {
        RemoteViews views = base(context, id);
        views.setTextViewText(R.id.widget_station, title);
        views.setTextViewText(R.id.widget_line, "軌島");
        views.setTextViewText(R.id.widget_updated, "");
        views.setViewVisibility(R.id.widget_rows, View.GONE);
        views.setViewVisibility(R.id.widget_last_train, View.GONE);
        views.setViewVisibility(R.id.widget_message, View.VISIBLE);
        views.setTextViewText(R.id.widget_message, text);
        if (accent) views.setInt(R.id.widget_accent, "setColorFilter", Color.rgb(52, 211, 153));
        return views;
    }

    private static RemoteViews base(Context context, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_metro_board);
        Intent refresh = new Intent(context, MetroWidgetProvider.class).setAction(ACTION_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        PendingIntent refreshPending = PendingIntent.getBroadcast(context, id + 47000, refresh,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshPending);
        return views;
    }

    private static void setOpenIntent(Context context, RemoteViews views, int id, String sys, String station) {
        Uri uri = new Uri.Builder().scheme("railisland").authority("metro-wait")
            .appendQueryParameter("sys", sys).appendQueryParameter("station", station).build();
        Intent open = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, id + 48000, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);
    }

    private static void setAccent(RemoteViews views, String raw) {
        int color = Color.rgb(52, 211, 153);
        try { if (raw != null && !raw.isEmpty()) color = Color.parseColor(raw); }
        catch (IllegalArgumentException ignored) {}
        views.setInt(R.id.widget_accent, "setColorFilter", color);
    }

    private static String crowdText(int[] crowd) {
        if (crowd == null || crowd.length == 0) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < crowd.length; i++) {
            if (i > 0) out.append(' ');
            out.append(crowd[i] <= 1 ? '▰' : crowd[i] == 2 ? '▰' : '▮');
        }
        return out.toString();
    }

    private static String formatTime(long millis) {
        if (millis <= 0) return "—";
        SimpleDateFormat f = new SimpleDateFormat("HH:mm", Locale.TAIWAN);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Taipei"));
        return f.format(new Date(millis));
    }

    private static void scheduleBoundary(Context context, int id, long at) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        Intent intent = new Intent(context, MetroWidgetProvider.class).setAction(ACTION_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        PendingIntent pending = PendingIntent.getBroadcast(context, id + 49000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (Build.VERSION.SDK_INT >= 23) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        else manager.set(AlarmManager.RTC_WAKEUP, at, pending);
    }

    private static void cancelBoundary(Context context, int id) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, MetroWidgetProvider.class).setAction(ACTION_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        PendingIntent pending = PendingIntent.getBroadcast(context, id + 49000, intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (manager != null && pending != null) manager.cancel(pending);
    }
}
