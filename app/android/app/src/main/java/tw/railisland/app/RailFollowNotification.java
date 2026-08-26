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
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.Locale;

/** 跟隨列車的鎖屏卡：Android 16 是 Live Update／Samsung Now Bar，舊版是持續通知。 */
final class RailFollowNotification {
    static final String CHANNEL_ID = "rail_follow_live_v1";
    static final int NOTIFICATION_ID = 46401;
    static final int STOP_REQUEST_CODE = 46402;
    static final int ADVANCE_REQUEST_CODE = 46403;
    static final String PREFS = "rail_follow_live";
    static final String KEY_STATE = "active_state";

    private RailFollowNotification() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "跟隨列車", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("在鎖定畫面與 Now Bar 顯示正在跟隨列車的下一站");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    static void start(Context context, JSONObject payload) throws JSONException {
        stop(context);
        payload.put("active", true);
        save(context, payload);
        post(context, payload);
        scheduleAdvance(context, payload);
    }

    static void update(Context context, JSONObject payload) throws JSONException {
        JSONObject state = load(context);
        if (state == null) {
            start(context, payload);
            return;
        }
        Iterator<String> keys = payload.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            state.put(key, payload.get(key));
        }
        state.put("active", true);
        save(context, state);
        post(context, state);
        scheduleAdvance(context, state);
    }

    static JSONObject status(Context context) {
        JSONObject state = load(context);
        return state != null && state.optBoolean("active", false) ? state : null;
    }

    static void post(Context context, JSONObject state) {
        if (!canNotify(context)) return;
        createChannel(context);
        long now = System.currentTimeMillis();
        String trainNo = state.optString("trainNo", "");
        String kind = state.optString("kind", "列車");
        String nextStop = state.optString("nextStop", "下一站");
        String terminus = state.optString("terminus", "");
        String prevStop = state.optString("prevStop", "");
        boolean stopping = state.optBoolean("stopping", false);
        long arrival = (long) (state.optDouble("arrivalAt", 0) * 1000);
        long departed = (long) (state.optDouble("departedAt", 0) * 1000);
        int delay = state.optInt("delaySec", 0);

        String title = (kind + " " + trainNo).trim();
        String status = stopping ? "停靠 " + nextStop : "下一站 " + nextStop;
        String route = terminus.isEmpty() ? status : status + " · 往 " + terminus;
        String detail = route;
        if (!prevStop.isEmpty() && !stopping) detail += "\n" + prevStop + " → " + nextStop;
        if (delay != 0) detail += "\n" + delayText(delay);

        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(context, 46400, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(context, RailFollowStopReceiver.class).setAction(RailFollowStopReceiver.ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getBroadcast(context, STOP_REQUEST_CODE, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Integer accent = null;
        try {
            String color = state.optString("color", "");
            if (!color.isEmpty()) accent = Color.parseColor(color);
        } catch (IllegalArgumentException ignored) {}

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_train)
            .setContentTitle(title.isEmpty() ? "跟隨列車" : title)
            .setContentText(route)
            .setSubText(delay == 0 ? "軌島 · 準點" : "軌島 · " + delayText(delay))
            .setContentIntent(openPending)
            .addAction(R.drawable.ic_stop, "結束跟車", stopPending)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(shortText(stopping ? "停靠中" : nextStop))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (accent != null) builder.setColor(accent);

        boolean timed = !stopping && arrival > now;
        int progress = 0;
        if (timed) {
            builder.setWhen(arrival).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true);
            long start = departed > 0 && departed < arrival ? departed : now;
            long total = Math.max(1, arrival - start);
            progress = (int) Math.max(0, Math.min(1000, (now - start) * 1000 / total));
            builder.setProgress(1000, progress, false);
        } else builder.setShowWhen(false);

        if (Build.VERSION.SDK_INT >= 36) {
            NotificationCompat.ProgressStyle style = new NotificationCompat.ProgressStyle()
                .setStyledByProgress(true)
                .setProgressTrackerIcon(IconCompat.createWithResource(context, R.drawable.ic_stat_train));
            NotificationCompat.ProgressStyle.Segment segment =
                new NotificationCompat.ProgressStyle.Segment(1000).setId(1);
            NotificationCompat.ProgressStyle.Point destination =
                new NotificationCompat.ProgressStyle.Point(1000).setId(1);
            if (accent != null) { segment.setColor(accent); destination.setColor(accent); }
            style.addProgressSegment(segment).addProgressPoint(destination);
            if (timed) style.setProgress(progress);
            else style.setProgress(stopping ? 1000 : 0).setProgressIndeterminate(!stopping);
            builder.setStyle(style);
        } else {
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(detail));
        }
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // 權限可能在上方 canNotify() 檢查後立刻被使用者從系統設定撤回。
        }
    }

    /** App 退到背景後依前端交來的完整停靠序列，自行把卡片推進到下一站。 */
    static void advance(Context context) {
        JSONObject state = load(context);
        if (state == null) return;
        long nowSec = System.currentTimeMillis() / 1000;
        JSONArray stops = state.optJSONArray("remainingStops");
        JSONObject next = null;
        if (stops != null) for (int i = 0; i < stops.length(); i++) {
            JSONObject candidate = stops.optJSONObject(i);
            if (candidate != null && candidate.optLong("advanceAt", candidate.optLong("arrivalAt")) > nowSec) {
                next = candidate; break;
            }
        }
        if (next == null) { stop(context); return; }
        try {
            state.put("nextStop", next.optString("name", ""));
            state.put("arrivalAt", next.optDouble("arrivalAt", 0));
            state.put("departedAt", next.optDouble("departedAt", 0));
            state.put("advanceAt", next.optDouble("advanceAt", next.optDouble("arrivalAt", 0)));
            state.put("prevStop", next.optString("prevStop", ""));
            state.put("stopping", false);
            save(context, state);
            post(context, state);
            scheduleAdvance(context, state);
        } catch (JSONException ignored) { stop(context); }
    }

    static void stop(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
        cancelAdvance(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_STATE).apply();
    }

    private static boolean canNotify(Context context) {
        return Build.VERSION.SDK_INT < 33
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private static void save(Context context, JSONObject state) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_STATE, state.toString()).apply();
    }

    private static JSONObject load(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_STATE, null);
        if (raw == null) return null;
        try { return new JSONObject(raw); }
        catch (JSONException ignored) { return null; }
    }

    private static PendingIntent advanceIntent(Context context, int flags) {
        Intent intent = new Intent(context, RailFollowStopReceiver.class).setAction(RailFollowStopReceiver.ACTION_ADVANCE);
        return PendingIntent.getBroadcast(context, ADVANCE_REQUEST_CODE, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void scheduleAdvance(Context context, JSONObject state) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        long now = System.currentTimeMillis();
        long advance = (long) (state.optDouble("advanceAt", state.optDouble("arrivalAt", 0)) * 1000);
        long when = Math.max(now + 30_000L, advance + 15_000L);
        alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when,
            advanceIntent(context, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    private static void cancelAdvance(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = advanceIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (alarm != null && pending != null) alarm.cancel(pending);
    }

    private static String delayText(int seconds) {
        int minutes = Math.round(Math.abs(seconds) / 60f);
        if (minutes == 0) return seconds > 0 ? "稍有延誤" : "提早";
        return seconds > 0 ? String.format(Locale.TAIWAN, "晚 %d 分", minutes)
            : String.format(Locale.TAIWAN, "早 %d 分", minutes);
    }

    private static String shortText(String value) {
        if (value == null) return "";
        return value.length() <= 7 ? value : value.substring(0, 7);
    }
}
