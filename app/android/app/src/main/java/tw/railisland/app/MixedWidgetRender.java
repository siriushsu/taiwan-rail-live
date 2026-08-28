package tw.railisland.app;

import android.content.Context;
import android.graphics.Color;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** 鐵路＋捷運雙看板 binder；資料判定直接重用兩張獨立小工具，不另造第三套規則。 */
final class MixedWidgetRender {
    private static final TimeZone TAIPEI = TimeZone.getTimeZone("Asia/Taipei");

    private MixedWidgetRender() {}

    static RemoteViews board(Context context, RailWidgetData.Snapshot rail, MetroWidgetData.Snapshot metro) {
        RemoteViews root = new RemoteViews(context.getPackageName(), R.layout.widget_mixed_4x4);
        root.setTextViewText(R.id.wmx_head, metro.station + "雙看板");
        root.setTextViewText(R.id.wmx_stamp, clock(Math.max(rail.generatedAt, (long) (metro.dataAt * 1000))) + " 更新");
        root.setTextViewText(R.id.wmx_metro_head, "捷運 · " + metro.systemLabel + " · " + metro.station);
        root.setTextViewText(R.id.wmx_rail_head, "鐵路 · " + rail.systemLabel + " · " + rail.origin);
        root.setTextViewText(R.id.wmx_note, (metro.failed || rail.failed)
            ? "部分資料延遲 · 顯示上次成功結果" : "捷運即時 · 台鐵誤點 · 高鐵表定");

        root.removeAllViews(R.id.wmx_metro_rows);
        List<MetroWidgetPlate> plates = MetroWidgetProvider.plates(context, metro);
        for (int i = 0; i < Math.min(3, plates.size()); i++) {
            root.addView(R.id.wmx_metro_rows, metroRow(context, plates.get(i), i == 0));
        }

        root.removeAllViews(R.id.wmx_rail_rows);
        int limit = Math.min(3, rail.rows.size());
        for (int i = 0; i < limit; i++) {
            root.addView(R.id.wmx_rail_rows, RailWidgetRender.row(context, rail.rows.get(i), false, false));
        }
        if (limit == 0) {
            RailWidgetData.Row empty = new RailWidgetData.Row();
            empty.sys = rail.sys;
            empty.no = "—";
            empty.type = "目前無班次";
            empty.color = "#8A8471";
            empty.terminus = "請稍後再看";
            empty.relation = RailWidgetData.Relation.DEPARTURE;
            empty.scheduledAt = System.currentTimeMillis();
            root.addView(R.id.wmx_rail_rows, RailWidgetRender.row(context, empty, false, false));
        }
        return root;
    }

    static RemoteViews message(Context context, String title, String body) {
        RemoteViews root = new RemoteViews(context.getPackageName(), R.layout.widget_mixed_message);
        root.setTextViewText(R.id.wmxm_title, title);
        root.setTextViewText(R.id.wmxm_body, body);
        return root;
    }

    private static RemoteViews metroRow(Context context, MetroWidgetPlate plate, boolean first) {
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_mixed_metro_row);
        int color;
        try { color = Color.parseColor(plate.badgeColor); }
        catch (Exception ignored) { color = context.getColor(R.color.wg_navy); }
        row.setInt(R.id.wmxr_mark, "setColorFilter", color);
        row.setTextViewText(R.id.wmxr_dest, plate.dest == null || plate.dest.isEmpty() ? "本站列車" : plate.dest);
        String sub = plate.footLeft == null ? "" : plate.footLeft;
        if (sub.isEmpty() && plate.footRight != null) sub = plate.footRight;
        if (!first && plate.state == MetroWidgetPlate.State.PASS_LIMITED) sub = "";
        row.setTextViewText(R.id.wmxr_sub, sub);
        row.setTextViewText(R.id.wmxr_value, plate.heroValue == null || plate.heroValue.isEmpty() ? "—" : plate.heroValue);
        boolean minutes = plate.hero == MetroWidgetPlate.Hero.MINUTES;
        row.setViewVisibility(R.id.wmxr_unit, minutes ? View.VISIBLE : View.GONE);
        row.setTextColor(R.id.wmxr_value, tone(context, plate.heroTone));
        return row;
    }

    private static int tone(Context context, MetroWidgetPlate.Tone tone) {
        if (tone == null) return context.getColor(R.color.wg_ink);
        switch (tone) {
            case OK: return context.getColor(R.color.wg_ok);
            case WARN: return context.getColor(R.color.wg_warn);
            case BAD: return context.getColor(R.color.wg_bad);
            case FAINT: return context.getColor(R.color.wg_ink_faint);
            default: return context.getColor(R.color.wg_ink);
        }
    }

    private static String clock(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("HH:mm", Locale.TAIWAN);
        format.setTimeZone(TAIPEI);
        return format.format(new Date(millis));
    }
}
