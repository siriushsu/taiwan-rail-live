package tw.railisland.app;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

/**
 * 把 MetroWidgetPlate（純值）綁進 RemoteViews。三種尺寸共用這一份——三張版面的 id 是同一組，
 * 尺寸差異全部寫在 xml 裡（見 widget_plate_4x2.xml 的註解）。
 *
 * 🔴 這個類別【只做綁定】，一個判斷都不做：狀態、文案、顏色語意全部由 MetroWidgetPlate.of(...)
 *    決定。分開的理由是那一邊是純 Java、可以用 javac 跑斷言，這一邊只有真機／模擬器才驗得到；
 *    判斷若漏在這裡，就是漏在唯一驗不到的那一層。
 */
final class MetroWidgetPlateRender {
    private MetroWidgetPlateRender() {}

    static int tone(Context c, MetroWidgetPlate.Tone t) {
        switch (t) {
            case OK:    return c.getColor(R.color.wg_ok);
            case WARN:  return c.getColor(R.color.wg_warn);
            case BAD:   return c.getColor(R.color.wg_bad);
            case FAINT: return c.getColor(R.color.wg_ink_faint);
            default:    return c.getColor(R.color.wg_ink);
        }
    }

    /** chip 的顏色語意只有一份——琺瑯站牌與夜行看板共用（看板曾經自己寫一套，
     *  結果紅字的「營運異常」配到綠點）。 */
    private static int chipColor(Context c, MetroWidgetPlate.Chip chip) {
        switch (chip) {
            case RECONNECT: case LAST: case PASS: return c.getColor(R.color.wg_warn);
            case ALERT: return c.getColor(R.color.wg_bad);
            case PLAIN: return c.getColor(R.color.wg_ink_faint);
            default: return c.getColor(R.color.wg_ok);
        }
    }

    private static int lineColor(Context c, String hex) {
        int rgb = MetroWidgetPlate.parseHex(hex);
        return rgb < 0 ? c.getColor(R.color.wg_navy) : (0xFF000000 | rgb);
    }

    /** 1a 琺瑯站牌。四張版面共用（4×2／4×3／2×2），compact 只有 2×2 用。 */
    static RemoteViews plate(Context c, int layoutRes, MetroWidgetPlate p) {
        return plate(c, layoutRes, p, false);
    }

