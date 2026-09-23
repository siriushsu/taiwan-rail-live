package tw.railisland.app;

import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 捷運等車卡 B 方案「進站軌道」的 Android 半邊：Android 16 ProgressStyle 的兩端是上一站與本站，
 * 進度條上的 tracker 換成自家車模的【正側面】圖（與 iOS 鎖定畫面同一張），分段用路線色。
 *
 * 規則與 iOS（MetroWidgetShared.swift waitHop、MetroWaitActivity.swift MetroWaitDisplay）同一套：
 *   車的位置＝官方倒數 ÷ 上一站到本站的站間秒；倒數大於「站間＋上一站停站」＝車還沒到上一站，
 *   畫在上一站左邊；上一站解不出唯一答案、分鐘級系統、最近一次抓資料失敗 ⇒ 不畫車（不猜）。
 */
final class RailWaitTrack {
    private RailWaitTrack() {}

    /** 車在上一站→本站之間時，每隔多久重貼一次通知讓車往前走（只重算位置，不重抓資料）。 */
    static final long MOVE_TICK_MS = 20_000L;
    /** 本機重貼時，距上次真的抓資料不到這麼久就不再抓（官方每分鐘才更新一次）。 */
    static final long FETCH_MIN_GAP_MS = 55_000L;

    static final class Hop {
        final String prev;
        final double runSec;
        final double dwellSec;
        final String lineId;
        final String lineName;
        final String color;

        Hop(String prev, double runSec, double dwellSec, String lineId, String lineName, String color) {
            this.prev = prev;
            this.runSec = runSec;
            this.dwellSec = dwellSec;
            this.lineId = lineId;
            this.lineName = lineName;
            this.color = color;
        }

        /** 路線→車型對照同 iOS MetroWaitHop.carModel（網站 3D 列車 formations.js 的 baseFormation）。 */
        int carDrawable() {
            switch (lineId) {
                case "BR": return R.drawable.la_side_val256;
                case "BL": return R.drawable.la_side_c321;
                case "Y": return R.drawable.la_side_y100;
                default: return R.drawable.la_side_c381;
            }
        }
    }

    /** 等車卡的上一站：由目錄站序與終點推方向。解不出唯一答案回 null（理由見 iOS waitHop 註解）。 */
    static Hop hop(Context context, String sys, String station, String dest) {
        try {
            return hop(MetroWidgetData.catalog(context), sys, station, dest);
        } catch (Exception ignored) {
            return null;
        }
    }

    static Hop hop(MetroWidgetData.Catalog catalog, String sys, String station, String dest) {
        MetroWidgetData.SystemInfo system = catalog.byId.get(sys);
        if (system == null || !"sec".equals(system.precision) || dest == null || dest.isEmpty()) return null;
        Set<String> names = new HashSet<>();
        for (List<String> order : system.lineOrder.values()) names.addAll(order);
        JSONObject alias = catalog.alias.optJSONObject(sys);
        String here = canonical(alias, station, names);
        String to = canonical(alias, dest, names);
        if (here == null || to == null || here.equals(to)) return null;
        List<Hop> found = new ArrayList<>();
        for (Map.Entry<String, List<String>> line : system.lineOrder.entrySet()) {
            List<String> stops = line.getValue();
            int i = stops.indexOf(here), j = stops.indexOf(to);
            if (i < 0 || j < 0) continue;
            int p = j > i ? i - 1 : i + 1;
            if (p < 0 || p >= stops.size()) return null;          // 本站是這個方向的起點
            List<Double> runs = system.lineRun.get(line.getKey());
            List<Double> dwells = system.lineDwell.get(line.getKey());
            // run 記在「站序較後」的那一站(= 前一站到它);兩個方向同值。
            double run = runs == null ? Double.NaN : runs.get(j > i ? i : p);
            if (!(run > 0)) return null;
            double dwell = dwells == null ? Double.NaN : dwells.get(p);
            String color = system.lineColors.get(line.getKey());
            found.add(new Hop(stops.get(p), run, dwell > 0 ? dwell : 0, line.getKey(),
                system.lineLabels.get(line.getKey()), color == null || color.isEmpty() ? null : color));
        }
        if (found.isEmpty()) return null;
        Hop first = found.get(0);
        Set<String> stems = new HashSet<>(), colors = new HashSet<>();
        for (Hop h : found) {
            if (!h.prev.equals(first.prev) || h.runSec != first.runSec) return null;   // 兩條線上一站不同
            if (h.lineName != null && !h.lineName.isEmpty()) {
                int cut = h.lineName.indexOf('（');
                stems.add(cut < 0 ? h.lineName : h.lineName.substring(0, cut));
            }
            if (h.color != null) colors.add(h.color);
        }
        return new Hop(first.prev, first.runSec, first.dwellSec, first.lineId,
            stems.size() == 1 ? stems.iterator().next() : null,
            colors.size() == 1 ? colors.iterator().next() : null);
    }

