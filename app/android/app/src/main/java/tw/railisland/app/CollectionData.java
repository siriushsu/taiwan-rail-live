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

    static final class Sys {
        String k = "";
        String label = "";
        int v;
        int n;
    }

    static final class Recent {
        String name = "";
        String line = "";
        String k = "";
        String d = "";
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
     */
    static CollectionData decode(String json) {
        if (json == null || json.isEmpty()) return null;
        try {
            JSONObject root = new JSONObject(json);
            CollectionData d = new CollectionData();
            d.v = root.getInt("v");
            d.aspect = root.getDouble("aspect");
            d.n = root.getInt("n");
            d.total = root.getInt("total");
            if (d.v != 1 || !(d.aspect > 0.1) || !(d.aspect < 10) || d.total < 0 || d.n < 0) return null;
            JSONArray sysArr = root.getJSONArray("sys");
            for (int i = 0; i < sysArr.length(); i++) {
                JSONObject o = sysArr.getJSONObject(i);
                Sys s = new Sys();
                s.k = o.getString("k");
                s.label = o.getString("label");
                s.v = o.getInt("v");
                s.n = o.getInt("n");
                d.sys.add(s);
            }
            JSONArray recArr = root.getJSONArray("recent");
            for (int i = 0; i < recArr.length(); i++) {
                JSONObject o = recArr.getJSONObject(i);
                Recent r = new Recent();
                r.name = o.getString("name");
                r.line = o.getString("line");
                r.k = o.optString("k", "");
                r.d = o.getString("d");
                d.recent.add(r);
            }
            JSONArray ptsArr = root.getJSONArray("pts");
            for (int i = 0; i < ptsArr.length(); i++) {
                JSONArray a = ptsArr.getJSONArray(i);
                Pt p = new Pt();
                p.x = (float) a.getDouble(0);
                p.y = (float) a.getDouble(1);
                p.color = a.getString(2);
                p.s = a.getInt(3);
                p.sys = a.length() > 4 ? a.getInt(4) : -1;
                d.pts.add(p);
            }
            return d;
        } catch (Exception error) {
            return null;
        }
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
     * 其餘四捨五入。1/538 顯示「0%」等於說沒收集，537/538 顯示「100%」等於說收滿了——兩個都是謊。
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
        /** 最近蓋章：全台＝payload 全部（最多 4 筆）；單一系統＝只留 k 相符的。 */
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
            for (Recent r : recent) if (s.k.equals(r.k)) f.recent.add(r);
        } else {
            f.scopeKey = null;
            f.title = allTitle;
            f.collected = n;
            f.total = total;
            f.dots.addAll(pts);
            f.recent.addAll(recent);
        }
        f.percentLabel = percentLabel(f.collected, f.total);
        return f;
    }
}
