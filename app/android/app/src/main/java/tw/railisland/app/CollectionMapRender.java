package tw.railisland.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;

/**
 * 「車站收集」點陣地圖：Canvas 畫成 ARGB_8888 Bitmap，交給 RemoteViews 的 ImageView。
 * 畫法與 iOS CollectionMapView 一致（docs/collect-widget-contract.md〈畫法約定〉）：
 *
 * · 座標都在 payload 的 0..1000 正規化空間；圖框寬 = 高 × aspect，所以「正方形視窗」＝真實比例不變形。
 * · 三態：s=2 搭過或到訪＝線色實心圓；s=1 跟完＝線色空心圈（圈寬＝半徑 0.45 倍，圈外徑＝實心圓直徑）；
 *   s=0 未收集＝灰色小實心點。
 * · 全台範圍＝整島框（視窗 0..1000）。單一系統範圍＝放大到該系統：該系統點外框加邊距後取正方形視窗，
 *   視窗內其他系統的點畫成更淡一階的中性灰墊在下面，視窗外的點不畫。
 *
 * 🔴 淺／深兩份 Bitmap：Bitmap 不會跟著系統深淺色切換（資源會，像素不會），所以兩份都畫，
 *    由版面的資源限定值決定露出哪一張（見 widget_collect_small.xml 與 values(-night)/dimens_collect.xml）。
 */
final class CollectionMapRender {
    private CollectionMapRender() {}

    /** 點半徑 = 圖高 × 這個比例，但至少 1dp；已收集的點再放大 SOLID_SCALE 倍（與 iOS CollectionMetrics 同值）。 */
    static final float DOT_RADIUS_RATIO = 0.0075f;
    static final float SOLID_SCALE = 1.3f;
    /** 空心圈的圈寬 = 外半徑 × 這個比例（第二輪規格第 4 點）。 */
    static final float RING_WIDTH_RATIO = 0.45f;

    // 中性灰（未收集）與「更淡一階」的灰（單一系統視窗裡的其他系統）。
    // 底色是 wg_paper（淺 #FDFBF4／深 #101C2E），灰要在兩種底上都看得見、又不搶線色。
    private static final int OFF_LIGHT = 0xFFD2D2D2;
    private static final int OTHER_LIGHT = 0xFFE7E7E7;
    private static final int OFF_DARK = 0xFF485163;
    private static final int OTHER_DARK = 0xFF2B3444;
    /** 解不出線色時用品牌藏青（＝ wg_navy 的淺／深值）：點要照畫，不能丟。 */
    private static final int BRAND_LIGHT = 0xFF2A4A73;
    private static final int BRAND_DARK = 0xFF7FA6E0;
    /** 深色模式把線色提亮（iOS 取 1.25 再夾住），不然藏青與深綠在深底上看不見。 */
    private static final float DARK_GAIN = 1.25f;

    /** 視窗（正規化單位）：x0、y0 是左上角，size 是正方形邊長。全台＝(0,0,1000)。 */
    static final class Window {
        final float x0;
        final float y0;
        final float size;

        Window(float x0, float y0, float size) {
            this.x0 = x0;
            this.y0 = y0;
            this.size = size;
        }

        boolean contains(float x, float y) {
            return x >= x0 && x <= x0 + size && y >= y0 && y <= y0 + size;
        }
    }

    /**
     * 單一系統的放大視窗：外框 [minX,maxX]×[minY,maxY]，pad = max(0.12×max(寬,高), 10)，
     * S = max(寬+2pad, 高+2pad, 40)，以外框中心為中心；超出 0..1000 不夾回。
     * 全台、或該系統一個點都沒有（沒東西可框）→ 整島框。
     */
    static Window window(CollectionData.Figures f) {
        if (f.isAll() || f.dots.isEmpty()) return new Window(0, 0, 1000);
        float minX = Float.MAX_VALUE, maxX = -Float.MAX_VALUE, minY = Float.MAX_VALUE, maxY = -Float.MAX_VALUE;
        for (CollectionData.Pt p : f.dots) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        float w = maxX - minX;
        float h = maxY - minY;
        float pad = Math.max(0.12f * Math.max(w, h), 10f);
        float size = Math.max(Math.max(w + 2 * pad, h + 2 * pad), 40f);
        float cx = (minX + maxX) / 2f;
        float cy = (minY + maxY) / 2f;
        return new Window(cx - size / 2f, cy - size / 2f, size);
    }