    /** 站名對回目錄：先直接比對，不中才走別名、臺→台、去尾綴「站」（順序同 iOS canonicalStation）。 */
    private static String canonical(JSONObject alias, String raw, Set<String> known) {
        if (raw == null || raw.isEmpty()) return null;
        if (known.contains(raw)) return raw;
        String a = alias == null ? null : alias.optString(raw, null);
        if (a != null && known.contains(a)) return a;
        String tai = raw.replace('臺', '台');
        if (known.contains(tai)) return tai;
        if (tai.endsWith("站") && tai.length() > 1) {
            String stripped = tai.substring(0, tai.length() - 1);
            if (known.contains(stripped)) return stripped;
        }
        return null;
    }

    /** 車頭位置：-1＝不畫車；-2＝還沒到上一站；0…1＝上一站→本站（1＝進站）。 */
    static double carPosition(Hop hop, Double nextEta, double nowSec, boolean connected) {
        if (!connected || nextEta == null) return -1;
        double left = nextEta - nowSec;
        if (left <= 0) return 1;
        if (left <= hop.runSec) return 1 - left / hop.runSec;
        if (left <= hop.runSec + hop.dwellSec) return 0;
        return -2;
    }

    /**
     * 下一次該重貼通知的時刻：車在上一站→本站之間每 {@link #MOVE_TICK_MS} 一次；
     * 還沒進區間就約在「車離開上一站前停站」那一刻醒來。不需要就回 -1（Android 16 以前沒有進站軌道）。
     */
    static long nextMoveMillis(Context context, JSONObject state, long etaMillis, long nowMillis) {
        if (Build.VERSION.SDK_INT < 36 || state.optBoolean("trackOffline", false)) return -1;
        Hop hop = hop(context, state.optString("sys", ""), state.optString("station", ""),
            state.optString("nextDest", ""));
        if (hop == null) return -1;
        long moveFrom = etaMillis - (long) ((hop.runSec + hop.dwellSec) * 1000);
        return nowMillis < moveFrom ? moveFrom : nowMillis + MOVE_TICK_MS;
    }

    /** 這一輪只要本機重貼（車往前挪），不必重抓官方看板。 */
    static boolean localTickOnly(JSONObject state, long nowMillis) {
        if (Build.VERSION.SDK_INT < 36) return false;
        long fetchedAt = state.optLong("fetchedAt", 0);
        double eta = state.optDouble("nextEta", Double.NaN);
        return fetchedAt > 0 && nowMillis - fetchedAt < FETCH_MIN_GAP_MS
            && !Double.isNaN(eta) && eta * 1000 > nowMillis;
    }

    /**
     * 組 ProgressStyle。系統的 tracker 固定 20dp 高、寬最多 2 倍高，超出的部分會被
     * 【從中間裁掉】（NotificationProgressBar.configureTrackerBounds／drawTracker 的 clipRect）——
     * 車模比例 2.3～2.8 會被切掉車頭車尾，所以先補透明邊成 2:1 的畫布，車整台留在裡面。
     * tracker 以進度點為中心 ⇒ 進度要往回退半台車，車頭才會對齊目前位置。
     */
    static NotificationCompat.ProgressStyle style(Context context, Hop hop, double pos,
            String stationColorFallback) {
        int line = parse(hop.color, parse(stationColorFallback, 0xFF26497E));
        return style(context, hop.carDrawable(), pos, line, line);
    }

    /**
     * 台鐵等站卡：車模由網頁送來的車型 id 決定（{@link #traCarDrawable}），路線色＝車種色只給
     * 還沒走完的那段；站牌帶子用站牌本色（深藍），同 iOS 台鐵站牌。
     */
    static NotificationCompat.ProgressStyle traStyle(Context context, int carRes, double pos, String colorHex) {
        return style(context, carRes, pos, parse(colorHex, 0xFF26497E), 0xFF26497E);
    }