    /**
     * compact＝2×2：註腳只放主角。
     *
     * 🔴 為什麼這個「尺寸差異」不能只寫在 xml 裡（其餘的都可以）：擁擠度那一條的可見性是
     *    binder 依「有沒有擁擠度資料」設的，會蓋掉 xml 的 visibility="gone" ⇒ 2×2 實測擠成
     *    「再… ▮▮▮▮▮▮ 略擠 4分」一整列，主角還被擠到裁字。尺寸只有 provider 知道，
     *    所以由它明講（與夜行看板傳 maxRows 同一個做法），binder 仍然不自己猜。
     */
    static RemoteViews plate(Context c, int layoutRes, MetroWidgetPlate p, boolean compact) {
        RemoteViews v = new RemoteViews(c.getPackageName(), layoutRes);

        // ── header ──
        if (p.badge == null || p.badge.isEmpty()) {
            // 官方沒給這一站這條線的站號（實際存在：高雄橘線美麗島在官方檔裡只有紅線那一筆）
            // ⇒ 整顆徽章收掉，不畫一個空框，也不編一個站號。
            v.setViewVisibility(R.id.wg_badge, View.GONE);
            v.setViewVisibility(R.id.wg_badge_bg, View.GONE);
        } else {
            v.setViewVisibility(R.id.wg_badge, View.VISIBLE);
            v.setViewVisibility(R.id.wg_badge_bg, View.VISIBLE);
            v.setTextViewText(R.id.wg_badge, p.badge);
            v.setInt(R.id.wg_badge_bg, "setColorFilter", lineColor(c, p.badgeColor));
            // 設計稿：環狀線在琺瑯紙上對比不足 ⇒ 徽章改深墨字，其餘一律白字。
            v.setTextColor(R.id.wg_badge,
                p.badgeDarkInk ? c.getColor(R.color.wg_badge_ink) : c.getColor(R.color.wg_on_accent));
        }
        v.setTextViewText(R.id.wg_line, p.lineLabel == null ? "" : p.lineLabel);
        v.setTextViewText(R.id.wg_chip, p.chipText);
        v.setTextViewText(R.id.wg_stamp, p.stamp);
        int chipColor = chipColor(c, p.chip);
        v.setTextColor(R.id.wg_chip, chipColor);
        v.setInt(R.id.wg_chip_dot, "setColorFilter", chipColor);
        // PLAIN（深夜）沒有狀態詞，那顆點也不該亮著說「有東西在跑」。
        v.setViewVisibility(R.id.wg_chip_dot, p.chip == MetroWidgetPlate.Chip.PLAIN ? View.GONE : View.VISIBLE);

        // ── body ──
        v.setTextViewText(R.id.wg_station, p.station);
        v.setTextViewText(R.id.wg_station_en, p.stationEn);
        v.setTextViewText(R.id.wg_dest, p.dest);
        v.setTextColor(R.id.wg_dest, p.state == MetroWidgetPlate.State.SUSPENDED
            ? c.getColor(R.color.wg_bad) : c.getColor(R.color.wg_ink_soft));

        // ── 主角：四種形態互斥 ──
        boolean minutes = p.hero == MetroWidgetPlate.Hero.MINUTES;
        boolean pill = p.hero == MetroWidgetPlate.Hero.ARRIVING;
        boolean text = p.hero == MetroWidgetPlate.Hero.TEXT;
        v.setViewVisibility(R.id.wg_hero_num, minutes ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.wg_hero_unit, minutes ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.wg_hero_pill, pill ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.wg_hero_text, text ? View.VISIBLE : View.GONE);
        if (minutes) {
            v.setTextViewText(R.id.wg_hero_num, p.heroValue);
            v.setTextColor(R.id.wg_hero_num, tone(c, p.heroTone));
        } else if (pill) {
            v.setTextViewText(R.id.wg_hero_pill, p.heroValue);
        } else if (text) {
            v.setTextViewText(R.id.wg_hero_text, p.heroValue);
            v.setTextColor(R.id.wg_hero_text, tone(c, p.heroTone));
        }

        // ── 警示帶 ──
        if (p.band == null || p.band.isEmpty()) {
            v.setViewVisibility(R.id.wg_band, View.GONE);
        } else {
            v.setViewVisibility(R.id.wg_band, View.VISIBLE);
            v.setTextViewText(R.id.wg_band, p.band);
            v.setInt(R.id.wg_band, "setBackgroundResource",
                p.bandBad ? R.drawable.wg_band_bad : R.drawable.wg_band_warn);
            v.setTextColor(R.id.wg_band, p.bandBad ? c.getColor(R.color.wg_bad) : c.getColor(R.color.wg_warn));
        }

        // ── 註腳 ──
        boolean hasFoot = compact || !p.footLeft.isEmpty() || !p.footRight.isEmpty() || p.crowd != null;
        v.setViewVisibility(R.id.wg_foot, hasFoot ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.wg_foot_left, compact ? "" : p.footLeft);
        v.setTextColor(R.id.wg_foot_left, tone(c, p.footLeftTone));
        v.setTextViewText(R.id.wg_foot_right, compact ? "" : p.footRight);
        v.setTextColor(R.id.wg_foot_right, tone(c, p.footRightTone));
        v.setViewVisibility(R.id.wg_foot_left, compact ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.wg_foot_right, compact ? View.GONE : View.VISIBLE);
        if (compact || p.crowd == null || p.crowd.length == 0) {
            v.setViewVisibility(R.id.wg_meter, View.GONE);
        } else {
            v.setViewVisibility(R.id.wg_meter, View.VISIBLE);
            bindMeter(c, v, p.crowd);
        }

        // ── 4×3 的前後站帶：沒有鄰站資料就整條收掉（不畫「◀ —」） ──
        if (p.prevStation == null && p.nextStation == null) {
            v.setViewVisibility(R.id.wg_strip, View.GONE);
        } else {
            v.setTextViewText(R.id.wg_strip_prev, p.prevStation == null ? "" : "◀ " + p.prevStation);
            v.setTextViewText(R.id.wg_strip_next, p.nextStation == null ? "" : p.nextStation + " ▶");
            v.setInt(R.id.wg_strip_dot, "setColorFilter", lineColor(c, p.badgeColor));
        }
        return v;
    }

    /** 擁擠度：六節逐節上色，最後一節是帶圓鼻的車頭（標出行進方向）。 */
    private static void bindMeter(Context c, RemoteViews v, int[] crowd) {
        int[] ids = { R.id.wg_m1, R.id.wg_m2, R.id.wg_m3, R.id.wg_m4, R.id.wg_m5, R.id.wg_m6 };
        for (int i = 0; i < ids.length; i++) {
            int color;
            if (i >= crowd.length) color = c.getColor(R.color.wg_meter_empty);
            else if (crowd[i] <= 1) color = c.getColor(R.color.wg_meter_low);
            else if (crowd[i] == 2) color = c.getColor(R.color.wg_meter_mid);
            else color = c.getColor(R.color.wg_meter_high);
            v.setInt(ids[i], "setColorFilter", color);
        }
    }

