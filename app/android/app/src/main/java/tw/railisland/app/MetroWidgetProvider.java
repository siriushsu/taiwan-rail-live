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
import android.os.Build;
import android.os.PowerManager;
import android.util.SizeF;
import android.widget.RemoteViews;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MetroWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "metro_widget";
    static final String ACTION_REFRESH = "tw.railisland.app.REFRESH_METRO_WIDGET";
    static final String AUTO = MetroWidgetData.AUTO;
    /** 兩種版型（設計稿 1a 琺瑯站牌／1b 夜行看板），一格一種，設定頁可換。 */
    static final String LAYOUT_PLATE = "plate";
    static final String LAYOUT_BOARD = "board";
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
                .remove("snapshot_" + id).remove("layout_" + id).remove("freq_" + id);
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
        EXECUTOR.execute(() -> updateOne(app, manager, id));
    }

    private static void updateOne(Context context, AppWidgetManager manager, int id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String sys = prefs.getString("sys_" + id, null);
        String station = prefs.getString("station_" + id, null);
        String direction = prefs.getString("direction_" + id, "");
        if (sys == null || station == null) {
            // 狀態 6 · 未設定車站
            manager.updateAppWidget(id, configure(context, id, MetroWidgetPlateRender.unset(context)));
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
        // 螢幕關著就不打網路——只把下一次喚醒排好。設計稿的更新頻率是「看得到的時候」才成立。
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (power != null && !power.isInteractive()) {
            scheduleBoundary(context, id, System.currentTimeMillis() + 300_000L);
            return;
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
                    manager.updateAppWidget(id,
                        tap(MetroWidgetPlateRender.noLocation(context), openIntent(context, id, sys, station)));
                    return;
                }
                sys = nearestSystem.id;
                station = nearest.name;
                direction = "";
            }
            MetroWidgetData.Snapshot snapshot = MetroWidgetData.fetch(context, sys, station, direction);
            if (!snapshot.rows.isEmpty()) MetroWidgetData.cache(context, id, snapshot);
            manager.updateAppWidget(id, build(context, id, snapshot, openIntent(context, id, sys, station)));
        } catch (Exception error) {
            MetroWidgetData.Snapshot fallback = MetroWidgetData.cached(context, id);
            if (fallback != null) {
                fallback.failed = true;   // ⇒ 狀態 3 · 資料延遲（畫面上是「暫無資料／正在重新連線」）
                manager.updateAppWidget(id, build(context, id, fallback, openIntent(context, id, sys, station)));
            } else {
                manager.updateAppWidget(id, tap(MetroWidgetPlateRender.offline(context, station),
                    openIntent(context, id, sys, station)));
            }
            scheduleBoundary(context, id, System.currentTimeMillis() + 120_000L);
        }
    }

    // ── 從官方資料組出「一格要顯示什麼」，再交給 binder ────────────────────────────────

    /**
     * 一格＝三個尺寸的 RemoteViews。API 31+ 交給系統依實際大小挑；31 以下沒有這個 API，
     * 一律給 4×2 那張（放大縮小由 launcher 處理，內容不變）。
     */
    private static RemoteViews build(Context context, int id, MetroWidgetData.Snapshot snapshot,
                                     PendingIntent tap) {
        boolean board = LAYOUT_BOARD.equals(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("layout_" + id, LAYOUT_PLATE));
        List<MetroWidgetPlate> plates = plates(context, snapshot);
        MetroWidgetPlate first = plates.get(0);
        scheduleNext(context, id, snapshot, first);

        if (Build.VERSION.SDK_INT < 31) {
            return tap(board ? board(context, R.layout.widget_board_4x2, plates, 2, snapshot)
                : MetroWidgetPlateRender.plate(context, R.layout.widget_plate_4x2, first), tap);
        }
        // 🔴 合併後的 RemoteViews 再 addAction 會直接丟 RuntimeException（"cannot be modified.
        //    Instead, fully configure each layouts individually before constructing the combined
        //    layout"）⇒ 點擊必須在合併【之前】逐張掛好，不能事後補。
        Map<SizeF, RemoteViews> sizes = new HashMap<>();
        if (board) {
            sizes.put(new SizeF(110f, 100f), tap(board(context, R.layout.widget_board_2x2, plates, 2, snapshot), tap));
            sizes.put(new SizeF(200f, 100f), tap(board(context, R.layout.widget_board_4x2, plates, 2, snapshot), tap));
            sizes.put(new SizeF(200f, 170f), tap(board(context, R.layout.widget_board_4x3, plates, 3, snapshot), tap));
        } else {
            sizes.put(new SizeF(110f, 100f),
                tap(MetroWidgetPlateRender.plate(context, R.layout.widget_plate_2x2, first, true), tap));
            sizes.put(new SizeF(200f, 100f), tap(MetroWidgetPlateRender.plate(context, R.layout.widget_plate_4x2, first), tap));
            sizes.put(new SizeF(200f, 170f), tap(MetroWidgetPlateRender.plate(context, R.layout.widget_plate_4x3, first), tap));
        }
        return new RemoteViews(sizes);
    }

    private static RemoteViews board(Context context, int layoutRes, List<MetroWidgetPlate> plates, int maxRows,
                                     MetroWidgetData.Snapshot snapshot) {
        MetroWidgetPlate first = plates.get(0);
        String head = first.station.isEmpty() ? snapshot.station : first.station;
        if (first.badge != null && !first.badge.isEmpty()) head = first.badge + " " + head;
        return MetroWidgetPlateRender.board(context, layoutRes,
            plates.toArray(new MetroWidgetPlate[0]), maxRows, head,
            "單位分鐘", first.footRight, first.band, first.bandBad);
    }

    /**
     * 一列＝一個終點方向。第一列是主角（設計稿的 1a 只畫這一列），1b 看板最多三列。
     * 每一列都走同一個 MetroWidgetPlate.of(...)——狀態判定只有一份。
     */
    private static List<MetroWidgetPlate> plates(Context context, MetroWidgetData.Snapshot snapshot) {
        MetroWidgetData.Catalog catalog = null;
        MetroWidgetData.SystemInfo system = null;
        try {
            catalog = MetroWidgetData.catalog(context);
            system = catalog.byId.get(snapshot.sys);
        } catch (Exception ignored) {}
        MetroWidgetData.StationInfo info = system == null ? null : system.stationByName.get(snapshot.station);
        boolean passLimited = !context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean("plus_active", false);
        double now = System.currentTimeMillis() / 1000.0;
        boolean closed = catalog != null && MetroWidgetData.serviceClosed(catalog, snapshot.sys, snapshot.station, now);

        // 同一個終點只留最近那班，後面兩班進「再下班」。
        List<String> dests = new ArrayList<>();
        for (MetroWidgetData.Row row : snapshot.rows) if (!dests.contains(row.dest)) dests.add(row.dest);
        if (dests.isEmpty()) dests.add(null);

        List<MetroWidgetPlate> out = new ArrayList<>();
        for (String dest : dests) {
            List<MetroWidgetData.Row> mine = new ArrayList<>();
            for (MetroWidgetData.Row row : snapshot.rows) if (dest == null || dest.equals(row.dest)) mine.add(row);
            MetroWidgetData.Row head = mine.isEmpty() ? null : mine.get(0);
            String lineId = head == null ? null : head.lineId;

            MetroWidgetPlate.Input in = new MetroWidgetPlate.Input();
            in.station = snapshot.station;
            in.stationEn = info == null ? null : info.en;
            in.stationCode = info == null ? null : info.codeForLine(lineId);
            in.lineLabel = head != null && head.lineLabel != null ? head.lineLabel : snapshot.systemLabel;
            in.lineColor = head != null && head.color != null ? head.color : snapshot.stationColor;
            in.dest = dest;
            in.etaEpochSec = head == null ? null : head.eta;
            in.minutes = head == null ? null : head.minutes;
            in.secondMinutes = minutesOf(mine, 1, now);
            in.thirdMinutes = minutesOf(mine, 2, now);
            in.secondApprox = approxOf(mine, 1);
            in.thirdApprox = approxOf(mine, 2);
            in.crowd = head == null ? null : head.crowd;
            in.dataAtEpochSec = snapshot.dataAt;
            in.fetchFailed = snapshot.failed;
            in.lastTrainTime = lastTrainFor(snapshot, dest);
            in.firstTrainTime = catalog == null ? null : catalog.firstTrainAt(snapshot.sys, snapshot.station, dest);
            in.serviceClosed = closed;
            in.alertTitle = snapshot.alertTitle;
            in.alertFromOperator = snapshot.alertFromOperator;
            in.passLimited = passLimited;
            if (system != null) {
                String[] neighbors = system.neighbors(snapshot.station, lineId);
                in.prevStation = neighbors[0];
                in.nextStation = neighbors[1];
            }
            in.nowEpochSec = now;
            out.add(MetroWidgetPlate.of(in));
            if (out.size() == 3) break;
        }
        return out;
    }

    /** 末班只掛在「官方說那班末班要去的那個終點」那一列，不要每一列都寫「本日最後一班」。 */
    private static String lastTrainFor(MetroWidgetData.Snapshot snapshot, String dest) {
        if (snapshot.lastTrainAt == null || snapshot.lastTrainAt.isEmpty()) return null;
        if (dest != null && snapshot.lastTrain != null && !snapshot.lastTrain.contains(dest)) return null;
        return snapshot.lastTrainAt;
    }

    /** 第 index 班的整數分鐘。官方列維持 floor；eta2 投影列只准 ceil，且過期就整列留白。 */
    static Integer minutesOf(List<MetroWidgetData.Row> rows, int index, double now) {
        if (index >= rows.size()) return null;
        MetroWidgetData.Row row = rows.get(index);
        if (row.eta != null && row.approx) {
            int minutes = (int) Math.ceil((row.eta - now) / 60);
            return minutes < 1 ? null : minutes;
        }
        if (row.eta != null) return (int) Math.floor((row.eta - now) / 60);
        return row.minutes;
    }

    static boolean approxOf(List<MetroWidgetData.Row> rows, int index) {
        return index < rows.size() && rows.get(index).approx;
    }

    // ── 更新節奏 ──────────────────────────────────────────────────────────────────

    /**
     * 下一次喚醒＝「畫面上的數字會變的那一刻」與「這一格的更新頻率」取較早者。
     *
     * 🔴 為什麼不是 WorkManager：週期性 WorkManager 的最小間隔是 15 分鐘，設計稿寫的 60 秒
     *    用它做不到（設計稿那句是 Android 側的技術假設，實作改用精準 AlarmManager）。
     *    這裡沿用原本就在用的 setAndAllowWhileIdle，並把「分鐘邊界」算進去——
     *    倒數是靜態文字（設計稿不要 m:ss 的 Chronometer），所以更新時機就是顯示值改變的時機。
     */
    private static void scheduleNext(Context context, int id, MetroWidgetData.Snapshot snapshot,
                                     MetroWidgetPlate plate) {
        String freq = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("freq_" + id, "std");
        long now = System.currentTimeMillis();
        double nowSec = now / 1000.0;
        Double eta = null;
        for (MetroWidgetData.Row row : snapshot.rows) if (row.eta != null && row.eta > nowSec) { eta = row.eta; break; }
        boolean soon = eta != null && eta - nowSec <= 180;   // 進站前三分鐘：設計稿的加密區間
        long base;
        switch (freq) {
            case "eco": base = soon ? 120_000L : 300_000L; break;
            case "max": base = 30_000L; break;
            default:    base = soon ? 30_000L : 60_000L;
        }
        long next = now + base;
        if (eta != null) {
            // 顯示值是 floor(剩餘/60) ⇒ 下一次變動在 (剩餘 mod 60) 秒後；不足一分鐘時，
            // 變動點就是到站那一刻（那之後這一班會從官方看板消失，換下一班上來）。
            double left = eta - nowSec;
            double delta = left >= 60 ? left % 60 : left;
            next = Math.min(next, now + (long) Math.max(15, delta * 1000));
        }
        if (plate.state == MetroWidgetPlate.State.CLOSED) next = now + 900_000L;   // 深夜不必每分鐘醒
        scheduleBoundary(context, id, Math.max(now + 15_000L, next));
    }

    // ── 訊息版面與點擊 ─────────────────────────────────────────────────────────────

    private static RemoteViews passRequired(Context context, int id) {
        RemoteViews views = MetroWidgetPlateRender.passNeeded(context);
        Uri uri = new Uri.Builder().scheme("railisland").authority("pass").build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, id + 81000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.wm_root, pending);
        return views;
    }

    private static RemoteViews configure(Context context, int id, RemoteViews views) {
        Intent config = new Intent(context, MetroWidgetConfigActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        PendingIntent pending = PendingIntent.getActivity(context, id, config,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.wm_root, pending);
        return views;
    }

    /** 整張卡片點下去開站台看板（設計稿沒有 ↻ 按鈕，點卡片就是要看更完整的資訊）。 */
    private static PendingIntent openIntent(Context context, int id, String sys, String station) {
        Uri uri = new Uri.Builder().scheme("railisland").authority("metro-wait")
            .appendQueryParameter("sys", sys).appendQueryParameter("station", station).build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, id + 48000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 三種版面的根 id 不同（一張版面只會有其中一個），三個都掛；找不到的 id 會被略過。 */
    private static RemoteViews tap(RemoteViews views, PendingIntent pending) {
        views.setOnClickPendingIntent(R.id.wg_root, pending);
        views.setOnClickPendingIntent(R.id.wb_root, pending);
        views.setOnClickPendingIntent(R.id.wm_root, pending);
        return views;
    }

    private static void scheduleBoundary(Context context, int id, long at) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        Intent intent = new Intent(context, MetroWidgetProvider.class).setAction(ACTION_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        PendingIntent pending = PendingIntent.getBroadcast(context, id + 49000, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
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
