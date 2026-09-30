package tw.railisland.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.RelativeSizeSpan;
import android.widget.RemoteViews;

import java.util.List;

/**
 * 把 CollectionData 綁進 RemoteViews：小（2×2）、中（5×2／4×2）兩款。
 * 版面資訊層級照 iOS CollectionCard.swift（Small／Medium），畫法照契約的〈畫法約定〉
 * （docs/collect-widget-contract.md）：地圖 Canvas 畫成 Bitmap 放 ImageView、文字用 TextView。
 *
 * 🔴 這個類別只做「綁定與排版取捨」，不重算任何數字：n／total／v／n 一律照抄 payload，
 *    百分比字串與進度條比例來自 CollectionData 的兩個純顯示函式。
 * 🔴 顏色全走資源（跟著深淺色）；只有點陣地圖是 Bitmap，所以畫淺／深兩張（見 CollectionMapRender）。
 * 🔴 尺寸只有 provider 知道（launcher 回報的 dp）：中卡的列數依高度預算逐項取捨（先丟圖例、再丟「還有 K 個系統」、
 *    最後才減系統列），放不下就不放，不讓字被裁在摺線下。
 */
final class CollectionWidgetRender {
    private CollectionWidgetRender() {}

    static final String SMALL = WidgetFamily.SMALL;
    static final String MEDIUM = WidgetFamily.MEDIUM;

    /** launcher 沒回報尺寸時的保底（dp）＝兩個 provider info 的 minWidth／minHeight。 */
    static final int DEFAULT_SMALL_W = 110, DEFAULT_SMALL_H = 110;
    static final int DEFAULT_MEDIUM_W = 320, DEFAULT_MEDIUM_H = 110;

    // 版面度量（dp）。中卡左欄各列的自然高度（含 CJK 行高），實測值，見 CollectionWidgetInstrumentedTest 的列高量測。
    private static final int CARD_PAD_V = 27;       // 上 12＋下 15
    private static final int CARD_PAD_H = 30;       // 左 14＋右 16
    private static final int MEDIUM_HEAD = 50;      // 標題列＋已收集行（含 26dp 高的蓋章鈕容器）＋間距＋列容器上緣（舊值 44 是蓋章鈕在標題列時量的；鈕搬進已收集那一列後該列由 17 變 26dp、wc_rows 上距 5→2dp，共 +6）
    private static final int ROW_SYS = 17;
    private static final int ROW_NOTE = 18;         // 含 marginTop 3
    private static final int ROW_LEGEND = 17;       // 含 marginTop 3
    private static final int ROW_BAR = 8;
    private static final int ROW_REMAIN = 23;       // 含 marginTop 5
    private static final int ROW_RECENT = 19;
    /** 小卡文字欄最下面的蓋章鈕區塊高（dp）：與數字的間距 6＋膠囊 18（見 widget_collect_small.xml 的 wc_stamp_hit）。 */
    private static final int STAMP_BLOCK = 24;
    /** 單張地圖的點陣框高上限（dp）：出血（下緣 18dp）只夠最高約 190dp 的地圖把恆春半島南端畫完。 */
    private static final float MAP_MAX_DP = 190f;
    /** CJK 行高約為字級的 1.45 倍（obs.json 量到 13sp→18.7dp、11sp→16dp）；拉丁字母較矮，一律取大的，寧可少放一行也不讓字被裁。 */
    private static final float LINE_H = 1.45f;
    /** 位元組上限保險：地圖 Bitmap 高度（像素）不超過這個值。 */
    private static final int MAP_MAX_PX = 560;

    static RemoteViews build(Context context, String family, CollectionData data, String scope, int widthDp, int heightDp) {
        Context app = context.getApplicationContext() == null ? context : context.getApplicationContext();
        boolean small = SMALL.equals(family);
        int w = widthDp > 0 ? widthDp : (small ? DEFAULT_SMALL_W : DEFAULT_MEDIUM_W);
        int h = heightDp > 0 ? heightDp : (small ? DEFAULT_SMALL_H : DEFAULT_MEDIUM_H);
        if (data == null) return unavailable(app, small);
        CollectionData.Figures f = data.figures(scope, RailNativeL10n.text(app, "全台"));
        return small ? small(app, f, w, h) : medium(app, f, w, h);
    }

    // ── 沒有資料 ───────────────────────────────────────────────────────────────