    /** 1b 夜行看板。maxRows 由 provider 明確傳進來（它才知道自己在建哪個尺寸）。 */
    static RemoteViews board(Context c, int layoutRes, MetroWidgetPlate[] rows, int maxRows,
                             String head, String footLeft, String footRight, String band, boolean bandBad) {
        RemoteViews v = new RemoteViews(c.getPackageName(), layoutRes);
        v.setTextViewText(R.id.wb_head, head);
        int[][] slot = {
            { R.id.wb_r1, R.id.wb_r1_bar, R.id.wb_r1_title, R.id.wb_r1_sub, R.id.wb_r1_a, R.id.wb_r1_b, R.id.wb_r1_c },
            { R.id.wb_r2, R.id.wb_r2_bar, R.id.wb_r2_title, R.id.wb_r2_sub, R.id.wb_r2_a, R.id.wb_r2_b, R.id.wb_r2_c },
            { R.id.wb_r3, R.id.wb_r3_bar, R.id.wb_r3_title, R.id.wb_r3_sub, R.id.wb_r3_a, R.id.wb_r3_b, R.id.wb_r3_c },
        };
        MetroWidgetPlate live = null;
        for (int i = 0; i < slot.length; i++) {
            MetroWidgetPlate p = i < maxRows && i < rows.length ? rows[i] : null;
            if (p == null) { v.setViewVisibility(slot[i][0], View.GONE); continue; }
            if (live == null) live = p;
            v.setViewVisibility(slot[i][0], View.VISIBLE);
            v.setInt(slot[i][1], "setColorFilter", lineColor(c, p.badgeColor));
            // 站名在抬頭已經有了，列上只寫方向（設計稿 1b 是「一站多方向並排」）。
            v.setTextViewText(slot[i][2], p.dest.isEmpty() ? p.station : p.dest);
            v.setTextViewText(slot[i][3], p.footLeft);
            v.setViewVisibility(slot[i][3], p.footLeft.isEmpty() ? View.GONE : View.VISIBLE);
            // 三個數字：第一個是主角（狀態決定形態），後兩個是純分鐘。
            v.setTextViewText(slot[i][4], p.hero == MetroWidgetPlate.Hero.MINUTES ? p.heroValue
                : p.hero == MetroWidgetPlate.Hero.ARRIVING ? "進站" : "—");
            v.setTextColor(slot[i][4], tone(c, p.heroTone));
            v.setTextViewText(slot[i][5], p.boardSecond == null ? "" : p.boardSecond);
            v.setTextViewText(slot[i][6], p.boardThird == null ? "" : p.boardThird);
        }
        int chipColor = chipColor(c, live == null ? MetroWidgetPlate.Chip.PLAIN : live.chip);
        v.setTextViewText(R.id.wb_chip, live == null ? "" : live.chipText);
        v.setTextColor(R.id.wb_chip, chipColor);
        v.setInt(R.id.wb_chip_dot, "setColorFilter", chipColor);
        v.setTextViewText(R.id.wb_stamp, live == null ? "" : live.stamp);
        v.setTextViewText(R.id.wb_foot_left, footLeft);
        v.setTextViewText(R.id.wb_foot_right, footRight);
        if (band == null || band.isEmpty()) {
            v.setViewVisibility(R.id.wb_band, View.GONE);
        } else {
            v.setViewVisibility(R.id.wb_band, View.VISIBLE);
            v.setTextViewText(R.id.wb_band, band);
            v.setInt(R.id.wb_band, "setBackgroundResource",
                bandBad ? R.drawable.wg_band_bad : R.drawable.wg_band_warn);
            v.setTextColor(R.id.wb_band, bandBad ? c.getColor(R.color.wg_bad) : c.getColor(R.color.wg_warn));
        }
        return v;
    }

    /** 狀態 6 · 未設定車站。文案放這裡而不是 provider 裡，畫廊才會顯示與桌面【同一份】文字。 */
    static RemoteViews unset(Context c) {
        return message(c, "軌島", "選一個捷運站", "設定之後，這一格就會顯示下一班車還有幾分鐘。", "選擇車站");
    }

    /** 免費版已經用掉那一站，又設了第二站。 */
    static RemoteViews passNeeded(Context c) {
        return message(c, "軌島通行證", "再加一站",
            "免費可以固定一站。通行證解鎖多站、自動選站與擁擠度。", "了解通行證");
    }

    /** 自動選站但還沒拿到位置。 */
    static RemoteViews noLocation(Context c) {
        return message(c, "自動選站", "還不知道你在哪",
            "請開啟軌島並允許「大概位置」，之後這一格會自己跟著最近的車站。", "開啟軌島");
    }

    /** 連不上而且連快取都沒有（有快取時走狀態 3，不走這張）。 */
    static RemoteViews offline(Context c, String station) {
        return message(c, station, "暫時連不上", "目前無法取得官方班次。點一下開啟軌島看完整看板。", "開啟軌島");
    }

    /** 狀態 6 與載入／失敗訊息。刻意用另一張版面（見 widget_plate_message.xml）。 */
    static RemoteViews message(Context c, String kicker, String title, String body, String action) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_plate_message);
        v.setTextViewText(R.id.wm_kicker, kicker);
        v.setTextViewText(R.id.wm_title, title);
        v.setTextViewText(R.id.wm_body, body);
        if (action == null || action.isEmpty()) {
            v.setViewVisibility(R.id.wm_action, View.GONE);
        } else {
            v.setViewVisibility(R.id.wm_action, View.VISIBLE);
            v.setTextViewText(R.id.wm_action, action);
        }
        return v;
    }
}
