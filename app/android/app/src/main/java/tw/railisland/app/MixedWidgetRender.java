package tw.railisland.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.res.Resources;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * 鐵路＋捷運雙看板 binder；資料判定直接重用兩張獨立小工具，不另造第三套規則。
 *
 * 版面對應 iOS MixedBoardWidget：每段一列主角＋幾列次列，次列數跟著卡片高度走（MixedPlan）。
 * 🔴 2026-09-18 真機回饋「字太小、留空太多」：舊版兩段各固定三列 30dp、兩段各佔一半高度，
 *    大卡上每段底下都空出一大塊，而字只有 9–12sp。改成「字先放大，放得下幾列就列幾列」，
 *    剩下不到一列的高度才留白。
 */
final class MixedWidgetRender {
    private static final TimeZone TAIPEI = TimeZone.getTimeZone("Asia/Taipei");
    /** 兩段合計的次列上限。每一種不同的分配各佔一個尺寸桶（系統上限 16 個）。 */
    static final int MAX_FOLLOWS = 8;
    /** 列高換成像素會四捨五入，十幾列累積起來可能差一兩 dp；留一點，免得註腳被擠出卡外。 */
    private static final float SAFETY_DP = 4f;
    /** 尺寸桶只比高度：寬度取比最小可縮寬度（250dp）還窄的值，任何寬度都放得進。 */
    private static final float BUCKET_WIDTH_DP = 200f;
    /** 31 以下拿不到 launcher 回報的高度時的退路：widget info 的 minHeight。 */
    private static final float FALLBACK_HEIGHT_DP = 270f;

    private MixedWidgetRender() {}

    /**
     * 小工具本體用的整張卡。API 31+ 每一種「次列分配」各給一張、交給系統依實際高度挑
     * （與發車看板／捷運看板同一套做法）；31 以下沒有這個 API，照 launcher 回報的直向高度算一張。
     * 🔴 點擊要在合併【之前】逐張掛好：合併後的 RemoteViews 再加 action 會丟 RuntimeException。
     */
    static RemoteViews sized(Context context, AppWidgetManager manager, int id,
                             RailWidgetData.Snapshot rail, MetroWidgetData.Snapshot metro, PendingIntent tap) {
        List<MetroWidgetPlate> plates = MetroWidgetProvider.plates(context, metro, MAX_FOLLOWS + 1);
        if (Build.VERSION.SDK_INT < 31) {
            Bundle options = manager.getAppWidgetOptions(id);
            int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            RemoteViews views = boardAt(context, rail, metro, height > 0 ? height : FALLBACK_HEIGHT_DP);
            views.setOnClickPendingIntent(R.id.wmx_root, tap);
            return views;
        }
        Map<SizeF, RemoteViews> sizes = new HashMap<>();
        // 比 heightFor(0) 還矮的卡用不放註腳的那一張（見 board 的 bare）；比它還矮時所有桶都放不下，
        // 系統會挑最小的桶，也就是它。
        RemoteViews bare = board(context, rail, metro, plates, plan(0, plates.size(), rail.rows.size()), true);
        bare.setOnClickPendingIntent(R.id.wmx_root, tap);
        sizes.put(new SizeF(BUCKET_WIDTH_DP, heightFor(context, 0) - dp(context, R.dimen.wmx_note_h)), bare);
        int[] last = null;
        for (int slots = 0; slots <= MAX_FOLLOWS; slots++) {
            int[] plan = plan(slots, plates.size(), rail.rows.size());
            // 同一種分配只留最矮的那個桶：更高的卡挑到它，多出來的高度由版面底部那塊空白吃掉。
            if (Arrays.equals(plan, last)) continue;
            last = plan;
            RemoteViews views = board(context, rail, metro, plates, plan, false);
            views.setOnClickPendingIntent(R.id.wmx_root, tap);
            sizes.put(new SizeF(BUCKET_WIDTH_DP, heightFor(context, slots)), views);
        }
        return new RemoteViews(sizes);
    }

