package tw.railisland.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * 「車站收集」小工具的資料模型（collection.json v1）＋由 payload 得到「這張卡要顯示的數字」。
 *
 * 🔴 架構：網頁算、原生只畫。數字只有一個來源——網頁 stationCollection(loadRides())，也就是護照
 *    「車站 N 座」用的那個函式；這裡【只讀不算】：n／total／各系統 v／n／recent／點位一律照抄。
 *    唯一自己算的是兩個純顯示量：百分比字串（含「<1%」「99%」邊界）與進度條填滿比例。
 *    驗收腳本（app/scripts/verify_android_collect_widget.mjs）從 payload 用另一份實作獨立重算比對。
 * 契約（資料格式 v1）：docs/collect-widget-contract.md。
 * 與 iOS CollectionCard.swift（CollectionStore／CollectionScope）同一套規則，改任何一邊都要同步。
 */
final class CollectionData {
    static final String FILE_NAME = "collection.json";
    /** 設定裡「全台」的存值（與 iOS CollectionScope.allKey 相同）。其餘存值是 sys[].k。 */
    static final String ALL = "all";
    /** 單一系統範圍最多取幾筆最近蓋章（契約〈畫法約定〉9；放得下幾筆由算圖端量）。 */
    static final int RECENT_MAX = 4;

    static final class Sys {
        String k = "";
        String label = "";
        int v;
        int n;
    }

    static final class Recent {
        String name = "";
        String line = "";
        /** 歸屬系統；缺或不是字串＝沒有歸屬（null）。 */
        String k;
        /** 選用：這座站所屬的全部系統（轉乘站才有，例：紅樹林＝北捷＋淡海）；缺或不是字串陣列＝null（舊版網頁不送）。 */
        List<String> ks;
        String d = "";

        /** 單一系統範圍要不要列這一筆：k 相符，或 ks 含該系統（契約〈recent 的細節〉；兩個條件取聯集）。 */
        boolean inSystem(String sysKey) {
            return sysKey.equals(k) || (ks != null && ks.contains(sysKey));
        }
    }

    /** pts 的每個元素是 [x, y, "#色碼", s, sysIdx]；x、y 為 0..1000；s：0 未收集、1 跟完、2 搭過或到訪。 */
    static final class Pt {
        float x;
        float y;
        String color = "";
        int s;
        int sys = -1;
    }

    int v;
    double aspect;
    int n;
    int total;
    final List<Sys> sys = new ArrayList<>();
    final List<Recent> recent = new ArrayList<>();
    final List<Pt> pts = new ArrayList<>();

