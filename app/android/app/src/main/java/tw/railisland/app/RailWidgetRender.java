package tw.railisland.app;

import android.content.Context;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** 台鐵／高鐵發車看板 RemoteViews binder；三尺寸共用同一列元件與同一套事實文案。 */
final class RailWidgetRender {
    private static final TimeZone TAIPEI = TimeZone.getTimeZone("Asia/Taipei");

    private RailWidgetRender() {}

    static RemoteViews board(Context context, int layout, RailWidgetData.Snapshot snapshot,
                             int maxRows, boolean readable, boolean compact) {
        RemoteViews root = new RemoteViews(context.getPackageName(), layout);
        root.setTextViewText(R.id.wr_head, snapshot.origin + (compact ? "" : "發車看板"));
        root.setTextViewText(R.id.wr_route, snapshot.destination == null || snapshot.destination.isEmpty()
            ? "全部目的地 · 直達／停靠／終到／通過" : "往 " + snapshot.destination + " · 直達列車");
        root.setTextViewText(R.id.wr_stamp, clock(snapshot.generatedAt) + (compact ? "" : " 更新"));
        String note = snapshot.failed ? "資料延遲 · 顯示上次成功結果"
            : snapshot.scheduleNote != null ? snapshot.scheduleNote
            : "台鐵即時誤點 · 高鐵表定時刻";
        root.setTextViewText(R.id.wr_note, note);
        root.removeAllViews(R.id.wr_rows);

        List<RailWidgetData.Row> rows = snapshot.rows;
        int limit = Math.min(rows.size(), Math.max(1, maxRows - (readable ? (compact ? 1 : 2) : 0)));
        for (int i = 0; i < limit; i++) root.addView(R.id.wr_rows, row(context, rows.get(i), readable, compact));
        if (limit == 0) {
            RemoteViews empty = new RemoteViews(context.getPackageName(), R.layout.widget_rail_row);
            empty.setViewVisibility(R.id.wrr_mark, View.INVISIBLE);
            empty.setTextViewText(R.id.wrr_train, "目前沒有接下來的班次");
            empty.setTextViewText(R.id.wrr_dest, "請稍後再看或點卡片開啟軌島");
            empty.setViewVisibility(R.id.wrr_status, View.GONE);
            empty.setViewVisibility(R.id.wrr_time, View.GONE);
            root.addView(R.id.wr_rows, empty);
        }
        return root;
    }

    static RemoteViews row(Context context, RailWidgetData.Row row, boolean readable, boolean compact) {
        RemoteViews out = new RemoteViews(context.getPackageName(), R.layout.widget_rail_row);
        int color;
        try { color = Color.parseColor(row.color); }
        catch (IllegalArgumentException ignored) { color = context.getColor(R.color.wg_navy); }
        out.setInt(R.id.wrr_mark, "setColorFilter", color);
        out.setTextViewText(R.id.wrr_train, row.type + " " + row.no);
        String relation;
        switch (row.relation) {
            case PASS: relation = "通過 · 往 " + row.terminus; break;
            case ARRIVAL: relation = "終到本站"; break;
            default: relation = "往 " + row.terminus;
        }
        if (row.destinationAt != null) relation += " · " + clock(row.destinationAt) + " 抵達";
        out.setTextViewText(R.id.wrr_dest, relation);
        out.setTextViewText(R.id.wrr_time, clock(row.scheduledAt));
        if (row.delayMinutes == null) {
            out.setTextViewText(R.id.wrr_status, row.sys.equals("thsr") ? "表定" : "尚無讀數");
            out.setTextColor(R.id.wrr_status, context.getColor(R.color.wg_ink_faint));
        } else if (row.delayMinutes == 0) {
            out.setTextViewText(R.id.wrr_status, "準點");
            out.setTextColor(R.id.wrr_status, context.getColor(R.color.wg_ok));
        } else if (row.delayMinutes > 0) {
            out.setTextViewText(R.id.wrr_status, "+" + row.delayMinutes + "分");
            out.setTextColor(R.id.wrr_status, row.delayMinutes >= 10
                ? context.getColor(R.color.wg_bad) : context.getColor(R.color.wg_warn));
        } else {
            out.setTextViewText(R.id.wrr_status, "早" + Math.abs(row.delayMinutes) + "分");
            out.setTextColor(R.id.wrr_status, context.getColor(R.color.wg_ok));
        }
        if (compact) {
            out.setViewVisibility(R.id.wrr_status, View.GONE);
            out.setTextViewTextSize(R.id.wrr_time, TypedValue.COMPLEX_UNIT_SP, readable ? 17 : 15);
            out.setTextViewTextSize(R.id.wrr_train, TypedValue.COMPLEX_UNIT_SP, readable ? 12 : 11);
        } else if (readable) {
            out.setTextViewTextSize(R.id.wrr_time, TypedValue.COMPLEX_UNIT_SP, 18);
            out.setTextViewTextSize(R.id.wrr_train, TypedValue.COMPLEX_UNIT_SP, 13);
            out.setViewVisibility(R.id.wrr_dest, View.GONE);
        }
        return out;
    }

    static RemoteViews message(Context context, String title, String body) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_rail_message);
        views.setTextViewText(R.id.wrm_title, title);
        views.setTextViewText(R.id.wrm_body, body);
        return views;
    }

    private static String clock(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("HH:mm", Locale.TAIWAN);
        format.setTimeZone(TAIPEI);
        return format.format(new Date(millis));
    }
}
