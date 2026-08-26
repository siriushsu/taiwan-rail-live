package tw.railisland.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Android 的「等車資訊卡」：Android 16+ 使用 Live Update 行程進度樣式，舊版退化為鎖屏持續通知。 */
final class RailWaitNotification {
    // v2 uses DEFAULT importance so Pixel does not tuck the silent fallback card away from
    // the lock screen. Android notification-channel importance cannot be raised after creation.
    static final String CHANNEL_ID = "rail_wait_live_v2";
    static final int NOTIFICATION_ID = 46301;
    static final int END_REQUEST_CODE = 46302;
    static final int REFRESH_REQUEST_CODE = 46303;
    static final String PREFS = "rail_metro_wait";
    static final String KEY_STATE = "active_state";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private RailWaitNotification() {}

    static boolean canNotify(Context context) {
        return Build.VERSION.SDK_INT < 33
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "等車資訊卡", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("在鎖定畫面顯示正在追蹤車站的下一班車");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    static long start(Context context, JSONObject payload) throws JSONException {
        createChannel(context);
        long now = System.currentTimeMillis();
        int durationMin = Math.max(1, payload.optInt("durationMin", 30));
        long endAt = now + durationMin * 60_000L;
        payload.put("endAt", endAt / 1000.0);
        payload.put("active", true);
        save(context, payload);
        post(context, payload);
        scheduleEnd(context, endAt);
        scheduleRefresh(context, payload, false);
        return endAt;
    }

    static void post(Context context, JSONObject state) {
        if (!canNotify(context)) return;
        String station = state.optString("station", "捷運等車");
        String line = state.optString("lineLabel", "");
        String dest = state.optString("nextDest", "—");
        String secondDest = state.optString("secondDest", "");
        Double nextEta = nullableDouble(state, "nextEta");
        Integer nextMinutes = nullableInt(state, "nextMinutes");
        Double secondEta = nullableDouble(state, "secondEta");
        Integer secondMinutes = nullableInt(state, "secondMinutes");
        long now = System.currentTimeMillis();

        String firstText = countdown(nextEta, nextMinutes, now);
        StringBuilder detail = new StringBuilder("往 ").append(dest).append("　").append(firstText);
        if (secondEta != null || secondMinutes != null) {
            detail.append("\n再下一班");
            if (!secondDest.isEmpty()) detail.append(" 往 ").append(secondDest);
            detail.append("　").append(countdown(secondEta, secondMinutes, now));
        }
        String crowd = crowdText(state.optJSONArray("crowd"));
        if (!crowd.isEmpty()) detail.append("\n車廂鬆緊　").append(crowd);
        double dataAt = state.optDouble("dataAt", 0);
        double endAt = state.optDouble("endAt", 0);
        if (dataAt > 0 || endAt > 0) {
            detail.append("\n");
            if (dataAt > 0) detail.append(formatTime((long) (dataAt * 1000))).append(" 更新");
            if (dataAt > 0 && endAt > 0) detail.append(" ・ ");
            if (endAt > 0) detail.append("追蹤至 ").append(formatTime((long) (endAt * 1000)));
        }
        String notice = state.optString("notice", "").trim();
        if (!notice.isEmpty()) detail.append("\n").append(notice);

        Uri openUri = new Uri.Builder().scheme("railisland").authority("metro-wait")
            .appendQueryParameter("sys", state.optString("sys", ""))
            .appendQueryParameter("station", station).build();
        Intent open = new Intent(Intent.ACTION_VIEW, openUri, context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(context, 46300, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(context, MetroWaitStopReceiver.class).setAction(MetroWaitStopReceiver.ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getBroadcast(context, END_REQUEST_CODE, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        StringBuilder compact = new StringBuilder("往 ").append(dest).append("　").append(firstText);
        if (secondEta != null || secondMinutes != null) {
            compact.append(" · 再下一班");
            if (!secondDest.isEmpty()) compact.append(" 往 ").append(secondDest);
            compact.append("　").append(countdown(secondEta, secondMinutes, now));
        }

        Integer accentColor = null;
        String color = state.optString("color", "");
        try { if (!color.isEmpty()) accentColor = Color.parseColor(color); }
        catch (IllegalArgumentException ignored) {}

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_train)
            .setContentTitle(station)
            .setContentText(compact.toString())
            .setSubText(line.isEmpty() ? "軌島・等車中" : line)
            .setContentIntent(openPending)
            .addAction(R.drawable.ic_stop, "結束", stopPending)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(shortCritical(firstText))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        if (accentColor != null) builder.setColor(accentColor);

        int progress = 0;
        boolean timedProgress = nextEta != null && nextEta * 1000 > now;
        if (timedProgress) {
            long etaMillis = (long) (nextEta * 1000);
            builder.setWhen(etaMillis).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true);
            long dataMillis = (long) (dataAt * 1000);
            long progressStart = dataMillis > 0 && dataMillis < etaMillis ? dataMillis : now;
            long total = Math.max(1, etaMillis - progressStart);
            long elapsed = Math.max(0, now - progressStart);
            progress = (int) Math.min(1000, elapsed * 1000 / total);
            builder.setProgress(1000, progress, false);
        } else {
            builder.setShowWhen(false);
        }

        if (Build.VERSION.SDK_INT >= 36) {
            // Android 16 的 ProgressStyle 是 Live Update／Samsung Now Bar 的原生行程樣式。
            // 一整段代表「開始等車→下一班抵達」，tracker 用軌島列車圖示沿進度前進；
            // 只有分鐘級資料的高捷／機捷不偽造秒級 ETA，改用 indeterminate 如實呈現。
            NotificationCompat.ProgressStyle progressStyle = new NotificationCompat.ProgressStyle()
                .setStyledByProgress(true)
                .setProgressTrackerIcon(IconCompat.createWithResource(context, R.drawable.ic_stat_train));
            NotificationCompat.ProgressStyle.Segment segment =
                new NotificationCompat.ProgressStyle.Segment(1000).setId(1);
            NotificationCompat.ProgressStyle.Point destination =
                new NotificationCompat.ProgressStyle.Point(1000).setId(1);
            if (accentColor != null) {
                segment.setColor(accentColor);
                destination.setColor(accentColor);
            }
            progressStyle.addProgressSegment(segment).addProgressPoint(destination);
            if (timedProgress) progressStyle.setProgress(progress);
            else progressStyle.setProgress(0).setProgressIndeterminate(true);
            builder.setStyle(progressStyle);
        } else {
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(detail.toString()));
        }

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // 權限可能在上方 canNotify() 檢查後立刻被使用者從系統設定撤回。
        }
    }

    /** 回傳系統是否允許、通知是否合格，以及 Samsung／Android 是否已實際提升這張卡。 */
    static JSONObject promotionStatus(Context context) {
        JSONObject out = new JSONObject();
        try {
            boolean supported = Build.VERSION.SDK_INT >= 36;
            out.put("supported", supported);
            out.put("allowed", false);
            out.put("eligible", false);
            out.put("promoted", false);
            out.put("settingsAvailable", supported);
            if (!supported) return out;

            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null) return out;
            out.put("allowed", manager.canPostPromotedNotifications());
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (active.getId() != NOTIFICATION_ID) continue;
                Notification notification = active.getNotification();
                out.put("eligible", notification.hasPromotableCharacteristics());
                out.put("promoted", (notification.flags & Notification.FLAG_PROMOTED_ONGOING) != 0);
                break;
            }
        } catch (Exception ignored) {}
        return out;
    }

    /** 開啟 Android 16 的 App 即時通知提升設定；不是 Android 16 時不提供假入口。 */
    static boolean openPromotionSettings(Context context) {
        if (Build.VERSION.SDK_INT < 36) return false;
        Intent settings = new Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(settings);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    static JSONObject status(Context context) {
        JSONObject state = load(context);
        if (state == null || !state.optBoolean("active", false)) return null;
        double endAt = state.optDouble("endAt", 0);
        if (endAt > 0 && System.currentTimeMillis() / 1000.0 >= endAt) {
            stop(context);
            return null;
        }
        return state;
    }

    static void stop(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
        cancelEnd(context);
        cancelRefresh(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_STATE).apply();
    }

    /**
     * 下一班到站後由 Android 自己重抓官方看板，讓鎖屏卡接到下一班；不依賴 App 留在前景。
     * AlarmManager 只負責喚醒，網路工作固定放到單一背景執行緒，BroadcastReceiver 可準時交還。
     */
    static void refreshAsync(Context context, Runnable finished) {
        Context app = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                JSONObject state = load(app);
                if (state == null || !state.optBoolean("active", false)) return;
                long now = System.currentTimeMillis();
                long endAt = (long) (state.optDouble("endAt", 0) * 1000);
                if (endAt > 0 && now >= endAt) { stop(app); return; }
                String sys = state.optString("sys", "");
                String station = state.optString("station", "");
                String selectedDest = state.optString("selectedDest", "");
                MetroWidgetData.Snapshot snapshot = MetroWidgetData.fetch(app, sys, station, selectedDest);
                if (!snapshot.rows.isEmpty()) {
                    applySnapshot(state, snapshot);
                    save(app, state);
                    post(app, state);
                    scheduleRefresh(app, state, false);
                } else {
                    scheduleRefresh(app, state, true);
                }
            } catch (Exception ignored) {
                JSONObject state = load(app);
                if (state != null) scheduleRefresh(app, state, true);
            } finally {
                if (finished != null) finished.run();
            }
        });
    }

    private static void applySnapshot(JSONObject state, MetroWidgetData.Snapshot snapshot) throws JSONException {
        MetroWidgetData.Row first = snapshot.rows.get(0);
        MetroWidgetData.Row second = snapshot.rows.size() > 1 ? snapshot.rows.get(1) : null;
        state.put("nextDest", first.dest);
        putNullable(state, "nextEta", first.eta);
        putNullable(state, "nextMinutes", first.minutes);
        if (second == null) {
            state.remove("secondDest"); state.remove("secondEta"); state.remove("secondMinutes");
        } else {
            state.put("secondDest", second.dest);
            putNullable(state, "secondEta", second.eta);
            putNullable(state, "secondMinutes", second.minutes);
        }
        state.put("lineLabel", first.lineLabel == null ? snapshot.systemLabel : first.lineLabel);
        if (first.color == null || first.color.isEmpty()) state.remove("color");
        else state.put("color", first.color);
        if (first.crowd == null || first.crowd.length == 0) state.remove("crowd");
        else {
            JSONArray crowd = new JSONArray();
            for (int value : first.crowd) crowd.put(value);
            state.put("crowd", crowd);
        }
        state.put("dataAt", snapshot.dataAt);
        state.remove("notice");
    }

    private static void putNullable(JSONObject state, String key, Object value) throws JSONException {
        if (value == null) state.remove(key);
        else state.put(key, value);
    }

    private static void save(Context context, JSONObject state) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_STATE, state.toString()).apply();
    }

    private static JSONObject load(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = p.getString(KEY_STATE, null);
        if (raw == null) return null;
        try { return new JSONObject(raw); }
        catch (JSONException ignored) { return null; }
    }

    private static void scheduleEnd(Context context, long when) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        Intent intent = new Intent(context, MetroWaitStopReceiver.class).setAction(MetroWaitStopReceiver.ACTION_EXPIRE);
        PendingIntent pending = PendingIntent.getBroadcast(context, END_REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (Build.VERSION.SDK_INT >= 23) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
        else alarm.set(AlarmManager.RTC_WAKEUP, when, pending);
    }

    private static void cancelEnd(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, MetroWaitStopReceiver.class).setAction(MetroWaitStopReceiver.ACTION_EXPIRE);
        PendingIntent pending = PendingIntent.getBroadcast(context, END_REQUEST_CODE, intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (alarm != null && pending != null) alarm.cancel(pending);
    }

    private static void scheduleRefresh(Context context, JSONObject state, boolean retry) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        long now = System.currentTimeMillis();
        long endAt = (long) (state.optDouble("endAt", 0) * 1000);
        long when;
        Double eta = nullableDouble(state, "nextEta");
        if (!retry && eta != null && eta * 1000 > now) {
            long etaMillis = (long) (eta * 1000);
            when = etaMillis > now + 60_000L
                ? Math.max(now + 1_000L, etaMillis - 60_000L)
                : etaMillis + 31_000L;
        } else when = now + (retry ? 120_000L : 60_000L);
        if (endAt > 0 && when >= endAt) return;
        Intent intent = new Intent(context, MetroWaitStopReceiver.class).setAction(MetroWaitStopReceiver.ACTION_REFRESH);
        PendingIntent pending = PendingIntent.getBroadcast(context, REFRESH_REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (Build.VERSION.SDK_INT >= 23) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
        else alarm.set(AlarmManager.RTC_WAKEUP, when, pending);
    }

    private static void cancelRefresh(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, MetroWaitStopReceiver.class).setAction(MetroWaitStopReceiver.ACTION_REFRESH);
        PendingIntent pending = PendingIntent.getBroadcast(context, REFRESH_REQUEST_CODE, intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (alarm != null && pending != null) alarm.cancel(pending);
    }

    private static String countdown(Double eta, Integer minutes, long now) {
        if (eta != null) {
            long sec = Math.max(0, Math.round(eta - now / 1000.0));
            if (sec <= 60) return "進站";
            return String.format(Locale.TAIWAN, "%d:%02d", sec / 60, sec % 60);
        }
        return minutes == null ? "—" : "約 " + minutes + " 分";
    }

    private static String shortCritical(String text) {
        if (text.length() <= 7) return text;
        return text.substring(0, 7);
    }

    private static String crowdText(JSONArray crowd) {
        if (crowd == null || crowd.length() == 0) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < crowd.length(); i++) {
            int v = crowd.optInt(i, 1);
            out.append(v <= 1 ? "▰" : v == 2 ? "▰" : "▮");
            if (i + 1 < crowd.length()) out.append(' ');
        }
        return out.toString();
    }

    private static String formatTime(long millis) {
        SimpleDateFormat f = new SimpleDateFormat("HH:mm", Locale.TAIWAN);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Taipei"));
        return f.format(new Date(millis));
    }

    private static Double nullableDouble(JSONObject object, String key) {
        if (!object.has(key) || object.isNull(key)) return null;
        double value = object.optDouble(key, Double.NaN);
        return Double.isNaN(value) ? null : value;
    }

    private static Integer nullableInt(JSONObject object, String key) {
        if (!object.has(key) || object.isNull(key)) return null;
        return object.optInt(key);
    }
}