    static RemoteViews unavailable(Context c, boolean small) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_collect_message);
        v.setTextViewText(R.id.wc_title, RailNativeL10n.text(c, "車站收集"));
        v.setTextViewText(R.id.wc_message, RailNativeL10n.text(c, "打開軌島一次，就會出現你的車站收集"));
        v.setTextViewTextSize(R.id.wc_message, android.util.TypedValue.COMPLEX_UNIT_SP, small ? 13 : 15);
        v.setContentDescription(R.id.wc_root, RailNativeL10n.text(c, "車站收集") + "。"
            + RailNativeL10n.text(c, "打開軌島一次，就會出現你的車站收集"));
        return v;
    }

    // ── 小卡 ───────────────────────────────────────────────────────────────────

    private static RemoteViews small(Context c, CollectionData.Figures f, int wDp, int hDp) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_collect_small);
        float fs = fontScale(c);
        String kicker = RailNativeL10n.text(c, "車站收集");
        // 副標的可見性在這裡明講兩個分支（launcher 是 reapply 到舊 View 樹）；字級在 smallHeader 兩個分支都設
        String stamp = RailNativeL10n.text(c, "蓋章");
        v.setTextViewText(R.id.wc_stamp, stamp);
        v.setContentDescription(R.id.wc_stamp_hit, stamp);   // 透明的可點容器（48dp 寬）：TalkBack 讀「蓋章」
        boolean kick = smallHeader(v, f, kicker, wDp, fs);
        v.setViewVisibility(R.id.wc_subtitle, kick ? android.view.View.VISIBLE : android.view.View.GONE);

        // 文字欄寬（dp）：版面權重 58／42。窄到文字放不下（多半是 110dp 寬的 2×2）就整個放掉地圖，
        // 讓文字欄吃滿整張卡——「數字被裁」比「少一張地圖」糟得多，關鍵數字永遠優先。
        float colW = (wDp - CARD_PAD_H) * 0.58f;
        String countText = RailNativeL10n.text(c, "已收集 {n} 座", "n", String.valueOf(f.collected));
        String remainText = RailNativeL10n.text(c, "還有 {n} 座", "n", String.valueOf(f.remaining()));
        String emptyTitle = RailNativeL10n.text(c, "還沒有收集的車站");
        String emptyHint = RailNativeL10n.text(c, "跟一班車到終點，或到車站打卡就會蓋章");
        boolean showMap;
        if (f.isEmpty()) {
            showMap = lineCount(emptyTitle, 13, true, colW, fs) <= 2 && lineCount(emptyHint, 11, false, colW, fs) <= 3;
        } else {
            // 用 tightWidth（拉丁字母 0.5em）不是 estimatedWidth（0.62em）：Pixel 2×2 只有 137dp 寬、文字欄 62dp，
            // 「已收集 201 座」實測 9sp 約 54dp，用 0.62em 估會誤判放不下而把地圖丟掉（2026-09-30 真桌面踩到）
            float need9 = Math.max(tightWidth(countText, 9 * fs) * 1.05f, tightWidth(remainText, 9 * fs));
            showMap = need9 <= colW;
        }
        // 蓋章鈕（膠囊寬＝字寬加左右內距 16dp）也要放得進文字欄：放不下（日文「スタンプ」在 110dp 寬的卡上）就把地圖讓出來，
        // 不讓膠囊的字折成兩行被裁掉。
        showMap = showMap && tightWidth(stamp, 10 * fs) * 1.1f + 16f <= colW;
        if (!showMap) colW = wDp - CARD_PAD_H;

        // 🔴 launcher 收到同一個 layout 的新 RemoteViews 時是 reapply 到「舊的那棵 View 樹」上，不是重新 inflate：
        //    新 RemoteViews 沒提到的屬性會停在上一次的樣子。所以每個會被切換的可見性，兩個分支都要明講一次
        //    （空→有資料、有地圖→沒地圖、有「還有 N 座」→沒有，都是真實會發生的順序）。
        if (f.isEmpty()) {
            v.setViewVisibility(R.id.wc_pct, android.view.View.GONE);
            v.setViewVisibility(R.id.wc_count, android.view.View.GONE);
            v.setViewVisibility(R.id.wc_remain, android.view.View.GONE);
            v.setViewVisibility(R.id.wc_empty_title, android.view.View.VISIBLE);
            v.setTextViewText(R.id.wc_empty_title, emptyTitle);
            // 高度放不下標題＋說明就只留標題（說明被裁掉半行比不放更難看）
            float bodyH = hDp - CARD_PAD_V - 22;
            float titleH = lineCount(emptyTitle, 13, true, colW, fs) * 13 * fs * LINE_H;
            float hintH = 4 + lineCount(emptyHint, 11, false, colW, fs) * 11 * fs * LINE_H;
            boolean hint = titleH + hintH + STAMP_BLOCK <= bodyH;
            v.setViewVisibility(R.id.wc_empty_hint, hint ? android.view.View.VISIBLE : android.view.View.GONE);
            v.setTextViewText(R.id.wc_empty_hint, emptyHint);
        } else {
            v.setViewVisibility(R.id.wc_pct, android.view.View.VISIBLE);
            v.setViewVisibility(R.id.wc_count, android.view.View.VISIBLE);
            v.setViewVisibility(R.id.wc_empty_title, android.view.View.GONE);
            v.setViewVisibility(R.id.wc_empty_hint, android.view.View.GONE);
            v.setTextViewText(R.id.wc_pct, bigPercent(f.percentLabel));
            float pctSp = percentSp(f.percentLabel, colW, fs);
            // 高度預算：百分比（字級×1.2）＋已收集一行＋還有一行（各 16dp 量到的行高）。放不下先丟次要的「還有 N 座」，
            // 再放不下才縮百分比；關鍵數字（百分比與已收集）永遠留著。
            // 蓋章鈕在文字欄最下面（STAMP_BLOCK），預算要先扣掉它：關鍵數字與鈕都要留，所以先丟「還有 N 座」，再縮百分比（下限 20sp）。
            float bodyH = hDp - CARD_PAD_V - 16 - 6;
            float textH = 4 + 16 * fs + 1 + 16 * fs;
            boolean remain = pctSp * 1.2f * fs + textH + STAMP_BLOCK <= bodyH;
            if (!remain) {
                textH = 4 + 16 * fs;
                pctSp = Math.max(20f, Math.min(pctSp, (bodyH - textH - STAMP_BLOCK) / (1.2f * fs)));
            }
            v.setTextViewTextSize(R.id.wc_pct, android.util.TypedValue.COMPLEX_UNIT_SP, pctSp);
            v.setTextViewText(R.id.wc_count, countText);
            v.setTextViewText(R.id.wc_remain, remainText);
            v.setViewVisibility(R.id.wc_remain, remain ? android.view.View.VISIBLE : android.view.View.GONE);
        }

        v.setViewVisibility(R.id.wc_map_slot, showMap ? android.view.View.VISIBLE : android.view.View.GONE);
        if (showMap) {
            float density = c.getResources().getDisplayMetrics().density;
            float bodyH = Math.max(48, hDp - CARD_PAD_V - 16 - 6 - 4);
            float slotW = (wDp - CARD_PAD_H) * 0.42f;
            float mapH = Math.min(bodyH, slotW / (float) f.aspect);
            setMaps(v, f, mapH, density, c.getResources());
        }
        v.setContentDescription(R.id.wc_root, describe(c, f));
        return v;
    }

    /**
     * 小卡標題列 [標題][副標]（蓋章鈕已搬到文字欄最下面，標題列只剩這兩個）。放不下時：先收副標（與 iOS ViewThatFits 同一個取捨）；
     * 標題自己還是放不下，就縮字級（最多縮到 70%）。回傳副標要不要顯示（可見性由 small() 明講兩個分支）。
     * 🔴 字級兩個分支都要明講：launcher 是 reapply 到舊 View 樹，沒提到的屬性會停在上一次的樣子。
     */
    private static boolean smallHeader(RemoteViews v, CollectionData.Figures f, String kicker, int wDp, float fs) {
        v.setTextViewText(R.id.wc_title, f.title);
        v.setTextViewText(R.id.wc_subtitle, kicker);
        float rowW = wDp - CARD_PAD_H;
        // 標題（粗體，比估計寬約 5%）＋間距＋副標，再留 3dp：日文 137dp 寬的小卡實測「高捷」加副標剛好差 1dp 而被截成「…」
        boolean kick = estimatedWidth(f.title, 13 * fs) * 1.05f + 4 + estimatedWidth(kicker, 11 * fs) + 3 <= rowW;
        float titleText = tightWidth(f.title, 13 * fs) * 1.1f;         // Latin 粗體比 0.5em 略寬，留 10%
        float scale = 1f;
        if (!kick && titleText > rowW) scale = Math.max(0.7f, rowW / titleText);
        v.setTextViewTextSize(R.id.wc_title, android.util.TypedValue.COMPLEX_UNIT_SP, 13 * scale);
        return kick;
    }

    // ── 中卡 ───────────────────────────────────────────────────────────────────

    private static RemoteViews medium(Context c, CollectionData.Figures f, int wDp, int hDp) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_collect_medium);
        String kicker = RailNativeL10n.text(c, "車站收集");
        // 標題欄寬（dp）＝文字欄寬 − 百分比 − 間距（蓋章鈕在下一列「已收集」的右端，不占標題列）。「車站收集」或「範圍 · 車站收集」連 10sp 也放不下
        // （單一系統的英文、窄卡）就只留範圍名。
        String stamp = RailNativeL10n.text(c, "蓋章");
        v.setTextViewText(R.id.wc_stamp, stamp);
        v.setContentDescription(R.id.wc_stamp_hit, stamp);
        float fs0 = fontScale(c);
        float titleCol = (wDp - CARD_PAD_H - 8) * 0.70f - f.percentLabel.length() * 0.62f * 14 * fs0 - 6;
        String heading = f.isAll() ? kicker : f.title + " · " + kicker;
        if (tightWidth(heading, 10 * fs0) * 1.05f > titleCol) heading = f.title;
        v.setTextViewText(R.id.wc_title, heading);
        v.setTextViewText(R.id.wc_pct, f.percentLabel);
        v.setTextViewText(R.id.wc_count, RailNativeL10n.text(c, "已收集 {v}／{n} 座",
            "v", String.valueOf(f.collected), "n", String.valueOf(f.total)));

        float fs = fontScale(c);
        // 🔴 addView 會「累加」：launcher 對同一個 layout 是 reapply 到舊 View 樹，不先清掉，
        //    每次更新（換範圍、收集新站、換語言）都會在舊的列後面再長出一份（2026-09-30 真桌面看到全台列重複）。
        v.removeAllViews(R.id.wc_rows);
        // 垂直分配照 iOS MediumCollectionView：標題貼頂、中段前一個伸縮間隔、有圖例時圖例前再一個（圖例貼底）。
        // 間隔最小高度 0，下面的列高預算不用算它。
        addSpacer(c, v);
        // 高度預算（dp）：列容器可用高度；各列自然高度隨字級縮放（allRows／scopeRows 內乘 fs）。
        float avail = hDp - CARD_PAD_V - MEDIUM_HEAD * fs;
        String pkg = c.getPackageName();
        if (f.isEmpty()) {
            String title = RailNativeL10n.text(c, "還沒有收集的車站");
            String hint = RailNativeL10n.text(c, "跟一班車到終點，或到車站打卡就會蓋章");
            RemoteViews empty = new RemoteViews(pkg, R.layout.widget_collect_empty);
            empty.setTextViewText(R.id.wc_empty_title, title);
            empty.setTextViewText(R.id.wc_empty_hint, hint);
            float colW = (wDp - CARD_PAD_H - 8) * 0.70f;
            float need = lineCount(title, 13, true, colW, fs) * 13 * fs * LINE_H
                + 3 + lineCount(hint, 11, false, colW, fs) * 11 * fs * LINE_H;
            if (need > avail) empty.setViewVisibility(R.id.wc_empty_hint, android.view.View.GONE);
            v.addView(R.id.wc_rows, empty);
        } else if (f.isAll()) {
            allRows(c, v, f, avail, fs, legendFits(c, wDp, fs));
        } else {
            scopeRows(c, v, f, avail, fs, legendFits(c, wDp, fs));
        }

        float density = c.getResources().getDisplayMetrics().density;
        float bodyH = Math.max(48, hDp - CARD_PAD_V);
        float slotW = (wDp - CARD_PAD_H - 8) * 0.30f;
        float mapH = Math.min(bodyH, slotW / (float) f.aspect);
        setMaps(v, f, mapH, density, c.getResources());
        v.setContentDescription(R.id.wc_root, describe(c, f));
        return v;
    }

    /** 全台：有收集的系統各一列＋「還有 K 個系統還沒去過」＋圖例；依高度預算由後往前丟。 */
    private static void allRows(Context c, RemoteViews v, CollectionData.Figures f, float avail, float fs, boolean legendOk) {
        List<CollectionData.Sys> top = f.topSystems;
        int rows = top.size();
        boolean note = f.untouchedSystems > 0;
        boolean legend = legendOk;
        while (need((rows * ROW_SYS + (note ? ROW_NOTE : 0) + (legend ? ROW_LEGEND : 0)) * fs, avail)) {
            if (legend) legend = false;
            else if (note) note = false;
            else if (rows > 1) rows--;
            else break;
        }
        // 系統名那一欄：兩個中文字取 34dp；英文簡稱（Kaohsiung）比較長，整張卡的列一起放寬到 62dp。
        float longest = 0;
        for (int i = 0; i < rows; i++) longest = Math.max(longest, estimatedWidth(top.get(i).label, 11.5f));
        int rowLayout = longest > 34 ? R.layout.widget_collect_sysrow_wide : R.layout.widget_collect_sysrow;
        String pkg = c.getPackageName();
        for (int i = 0; i < rows; i++) {
            CollectionData.Sys s = top.get(i);
            RemoteViews row = new RemoteViews(pkg, rowLayout);
            row.setTextViewText(R.id.wc_row_label, s.label);
            row.setProgressBar(R.id.wc_row_bar, 1000, (int) Math.round(CollectionData.fill(s.v, s.n) * 1000), false);
            row.setTextViewText(R.id.wc_row_count, s.v + "/" + s.n);
            v.addView(R.id.wc_rows, row);
        }
        if (note) addNote(c, v, RailNativeL10n.text(c, "還有 {n} 個系統還沒去過", "n", String.valueOf(f.untouchedSystems)));
        if (legend) addLegend(c, v);
    }

    /** 單一系統：整條進度條＋「還有 N 座」＋最近蓋章（放得下幾筆就畫幾筆）＋圖例。 */
    private static void scopeRows(Context c, RemoteViews v, CollectionData.Figures f, float avail, float fs, boolean legendOk) {
        int recents = Math.min(2, f.recent.size());   // iOS 中卡單一系統放 2 筆最近蓋章
        boolean legend = legendOk;
        int fixed = ROW_BAR + ROW_REMAIN;
        while (need((fixed + recents * ROW_RECENT + (legend ? ROW_LEGEND : 0)) * fs, avail)) {
            if (legend) legend = false;
            else if (recents > 0) recents--;
            else break;
        }
        String pkg = c.getPackageName();
        RemoteViews bar = new RemoteViews(pkg, R.layout.widget_collect_bar_row);
        bar.setProgressBar(R.id.wc_scope_bar, 1000, (int) Math.round(CollectionData.fill(f.collected, f.total) * 1000), false);
        v.addView(R.id.wc_rows, bar);
        RemoteViews remain = new RemoteViews(pkg, R.layout.widget_collect_remain);
        remain.setTextViewText(R.id.wc_remain_line, RailNativeL10n.text(c, "還有 {n} 座", "n", String.valueOf(f.remaining())));
        v.addView(R.id.wc_rows, remain);
        for (int i = 0; i < recents; i++) {
            CollectionData.Recent r = f.recent.get(i);
            RemoteViews row = new RemoteViews(pkg, R.layout.widget_collect_recent);
            row.setTextViewText(R.id.wc_recent_date, CollectionData.shortDate(r.d));
            row.setTextViewText(R.id.wc_recent_name, r.name);
            row.setTextViewText(R.id.wc_recent_line, r.line);
            v.addView(R.id.wc_rows, row);
        }
        if (legend) addLegend(c, v);
    }

    /** 圖例一行（兩顆點＋兩段字）縮到最小字級 8sp 也放不進欄寬（英日文＋窄卡）就整行不放，不讓它折行被裁。 */
    private static boolean legendFits(Context c, int wDp, float fs) {
        float colW = (wDp - CARD_PAD_H - 8) * 0.70f;
        float w = tightWidth(RailNativeL10n.text(c, "實心＝搭過／到訪"), 8 * fs)
            + tightWidth(RailNativeL10n.text(c, "空心＝跟完"), 8 * fs) + 32;
        return w <= colW;
    }

    private static boolean need(float total, float avail) { return total > avail; }

    private static void addNote(Context c, RemoteViews v, String text) {
        RemoteViews note = new RemoteViews(c.getPackageName(), R.layout.widget_collect_note);
        note.setTextViewText(R.id.wc_note_line, text);
        v.addView(R.id.wc_rows, note);
    }

    private static void addSpacer(Context c, RemoteViews v) {
        v.addView(R.id.wc_rows, new RemoteViews(c.getPackageName(), R.layout.widget_collect_spacer));
    }

    private static void addLegend(Context c, RemoteViews v) {
        addSpacer(c, v);
        RemoteViews legend = new RemoteViews(c.getPackageName(), R.layout.widget_collect_legend);
        legend.setTextViewText(R.id.wc_legend_solid, RailNativeL10n.text(c, "實心＝搭過／到訪"));
        legend.setTextViewText(R.id.wc_legend_follow, RailNativeL10n.text(c, "空心＝跟完"));
        v.addView(R.id.wc_rows, legend);
    }

    // ── 地圖 ───────────────────────────────────────────────────────────────────

    /**
     * 淺／深兩張 Bitmap 疊同一格，資源限定的 alpha 決定露出哪一張。高度取版面預期的地圖高（dp）換成像素；
     * Bitmap＝點陣框＋出血（框外一圈透明邊，輪廓的恆春半島南端與西岸畫在這裡），整張超過像素上限就把框縮小。
     */
    private static void setMaps(RemoteViews v, CollectionData.Figures f, float mapHDp, float density, android.content.res.Resources res) {
        CollectionMapRender.Bleed bleed = CollectionMapRender.bleed(res);
        int want = Math.min(MAP_MAX_PX, Math.max(120, Math.round(Math.min(mapHDp, MAP_MAX_DP) * density)));
        int px = CollectionMapRender.frameHeightPx(f.aspect, want, bleed);
        Bitmap light = CollectionMapRender.render(f, false, px, density, bleed);
        Bitmap dark = CollectionMapRender.render(f, true, px, density, bleed);
        v.setImageViewBitmap(R.id.wc_map_light, light);
        v.setImageViewBitmap(R.id.wc_map_dark, dark);
    }

    // ── 文字 ───────────────────────────────────────────────────────────────────

    private static float fontScale(Context c) {
        return Math.max(0.85f, c.getResources().getConfiguration().fontScale);
    }

    /** 一段文字放進寬 colDp 的欄位會折成幾行（粗估：粗體加寬 5%、再留 10% 給斷行浪費）。 */
    static int lineCount(String text, float sp, boolean bold, float colDp, float fs) {
        float w = estimatedWidth(text, sp * fs) * (bold ? 1.05f : 1f) * 1.1f;
        return Math.max(1, (int) Math.ceil(w / Math.max(1f, colDp)));
    }

    /** 百分比大字的字級：34sp 為上限，文字欄不夠寬就往下縮（下限 20sp）。「%」小字只算 0.4 個字級寬。 */
    static float percentSp(String label, float colDp, float fs) {
        float em = 0;
        for (int i = 0; i < label.length(); i++) em += label.charAt(i) == '%' ? 0.4f : 0.62f;
        return Math.max(20f, Math.min(34f, colDp * 0.92f / (em * fs)));
    }

    /** 「37」大、「%」小；「<1%」同理。純文字內容不變（讀畫面的人看到的仍是 "37%"）。 */
    static CharSequence bigPercent(String label) {
        SpannableString s = new SpannableString(label);
        int at = label.lastIndexOf('%');
        if (at >= 0) s.setSpan(new RelativeSizeSpan(0.44f), at, label.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }

    /** 給 TalkBack：範圍、百分比、已收集／還有，一句話講完。 */
    private static String describe(Context c, CollectionData.Figures f) {
        String comma = RailNativeL10n.text(c, "，");
        String head = RailNativeL10n.text(c, "車站收集") + comma + f.title;
        if (f.isEmpty()) return head + comma + RailNativeL10n.text(c, "還沒有收集的車站");
        return head + comma + f.percentLabel + comma
            + RailNativeL10n.text(c, "已收集 {n} 座", "n", String.valueOf(f.collected)) + comma
            + RailNativeL10n.text(c, "還有 {n} 座", "n", String.valueOf(f.remaining()));
    }

    /** 標題用的較貼近實測的寬度估計：CJK 一字一個字級寬，其餘取 0.5 個字級寬（Roboto 粗體英文實測約 0.45）。只用來決定要不要收掉副標。 */
    static float tightWidth(String text, float fontSize) {
        float em = 0;
        for (int i = 0; i < text.length(); i++) em += text.charAt(i) >= 0x2E80 ? 1.0f : 0.5f;
        return em * fontSize;
    }

    /** 一段文字的粗估寬度（dp）：CJK 一字一個字級寬，其餘取 0.62 個字級寬（半粗體平均，偏寬一點）。同 iOS estimatedWidth。 */
    static float estimatedWidth(String text, float fontSize) {
        float em = 0;
        for (int i = 0; i < text.length(); i++) em += text.charAt(i) >= 0x2E80 ? 1.0f : 0.62f;
        return em * fontSize;
    }
}