    private static NotificationCompat.ProgressStyle style(Context context, int carRes, double pos,
            int line, int band) {
        boolean dark = (context.getResources().getConfiguration().uiMode
            & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int rail = dark ? 0xFF5A5A5E : 0xFFC7C7CC;
        NotificationCompat.ProgressStyle style = new NotificationCompat.ProgressStyle()
            .setStyledByProgress(false)
            .setProgressEndIcon(IconCompat.createWithBitmap(plate(context, band, dark)));
        double half = halfCarFraction();
        if (pos == -2) {
            // 還沒到上一站：上一站畫成進度條上的點，車停在它左邊（車頭不碰到它）。
            int prevAt = 300;
            segment(style, prevAt, rail);
            segment(style, 1000 - prevAt, line);
            style.addProgressPoint(new NotificationCompat.ProgressStyle.Point(prevAt).setColor(rail));
            style.setProgressTrackerIcon(car(context, carRes))
                .setProgress((int) Math.round(half * 1000));
            return style;
        }
        style.setProgressStartIcon(IconCompat.createWithBitmap(ring(context)));
        if (pos < 0) {
            // 沒接上：只畫上一站→本站的軌道，不畫車（車停在畫面上等於說謊）。
            segment(style, 1000, rail);
            style.setProgress(0);
            return style;
        }
        int nose = (int) Math.round(Math.max(0, Math.min(1, pos)) * 1000);
        if (nose > 0) segment(style, nose, rail);
        if (nose < 1000) segment(style, 1000 - nose, line);
        double center = Math.max(half, Math.min(1 - half, pos - half));
        style.setProgressTrackerIcon(car(context, carRes)).setProgress((int) Math.round(center * 1000));
        return style;
    }

    private static void segment(NotificationCompat.ProgressStyle style, int length, int color) {
        style.addProgressSegment(new NotificationCompat.ProgressStyle.Segment(length).setColor(color));
    }

    private static int parse(String hex, int fallback) {
        try { return hex == null || hex.isEmpty() ? fallback : Color.parseColor(hex); }
        catch (IllegalArgumentException ignored) { return fallback; }
    }

    /**
     * 半台車佔進度條的比例。進度條寬＝螢幕寬扣掉通知左右邊距、內容縮排與兩端圖示
     * （AOSP notification_template_material_progress：內容左 52dp／右 16dp、兩端圖示各 20＋4dp，
     * 通知卡本身左右約 12dp）。各家版面略有出入，這裡只求車頭大致對齊。
     */
    private static double halfCarFraction() {
        Resources res = Resources.getSystem();
        float density = res.getDisplayMetrics().density;
        float screenDp = res.getDisplayMetrics().widthPixels / (density > 0 ? density : 1);
        float barDp = Math.max(160f, screenDp - 140f);
        return 20.0 / barDp;
    }

    /**
     * 台鐵車型 id（網站 3D 列車 formations.js 的 FORMATIONS[…].id）→ 正側面車模。
     * 沒有素材的車型回 0 ⇒ 呼叫端不畫進站軌道（同 iOS TraWaitHop.carAspect 回 nil）。
     * 刻意寫成明列的 switch 而不是 getIdentifier：資源縮減只認得寫死的 R 參照。
     */
    static int traCarDrawable(String model) {
        switch (model == null ? "" : model) {
            case "emu3000": return R.drawable.la_side_emu3000;
            case "temu1000": return R.drawable.la_side_temu1000;
            case "temu2000": return R.drawable.la_side_temu2000;
            case "e1000": return R.drawable.la_side_e1000;
            case "dr3100": return R.drawable.la_side_dr3100;
            case "emu800": return R.drawable.la_side_emu800;
            case "e200": return R.drawable.la_side_e200;
            case "dr1000": return R.drawable.la_side_dr1000;
            case "blue": return R.drawable.la_side_blue;
            case "haifeng": return R.drawable.la_side_haifeng;
            case "shanlan": return R.drawable.la_side_shanlan;
            case "mingri": return R.drawable.la_side_mingri;
            case "e500": return R.drawable.la_side_e500;
            default: return 0;
        }
    }

    private static IconCompat car(Context context, int carRes) {
        Bitmap src = BitmapFactory.decodeResource(context.getResources(), carRes);
        int w = src.getWidth(), h = Math.max(w / 2, src.getHeight());
        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        new Canvas(out).drawBitmap(src, 0, (h - src.getHeight()) / 2f, new Paint(Paint.FILTER_BITMAP_FLAG));
        return IconCompat.createWithBitmap(out);
    }

    /** 上一站：空心圓（同 iOS 軌道左端與設計稿）。 */
    private static Bitmap ring(Context context) {
        int size = px(context, 20);
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(size * 0.1f);
        p.setColor(0xFF8E8E93);
        float r = size * 0.36f;
        new Canvas(out).drawCircle(size / 2f, size / 2f, r, p);
        return out;
    }

    /** 本站：縮小的琺瑯站牌（白底藍字「站」＋路線色帶子，配色同 iOS MetroWaitPlate；深色是白瓷壓暗一階）。 */
    private static Bitmap plate(Context context, int band, boolean dark) {
        int size = px(context, 20);
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        float r = size * 0.2f, bandTop = size * 0.68f, frame = Math.max(1f, size * 0.07f);
        RectF all = new RectF(0, 0, size, size);
        Path clip = new Path();
        clip.addRoundRect(all, r, r, Path.Direction.CW);
        c.save();
        c.clipPath(clip);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(dark ? 0xFFDCD8CC : 0xFFF7F5EE);
        c.drawRect(all, fill);
        fill.setColor(band);
        c.drawRect(0, bandTop, size, size, fill);
        c.restore();
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(0xFF26497E);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setTextAlign(Paint.Align.CENTER);
        text.setTextSize(size * 0.5f);
        Paint.FontMetrics fm = text.getFontMetrics();
        float baseline = bandTop / 2f - (fm.ascent + fm.descent) / 2f;
        c.drawText(RailNativeL10n.text(context, "站"), size / 2f, baseline, text);
        Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(frame);
        stroke.setColor(dark ? 0xFF6B6557 : 0xFF767061);
        float inset = frame / 2f;
        c.drawRoundRect(new RectF(inset, inset, size - inset, size - inset), r, r, stroke);
        return out;
    }

    private static int px(Context context, float dp) {
        return Math.max(1, Math.round(dp * context.getResources().getDisplayMetrics().density));
    }
}
