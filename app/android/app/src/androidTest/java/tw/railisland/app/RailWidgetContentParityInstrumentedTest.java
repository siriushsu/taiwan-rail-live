package tw.railisland.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.List;

@RunWith(AndroidJUnit4.class)
public final class RailWidgetContentParityInstrumentedTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @After public void cleanUp() {
        context.getSharedPreferences(RailWidgetData.PLACES_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    @Test public void savedPlaceResolvesAgainAfterMovingAndOffersRealFilters() throws Exception {
        RailWidgetData.Catalog catalog = RailWidgetData.catalog(context);
        RailWidgetData.Station taipei = catalog.byId.get("tra").stationByName.get("臺北");
        RailWidgetData.Station hualien = catalog.byId.get("tra").stationByName.get("花蓮");
        assertNotNull(taipei); assertNotNull(hualien);
        save("家", taipei.lat, taipei.lon);

        List<RailWidgetData.PlaceOption> places = RailWidgetData.places(context, catalog, "", null);
        assertFalse(places.isEmpty());
        RailWidgetData.PlaceOption first = places.get(0);
        assertEquals("家", first.label);
        assertEquals("臺北", first.station);
        List<RailWidgetData.FilterOption> filters = RailWidgetData.filterOptions(context, catalog, first.sys, first.key);
        assertTrue("地點起站必須有方向篩選", filters.stream().anyMatch(value -> value.key.startsWith("dir|")));
        assertTrue("地點起站必須有車種篩選", filters.stream().anyMatch(value -> value.key.startsWith("ty|")));
        assertTrue("地點起站必須有車次篩選", filters.stream().anyMatch(value -> value.key.startsWith("no|")));

        save("家", hualien.lat, hualien.lon);
        RailWidgetData.PlaceOption moved = RailWidgetData.resolvePlace(context, catalog, first.key, "", null);
        assertNotNull(moved);
        assertEquals("同名地點搬家後，小工具不得黏在設定時的舊站", "花蓮", moved.station);
    }

    private void save(String label, double lat, double lon) throws Exception {
        JSONArray values = new JSONArray().put(new JSONObject()
            .put("label", label).put("lat", lat).put("lon", lon).put("manual", true));
        context.getSharedPreferences(RailWidgetData.PLACES_PREFS, Context.MODE_PRIVATE)
            .edit().putString(RailWidgetData.PLACES_KEY, values.toString()).commit();
    }
}