    static float radius(int heightPx, float density) {
        return Math.max(density, heightPx * DOT_RADIUS_RATIO);
    }

    static int widthFor(double aspect, int heightPx) {
        return Math.max(1, (int) Math.round(heightPx * aspect));
    }

    /** 線色 → ARGB。深色模式提亮；解不出來用品牌藏青。 */
    static int lineColor(String hex, boolean night) {
        int brand = night ? BRAND_DARK : BRAND_LIGHT;
        if (hex == null) return brand;
        String s = hex.trim();
        if (s.startsWith("#")) s = s.substring(1);
        if (s.length() != 6) return brand;
        int rgb;
        try {
            rgb = Integer.parseInt(s, 16);
        } catch (NumberFormatException error) {
            return brand;
        }
        float gain = night ? DARK_GAIN : 1f;
        int r = Math.min(255, Math.round(((rgb >> 16) & 0xFF) * gain));
        int g = Math.min(255, Math.round(((rgb >> 8) & 0xFF) * gain));
        int b = Math.min(255, Math.round((rgb & 0xFF) * gain));
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }

    static Bitmap render(CollectionData.Figures f, boolean night, int heightPx, float density) {
        int h = Math.max(8, heightPx);
        int w = widthFor(f.aspect, h);
        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        float r = radius(h, density);
        float rSolid = r * SOLID_SCALE;
        // 留出已收集點的半徑當內距，最邊上的點才不會被裁掉（與 iOS center() 同一條）。
        float inset = rSolid;
        Window win = window(f);
        int off = night ? OFF_DARK : OFF_LIGHT;
        int other = night ? OTHER_DARK : OTHER_LIGHT;

        // 1) 視窗內的其他系統：更淡一階的灰，墊在最下面
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(other);
        for (CollectionData.Pt p : f.others) {
            if (!win.contains(p.x, p.y)) continue;
            canvas.drawCircle(cx(p.x, win, w, inset), cy(p.y, win, h, inset), r, paint);
        }
        // 2) 未收集：中性灰
        paint.setColor(off);
        for (CollectionData.Pt p : f.dots) {
            if (p.s != 0 || !win.contains(p.x, p.y)) continue;
            canvas.drawCircle(cx(p.x, win, w, inset), cy(p.y, win, h, inset), r, paint);
        }
        // 3) 跟完：線色空心圈，圈外徑＝實心圓直徑
        paint.setStyle(Paint.Style.STROKE);
        float ring = RING_WIDTH_RATIO * rSolid;
        paint.setStrokeWidth(ring);
        for (CollectionData.Pt p : f.dots) {
            if (p.s != 1 || !win.contains(p.x, p.y)) continue;
            paint.setColor(lineColor(p.color, night));
            canvas.drawCircle(cx(p.x, win, w, inset), cy(p.y, win, h, inset), rSolid - ring / 2f, paint);
        }
        // 4) 搭過或到訪：線色實心圓（最後畫，疊在最上面）
        paint.setStyle(Paint.Style.FILL);
        for (CollectionData.Pt p : f.dots) {
            if (p.s != 2 || !win.contains(p.x, p.y)) continue;
            paint.setColor(lineColor(p.color, night));
            canvas.drawCircle(cx(p.x, win, w, inset), cy(p.y, win, h, inset), rSolid, paint);
        }
        return bitmap;
    }

    static float cx(float x, Window win, int w, float inset) {
        return inset + (x - win.x0) / win.size * (w - 2 * inset);
    }

    static float cy(float y, Window win, int h, float inset) {
        return inset + (y - win.y0) / win.size * (h - 2 * inset);
    }
}