    /** 指定卡片高度（dp）的整張卡，給 31 以下、測試與除錯藝廊用；31 以上的小工具本體走 {@link #sized}。 */
    static RemoteViews boardAt(Context context, RailWidgetData.Snapshot rail, MetroWidgetData.Snapshot metro,
                               float heightDp) {
        List<MetroWidgetPlate> plates = MetroWidgetProvider.plates(context, metro, MAX_FOLLOWS + 1);
        return board(context, rail, metro, plates, plan(slots(context, heightDp), plates.size(), rail.rows.size()),
            heightDp < heightFor(context, 0));
    }

    /**
     * 次列名額怎麼分給兩段（iOS MixedPlan 同一條規則）：對半分，奇數時多的一格給捷運
     * （它在前，而且是兩段裡唯一即時的一半）；一段用不完的名額讓給另一段——單線小站不該讓對面空著。
     * 回傳 {捷運次列數, 鐵路次列數}。
     */
    static int[] plan(int slots, int metroRows, int railRows) {
        int metroAvailable = Math.max(0, metroRows - 1);
        int railAvailable = Math.max(0, railRows - 1);
        int wanted = Math.min(metroAvailable, (slots + 1) / 2);
        int rail = Math.min(railAvailable, Math.max(0, slots - wanted));
        int metro = Math.min(metroAvailable, Math.max(0, slots - rail));
        return new int[] { metro, rail };
    }

    /** 卡片高度（dp）放得下幾列次列。 */
    static int slots(Context context, float heightDp) {
        int n = (int) Math.floor((heightDp - fixedDp(context)) / dp(context, R.dimen.wmx_follow_h));
        return Math.max(0, Math.min(MAX_FOLLOWS, n));
    }

    /** 放得下 slots 列次列的最矮卡片高度（dp）。 */
    static float heightFor(Context context, int slots) {
        return fixedDp(context) + slots * dp(context, R.dimen.wmx_follow_h);
    }

    /** 次列以外的一切：上下內距、標題、兩個分區標題、兩列主角、分區線、註腳。 */
    private static float fixedDp(Context context) {
        return dp(context, R.dimen.wmx_pad_top) + dp(context, R.dimen.wmx_pad_bottom)
            + dp(context, R.dimen.wmx_title_h) + 2 * dp(context, R.dimen.wmx_section_h)
            + dp(context, R.dimen.wmx_metro_hero_h) + dp(context, R.dimen.wmx_divider_h)
            + dp(context, R.dimen.wmx_rail_hero_h) + dp(context, R.dimen.wmx_note_h) + SAFETY_DP;
    }

    /**
     * 讀 dimens_widget_mixed.xml（layout 用的同一組值）換成 dp。
     * 🔴 sp 一律乘 fontScale 線性換算，不走 Resources.getDimension：Android 14 起系統的 sp 換算
     *    是非線性的，大數值放大得比小字少（模擬器 API 35、字級 1.1 實測：40sp 的列只有 40dp，
     *    裡面 15sp 的字卻照 1.1 倍放大）。列高照系統換算就裝不下放大後的字；所以列高由這裡
     *    線性算好、再用 {@link #pin} 釘到版面上，預算與畫面是同一個數字。
     */
    private static float dp(Context context, int dimen) {
        Resources res = context.getResources();
        TypedValue value = new TypedValue();
        res.getValue(dimen, value, true);
        float raw = TypedValue.complexToFloat(value.data);
        return value.getComplexUnit() == TypedValue.COMPLEX_UNIT_SP
            ? raw * res.getConfiguration().fontScale : raw;
    }

    /**
     * 把一塊的高度釘成預算裡的值（API 31+；31 以下沒有 setViewLayoutHeight，也還沒有非線性字級，
     * layout 的 wrap_content＋minHeight 就等於預算）。
     */
    private static RemoteViews pin(Context context, RemoteViews views, int viewId, int dimen) {
        if (Build.VERSION.SDK_INT >= 31) {
            views.setViewLayoutHeight(viewId, dp(context, dimen), TypedValue.COMPLEX_UNIT_DIP);
        }
        return views;
    }

