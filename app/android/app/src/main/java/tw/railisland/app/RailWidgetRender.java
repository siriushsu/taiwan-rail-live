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
        boolean model = layout == R.layout.widget_rail_2x2_model || layout == R.layout.widget_rail_4x2_model
            || layout == R.layout.widget_rail_4x4_model;
        boolean scene = layout == R.layout.widget_rail_2x2_scene || layout == R.layout.widget_rail_4x2_scene
            || layout == R.layout.widget_rail_4x4_scene;
        String origin = RailNativeL10n.name(context, snapshot.origin);
        // 車模頭帶與場景站名牌都只寫站名（mockup），「發車看板」四個字只留給素色版的標題列。
        root.setTextViewText(R.id.wr_head, compact || model ? origin : RailNativeL10n.text(context,
            "{station}發車看板", "station", origin));
        root.setTextViewText(R.id.wr_route, snapshot.destination == null || snapshot.destination.isEmpty()
            ? RailNativeL10n.text(context, snapshot.includePass
                ? "全部目的地 · 直達／停靠／終到／通過"
                : "全部目的地 · 停靠與終到")
            : RailNativeL10n.text(context, "往 {station} · 直達列車", "station", RailNativeL10n.name(context, snapshot.destination)));
        root.setTextViewText(R.id.wr_stamp, clock(snapshot.generatedAt) + (compact ? "" : " " + RailNativeL10n.text(context, "更新")));
        // 🔴 退快取標示排在「資料延遲」之後、其餘之前：資料本身壞掉比位置舊更急，
        //    但「這一站是上次的位置解析出來的」一定要看得見——不標的話退化狀態與正常狀態
        //    長得一模一樣，使用者只會覺得自動選站壞了而無從分辨（iOS 側同一條決定）。
        String note = snapshot.failed ? RailNativeL10n.text(context, "資料延遲 · 顯示上次成功結果")
            : snapshot.autoStale ? RailNativeL10n.text(context, "上次位置 · 開啟軌島更新")
            : snapshot.scheduleNote != null ? scheduleNote(context, snapshot.scheduleNote)
            : RailNativeL10n.text(context, "台鐵即時誤點 · 高鐵表定時刻");
        root.setTextViewText(R.id.wr_note, note);
        if (model) bindCar(root, snapshot.rows);
        if (scene) bindPlate(context, root, layout, snapshot, origin);
        // 🔴 車模／場景小卡平常收掉註腳讓位給車與場景，但註腳是警示時（這張卡的數字可能錯）一定要露出來；
        //    車模小卡有警示就不畫車——整行會壓進車身讀不出來，警示比裝飾重要（與 iOS 同一條規則）。
        boolean small = layout == R.layout.widget_rail_2x2_model || layout == R.layout.widget_rail_2x2_scene;
        if (small && warning(snapshot)) {
            root.setViewVisibility(R.id.wr_note, View.VISIBLE);
            if (model) root.setViewVisibility(R.id.wr_car, View.GONE);
        }
        if (readable) {
            // 好讀版一律畫素色版面（WidgetBackground.effective），這裡只會遇到三張素色。
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

    /** 註腳是不是警示：資料延遲、上次位置、班表過期退回同星期／超出涵蓋日期。高鐵「當日班表」是例行標示，不算。 */
    private static boolean warning(RailWidgetData.Snapshot snapshot) {
        return snapshot.failed || snapshot.autoStale
            || snapshot.scheduleNote != null && !snapshot.scheduleNote.endsWith(" 當日班表");
    }

    /** A 車模頭帶：下一班（排序後第一列）的車種代表車；沒有班次就收掉車、頭帶照留。 */
    private static void bindCar(RemoteViews root, List<RailWidgetData.Row> rows) {
        if (rows.isEmpty()) {
            root.setViewVisibility(R.id.wr_car, View.GONE);
            return;
        }
        RailWidgetData.Row next = rows.get(0);
        root.setViewVisibility(R.id.wr_car, View.VISIBLE);
        root.setImageViewResource(R.id.wr_car, WidgetBackground.railCar(next.sys, next.type));
    }

    /**
     * C 場景的琺瑯站名牌：站名＋下緣鄰站帶。直達模式（有目的站）帶子改寫「往 目的站」；
     * 鄰站缺一側就把那一側設成 INVISIBLE（另一側仍靠在自己那邊），兩側都沒有整條帶子收掉。
     */
    private static void bindPlate(Context context, RemoteViews root, int layout, RailWidgetData.Snapshot snapshot,
                                  String origin) {
        root.setTextViewText(R.id.wr_plate_name, origin);
        // 🔴 RemoteViews 量不到字寬，站名長度卻從「板橋」到「新左營／高鐵左營」「Chang Jung Christian University」都有：
        //    依字數估寬（全形 1em、半形約 0.62em，再加 0.28em 字距），縮到這張版面最窄那一格放得下為止；
        //    縮到下限還放不下才交給 ellipsize。牌子本身由 FrameLayout 以 AT_MOST 量寬，永遠不會超出卡片被裁。
        boolean large = layout == R.layout.widget_rail_4x4_scene;
        float em = 0;
        for (int i = 0; i < origin.length(); ) {
            int cp = origin.codePointAt(i);
            em += (cp >= 0x2E80 ? 1f : 0.62f) + 0.28f;
            i += Character.charCount(cp);
        }
        // 各版面在最窄那一格（大、中卡 200dp；小卡以 150dp 計）扣掉卡片與牌子內距後，留給站名的寬度。
        float budget = large ? 140f : layout == R.layout.widget_rail_4x2_scene ? 150f : 96f;
        float base = large ? 21f : 14f;
        float size = Math.max(large ? 12f : 9f, Math.min(base, budget / Math.max(1f, em)));
        root.setTextViewTextSize(R.id.wr_plate_name, TypedValue.COMPLEX_UNIT_SP, size);
        boolean direct = snapshot.destination != null && !snapshot.destination.isEmpty();
        boolean sides = snapshot.neighborSouth != null || snapshot.neighborNorth != null;
        root.setViewVisibility(R.id.wr_plate_band, direct || sides ? View.VISIBLE : View.GONE);
        root.setViewVisibility(R.id.wr_plate_one, direct ? View.VISIBLE : View.GONE);
        root.setViewVisibility(R.id.wr_plate_prev, direct ? View.GONE
            : snapshot.neighborSouth == null ? View.INVISIBLE : View.VISIBLE);
        root.setViewVisibility(R.id.wr_plate_next, direct ? View.GONE
            : snapshot.neighborNorth == null ? View.INVISIBLE : View.VISIBLE);
        if (direct) {
            root.setTextViewText(R.id.wr_plate_one, RailNativeL10n.text(context, "往 {station}",
                "station", RailNativeL10n.name(context, snapshot.destination)));
            return;
        }
        root.setTextViewText(R.id.wr_plate_prev, snapshot.neighborSouth == null ? ""
            : "◀ " + RailNativeL10n.name(context, snapshot.neighborSouth));
        root.setTextViewText(R.id.wr_plate_next, snapshot.neighborNorth == null ? ""
            : RailNativeL10n.name(context, snapshot.neighborNorth) + " ▶");
    }

    static RemoteViews row(Context context, RailWidgetData.Row row, boolean readable, boolean compact) {
        RemoteViews out = row(context, row, readable
            ? R.layout.widget_rail_row_readable : R.layout.widget_rail_row);
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

    /** 只綁資料、不動字級：任何帶 wrr_* 這組 id 的列 layout 都能用（雙看板的主角列／次列也走這裡）。 */
    static RemoteViews row(Context context, RailWidgetData.Row row, int layout) {
        RemoteViews out = new RemoteViews(context.getPackageName(), layout);
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
        String platform = row.platformAt(System.currentTimeMillis());
        out.setViewVisibility(R.id.wrr_platform, platform == null ? View.GONE : View.VISIBLE);
        out.setTextViewText(R.id.wrr_platform, platform == null ? ""
            : RailNativeL10n.text(context, "月台 {platform}", "platform", platform));
        out.setContentDescription(R.id.wrr_platform, platform == null ? ""
            : RailNativeL10n.text(context, "月台 {platform}", "platform", platform));
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
