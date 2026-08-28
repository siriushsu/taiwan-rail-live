package tw.railisland.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;

/** 雙看板設定；對應 iOS MixedBoardIntent 的鐵路起站、捷運站與方向三個欄位。 */
public final class MixedWidgetConfigActivity extends AppCompatActivity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private RailWidgetData.Catalog railCatalog;
    private MetroWidgetData.Catalog metroCatalog;
    private Spinner railSpinner;
    private Spinner metroSystemSpinner;
    private Spinner metroStationSpinner;
    private Spinner metroDirectionSpinner;
    private final List<RailChoice> railChoices = new ArrayList<>();
    private final List<MetroWidgetData.StationInfo> metroStations = new ArrayList<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }
        try {
            railCatalog = RailWidgetData.catalog(this);
            metroCatalog = MetroWidgetData.catalog(this);
        } catch (Exception error) { finish(); return; }
        buildUi();
        restore();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(24));
        root.setBackgroundColor(getColor(R.color.wg_paper));

        TextView title = text("鐵路＋捷運雙看板", 24, getColor(R.color.wg_ink));
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title, matchWrap(0));
        TextView hint = text("在同一張大卡片查看一個鐵路站和一個捷運站。", 14, getColor(R.color.wg_ink_soft));
        LinearLayout.LayoutParams hintLp = matchWrap(dp(8));
        hintLp.bottomMargin = dp(20);
        root.addView(hint, hintLp);

        root.addView(label("台鐵／高鐵起站"), matchWrap(0));
        railSpinner = new Spinner(this);
        buildRailChoices();
        railSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, railChoices));
        ((ArrayAdapter<?>) railSpinner.getAdapter()).setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        root.addView(railSpinner, matchWrap(dp(4)));

        root.addView(label("捷運系統"), matchWrap(dp(18)));
        metroSystemSpinner = new Spinner(this);
        List<String> labels = new ArrayList<>();
        for (MetroWidgetData.SystemInfo system : metroCatalog.systems) labels.add(system.label);
        metroSystemSpinner.setAdapter(adapter(labels));
        root.addView(metroSystemSpinner, matchWrap(dp(4)));

        root.addView(label("捷運站"), matchWrap(dp(18)));
        metroStationSpinner = new Spinner(this);
        root.addView(metroStationSpinner, matchWrap(dp(4)));

        root.addView(label("捷運方向（可留空）"), matchWrap(dp(18)));
        metroDirectionSpinner = new Spinner(this);
        root.addView(metroDirectionSpinner, matchWrap(dp(4)));

        TextView pass = text("免費版可使用一個捷運站；多站與自動選站需啟用軌島通行證。", 13,
            getColor(R.color.wg_warn));
        root.addView(pass, matchWrap(dp(18)));

        Button done = new Button(this);
        done.setText(RailNativeL10n.text(this, "加到桌面"));
        done.setTextSize(16);
        done.setTextColor(getColor(R.color.wg_on_accent));
        done.setAllCaps(false);
        done.setBackgroundColor(getColor(R.color.wg_navy));
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        buttonLp.topMargin = dp(24);
        root.addView(done, buttonLp);

        metroSystemSpinner.setOnItemSelectedListener(new Selection() {
            @Override public void selected(int position) { updateMetroStations(position); }
        });
        metroStationSpinner.setOnItemSelectedListener(new Selection() {
            @Override public void selected(int position) { updateMetroDirections(); }
        });
        done.setOnClickListener(view -> save());

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
    }

    private void buildRailChoices() {
        for (RailWidgetData.PlaceOption place : RailWidgetData.places(this, railCatalog, "", null)) {
            railChoices.add(new RailChoice(place.sys, place.key, RailNativeL10n.option(this, place.displayLabel(railCatalog))));
        }
        railChoices.add(new RailChoice("tra", RailWidgetData.AUTO, RailNativeL10n.text(this, "自動（最近的台鐵站）")));
        RailWidgetData.SystemInfo tra = railCatalog.byId.get("tra");
        if (tra != null) for (RailWidgetData.Station station : tra.stations) {
            railChoices.add(new RailChoice("tra", station.name, RailNativeL10n.text(this, "台鐵") + " · " + RailNativeL10n.name(this, station.name)));
        }
        RailWidgetData.SystemInfo thsr = railCatalog.byId.get("thsr");
        if (thsr != null) for (RailWidgetData.Station station : thsr.stations) {
            railChoices.add(new RailChoice("thsr", station.name, RailNativeL10n.text(this, "高鐵") + " · " + RailNativeL10n.name(this, station.name)));
        }
        for (RailWidgetData.Composite pair : railCatalog.composites) {
            railChoices.add(new RailChoice(RailWidgetData.SYS_COMPOSITE, pair.key,
                RailNativeL10n.text(this, "共站") + " · " + RailNativeL10n.option(this, pair.label)));
        }
    }

    private void updateMetroStations(int position) {
        metroStations.clear();
        List<String> labels = new ArrayList<>();
        labels.add("自動（最近的捷運站）");
        if (position >= 0 && position < metroCatalog.systems.size()) {
            for (MetroWidgetData.StationInfo station : metroCatalog.systems.get(position).stations) {
                metroStations.add(station);
                labels.add(station.name);
            }
        }
        metroStationSpinner.setAdapter(adapter(labels));
        int preferred = indexOfMetro("板橋");
        if (preferred >= 0) metroStationSpinner.setSelection(preferred + 1);
        updateMetroDirections();
    }

    private void updateMetroDirections() {
        List<String> labels = new ArrayList<>();
        labels.add("全部方向");
        MetroWidgetData.StationInfo station = selectedMetroStation();
        if (station != null) for (String destination : station.destinations) labels.add("往 " + destination);
        metroDirectionSpinner.setAdapter(adapter(labels));
    }

    private void restore() {
        SharedPreferences prefs = getSharedPreferences(MixedBoardWidgetProvider.PREFS, Context.MODE_PRIVATE);
        String railSys = prefs.getString("rail_sys_" + widgetId, "tra");
        String railOrigin = prefs.getString("rail_origin_" + widgetId, "板橋");
        for (int i = 0; i < railChoices.size(); i++) {
            RailChoice choice = railChoices.get(i);
            if (choice.sys.equals(railSys) && choice.origin.equals(railOrigin)) { railSpinner.setSelection(i); break; }
        }

        String metroSys = prefs.getString("metro_sys_" + widgetId, "trtc");
        int systemIndex = 0;
        for (int i = 0; i < metroCatalog.systems.size(); i++) {
            if (metroCatalog.systems.get(i).id.equals(metroSys)) { systemIndex = i; break; }
        }
        metroSystemSpinner.setSelection(systemIndex);
        updateMetroStations(systemIndex);
        String metroStation = prefs.getString("metro_station_" + widgetId, "板橋");
        int stationIndex = indexOfMetro(metroStation);
        if (MetroWidgetData.AUTO.equals(metroStation)) metroStationSpinner.setSelection(0);
        else if (stationIndex >= 0) metroStationSpinner.setSelection(stationIndex + 1);
        updateMetroDirections();
        String direction = prefs.getString("metro_direction_" + widgetId, "");
        MetroWidgetData.StationInfo station = selectedMetroStation();
        if (station != null) {
            int directionIndex = station.destinations.indexOf(direction);
            if (directionIndex >= 0) metroDirectionSpinner.setSelection(directionIndex + 1);
        }
    }

    private int indexOfMetro(String name) {
        for (int i = 0; i < metroStations.size(); i++) if (metroStations.get(i).name.equals(name)) return i;
        return -1;
    }

    private MetroWidgetData.SystemInfo selectedMetroSystem() {
        int at = metroSystemSpinner.getSelectedItemPosition();
        return at >= 0 && at < metroCatalog.systems.size() ? metroCatalog.systems.get(at) : metroCatalog.systems.get(0);
    }

    private MetroWidgetData.StationInfo selectedMetroStation() {
        int at = metroStationSpinner == null ? 0 : metroStationSpinner.getSelectedItemPosition();
        return at <= 0 || at - 1 >= metroStations.size() ? null : metroStations.get(at - 1);
    }

    private String selectedDirection() {
        MetroWidgetData.StationInfo station = selectedMetroStation();
        int at = metroDirectionSpinner.getSelectedItemPosition();
        return station == null || at <= 0 || at - 1 >= station.destinations.size() ? "" : station.destinations.get(at - 1);
    }

    private void save() {
        RailChoice rail = (RailChoice) railSpinner.getSelectedItem();
        MetroWidgetData.SystemInfo metroSystem = selectedMetroSystem();
        MetroWidgetData.StationInfo metroStation = selectedMetroStation();
        getSharedPreferences(MixedBoardWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
            .putString("rail_sys_" + widgetId, rail.sys)
            .putString("rail_origin_" + widgetId, rail.origin)
            .putString("metro_sys_" + widgetId, metroSystem.id)
            .putString("metro_station_" + widgetId, metroStation == null ? MetroWidgetData.AUTO : metroStation.name)
            .putString("metro_direction_" + widgetId, selectedDirection())
            .apply();
        MetroWidgetProvider.reconcileFreeStation(this);
        MixedBoardWidgetProvider.updateOneAsync(this, AppWidgetManager.getInstance(this), widgetId);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }

    private TextView label(String value) {
        TextView out = text(value, 13, getColor(R.color.wg_ink_soft));
        out.setTypeface(out.getTypeface(), android.graphics.Typeface.BOLD);
        return out;
    }

    private TextView text(String value, float size, int color) {
        TextView out = new TextView(this);
        out.setText(RailNativeL10n.text(this, value)); out.setTextSize(size); out.setTextColor(color);
        return out;
    }

    private ArrayAdapter<String> adapter(List<String> values) {
        List<String> localized = new ArrayList<>();
        for (String value : values) localized.add(RailNativeL10n.option(this, value));
        ArrayAdapter<String> out = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, localized);
        out.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return out;
    }

    private LinearLayout.LayoutParams matchWrap(int top) {
        LinearLayout.LayoutParams out = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        out.topMargin = top;
        return out;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private static final class RailChoice {
        final String sys;
        final String origin;
        final String label;
        RailChoice(String sys, String origin, String label) { this.sys = sys; this.origin = origin; this.label = label; }
        @Override public String toString() { return label; }
    }

    private abstract static class Selection implements AdapterView.OnItemSelectedListener {
        abstract void selected(int position);
        @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { selected(position); }
        @Override public void onNothingSelected(AdapterView<?> parent) {}
    }
}