    /**
     * bare：卡片矮到連兩列主角加註腳都擺不下（最小尺寸配大字級、橫放）。照設計稿「超出先砍列不縮字」
     * 先拿掉註腳（iOS 雙看板本來就沒有註腳）；但註腳在退化時是唯一的標示，不能跟著消失，
     * 所以改掛在標題列的時刻上——iOS 也是掛在那裡（時刻變警示色）。
     */
    private static RemoteViews board(Context context, RailWidgetData.Snapshot rail, MetroWidgetData.Snapshot metro,
                                     List<MetroWidgetPlate> plates, int[] plan, boolean bare) {
        RemoteViews root = new RemoteViews(context.getPackageName(), R.layout.widget_mixed_4x4);
        pin(context, root, R.id.wmx_title_row, R.dimen.wmx_title_h);
        pin(context, root, R.id.wmx_metro_head, R.dimen.wmx_section_h);
        pin(context, root, R.id.wmx_rail_head, R.dimen.wmx_section_h);
        pin(context, root, R.id.wmx_note, R.dimen.wmx_note_h);
        root.setTextViewText(R.id.wmx_head, RailNativeL10n.text(context, "{station}雙看板", "station", RailNativeL10n.name(context, metro.station)));
        root.setTextViewText(R.id.wmx_stamp, RailNativeL10n.text(context, "{time} 更新", "time", clock(Math.max(rail.generatedAt, (long) (metro.dataAt * 1000)))));
        root.setTextViewText(R.id.wmx_metro_head, RailNativeL10n.text(context, "捷運 · {system} · {station}",
            "system", RailNativeL10n.name(context, metro.systemLabel), "station", RailNativeL10n.name(context, metro.station)));
        root.setTextViewText(R.id.wmx_rail_head, RailNativeL10n.text(context, "鐵路 · {system} · {station}",
            "system", RailNativeL10n.name(context, rail.systemLabel), "station", RailNativeL10n.name(context, rail.origin)));
        // 退快取標示：資料延遲比位置舊更急，但「這一站是上次的位置解析出來的」不標示的話，
        // 退化狀態與正常狀態長得一模一樣（與單卡那兩支 render 同一條決定）。
        root.setTextViewText(R.id.wmx_note, (metro.failed || rail.failed)
            ? RailNativeL10n.text(context, "部分資料延遲 · 顯示上次成功結果")
            : (metro.autoStale || rail.autoStale)
            ? RailNativeL10n.text(context, "上次位置 · 開啟軌島更新")
            : RailNativeL10n.text(context, "捷運即時 · 台鐵誤點 · 高鐵表定"));
        if (bare) {
            root.setViewVisibility(R.id.wmx_note, View.GONE);
            boolean failed = metro.failed || rail.failed;
            if (failed || metro.autoStale || rail.autoStale) {
                if (!failed) root.setTextViewText(R.id.wmx_stamp, RailNativeL10n.text(context, "上次位置"));
                root.setTextColor(R.id.wmx_stamp, context.getColor(R.color.wg_warn));
            }
        }

        root.removeAllViews(R.id.wmx_metro_rows);
        int metroRows = Math.min(plates.size(), 1 + plan[0]);
        for (int i = 0; i < metroRows; i++) {
            root.addView(R.id.wmx_metro_rows, metroRow(context, plates.get(i), i == 0));
        }

        root.removeAllViews(R.id.wmx_rail_rows);
        int railRows = Math.min(rail.rows.size(), 1 + plan[1]);
        for (int i = 0; i < railRows; i++) {
            root.addView(R.id.wmx_rail_rows, pin(context, RailWidgetRender.row(context, rail.rows.get(i),
                i == 0 ? R.layout.widget_mixed_rail_hero : R.layout.widget_mixed_rail_row),
                R.id.wmx_row, i == 0 ? R.dimen.wmx_rail_hero_h : R.dimen.wmx_follow_h));
        }
        if (railRows == 0) root.addView(R.id.wmx_rail_rows, railEmpty(context, rail));
        return root;
    }

    static RemoteViews message(Context context, String title, String body) {
        RemoteViews root = new RemoteViews(context.getPackageName(), R.layout.widget_mixed_message);
        root.setTextViewText(R.id.wmxm_title, RailNativeL10n.text(context, title));
        root.setTextViewText(R.id.wmxm_body, RailNativeL10n.text(context, body));
        return root;
    }