    /**
     * 只收 v == 1；版本不認得、寬高比不合理都當「沒有資料」，走「打開軌島一次」那個畫面，
     * 不畫一張長得像有資料、其實是壞的卡（與 iOS CollectionStore.decode 同一條件）。
     *
     * 容錯（契約〈畫法約定〉10，與 iOS 同一套）：
     *  · 結構欄位（v、aspect、n、total、sys、recent、pts）缺或型別不對、sys 任一筆壞了＝整包作廢（回 null）；
     *  · recent、pts 的元素壞了只略過那一個；color 壞了用品牌色照畫（解色碼在算圖端）；k、ks、sysIdx 壞了當沒有。
     * 🔴 org.json 的 getString／optString 會把 JSON null 讀成字面 "null"、getInt 會把字串 "5" 與 5.7 當成 5，
     *    所以這裡一律用 opt 取原值再自己判斷型別，不用 getXxx 的轉型。
     */
    static CollectionData decode(String json) {
        if (json == null || json.isEmpty()) return null;
        if (!CollectionStore.nestingWithinLimit(json)) return null;
        try {
            JSONObject root = new JSONObject(json);
            Integer version = intOf(root.opt("v"));
            Double ratio = numberOf(root.opt("aspect"));
            Integer collected = intOf(root.opt("n"));
            Integer total = intOf(root.opt("total"));
            JSONArray sysArr = arrayOf(root.opt("sys"));
            JSONArray recArr = arrayOf(root.opt("recent"));
            JSONArray ptsArr = arrayOf(root.opt("pts"));
            if (version == null || ratio == null || collected == null || total == null || sysArr == null || recArr == null || ptsArr == null) return null;
            if (version != 1 || !(ratio > 0.1) || !(ratio < 10) || total < 0 || collected < 0) return null;
            CollectionData d = new CollectionData();
            d.v = version;
            d.aspect = ratio;
            d.n = collected;
            d.total = total;
            for (int i = 0; i < sysArr.length(); i++) {
                // pts[].sysIdx 指向這個陣列的索引，略過一筆會讓後面的索引全部錯位，所以壞了就整包作廢
                JSONObject o = sysArr.optJSONObject(i);
                if (o == null) return null;
                String k = stringOf(o.opt("k"));
                String label = stringOf(o.opt("label"));
                Integer sv = intOf(o.opt("v"));
                Integer sn = intOf(o.opt("n"));
                if (k == null || label == null || sv == null || sn == null) return null;
                Sys s = new Sys();
                s.k = k;
                s.label = label;
                s.v = sv;
                s.n = sn;
                d.sys.add(s);
            }
            for (int i = 0; i < recArr.length(); i++) {
                JSONObject o = recArr.optJSONObject(i);
                if (o == null) continue;
                String name = stringOf(o.opt("name"));
                String line = stringOf(o.opt("line"));
                String day = stringOf(o.opt("d"));
                if (name == null || line == null || day == null) continue;
                Recent r = new Recent();
                r.name = name;
                r.line = line;
                r.k = stringOf(o.opt("k"));
                r.ks = stringListOf(o.opt("ks"));
                r.d = day;
                d.recent.add(r);
            }
            for (int i = 0; i < ptsArr.length(); i++) {
                JSONArray a = ptsArr.optJSONArray(i);
                if (a == null || a.length() < 4) continue;
                Double x = numberOf(a.opt(0));
                Double y = numberOf(a.opt(1));
                Double state = numberOf(a.opt(3));
                if (x == null || y == null || state == null || !(state == 0 || state == 1 || state == 2)) continue;
                Pt p = new Pt();
                p.x = (float) (double) x;
                p.y = (float) (double) y;
                String color = stringOf(a.opt(2));
                p.color = color == null ? "" : color;   // 空字串解不出色碼，算圖端用品牌色
                p.s = (int) (double) state;
                Integer idx = a.length() > 4 ? intOf(a.opt(4)) : null;
                p.sys = idx != null && idx >= 0 && idx < d.sys.size() ? idx : -1;
                d.pts.add(p);
            }
            return d;
        } catch (Exception | StackOverflowError error) {
            // org.json 遞迴解析，深巢狀會 StackOverflowError（Error，不是 Exception）：上面的深度檢查是第一道，這是保險
            return null;
        }
    }

    private static String stringOf(Object o) {
        return o instanceof String ? (String) o : null;
    }

    private static JSONArray arrayOf(Object o) {
        return o instanceof JSONArray ? (JSONArray) o : null;
    }

    /** 字串陣列；不是陣列、或裡面有任何一個不是字串，整個當沒有（null）。 */
    private static List<String> stringListOf(Object o) {
        JSONArray a = arrayOf(o);
        if (a == null) return null;
        List<String> out = new ArrayList<>(a.length());
        for (int i = 0; i < a.length(); i++) {
            String s = stringOf(a.opt(i));
            if (s == null) return null;
            out.add(s);
        }
        return out;
    }

    /** 有限的數字；不是數字（JSON null、字串、布林、陣列）回 null。 */
    private static Double numberOf(Object o) {
        if (!(o instanceof Number)) return null;
        double x = ((Number) o).doubleValue();
        return Double.isNaN(x) || Double.isInfinite(x) ? null : x;
    }

    /** int 範圍內的整數值（3 與 3.0 都算；3.5、字串、JSON null 不算）。 */
    private static Integer intOf(Object o) {
        Double x = numberOf(o);
        if (x == null || x != Math.rint(x) || Math.abs(x) > Integer.MAX_VALUE) return null;
        return (int) (double) x;
    }

    /** App 私有儲存 files/collection.json；沒有檔案（App 還沒開過）或壞檔一律回 null。 */
    static CollectionData load(Context context) {
        String json = CollectionStore.read(context);
        return json == null ? null : decode(json);
    }

    static File file(Context context) {
        return new File(context.getFilesDir(), FILE_NAME);
    }

    // ── 顯示量 ────────────────────────────────────────────────────────────────

    /** 整數百分比，半數進位（與網頁 Math.round 一致）。整數運算，不經浮點。 */
    static int percent(int v, int total) {
        if (total <= 0 || v <= 0) return 0;
        return Math.min(100, (int) (((long) v * 200 + total) / (2L * total)));
    }

