package tw.railisland.app;

import android.content.Context;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
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

    /**
     * 預設大小的卡：maxRows 以一般字級計；大字版列高 30dp→42dp，同一塊地方照比例少放
     * （預設大小實測：小 3→2、中 3→2、大 9→6，與按比例換算相同）。
     */
    static RemoteViews board(Context context, int layout, RailWidgetData.Snapshot snapshot,
                             int maxRows, boolean readable, boolean compact) {
        return boardWithRows(context, layout, snapshot, readable ? maxRows * 30 / 42 : maxRows, readable, compact);
    }

    /** 恰好放 count 班的卡（至少一列：沒有班次時那一列是空狀態）。count 由 {@link #rowsThatFit} 量出來。 */
    static RemoteViews boardWithRows(Context context, int layout, RailWidgetData.Snapshot snapshot,
                                     int count, boolean readable, boolean compact) {
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
        // 🔴 退快取標示排在「資料延遲」之後、其餘之前：資料本身壞掉比位置舊更急，
        //    但「這一站是上次的位置解析出來的」一定要看得見——不標的話退化狀態與正常狀態
        //    長得一模一樣，使用者只會覺得自動選站壞了而無從分辨（iOS 側同一條決定）。
        String note = snapshot.failed ? RailNativeL10n.text(context, "資料延遲 · 顯示上次成功結果")
            : snapshot.autoStale ? RailNativeL10n.text(context, "上次位置 · 開啟軌島更新")
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
        int limit = Math.min(rows.size(), Math.max(1, count));
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

    /**
     * 這張卡在 widthDp×heightDp 的格子裡放得下幾班（1～max）；量不出來回 0，呼叫端退回預設列數。
     * 🔴 台鐵列是固定高度（widget_rail_row 30dp／好讀版 42dp），放不下會從列中間切掉，所以要算準。
     *    不估字高：把整張卡在本 App 裡照桌面的方式 apply 出來量（字型、字級、Samsung 字體、
     *    警示時露出的註腳都跟桌面同一套），量「表頭＋N 列＋註腳」的最小高度，N 加到放不下為止。
     *    Samsung One UI 先照回報尺寸排版、再整張縮 0.83 畫上桌面，所以拿回報的 dp 比就對。
     */
    static int rowsThatFit(Context context, RemoteViews card, float widthDp, float heightDp, int max) {
        try {
            View root = card.apply(context, new FrameLayout(context));
            ViewGroup rows = root.findViewById(R.id.wr_rows);
            if (rows == null || rows.getChildCount() == 0) return 0;
            int rowPx = rows.getChildAt(0).getLayoutParams().height;
            if (rowPx <= 0) return 0;
            rows.removeAllViews();
            float density = context.getResources().getDisplayMetrics().density;
            int widthSpec = View.MeasureSpec.makeMeasureSpec(Math.round(widthDp * density), View.MeasureSpec.EXACTLY);
            int unbounded = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED);
            int limitPx = (int) Math.floor(heightDp * density);
            int fit = 1;
            for (int n = 2; n <= max; n++) {
                rows.setMinimumHeight(n * rowPx);
                root.measure(widthSpec, unbounded);
                if (root.getMeasuredHeight() > limitPx) break;
                fit = n;
            }
            return fit;
        } catch (RuntimeException error) {
            return 0;
        }
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