    private static RemoteViews metroRow(Context context, MetroWidgetPlate plate, boolean hero) {
        RemoteViews row = new RemoteViews(context.getPackageName(),
            hero ? R.layout.widget_mixed_metro_hero : R.layout.widget_mixed_metro_row);
        pin(context, row, R.id.wmx_row, hero ? R.dimen.wmx_metro_hero_h : R.dimen.wmx_follow_h);
        int color;
        try { color = Color.parseColor(plate.badgeColor); }
        catch (Exception ignored) { color = context.getColor(R.color.wg_navy); }
        row.setInt(R.id.wmxr_mark, "setColorFilter", color);
        row.setTextViewText(R.id.wmxr_dest, plate.dest == null || plate.dest.isEmpty() ? RailNativeL10n.text(context, "本站列車") : plate.dest);
        String sub = plate.footLeft == null ? "" : plate.footLeft;
        if (sub.isEmpty() && plate.footRight != null) sub = plate.footRight;
        if (!hero && plate.state == MetroWidgetPlate.State.PASS_LIMITED) sub = "";
        // 營運異常時主角與註腳都是空的，官方公告標題是這一段唯一的內容（捷運看板把它畫在警示帶上）。
        // 公告是車站層級的事實 ⇒ 只掛在主角列，不每一列重複。
        boolean band = hero && sub.isEmpty() && plate.band != null && !plate.band.isEmpty();
        row.setTextViewText(R.id.wmxr_sub, band ? plate.band : sub);
        if (band) row.setTextColor(R.id.wmxr_sub, context.getColor(plate.bandBad ? R.color.wg_bad : R.color.wg_warn));
        row.setTextViewText(R.id.wmxr_value, plate.heroValue == null || plate.heroValue.isEmpty() ? "—" : plate.heroValue);
        boolean minutes = plate.hero == MetroWidgetPlate.Hero.MINUTES;
        row.setViewVisibility(R.id.wmxr_unit, minutes ? View.VISIBLE : View.GONE);
        row.setTextViewText(R.id.wmxr_unit, RailNativeL10n.text(context, "分"));
        row.setTextColor(R.id.wmxr_value, tone(context, plate.heroTone));
        // 「進站」「暫無資料」「已收班」是字不是數字，寬度是數字的兩到四倍：照數字的字級畫會把終點站擠掉。
        if (!minutes) {
            boolean arriving = plate.hero == MetroWidgetPlate.Hero.ARRIVING;
            row.setTextViewTextSize(R.id.wmxr_value, TypedValue.COMPLEX_UNIT_SP,
                hero ? (arriving ? 26 : 18) : (arriving ? 18 : 14));
        }
        return row;
    }

    /** 鐵路段一班都沒有時的那一列：用主角列版面、只留兩行字（與發車看板空狀態同一組字）。 */
    private static RemoteViews railEmpty(Context context, RailWidgetData.Snapshot rail) {
        RemoteViews empty = new RemoteViews(context.getPackageName(), R.layout.widget_mixed_rail_hero);
        pin(context, empty, R.id.wmx_row, R.dimen.wmx_rail_hero_h);
        empty.setViewVisibility(R.id.wrr_mark, View.INVISIBLE);
        empty.setViewVisibility(R.id.wrr_heading, View.GONE);
        // 雙看板的設定沒有「含通過列車」，所以不講去設定裡開（發車看板那句提示在這裡是錯的指路）。
        empty.setTextViewText(R.id.wrr_train, RailNativeL10n.text(context,
            rail.hiddenPass > 0 ? "本站今日沒有停靠的列車" : "目前沒有接下來的班次"));
        empty.setTextViewText(R.id.wrr_dest, RailNativeL10n.text(context, "請稍後再看或點卡片開啟軌島"));
        empty.setViewVisibility(R.id.wrr_status, View.GONE);
        empty.setViewVisibility(R.id.wrr_time, View.GONE);
        return empty;
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
