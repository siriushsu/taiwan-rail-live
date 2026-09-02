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
        String origin = RailNativeL10n.name(context, snapshot.origin);
        root.setTextViewText(R.id.wr_head, compact ? origin : RailNativeL10n.text(context,
            "{station}發車看板", "station", origin));
        root.setTextViewText(R.id.wr_route, snapshot.destination == null || snapshot.destination.isEmpty()
            ? RailNativeL10n.text(context, snapshot.includePass
                ? "全部目的地 · 直達／停靠／終到／通過"
                : "全部目的地 · 停靠與終到")
            : RailNativeL10n.text(context, "往 {station} · 直達列車", "station", RailNativeL10n.name(context, snapshot.destination)));
        root.setTextViewText(R.id.wr_stamp, clock(snapshot.generatedAt) + (compact ? "" : " " + RailNativeL10n.text(context, "更新")));
        String note = snapshot.failed ? RailNativeL10n.text(context, "資料延遲 · 顯示上次成功結果")
            : snapshot.scheduleNote != null ? scheduleNote(context, snapshot.scheduleNote)
            : RailNativeL10n.text(context, "台鐵即時誤點 · 高鐵表定時刻");
        root.setTextViewText(R.id.wr_note, note);
        if (readable) {
            boolean large = layout == R.layout.widget_rail_4x4;
            root.setTextViewTextSize(R.id.wr_head, TypedValue.COMPLEX_UNIT_SP,
                compact ? 17 : large ? 20 : 18);
            root.setTextViewTextSize(R.id.wr_route, TypedValue.COMPLEX_UNIT_SP,
                large ? 12 : 11);
            root.setTextViewTextSize(R.id.wr_stamp, TypedValue.COMPLEX_UNIT_SP,
                large ? 11 : 10);
            root.setTextViewTextSize(R.id.wr_note, TypedValue.COMPLEX_UNIT_SP,
                large ? 10 : 9);
        }
        root.removeAllViews(R.id.wr_rows);

        List<RailWidgetData.Row> rows = snapshot.rows;
        int limit = Math.min(rows.size(), Math.max(1, maxRows - (readable ? (compact ? 1 : 2) : 0)));
        for (int i = 0; i < limit; i++) root.addView(R.id.wr_rows, row(context, rows.get(i), readable, compact));
        if (limit == 0) {
            RemoteViews empty = new RemoteViews(context.getPackageName(), readable
                ? R.layout.widget_rail_row_readable : R.layout.widget_rail_row);
            empty.setViewVisibility(R.id.wrr_mark, View.INVISIBLE);
            empty.setViewVisibility(R.id.wrr_heading, View.GONE);
            boolean onlyPassing = snapshot.hiddenPass > 0;
            empty.setTextViewText(R.id.wrr_train, RailNativeL10n.text(context,
                onlyPassing ? "本站今日沒有停靠的列車" : "目前沒有接下來的班次"));
            empty.setTextViewText(R.id.wrr_dest, RailNativeL10n.text(context,
                onlyPassing ? "只有通過列車 · 可在設定開啟「含通過列車」" : "請稍後再看或點卡片開啟軌島"));
            empty.setViewVisibility(R.id.wrr_status, View.GONE);
            empty.setViewVisibility(R.id.wrr_time, View.GONE);
            root.addView(R.id.wr_rows, empty);
        }
        return root;
    }

    static RemoteViews row(Context context, RailWidgetData.Row row, boolean readable, boolean compact) {
        RemoteViews out = new RemoteViews(context.getPackageName(), readable
            ? R.layout.widget_rail_row_readable : R.layout.widget_rail_row);
        int color;
        try { color = Color.parseColor(row.color); }
        catch (IllegalArgumentException ignored) { color = context.getColor(R.color.wg_navy); }
        out.setInt(R.id.wrr_mark, "setColorFilter", color);
        // 方向三角（與 iOS RailHeadingMark 對等）。沒有方向就整顆收起來,不畫猜的三角;
        // 🔴 各列獨立、不連成線——不准加貫穿列的線、不准把相鄰兩顆三角對齊成軌跡（iOS 側裁示：
        //    它取代的軌脊圓點正是因為「連成一條線」才被讀成連續車站）。
        // 顏色不獨立表意:三角本身是形狀差異（尖端朝上／朝下）,另有 contentDescription 唸出來。
        if (row.heading == null) {
            out.setViewVisibility(R.id.wrr_heading, View.GONE);
        } else {
            boolean north = row.heading == RailWidgetData.Heading.NORTH;
            out.setViewVisibility(R.id.wrr_heading, View.VISIBLE);
            out.setImageViewResource(R.id.wrr_heading,
                north ? R.drawable.wg_heading_north : R.drawable.wg_heading_south);
            out.setContentDescription(R.id.wrr_heading,
                RailNativeL10n.text(context, north ? "北上" : "南下"));
        }
        out.setTextViewText(R.id.wrr_train, RailNativeL10n.name(context, row.type) + " " + row.no);
        String relation;
        switch (row.relation) {
            case PASS: relation = RailNativeL10n.text(context, "通過 · 往{station}", "station", RailNativeL10n.name(context, row.terminus)); break;
            case ARRIVAL: relation = RailNativeL10n.text(context, "終到本站"); break;
            default: relation = RailNativeL10n.text(context, "往 {station}", "station", RailNativeL10n.name(context, row.terminus));
        }
        if (row.destinationAt != null) relation += " · " + RailNativeL10n.text(context, "{time} 抵達", "time", clock(row.destinationAt));
        out.setTextViewText(R.id.wrr_dest, relation);
        out.setTextViewText(R.id.wrr_time, clock(row.scheduledAt));
        if (row.delayMinutes == null) {
            out.setTextViewText(R.id.wrr_status, RailNativeL10n.text(context, row.sys.equals("thsr") ? "表定" : "尚無讀數"));
            out.setTextColor(R.id.wrr_status, context.getColor(R.color.wg_ink_faint));
        } else if (row.delayMinutes == 0) {
            out.setTextViewText(R.id.wrr_status, RailNativeL10n.text(context, "準點"));
            out.setTextColor(R.id.wrr_status, context.getColor(R.color.wg_ok));
        } else if (row.delayMinutes > 0) {
            out.setTextViewText(R.id.wrr_status, RailNativeL10n.text(context, "誤點 {n} 分", "n", String.valueOf(row.delayMinutes)));
            out.setTextColor(R.id.wrr_status, row.delayMinutes >= 10
                ? context.getColor(R.color.wg_bad) : context.getColor(R.color.wg_warn));
        } else {
            out.setTextViewText(R.id.wrr_status, RailNativeL10n.text(context, "早到 {n} 分", "n", String.valueOf(Math.abs(row.delayMinutes))));
            out.setTextColor(R.id.wrr_status, context.getColor(R.color.wg_ok));
        }
        if (compact) {
            out.setViewVisibility(R.id.wrr_status, View.GONE);
            out.setTextViewTextSize(R.id.wrr_time, TypedValue.COMPLEX_UNIT_SP, readable ? 23 : 15);
            out.setTextViewTextSize(R.id.wrr_train, TypedValue.COMPLEX_UNIT_SP, readable ? 16 : 11);
        } else if (readable) {
            out.setTextViewTextSize(R.id.wrr_time, TypedValue.COMPLEX_UNIT_SP, 23);
            out.setTextViewTextSize(R.id.wrr_train, TypedValue.COMPLEX_UNIT_SP, 16);
            out.setTextViewTextSize(R.id.wrr_status, TypedValue.COMPLEX_UNIT_SP, 12);
            out.setViewVisibility(R.id.wrr_dest, View.GONE);
        }
        return out;
    }

    static RemoteViews message(Context context, String title, String body) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_rail_message);
        views.setTextViewText(R.id.wrm_title, RailNativeL10n.text(context, title));
        views.setTextViewText(R.id.wrm_body, RailNativeL10n.text(context, body));
        return views;
    }

    private static String scheduleNote(Context context, String source) {
        if (source.startsWith("依 ") && source.endsWith(" 同星期班表")) {
            return RailNativeL10n.text(context, "依 {date} 同星期班表",
                "date", source.substring(2, source.length() - " 同星期班表".length()));
        }
        if (source.startsWith("高鐵 ") && source.endsWith(" 當日班表")) {
            return RailNativeL10n.text(context, "高鐵 {date} 當日班表",
                "date", source.substring(3, source.length() - " 當日班表".length()));
        }
        return RailNativeL10n.text(context, source);
    }

    private static String clock(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("HH:mm", Locale.TAIWAN);
        format.setTimeZone(TAIPEI);
        return format.format(new Date(millis));
    }
}
