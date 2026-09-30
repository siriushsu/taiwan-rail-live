package tw.railisland.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * collection.json 解碼與過濾的單元測試（契約 docs/collect-widget-contract.md〈畫法約定〉9、10）。
 * 跑在裝置上，因為要測的是 Android 自己的 org.json 行為（例如它會把 JSON null 讀成字串 "null"、
 * 會把字串 "5" 與 5.7 當成整數 5）。
 *
 * 期望值全是手寫的：每個案例的 payload 與期望都寫在案例裡，不從算圖或 Provider 取值（同源時「相等」是零資訊）。
 */
@RunWith(AndroidJUnit4.class)
public final class CollectionDataInstrumentedTest {

    // ── 手寫 payload 的積木 ─────────────────────────────────────────────────────

    private static final String SYS_TWO =
        "[{\"k\":\"trtc\",\"label\":\"北捷\",\"v\":2,\"n\":3},{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":1,\"n\":2}]";
    private static final String PTS_TWO = "[[100,200,\"#E4572E\",2,0],[300,400,\"#2E6FB0\",1,1]]";

    /**
     * 一份合格的最小 payload；案例以「欄位名, 原樣的 JSON 值」成對覆寫要測的欄位，值為 null＝整欄不寫（缺欄）。
     * 覆寫一個不在預設裡的鍵＝多一個額外的鍵。
     */
    private static String doc(String... overrides) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("v", "1");
        m.put("aspect", "0.5516");
        m.put("n", "3");
        m.put("total", "5");
        m.put("sys", SYS_TWO);
        m.put("recent", "[]");
        m.put("pts", PTS_TWO);
        for (int i = 0; i < overrides.length; i += 2) {
            if (overrides[i + 1] == null) m.remove(overrides[i]); else m.put(overrides[i], overrides[i + 1]);
        }
        StringBuilder b = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> e : m.entrySet()) {
            if (!first) b.append(',');
            first = false;
            b.append('"').append(e.getKey()).append("\":").append(e.getValue());
        }
        return b.append('}').toString();
    }

    /** 一筆最近蓋章（name、line、k 用字串，d 是日期字串）。 */
    private static String rec(String name, String line, String k, String d) {
        return "{\"name\":\"" + name + "\",\"line\":\"" + line + "\",\"k\":\"" + k + "\",\"d\":\"" + d + "\"}";
    }

    // ── 正常 payload 照抄 ───────────────────────────────────────────────────────

    @Test
    public void validDocDecodesAsWritten() {
        CollectionData d = CollectionData.decode(doc("recent", "[" + rec("淡水", "淡水信義線", "trtc", "2026-09-02") + "]"));
        assertNotNull(d);
        assertEquals(1, d.v);
        assertEquals(0.5516, d.aspect, 1e-9);
        assertEquals(3, d.n);
        assertEquals(5, d.total);
        assertEquals(2, d.sys.size());
        assertEquals("trtc", d.sys.get(0).k);
        assertEquals("北捷", d.sys.get(0).label);
        assertEquals(2, d.sys.get(0).v);
        assertEquals(3, d.sys.get(0).n);
        assertEquals("ntdlrt", d.sys.get(1).k);
        assertEquals("淡海", d.sys.get(1).label);
        assertEquals(1, d.sys.get(1).v);
        assertEquals(2, d.sys.get(1).n);
        assertEquals(1, d.recent.size());
        assertEquals("淡水", d.recent.get(0).name);
        assertEquals("淡水信義線", d.recent.get(0).line);
        assertEquals("trtc", d.recent.get(0).k);
        assertEquals("2026-09-02", d.recent.get(0).d);
        assertEquals(2, d.pts.size());
        assertEquals(100f, d.pts.get(0).x, 0f);
        assertEquals(200f, d.pts.get(0).y, 0f);
        assertEquals("#E4572E", d.pts.get(0).color);
        assertEquals(2, d.pts.get(0).s);
        assertEquals(0, d.pts.get(0).sys);
        assertEquals(300f, d.pts.get(1).x, 0f);
        assertEquals(1, d.pts.get(1).s);
        assertEquals(1, d.pts.get(1).sys);
    }

    @Test
    public void extraKeysAndIntegralDoublesAreFine() {
        // 真 payload 另有 at、lang、box；數字寫成 3.0、1e0 也是整數
        CollectionData d = CollectionData.decode(doc(
            "at", "1790690000000", "lang", "\"zh-TW\"", "box", "[120.15,22.2,122.0,25.27]", "n", "3.0", "v", "1e0"));
        assertNotNull(d);
        assertEquals(3, d.n);
        assertEquals(1, d.v);
    }

    // ── 結構欄位壞了＝整包作廢（畫法約定 10） ──────────────────────────────────────

    @Test
    public void badStructureRejectsWholePackage() {
        String sysBadK = "[{\"k\":null,\"label\":\"北捷\",\"v\":2,\"n\":3},{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":1,\"n\":2}]";
        Object[][] table = {
            { "缺 v", doc("v", null) },
            { "v=2", doc("v", "2") },
            { "v 是字串", doc("v", "\"1\"") },
            { "v=null", doc("v", "null") },
            { "v=true", doc("v", "true") },
            { "v=1.5", doc("v", "1.5") },
            { "缺 aspect", doc("aspect", null) },
            { "aspect=null", doc("aspect", "null") },
            { "aspect 是字串", doc("aspect", "\"0.5\"") },
            { "aspect 太小", doc("aspect", "0.05") },
            { "aspect 太大", doc("aspect", "20") },
            { "缺 n", doc("n", null) },
            { "n=null", doc("n", "null") },
            { "n 是字串", doc("n", "\"3\"") },
            { "n=true", doc("n", "true") },
            { "n=3.5（不是整數）", doc("n", "3.5") },
            { "n=-1", doc("n", "-1") },
            { "n 超出 int", doc("n", "99999999999") },
            { "缺 total", doc("total", null) },
            { "total=null", doc("total", "null") },
            { "total 是字串", doc("total", "\"5\"") },
            { "total=-1", doc("total", "-1") },
            { "缺 sys", doc("sys", null) },
            { "sys=null", doc("sys", "null") },
            { "sys 是物件", doc("sys", "{}") },
            { "sys 是字串", doc("sys", "\"x\"") },
            { "缺 recent", doc("recent", null) },
            { "recent=null", doc("recent", "null") },
            { "recent 是物件", doc("recent", "{}") },
            { "缺 pts", doc("pts", null) },
            { "pts=null", doc("pts", "null") },
            { "pts 是字串", doc("pts", "\"x\"") },
            { "sys[0] 不是物件", doc("sys", "[5,{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":1,\"n\":2}]") },
            { "sys[0] 是 null", doc("sys", "[null,{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":1,\"n\":2}]") },
            { "sys[0].k=null", doc("sys", sysBadK) },
            { "sys[0].k 是數字", doc("sys", sysBadK.replace("\"k\":null", "\"k\":5")) },
            { "sys[0].k 缺", doc("sys", sysBadK.replace("\"k\":null,", "")) },
            { "sys[0].label=null", doc("sys", sysBadK.replace("\"k\":null", "\"k\":\"trtc\"").replace("\"label\":\"北捷\"", "\"label\":null")) },
            { "sys[1].v=null", doc("sys", "[{\"k\":\"trtc\",\"label\":\"北捷\",\"v\":2,\"n\":3},{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":null,\"n\":2}]") },
            { "sys[1].v 是字串", doc("sys", "[{\"k\":\"trtc\",\"label\":\"北捷\",\"v\":2,\"n\":3},{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":\"1\",\"n\":2}]") },
            { "sys[1].v=1.5", doc("sys", "[{\"k\":\"trtc\",\"label\":\"北捷\",\"v\":2,\"n\":3},{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":1.5,\"n\":2}]") },
            { "sys[1].n 缺", doc("sys", "[{\"k\":\"trtc\",\"label\":\"北捷\",\"v\":2,\"n\":3},{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":1}]") },
            { "頂層不是物件", "[1,2]" },
            { "空字串", "" },
            { "壞 JSON", "{\"v\":1," },
        };
        for (Object[] row : table) {
            assertNull("整包應作廢：" + row[0], CollectionData.decode((String) row[1]));
        }
        assertNull("null 輸入", CollectionData.decode(null));
    }

    // ── recent 元素壞了只略過那一筆（畫法約定 10） ───────────────────────────────────

    @Test
    public void badRecentElementsAreSkippedOneByOne() {
        String good = rec("淡水", "淡水信義線", "trtc", "2026-09-02");
        String recent = "[" +
            "{\"name\":null,\"line\":\"淡水信義線\",\"k\":\"trtc\",\"d\":\"2026-09-01\"}," +    // name 是 JSON null
            "{\"name\":7,\"line\":\"L\",\"k\":\"trtc\",\"d\":\"2026-09-01\"}," +                // name 是數字
            "{\"line\":\"L\",\"k\":\"trtc\",\"d\":\"2026-09-01\"}," +                           // 缺 name
            "{\"name\":\"A\",\"line\":null,\"k\":\"trtc\",\"d\":\"2026-09-01\"}," +             // line 是 JSON null
            "{\"name\":\"B\",\"line\":\"L\",\"k\":\"trtc\"}," +                                 // 缺 d
            "{\"name\":\"C\",\"line\":\"L\",\"k\":\"trtc\",\"d\":null}," +                      // d 是 JSON null
            "{\"name\":\"D\",\"line\":\"L\",\"k\":\"trtc\",\"d\":20260901}," +                  // d 是數字
            "5,null,\"x\",[],true," +                                                           // 不是物件
            good + "]";
        CollectionData d = CollectionData.decode(doc("recent", recent));
        assertNotNull("recent 的元素壞了不該拖垮整包", d);
        assertEquals("只剩唯一合格的那一筆", 1, d.recent.size());
        assertEquals("淡水", d.recent.get(0).name);
        assertEquals("淡水信義線", d.recent.get(0).line);
        assertEquals("2026-09-02", d.recent.get(0).d);
        for (CollectionData.Recent r : d.recent) {
            assertFalse("JSON null 不准變成字面 \"null\"", "null".equals(r.name) || "null".equals(r.line) || "null".equals(r.d));
        }
    }

    @Test
    public void badKeyMeansNoAttribution() {
        // k 缺、是數字、是 JSON null：那一筆留著，但沒有歸屬（任何單一系統範圍都不列它）
        String recent = "[" +
            "{\"name\":\"A\",\"line\":\"L\",\"k\":5,\"d\":\"2026-09-01\"}," +
            "{\"name\":\"B\",\"line\":\"L\",\"k\":null,\"d\":\"2026-09-01\"}," +
            "{\"name\":\"C\",\"line\":\"L\",\"d\":\"2026-09-01\"}," +
            "{\"name\":\"D\",\"line\":\"L\",\"k\":[\"trtc\"],\"d\":\"2026-09-01\"}," +
            rec("E", "L", "trtc", "2026-09-01") + "]";
        CollectionData d = CollectionData.decode(doc("recent", recent));
        assertNotNull(d);
        assertEquals("五筆都留著", 5, d.recent.size());
        for (int i = 0; i < 4; i++) {
            assertNull("第 " + i + " 筆沒有歸屬（且 JSON null 不是字面 \"null\"）", d.recent.get(i).k);
        }
        assertEquals("trtc", d.recent.get(4).k);
        CollectionData.Figures trtc = d.figures("trtc", "全台");
        assertEquals("北捷範圍只看得到有歸屬的那一筆", 1, trtc.recent.size());
        assertEquals("E", trtc.recent.get(0).name);
        assertEquals("淡海範圍一筆也沒有", 0, d.figures("ntdlrt", "全台").recent.size());
    }

    // ── pts 元素壞了只略過那一點（畫法約定 10） ────────────────────────────────────

    @Test
    public void badPointsAreSkippedOneByOne() {
        String pts = "[" +
            "[null,200,\"#E4572E\",2,0]," +           // x 是 JSON null
            "[100,null,\"#E4572E\",2,0]," +           // y 是 JSON null
            "[\"100\",200,\"#E4572E\",2,0]," +        // x 是字串
            "[100,true,\"#E4572E\",2,0]," +           // y 是布林
            "[100,200,\"#E4572E\",3,0]," +            // s=3
            "[100,200,\"#E4572E\",-1,0]," +           // s=-1
            "[100,200,\"#E4572E\",1.5,0]," +          // s=1.5
            "[100,200,\"#E4572E\",\"1\",0]," +        // s 是字串
            "[100,200,\"#E4572E\",null,0]," +         // s 是 JSON null
            "[100,200,\"#E4572E\"]," +                // 只有 3 個元素
            "[100,200]," + "[]," +                    // 更短
            "5,null,\"x\",{\"a\":1}," +               // 不是陣列
            "[300,400,\"#2E6FB0\",1,1]" +             // 唯一合格
            "]";
        CollectionData d = CollectionData.decode(doc("pts", pts));
        assertNotNull("pts 的元素壞了不該拖垮整包", d);
        assertEquals("只剩唯一合格的那一點", 1, d.pts.size());
        assertEquals(300f, d.pts.get(0).x, 0f);
        assertEquals(400f, d.pts.get(0).y, 0f);
        assertEquals(1, d.pts.get(0).s);
        assertEquals(1, d.pts.get(0).sys);
    }

    @Test
    public void pointStateAcceptsZeroOneTwoIncludingIntegralDoubles() {
        String pts = "[[1,2,\"#E4572E\",0,0],[3,4,\"#E4572E\",1,0],[5,6,\"#E4572E\",2,0],[7,8,\"#E4572E\",2.0,0],[9.5,10.25,\"#E4572E\",1.0,0]]";
        CollectionData d = CollectionData.decode(doc("pts", pts));
        assertNotNull(d);
        assertEquals(5, d.pts.size());
        assertEquals(0, d.pts.get(0).s);
        assertEquals(1, d.pts.get(1).s);
        assertEquals(2, d.pts.get(2).s);
        assertEquals(2, d.pts.get(3).s);
        assertEquals(1, d.pts.get(4).s);
        assertEquals(9.5f, d.pts.get(4).x, 0f);
        assertEquals(10.25f, d.pts.get(4).y, 0f);
    }

    @Test
    public void pointWithBadColorIsKeptAndDrawnInBrandColor() {
        String pts = "[[100,200,null,2,0],[110,210,5,2,0],[120,220,\"zzz\",2,0],[130,230,\"\",2,0],[140,240,\"#2E6FB0\",2,0]]";
        CollectionData d = CollectionData.decode(doc("pts", pts));
        assertNotNull(d);
        assertEquals("color 壞了的點照留", 5, d.pts.size());
        for (boolean night : new boolean[] { false, true }) {
            int brand = CollectionMapRender.lineColor(null, night);
            for (int i = 0; i < 4; i++) {
                assertEquals("第 " + i + " 點用品牌色（night=" + night + "）", brand, CollectionMapRender.lineColor(d.pts.get(i).color, night));
            }
        }
        assertFalse("JSON null 不准變成字面 \"null\"", "null".equals(d.pts.get(0).color));
        assertEquals("合格的色碼照原樣", "#2E6FB0", d.pts.get(4).color);
        assertEquals("合格的色碼真的解得出來", 0xFF2E6FB0, CollectionMapRender.lineColor(d.pts.get(4).color, false));
    }

    @Test
    public void systemIndexOutOfRangeMeansNoSystem() {
        // sys 有 2 個（索引 0、1）
        Object[][] table = {
            { "索引 0", "0", 0 },
            { "索引 1", "1", 1 },
            { "1.0（整數值的浮點寫法）", "1.0", 1 },
            { "索引 2（剛好越界）", "2", -1 },
            { "索引 7", "7", -1 },
            { "負索引", "-3", -1 },
            { "1.5（不是整數）", "1.5", -1 },
            { "字串 \"1\"", "\"1\"", -1 },
            { "JSON null", "null", -1 },
            { "布林", "true", -1 },
            { "陣列", "[1]", -1 },
        };
        for (Object[] row : table) {
            CollectionData d = CollectionData.decode(doc("pts", "[[100,200,\"#E4572E\",2," + row[1] + "]]"));
            assertNotNull("點照留：" + row[0], d);
            assertEquals("點照留：" + row[0], 1, d.pts.size());
            assertEquals("sysIdx：" + row[0], (int) (Integer) row[2], d.pts.get(0).sys);
        }
        CollectionData missing = CollectionData.decode(doc("pts", "[[100,200,\"#E4572E\",2]]"));
        assertNotNull(missing);
        assertEquals("只有 4 個元素（缺 sysIdx）的點照留", 1, missing.pts.size());
        assertEquals("缺 sysIdx＝不屬於任何系統", -1, missing.pts.get(0).sys);
    }

    // ── 計數照 payload，不因略過元素而重算 ─────────────────────────────────────────

    @Test
    public void countsFollowThePayloadNotTheSurvivingElements() {
        String sys = "[{\"k\":\"tra\",\"label\":\"台鐵\",\"v\":77,\"n\":241},{\"k\":\"trtc\",\"label\":\"北捷\",\"v\":85,\"n\":119}]";
        // 三點合格、四點壞；三筆最近蓋章合格、兩筆壞
        String pts = "[[1,2,\"#E4572E\",2,0],[3,4,\"#E4572E\",1,1],[5,6,\"#E4572E\",0,1]," +
            "[null,2,\"#E4572E\",2,0],[1,2,\"#E4572E\",9,0],[1,2],5]";
        String recent = "[" + rec("A", "L", "tra", "2026-09-03") + "," + rec("B", "L", "trtc", "2026-09-02") + "," + rec("C", "L", "tra", "2026-09-01") + "," +
            "{\"name\":null,\"line\":\"L\",\"k\":\"tra\",\"d\":\"2026-09-01\"},7]";
        CollectionData d = CollectionData.decode(doc("n", "201", "total", "538", "sys", sys, "pts", pts, "recent", recent));
        assertNotNull(d);
        assertEquals("只留合格的點", 3, d.pts.size());
        assertEquals("只留合格的最近蓋章", 3, d.recent.size());
        assertEquals(201, d.n);
        assertEquals(538, d.total);
        assertEquals(77, d.sys.get(0).v);
        assertEquals(241, d.sys.get(0).n);
        assertEquals(85, d.sys.get(1).v);
        assertEquals(119, d.sys.get(1).n);
        CollectionData.Figures all = d.figures("all", "全台");
        assertEquals(201, all.collected);
        assertEquals(538, all.total);
        assertEquals("201/538＝37.36%", "37%", all.percentLabel);
        CollectionData.Figures tra = d.figures("tra", "全台");
        assertEquals(77, tra.collected);
        assertEquals(241, tra.total);
        assertEquals("77/241＝31.95%", "32%", tra.percentLabel);
        assertEquals("台鐵範圍：自己的點 1 個、其他系統的點 2 個（只數合格的點）", 1, tra.dots.size());
        assertEquals(2, tra.others.size());
        assertEquals("北捷範圍：自己的點 2 個", 2, d.figures("trtc", "全台").dots.size());
    }

    // ── recent[].ks：轉乘站在每個所屬系統的單一系統範圍都看得到（契約〈recent 的細節〉） ──────────

    /** 最近蓋章一筆；k、ks 用原樣的 JSON 寫，null＝不寫這個鍵。 */
    private static String recRaw(String name, String kJson, String ksJson) {
        StringBuilder b = new StringBuilder("{\"name\":\"").append(name).append("\",\"line\":\"L\"");
        if (kJson != null) b.append(",\"k\":").append(kJson);
        if (ksJson != null) b.append(",\"ks\":").append(ksJson);
        return b.append(",\"d\":\"2026-09-01\"}").toString();
    }

    private static List<String> names(CollectionData.Figures f) {
        List<String> out = new ArrayList<>();
        for (CollectionData.Recent r : f.recent) out.add(r.name);
        return out;
    }

    @Test
    public void ksIsKeptOnlyWhenItIsAnArrayOfStrings() {
        String recent = "[" +
            recRaw("A", "\"trtc\"", "[\"trtc\",\"ntdlrt\"]") + "," +   // 合格
            recRaw("B", "\"trtc\"", "[]") + "," +                        // 空陣列也是字串陣列
            recRaw("C", "\"trtc\"", null) + "," +                        // 缺
            recRaw("D", "\"trtc\"", "\"trtc\"") + "," +                  // 字串，不是陣列
            recRaw("E", "\"trtc\"", "null") + "," +                      // JSON null
            recRaw("F", "\"trtc\"", "5") + "," +                         // 數字
            recRaw("G", "\"trtc\"", "{\"a\":1}") + "," +                 // 物件
            recRaw("H", "\"trtc\"", "[\"trtc\",5]") + "," +              // 有一個不是字串：整個當沒有
            recRaw("I", "\"trtc\"", "[\"trtc\",null]") + "," +
            recRaw("J", "\"trtc\"", "[[\"trtc\"]]") + "]";
        CollectionData d = CollectionData.decode(doc("recent", recent));
        assertNotNull(d);
        assertEquals("ks 壞了只是當沒有 ks，那一筆照留", 10, d.recent.size());
        assertEquals(Arrays.asList("trtc", "ntdlrt"), d.recent.get(0).ks);
        assertEquals(Collections.emptyList(), d.recent.get(1).ks);
        for (int i = 2; i < 10; i++) assertNull("第 " + i + " 筆的 ks 當沒有", d.recent.get(i).ks);
    }

    @Test
    public void singleSystemRecentIsKOrKsFirstFourInPayloadOrder() {
        String sys = "[{\"k\":\"trtc\",\"label\":\"北捷\",\"v\":4,\"n\":119},{\"k\":\"ntdlrt\",\"label\":\"淡海\",\"v\":2,\"n\":14}," +
            "{\"k\":\"tra\",\"label\":\"台鐵\",\"v\":1,\"n\":241}]";
        String recent = "[" +
            recRaw("紅樹林", "\"trtc\"", "[\"trtc\",\"ntdlrt\"]") + "," +   // 轉乘站：北捷＋淡海
            recRaw("淡水", "\"trtc\"", null) + "," +
            recRaw("漁人碼頭", "\"ntdlrt\"", null) + "," +
            recRaw("菁桐", "\"tra\"", null) + "," +
            recRaw("象山", "\"trtc\"", null) + "," +
            recRaw("南港展覽館", "\"trtc\"", null) + "," +
            recRaw("動物園", "\"trtc\"", null) + "," +
            recRaw("只靠ks", null, "[\"ntdlrt\"]") + "," +                // 沒有 k，只靠 ks 歸屬
            recRaw("k不在ks內", "\"trtc\"", "[\"ntdlrt\"]") + "," +       // k 與 ks 取聯集
            recRaw("淡海第五筆", "\"ntdlrt\"", null) + "]";
        CollectionData d = CollectionData.decode(doc("sys", sys, "recent", recent));
        assertNotNull(d);
        assertEquals("北捷：k 相符或 ks 含北捷的前 4 筆，照 payload 順序（動物園、k不在ks內 被 4 筆上限擋掉）",
            Arrays.asList("紅樹林", "淡水", "象山", "南港展覽館"), names(d.figures("trtc", "全台")));
        assertEquals("淡海：紅樹林靠 ks、漁人碼頭靠 k、只靠ks、k不在ks內 靠 ks；第 5 筆被上限擋掉",
            Arrays.asList("紅樹林", "漁人碼頭", "只靠ks", "k不在ks內"), names(d.figures("ntdlrt", "全台")));
        assertEquals("台鐵：只有菁桐", Arrays.asList("菁桐"), names(d.figures("tra", "全台")));
    }

    // ── 全台範圍不取最近蓋章（契約〈畫法約定〉9） ─────────────────────────────────────

    @Test
    public void allScopeTakesNoRecentWhileSingleScopesStillDo() {
        String recent = "[" + rec("淡水", "淡水信義線", "trtc", "2026-09-05") + "," + rec("象山", "淡水信義線", "trtc", "2026-09-04") + "," +
            rec("漁人碼頭", "藍海線", "ntdlrt", "2026-09-03") + "," + rec("紅樹林", "淡水信義線", "trtc", "2026-09-02") + "," +
            rec("北投", "淡水信義線", "trtc", "2026-09-01") + "," + rec("新北投", "新北投支線", "trtc", "2026-08-31") + "]";
        CollectionData d = CollectionData.decode(doc("recent", recent));
        assertNotNull(d);
        assertEquals("測試前提：payload 有 6 筆最近蓋章（下面的「空」才不是空對空）", 6, d.recent.size());
        assertEquals("全台", 0, d.figures("all", "全台").recent.size());
        assertEquals("範圍存值是 null 也當全台", 0, d.figures(null, "全台").recent.size());
        assertEquals("認不得的範圍退回全台", 0, d.figures("沒有這個系統", "全台").recent.size());
        assertEquals("對照：北捷單一系統取前 4 筆", 4, d.figures("trtc", "全台").recent.size());
        assertEquals("對照：淡海單一系統 1 筆", 1, d.figures("ntdlrt", "全台").recent.size());
        assertTrue("全台的其他數字照舊", d.figures("all", "全台").isAll() && d.figures("all", "全台").collected == d.n);
    }

    // ── 深巢狀：壞資料不准讓 App 閃退（與上面的容錯同一個精神；解析發生在兩條路：存檔時 validate、小工具端 decode）──

    /** decode／validate 丟出 StackOverflowError＝真機上整個 App 閃退；這裡轉成一行訊息的失敗，不讓上千行的堆疊灌爆測試輸出。 */
    private static CollectionData decodeNoCrash(String json) {
        try {
            return CollectionData.decode(json);
        } catch (StackOverflowError error) {
            throw new AssertionError("CollectionData.decode 丟出 StackOverflowError（真機上會閃退）");
        }
    }

    private static String validateNoCrash(String json) {
        try {
            return CollectionStore.validate(json);
        } catch (StackOverflowError error) {
            throw new AssertionError("CollectionStore.validate 丟出 StackOverflowError（真機上會閃退）");
        }
    }

    private static CollectionData loadNoCrash(Context context) {
        try {
            return CollectionData.load(context);
        } catch (StackOverflowError error) {
            throw new AssertionError("CollectionData.load 丟出 StackOverflowError（真機上會閃退）");
        }
    }

    private static String repeat(String s, int n) {
        StringBuilder b = new StringBuilder(s.length() * n);
        for (int i = 0; i < n; i++) b.append(s);
        return b.toString();
    }

    /** 巢狀 depth 層的陣列 [[[…]]]。 */
    private static String nestedArrays(int depth) {
        return repeat("[", depth) + repeat("]", depth);
    }

    /** 巢狀 depth 層的物件 {"a":{"a":…}}（最內層是空物件）。 */
    private static String nestedObjects(int depth) {
        return repeat("{\"a\":", depth - 1) + "{}" + repeat("}", depth - 1);
    }

    @After
    public void removeStoredFile() {
        CollectionData.file(InstrumentationRegistry.getInstrumentation().getTargetContext()).delete();
    }

    @Test
    public void nestingLimitIsExactlyMaxDepth() {
        // 整份 payload 的深度＝最外層物件 1 層＋extra 裡的巢狀層數（正常 payload 最深 3 層）
        for (boolean objects : new boolean[] { false, true }) {
            String atLimit = doc("extra", objects ? nestedObjects(CollectionStore.MAX_DEPTH - 1) : nestedArrays(CollectionStore.MAX_DEPTH - 1));
            String overLimit = doc("extra", objects ? nestedObjects(CollectionStore.MAX_DEPTH) : nestedArrays(CollectionStore.MAX_DEPTH));
            String kind = objects ? "物件" : "陣列";
            assertNull("剛好 MAX_DEPTH 層要收（存檔）：" + kind, validateNoCrash(atLimit));
            assertNotNull("剛好 MAX_DEPTH 層要收（小工具端）：" + kind, decodeNoCrash(atLimit));
            String problem = validateNoCrash(overLimit);
            assertNotNull("MAX_DEPTH+1 層要拒（存檔）：" + kind, problem);
            assertTrue("拒絕訊息沿用「不是 JSON 物件」：" + problem, problem.contains("not a JSON object"));
            assertNull("MAX_DEPTH+1 層要拒（小工具端）：" + kind, decodeNoCrash(overLimit));
        }
        assertNull("正常 payload 不受影響（存檔）", validateNoCrash(doc()));
        assertNotNull("正常 payload 不受影響（小工具端）", decodeNoCrash(doc()));
    }

    @Test
    public void hugelyNestedPayloadIsRejectedOnBothPathsWithoutCrashing() {
        // 10 萬層陣列＝20 萬字元；8 萬層物件＝約 48 萬位元組（壓在 512 KB 上限之下，才會走到深度檢查而不是被大小擋掉）
        String arrays = doc("extra", nestedArrays(100_000));
        String objects = doc("extra", nestedObjects(80_000));
        assertTrue("測試前提：兩份都在 512 KB 之內", objects.getBytes(java.nio.charset.StandardCharsets.UTF_8).length < CollectionStore.MAX_BYTES);
        for (String json : new String[] { arrays, objects }) {
            String problem = validateNoCrash(json);
            assertNotNull("存檔要拒絕", problem);
            assertTrue("是被深度擋下、不是被大小擋下：" + problem, problem.contains("not a JSON object"));
            assertNull("小工具端要回「沒有資料」", decodeNoCrash(json));
        }
    }

    @Test
    public void hostileFileOnDiskLoadsAsNoData() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertTrue(CollectionStore.write(context, doc("extra", nestedArrays(100_000))));
        assertNull("小工具讀到一個極深的檔案也只是沒有資料", loadNoCrash(context));
        assertTrue(CollectionStore.write(context, doc()));
        assertNotNull("換回正常的檔案就恢復", loadNoCrash(context));
    }

    @Test
    public void bracketsInsideStringsDoNotCountAsNesting() {
        // 站名裡有 200 個 [、一個被跳脫的引號、200 個 {、一個被跳脫的反斜線：都是字串內容，不是巢狀
        String content = repeat("[", 200) + "\\\"" + repeat("{", 200) + "\\\\";       // JSON 文字（含跳脫）
        String expected = repeat("[", 200) + "\"" + repeat("{", 200) + "\\";          // 解碼後的字元
        String recent = "[{\"name\":\"" + content + "\",\"line\":\"L\",\"k\":\"trtc\",\"d\":\"2026-09-01\"}]";
        String json = doc("recent", recent);
        assertNull("字串裡的括號不算巢狀（存檔）", validateNoCrash(json));
        CollectionData d = decodeNoCrash(json);
        assertNotNull("字串裡的括號不算巢狀（小工具端）", d);
        assertEquals(1, d.recent.size());
        assertEquals(expected, d.recent.get(0).name);
    }

    @Test
    public void escapedBackslashBeforeClosingQuoteEndsTheString() {
        // "x":"\\" 的引號是結尾（反斜線被跳脫了）：後面真正的 75 層巢狀要被數到而拒收
        String json = doc("x", "\"\\\\\"", "extra", nestedArrays(CollectionStore.MAX_DEPTH + 11));
        assertNotNull("存檔要拒", validateNoCrash(json));
        assertNull("小工具端要拒", decodeNoCrash(json));
    }

    @Test
    public void lenientQuotingCannotCrashTheWidgetEither() {
        // org.json 放行單引號字串：'"' 讓深度掃描的字串狀態錯位、把後面的 10 萬層當成字串內容而放行；
        // 這時靠外層接住 StackOverflowError 保住不閃退（存檔那條用嚴格的 JsonReader，單引號一律拒收）
        String crafted = doc("x", "'\"'", "y", nestedArrays(100_000), "z", "'\"'");
        assertNull("小工具端回沒有資料、不閃退", decodeNoCrash(crafted));
        assertNotNull("存檔端拒收單引號", validateNoCrash(crafted));
    }
}
