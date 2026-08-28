package tw.railisland.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@RunWith(AndroidJUnit4.class)
public final class MetroWidgetEta2InstrumentedTest {

    @Test
    public void fixtureParsesEta2AndCachePreservesApproxIdentity() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject root = new JSONObject(readFixture());
        JSONArray board = root.getJSONArray("board");
        JSONObject raw = null;
        for (int i = 0; i < board.length(); i++) {
            JSONObject candidate = board.getJSONObject(i);
            if (candidate.has("eta2") && candidate.optDouble("eta2") > candidate.optDouble("eta")) {
                raw = candidate;
                break;
            }
        }
        assertNotNull("fixture 必須至少有一列有效 eta2", raw);

        MetroWidgetData.Catalog catalog = MetroWidgetData.catalog(app);
        MetroWidgetData.SystemInfo system = catalog.byId.get("trtc");
        assertNotNull(system);
        String station = catalog.alias.getJSONObject("trtc").optString(raw.getString("name"));
        double now = raw.getDouble("eta") - 1;
        MetroWidgetData.Snapshot snapshot = new MetroWidgetData.Snapshot();
        snapshot.sys = "trtc";
        snapshot.systemLabel = system.label;
        snapshot.station = station;
        snapshot.precision = system.precision;
        snapshot.dataAt = now;
        MetroWidgetData.parseTrtc(catalog, system, root, station, "", snapshot, now);

        MetroWidgetData.Row official = null;
        MetroWidgetData.Row projected = null;
        for (MetroWidgetData.Row row : snapshot.rows) {
            if (!row.approx && row.eta != null && row.eta == raw.getDouble("eta")) official = row;
            if (row.approx && row.eta != null && row.eta == raw.getDouble("eta2")) projected = row;
        }
        assertNotNull("官方第一班必須保留", official);
        assertNotNull("eta2 必須合成 approx 列", projected);
        assertNull("投影列不可冒用第一班擁擠度", projected.crowd);
        assertEquals(official.dest, projected.dest);

        MetroWidgetData.Snapshot cacheSample = new MetroWidgetData.Snapshot();
        cacheSample.sys = snapshot.sys;
        cacheSample.systemLabel = snapshot.systemLabel;
        cacheSample.station = snapshot.station;
        cacheSample.precision = snapshot.precision;
        cacheSample.dataAt = snapshot.dataAt;
        cacheSample.rows.add(official);
        cacheSample.rows.add(projected);
        int widgetId = -14014;
        MetroWidgetData.cache(app, widgetId, cacheSample);
        MetroWidgetData.Snapshot restored = MetroWidgetData.cached(app, widgetId);
        assertNotNull(restored);
        assertEquals(2, restored.rows.size());
        assertFalse(restored.rows.get(0).approx);
        assertTrue("快取 round-trip 不可掉 approx", restored.rows.get(1).approx);

        Integer minutes = MetroWidgetProvider.minutesOf(restored.rows, 1, now);
        int expected = (int) Math.ceil((projected.eta - now) / 60);
        assertEquals(Integer.valueOf(expected), minutes);
        MetroWidgetPlate.Input input = baseInput(now);
        input.secondMinutes = minutes;
        input.secondApprox = restored.rows.get(1).approx;
        MetroWidgetPlate plate = MetroWidgetPlate.of(input);
        assertEquals("再下班 約 " + expected + " 分", plate.footLeft);
        assertEquals("約 " + expected, plate.boardSecond);
        assertFalse("快取重畫不可變成 mm:ss", plate.footLeft.matches(".*[0-9]{1,2}:[0-9]{2}.*"));
        app.getSharedPreferences(MetroWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .edit().remove("snapshot_" + widgetId).commit();
    }

    @Test
    public void noEta2StaysBlankExpiredProjectionDisappearsAndOfficialKeepsFloor() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject fixture = new JSONObject(readFixture());
        JSONArray board = fixture.getJSONArray("board");
        JSONObject raw = null;
        for (int i = 0; i < board.length(); i++) {
            JSONObject candidate = board.getJSONObject(i);
            if (!candidate.has("eta2")) { raw = candidate; break; }
        }
        assertNotNull("fixture 必須有無 eta2 的對照列", raw);

        JSONObject minimal = new JSONObject()
            .put("board", new JSONArray().put(raw))
            .put("trains", fixture.optJSONArray("trains"));
        MetroWidgetData.Catalog catalog = MetroWidgetData.catalog(app);
        MetroWidgetData.SystemInfo system = catalog.byId.get("trtc");
        String station = catalog.alias.getJSONObject("trtc").optString(raw.getString("name"));
        double now = raw.getDouble("eta") - 1;
        MetroWidgetData.Snapshot snapshot = new MetroWidgetData.Snapshot();
        snapshot.station = station;
        MetroWidgetData.parseTrtc(catalog, system, minimal, station, "", snapshot, now);
        assertEquals(1, snapshot.rows.size());
        assertFalse(snapshot.rows.get(0).approx);

        MetroWidgetPlate.Input blank = baseInput(now);
        MetroWidgetPlate noSecond = MetroWidgetPlate.of(blank);
        assertEquals("", noSecond.footLeft);
        assertNull(noSecond.boardSecond);

        List<MetroWidgetData.Row> rows = new ArrayList<>();
        MetroWidgetData.Row lead = new MetroWidgetData.Row();
        lead.eta = now + 90;
        rows.add(lead);
        MetroWidgetData.Row expired = new MetroWidgetData.Row();
        expired.eta = now - 1;
        expired.approx = true;
        rows.add(expired);
        assertNull("過期投影整列不畫", MetroWidgetProvider.minutesOf(rows, 1, now));

        MetroWidgetData.Row officialSecond = new MetroWidgetData.Row();
        officialSecond.eta = now + 119;
        rows.set(1, officialSecond);
        assertEquals("官方列仍走既有 floor", Integer.valueOf(1),
            MetroWidgetProvider.minutesOf(rows, 1, now));
        assertFalse(MetroWidgetProvider.approxOf(rows, 1));
    }

    private static MetroWidgetPlate.Input baseInput(double now) {
        MetroWidgetPlate.Input input = new MetroWidgetPlate.Input();
        input.station = "松山機場";
        input.stationEn = "Songshan Airport";
        input.stationCode = "BR13";
        input.lineLabel = "文湖線";
        input.lineColor = "#C48C31";
        input.dest = "南港展覽館";
        input.etaEpochSec = now + 120;
        input.dataAtEpochSec = now;
        input.nowEpochSec = now;
        return input;
    }

    private static String readFixture() throws Exception {
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        try (InputStream input = test.getAssets().open("trtc-live-sample-20260822.json");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