    /**
     * 百分比字串（第二輪規格第 5 點）：n>0 且四捨五入為 0 → 「<1%」；n<total 且四捨五入為 100 → 「99%」；
     * 其餘四捨五入。1/539 顯示「0%」等於說沒收集，538/539 顯示「100%」等於說收滿了——兩個都是謊。
     */
    static String percentLabel(int collected, int total) {
        int p = percent(collected, total);
        if (collected > 0 && p == 0) return "<1%";
        if (collected < total && p >= 100) return "99%";
        return p + "%";
    }

    /** 進度條填滿比例：v/n，但「有收集」時至少畫 3%，不然 1/241 是看不見的一條線。 */
    static double fill(int v, int n) {
        if (n <= 0 || v <= 0) return 0;
        return Math.min(1.0, Math.max((double) v / n, 0.03));
    }

    /** "2026-09-27" → "9/27"；格式不對就原樣顯示（不猜、不丟）。 */
    static String shortDate(String iso) {
        String[] p = iso == null ? new String[0] : iso.split("-");
        if (p.length != 3) return iso == null ? "" : iso;
        try {
            return Integer.parseInt(p[1]) + "/" + Integer.parseInt(p[2]);
        } catch (NumberFormatException error) {
            return iso;
        }
    }

    /** 這張卡要顯示的全部數字。scopeKey＝null 表示全台。 */
    static final class Figures {
        /** null＝全台 */
        String scopeKey;
        /** 全台，或該系統在 payload 裡的名稱（已是網頁當下的語言）。 */
        String title = "";
        int collected;
        int total;
        String percentLabel = "";
        double aspect;
        /** 單一系統時只含該系統的點；全台含全部。 */
        final List<Pt> dots = new ArrayList<>();
        /** 單一系統時，視窗內要畫成灰底的「其他系統」的點（全台為空）。 */
        final List<Pt> others = new ArrayList<>();
        List<Sys> systems = new ArrayList<>();
        /**
         * 最近蓋章：單一系統＝「k 相符或 ks 含該系統」的前 RECENT_MAX 筆，payload 已排好序、不重排；
         * 全台＝空（全台範圍的版面不畫最近蓋章，契約〈畫法約定〉9，原生不必另取）。
         */
        final List<Recent> recent = new ArrayList<>();
        /** 中卡的進度條：有收集的系統，依總站數大到小，最多 5 個。 */
        final List<Sys> topSystems = new ArrayList<>();
        /** 一站都還沒收集的系統數。 */
        int untouchedSystems;

        boolean isAll() { return scopeKey == null; }
        boolean isEmpty() { return collected == 0; }
        int remaining() { return Math.max(0, total - collected); }
    }

    Figures figures(String scope, String allTitle) {
        int index = -1;
        if (scope != null && !ALL.equals(scope)) {
            for (int i = 0; i < sys.size(); i++) if (sys.get(i).k.equals(scope)) { index = i; break; }
        }
        Figures f = new Figures();
        f.aspect = aspect;
        f.systems = sys;
        // 有收集的系統，依總站數大到小（同數量維持 payload 順序），最多 5 個
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < sys.size(); i++) if (sys.get(i).v > 0) order.add(i);
        order.sort((a, b) -> sys.get(a).n != sys.get(b).n ? Integer.compare(sys.get(b).n, sys.get(a).n) : Integer.compare(a, b));
        for (int i = 0; i < Math.min(5, order.size()); i++) f.topSystems.add(sys.get(order.get(i)));
        for (Sys s : sys) if (s.v == 0) f.untouchedSystems++;

        if (index >= 0) {
            Sys s = sys.get(index);
            f.scopeKey = s.k;
            f.title = s.label;
            f.collected = s.v;
            f.total = s.n;
            for (Pt p : pts) {
                if (p.sys == index) f.dots.add(p); else f.others.add(p);
            }
            for (Recent r : recent) {
                if (f.recent.size() >= RECENT_MAX) break;
                if (r.inSystem(s.k)) f.recent.add(r);
            }
        } else {
            f.scopeKey = null;
            f.title = allTitle;
            f.collected = n;
            f.total = total;
            f.dots.addAll(pts);
        }
        f.percentLabel = percentLabel(f.collected, f.total);
        return f;
    }
}
