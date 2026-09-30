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
    private static final int CARD_PAD_V = 27;       // 上 12＋下 15（下 15 在欄位的 paddingBottom；根的下內距是 0，蓋章鈕容器要伸進去）
    private static final int CARD_PAD_H = 30;       // 左 14＋右 16
    private static final int CARD_PAD_TOP = 12, PAD_TOP_MIN = 6;   // 根的上內距（dp）：小卡矮到放不下 48dp 高的鈕容器時壓到最低 6（只有小卡壓）
    private static final int MEDIUM_HEAD = 38;      // 標題列（20.6）＋已收集行（15.2）＋列容器上距 2＝37.9 進位；蓋章鈕搬到地圖欄之後，已收集那一行只剩字（舊值 50 含 26dp 高的鈕容器）。各列常數都是實測進位，整體保守至少 0.6dp
    private static final int ROW_SYS = 17;
    private static final int ROW_NOTE = 18;         // 含 marginTop 3
    private static final int ROW_LEGEND = 17;       // 含 marginTop 3
    private static final int ROW_BAR = 8;
    private static final int ROW_REMAIN = 23;       // 含 marginTop 5
    private static final int ROW_RECENT = 19;
    /** 單一系統中卡最近蓋章的筆數上限（契約〈畫法約定〉9）。 */
    private static final int MAX_RECENT = 4;
    /** 整張卡的字都是拉丁字母時（英文）各列的高度（dp）：實測標題列＋已收集行 28.6（標題 16.4＋已收集 12.6）加列容器上距 2、「還有 N 座」列 5＋14.5、最近蓋章一列 15.2；
     *  CJK 的行高高約 25%（見上面的 MEDIUM_HEAD／ROW_REMAIN／ROW_RECENT），用 CJK 的值估英文會少放一列（2026-09-30 英文 158dp 高的台鐵中卡剩 29dp 空著）。 */
    private static final int MEDIUM_HEAD_LATIN = 31, ROW_REMAIN_LATIN = 20, ROW_RECENT_LATIN = 16;
    /** 蓋章鈕（整條按鈕，契約〈畫法約定〉11）：膠囊高 28dp；容器＝上空隙＋膠囊＋下 15dp，下 15dp 用 -15dp 下邊距伸進欄位的 paddingBottom，
     *  所以容器淨占欄位高度＝上空隙＋28，可點範圍高＝上空隙＋28＋15（空隙 5dp＝剛好 48dp）。
     *  小卡：空隙固定 5dp（見 widget_collect_small.xml），淨占 STAMP_BLOCK＝33。
     *  中卡：空隙隨地圖高度走（要容得下恆春半島畫到點陣框下緣之外的墨，約框高的 MAP_INK_BELOW），最少 STAMP_GAP_MIN。 */
    private static final int STAMP_PILL = 28, STAMP_GAP_MIN = 5, STAMP_PAD_BOTTOM = 15;
    private static final int STAMP_BLOCK = STAMP_GAP_MIN + STAMP_PILL;
    private static final float MAP_INK_BELOW = 0.10f;
    /** 中卡地圖高度的下限（dp）：矮到這個程度（110dp 高的中卡）地圖還是畫得出輪廓，不再縮。 */
    private static final float MAP_MIN_DP = 40f;
    /** 矮卡壓縮時百分比字級的下限（sp）：再矮就先壓根的上內距（最低 PAD_TOP_MIN），百分比才往下縮。 */
    private static final float PCT_COMPACT = 16f;
    /** 小卡高度預算：標題與文字欄之間留的空隙（預算用的保留量，版面裡沒有對應的 margin；百分比的行框上方本來就有字形外的空白）、
     *  百分比與「已收集」的間距（正常／矮卡壓縮後）。只有後者是版面真的會變的屬性（wc_count 的 paddingTop）。
     *  HEAD_GAP 由 6 降到 1：蓋章鈕變成 48dp 高的整條按鈕（淨占 33dp，舊的 24dp）之後，158dp 高的小卡剩下的餘裕只有約 1.7dp，
     *  保留量再大就會為了鈕丟掉「還有 N 座」；標題與百分比的實際間距由預言機量（字形框至少 1dp）。 */
    private static final float HEAD_GAP = 1f, HEAD_GAP_TIGHT = 2f, COUNT_GAP = 4f;
    /** 標題列放不放得下的取整餘裕（dp）：寧可收掉副標，也不讓字被「…」截斷。 */
    private static final float FIT_SLACK = 1f;
    /** 百分比大字一行的高度倍數（實測 20sp→23.7dp、34sp→40.0dp，取 1.2 留餘裕）、正常間距下的字級下限、再矮時的絕對下限（sp）。 */
    private static final float PCT_LH = 1.2f, PCT_FLOOR = 20f, PCT_MIN = 12f;
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
        boolean kick = smallHeader(c, v, f, kicker, wDp);
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
        // 蓋章鈕（整條，寬＝文字欄寬；字會 autoSize 縮到 9sp，左右內距各 6dp）也要放得進文字欄：縮到 9sp 還放不下就把地圖讓出來，
        // 不讓按鈕的字折成兩行被裁掉。
        showMap = showMap && tightWidth(stamp, 9 * fs) * 1.1f + 12f <= colW;
        if (!showMap) colW = wDp - CARD_PAD_H;
        // 根的上內距（dp）：平常 12；矮卡放不下 48dp 高的鈕容器時壓低（最低 PAD_TOP_MIN），兩個分支都在最後明講一次
        float padTop = CARD_PAD_TOP;
        float emptySp = 13f;

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
            // 矮卡（110dp 高）：標題折成兩行再加 48dp 高的鈕容器放不下 → 先壓根的上內距，還不夠就把邀請標題縮到 12sp
            float emptyRoom = hDp - CARD_PAD_V - 13 * LINE_H * fs;
            if (titleH + STAMP_BLOCK > emptyRoom) {
                float more = Math.min(CARD_PAD_TOP - PAD_TOP_MIN, titleH + STAMP_BLOCK - emptyRoom);
                padTop = CARD_PAD_TOP - more;
                if (titleH + STAMP_BLOCK > emptyRoom + more) emptySp = 12f;
            }
            v.setTextViewTextSize(R.id.wc_empty_title, android.util.TypedValue.COMPLEX_UNIT_SP, emptySp);
        } else {
            v.setViewVisibility(R.id.wc_pct, android.view.View.VISIBLE);
            v.setViewVisibility(R.id.wc_count, android.view.View.VISIBLE);
            v.setViewVisibility(R.id.wc_empty_title, android.view.View.GONE);
            v.setViewVisibility(R.id.wc_empty_hint, android.view.View.GONE);
            v.setTextViewText(R.id.wc_pct, bigPercent(f.percentLabel));
            float pctSp = percentSp(f.percentLabel, colW, fs);
            // 高度預算（dp）：卡高扣掉上下內距（CARD_PAD_V，含文字欄底部 15）與標題列（13sp 一行，CJK 行高約 1.45 倍；拉丁字母較矮，取大的），
            // 剩下給文字欄。文字欄由下往上排：蓋章區塊（STAMP_BLOCK）→「還有 N 座」（放得下才放）→ 已收集 → 百分比大字；標題與文字欄之間另留 HEAD_GAP。
            // 先丟次要的「還有 N 座」；再放不下，百分比縮到 PCT_FLOOR；還是放不下（約 124dp 以下）就把兩段間距壓到最小、百分比再縮到放得下為止；
            // 縮到 PCT_COMPACT 還放不下（110dp 高的 2×2）就先把根的上內距由 12dp 壓到最低 PAD_TOP_MIN，百分比才再往下縮。
            // 🔴 標題、百分比、已收集、蓋章鈕都要完整看得見：寧可字小，也不讓任何一個被裁在文字欄外（2026-09-30 110dp 高的百分比上半被裁）。
            float room = hDp - CARD_PAD_V - 13 * LINE_H * fs;
            float lineH = 16 * fs;                        // 11sp 一行（CJK 行高，實測 16.0dp）
            float countGap = COUNT_GAP;
            boolean remain = pctSp * PCT_LH * fs + HEAD_GAP + COUNT_GAP + lineH + 1 + lineH + STAMP_BLOCK <= room;
            if (!remain) {
                float fit = (room - HEAD_GAP - COUNT_GAP - lineH - STAMP_BLOCK) / (PCT_LH * fs);
                if (fit >= PCT_FLOOR) {
                    pctSp = Math.min(pctSp, fit);
                } else {
                    countGap = 0;
                    fit = (room - HEAD_GAP_TIGHT - lineH - STAMP_BLOCK) / (PCT_LH * fs);
                    if (fit < PCT_COMPACT) {
                        float more = Math.min(CARD_PAD_TOP - PAD_TOP_MIN, (PCT_COMPACT - fit) * PCT_LH * fs);
                        padTop = CARD_PAD_TOP - more;
                        fit += more / (PCT_LH * fs);
                    }
                    pctSp = Math.max(PCT_MIN, Math.min(PCT_FLOOR, fit));
                }
            }
            // 已收集的上距用 padding（RemoteViews 改得了 padding、改不了 margin）；每次都明講（launcher 是 reapply 到舊 View 樹）
            v.setViewPadding(R.id.wc_count, 0, Math.round(countGap * c.getResources().getDisplayMetrics().density), 0, 0);
            v.setTextViewTextSize(R.id.wc_pct, android.util.TypedValue.COMPLEX_UNIT_SP, pctSp);
            v.setTextViewText(R.id.wc_count, countText);
            v.setTextViewText(R.id.wc_remain, remainText);
            v.setViewVisibility(R.id.wc_remain, remain ? android.view.View.VISIBLE : android.view.View.GONE);
        }

        // 根的內距：左 14、右 16、下 0（下 15dp 在欄位的 paddingBottom，鈕容器要伸進去），上 padTop。setViewPadding 四個值要一起給；每次都明講
        float density0 = c.getResources().getDisplayMetrics().density;
        v.setViewPadding(R.id.wc_root, Math.round(14 * density0), Math.round(padTop * density0), Math.round(16 * density0), 0);
        v.setViewVisibility(R.id.wc_map_slot, showMap ? android.view.View.VISIBLE : android.view.View.GONE);
        if (showMap) {
            float density = c.getResources().getDisplayMetrics().density;
            float bodyH = Math.max(48, hDp - padTop - (CARD_PAD_V - CARD_PAD_TOP) - 16 - 6 - 4);
            float slotW = (wDp - CARD_PAD_H) * 0.42f;
            float mapH = Math.min(bodyH, slotW / (float) f.aspect);
            setMaps(v, f, mapH, density, c.getResources(), true);
        }
        v.setContentDescription(R.id.wc_root, describe(c, f));
        return v;
    }

    /**
     * 小卡標題列 [範圍名][副標「車站收集」]，省略順序照契約〈畫法約定〉8：同一行放得下就都放；放不下，全台範圍只留「車站收集」
     * （「全台」是預設值）、單一系統只留系統名；只剩一個名稱還放不下就縮字（下限 75%）再截斷。不因語言另設特例。
     * 放不放得下用 Paint 量實際寬度（與 TextView 同一套字型），不是估計。回傳副標要不要顯示（可見性由 small() 明講兩個分支）。
     * 🔴 標題的文字與字級兩個分支都要明講：launcher 是 reapply 到舊 View 樹，沒提到的屬性會停在上一次的樣子。
     */
    private static boolean smallHeader(Context c, RemoteViews v, CollectionData.Figures f, String kicker, int wDp) {
        float rowW = wDp - CARD_PAD_H;
        float scopeW = measuredWidth(c, f.title, 13, true);
        // 4＝副標的 marginStart；FIT_SLACK 留給取整，寧可收掉副標也不讓字被「…」截斷
        boolean both = scopeW + 4 + measuredWidth(c, kicker, 11, false) + FIT_SLACK <= rowW;
        String name = both || !f.isAll() ? f.title : kicker;
        float nameW = both || !f.isAll() ? scopeW : measuredWidth(c, name, 13, true);
        float scale = nameW + FIT_SLACK > rowW ? Math.max(0.75f, (rowW - FIT_SLACK) / nameW) : 1f;
        v.setTextViewText(R.id.wc_title, name);
        v.setTextViewText(R.id.wc_subtitle, kicker);
        v.setTextViewTextSize(R.id.wc_title, android.util.TypedValue.COMPLEX_UNIT_SP, 13 * scale);
        // 副標的字級也明講：版面 XML 宣告的 11sp 會被取整成整數像素，CJK 字寬隨整數像素跳（實測 7 個字差 2.7dp），
        // 和上面 Paint 量的浮點字級對不上，「放得下」就會誤判
        v.setTextViewTextSize(R.id.wc_subtitle, android.util.TypedValue.COMPLEX_UNIT_SP, 11);
        return both;
    }

    /** 一段文字在 sp 字級下的實際寬度（dp）：Paint 量，粗體用系統粗體；sp 換像素走 TypedValue（含使用者的字級設定）。 */
    static float measuredWidth(Context c, String text, float sp, boolean bold) {
        android.util.DisplayMetrics dm = c.getResources().getDisplayMetrics();
        android.text.TextPaint p = new android.text.TextPaint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        p.setTypeface(bold ? android.graphics.Typeface.DEFAULT_BOLD : android.graphics.Typeface.DEFAULT);
        p.setTextSize(android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, sp, dm));
        return p.measureText(text) / dm.density;
    }

    // ── 中卡 ───────────────────────────────────────────────────────────────────

    private static RemoteViews medium(Context c, CollectionData.Figures f, int wDp, int hDp) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_collect_medium);
        String kicker = RailNativeL10n.text(c, "車站收集");
        // 標題列照契約〈畫法約定〉8：全台範圍的標題本來就只有「車站收集」；單一系統是「範圍 · 車站收集」，同一行（14sp 粗體）放得下才用，
        // 放不下就只留系統名。標題欄寬（dp）＝文字欄寬 − 百分比 − 間距（蓋章鈕在地圖欄最下面，不占標題列與文字欄）；
        // 只剩一個名稱還放不下，由版面的 autoSize 縮字（下限 75%）再截斷。放不放得下用 Paint 量，不是估計。
        String stamp = RailNativeL10n.text(c, "蓋章");
        v.setTextViewText(R.id.wc_stamp, stamp);
        v.setContentDescription(R.id.wc_stamp_hit, stamp);
        float titleCol = (wDp - CARD_PAD_H - 8) * 0.70f - measuredWidth(c, f.percentLabel, 14, true) - 6;
        String both = f.title + " · " + kicker;
        String heading = f.isAll() ? kicker : (measuredWidth(c, both, 14, true) + FIT_SLACK <= titleCol ? both : f.title);
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
        boolean latin = !hasCjk(heading) && !hasCjk(RailNativeL10n.text(c, "已收集 {v}／{n} 座", "v", "0", "n", "0"));
        float avail = hDp - CARD_PAD_V - (latin ? MEDIUM_HEAD_LATIN : MEDIUM_HEAD) * fs;
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
            scopeRows(c, v, f, avail, fs, legendFits(c, wDp, fs), latin);
        }

        float density = c.getResources().getDisplayMetrics().density;
        // 地圖欄由上往下：地圖格（吃掉剩下的高度）→ 蓋章鈕容器。容器淨占＝上空隙＋STAMP_PILL（下 15dp 伸進欄位的下內距）；
        // 上空隙要容得下恆春半島畫到點陣框下緣之外的墨（約框高的 MAP_INK_BELOW），所以空隙與地圖高度一起解（幾次迭代就收斂）。
        // 空隙是容器的 paddingTop（RemoteViews 改得了 padding、改不了 margin），每次都明講（launcher 是 reapply 到舊 View 樹）。
        float colH = Math.max(0f, hDp - CARD_PAD_V);
        float gap = STAMP_GAP_MIN;
        float slotH = colH - STAMP_PILL - gap;
        for (int i = 0; i < 4; i++) {
            gap = Math.max(STAMP_GAP_MIN, (float) Math.ceil(Math.max(MAP_MIN_DP, slotH) * MAP_INK_BELOW + 1f));
            slotH = colH - STAMP_PILL - gap;
        }
        v.setViewPadding(R.id.wc_stamp_hit, 0, Math.round(gap * density), 0, Math.round(STAMP_PAD_BOTTOM * density));
        float slotW = (wDp - CARD_PAD_H - 8) * 0.30f;
        float mapH = Math.max(MAP_MIN_DP, Math.min(slotH, slotW / (float) f.aspect));
        setMaps(v, f, mapH, density, c.getResources(), false);
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
    private static void scopeRows(Context c, RemoteViews v, CollectionData.Figures f, float avail, float fs, boolean legendOk, boolean latinHead) {
        // 契約〈畫法約定〉9：放得下幾筆就畫幾筆，上限 MAX_RECENT、最少 0，畫篩出來的前 N 筆（recent 已排好序，不重排）；下面依高度預算由後往前丟
        int recents = Math.min(MAX_RECENT, f.recent.size());
        boolean legend = legendOk;
        // 這張卡的列都是拉丁字母才用矮的行高；任何一個字串含 CJK 就照 CJK 估（寧可少放一列也不讓字被裁）
        boolean latin = latinHead && !hasCjk(RailNativeL10n.text(c, "還有 {n} 座", "n", "0"));
        for (int i = 0; i < recents && latin; i++) latin = !hasCjk(f.recent.get(i).name) && !hasCjk(f.recent.get(i).line);
        int rowRecent = latin ? ROW_RECENT_LATIN : ROW_RECENT;
        int fixed = ROW_BAR + (latin ? ROW_REMAIN_LATIN : ROW_REMAIN);
        while (need((fixed + recents * rowRecent + (legend ? ROW_LEGEND : 0)) * fs, avail)) {
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
    private static void setMaps(RemoteViews v, CollectionData.Figures f, float mapHDp, float density, android.content.res.Resources res, boolean small) {
        CollectionMapRender.Bleed bleed = CollectionMapRender.bleed(res, small);
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

    /** 字串裡有沒有 CJK 字元（行高估計用：CJK 行高約 1.45 倍字級，拉丁字母約 1.2 倍）。 */
    static boolean hasCjk(String text) {
        for (int i = 0; i < text.length(); i++) if (text.charAt(i) >= 0x2E80) return true;
        return false;
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
