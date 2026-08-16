package tw.railisland.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;

public final class MetroWidgetConfigActivity extends AppCompatActivity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private MetroWidgetData.Catalog catalog;
    private Spinner systemSpinner;
    private Spinner stationSpinner;
    private Spinner directionSpinner;
    private final List<MetroWidgetData.StationInfo> visibleStations = new ArrayList<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }
        try { catalog = MetroWidgetData.catalog(this); }
        catch (Exception error) { finish(); return; }
        buildUi();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(24));
        root.setBackgroundColor(Color.rgb(245, 248, 247));

        TextView title = text("捷運看板小工具", 24, Color.rgb(13, 45, 48));
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title, matchWrap(0));
        TextView hint = text("選一個車站。放上桌面後會顯示官方下一班，點卡片可在鎖定畫面開始倒數。", 14,
            Color.rgb(71, 90, 91));
        LinearLayout.LayoutParams hintLp = matchWrap(dp(8));
        hintLp.bottomMargin = dp(22);
        root.addView(hint, hintLp);

        root.addView(label("系統"), matchWrap(dp(0)));
        systemSpinner = new Spinner(this);
        List<String> systemLabels = new ArrayList<>();
        for (MetroWidgetData.SystemInfo system : catalog.systems) systemLabels.add(system.label);
        systemSpinner.setAdapter(adapter(systemLabels));
        root.addView(systemSpinner, matchWrap(dp(4)));

        root.addView(label("車站"), matchWrap(dp(16)));
        stationSpinner = new Spinner(this);
        root.addView(stationSpinner, matchWrap(dp(4)));

        root.addView(label("方向（可留空）"), matchWrap(dp(16)));
        directionSpinner = new Spinner(this);
        root.addView(directionSpinner, matchWrap(dp(4)));

        Button done = new Button(this);
        done.setText("加入主畫面");
        done.setTextSize(16);
        done.setTextColor(Color.WHITE);
        done.setAllCaps(false);
        done.setBackgroundColor(Color.rgb(16, 96, 87));
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        buttonLp.topMargin = dp(28);
        root.addView(done, buttonLp);

        systemSpinner.setOnItemSelectedListener(new SimpleSelection() {
            @Override public void selected(int position) { updateStations(position); }
        });
        stationSpinner.setOnItemSelectedListener(new SimpleSelection() {
            @Override public void selected(int position) { updateDirections(position); }
        });
        done.setOnClickListener(v -> save());
        setContentView(root);
        int trtc = 0;
        for (int i = 0; i < catalog.systems.size(); i++) if ("trtc".equals(catalog.systems.get(i).id)) trtc = i;
        systemSpinner.setSelection(trtc);
    }

    private void updateStations(int systemIndex) {
        visibleStations.clear();
        List<String> labels = new ArrayList<>();
        labels.add("自動（最近的站・通行證）");
        if (systemIndex >= 0 && systemIndex < catalog.systems.size()) {
            visibleStations.addAll(catalog.systems.get(systemIndex).stations);
            for (MetroWidgetData.StationInfo station : visibleStations) labels.add(station.name);
        }
        stationSpinner.setAdapter(adapter(labels));
        int taipei = labels.indexOf("台北車站");
        if (taipei >= 0) stationSpinner.setSelection(taipei);
    }

    private void updateDirections(int position) {
        List<String> directions = new ArrayList<>();
        directions.add("全部方向");
        if (position > 0 && position - 1 < visibleStations.size()) {
            for (String dest : visibleStations.get(position - 1).destinations) directions.add("往 " + dest);
        }
        directionSpinner.setAdapter(adapter(directions));
    }

    private void save() {
        int sysIndex = systemSpinner.getSelectedItemPosition();
        int stationIndex = stationSpinner.getSelectedItemPosition();
        if (sysIndex < 0 || sysIndex >= catalog.systems.size() || stationIndex < 0) return;
        MetroWidgetData.SystemInfo system = catalog.systems.get(sysIndex);
        String station = stationIndex == 0 ? MetroWidgetData.AUTO : visibleStations.get(stationIndex - 1).name;
        String direction = "";
        int directionIndex = directionSpinner.getSelectedItemPosition();
        if (directionIndex > 0) {
            String label = String.valueOf(directionSpinner.getSelectedItem());
            direction = label.startsWith("往 ") ? label.substring(2) : label;
        }
        android.content.SharedPreferences prefs = getSharedPreferences(MetroWidgetProvider.PREFS, Context.MODE_PRIVATE);
        String previousSys = prefs.getString("sys_" + widgetId, null);
        String previousStation = prefs.getString("station_" + widgetId, null);
        String previousKey = previousSys == null || previousStation == null || MetroWidgetData.AUTO.equals(previousStation)
            ? null : previousSys + "|" + previousStation;
        String selectedKey = MetroWidgetData.AUTO.equals(station) ? null : system.id + "|" + station;
        android.content.SharedPreferences.Editor editor = prefs.edit()
            .putString("sys_" + widgetId, system.id)
            .putString("station_" + widgetId, station)
            .putString("direction_" + widgetId, direction);
        // 使用者重設的正是免費站時，名額跟著同一顆小工具搬到新站，不殘留在舊站。
        if (previousKey != null && previousKey.equals(prefs.getString("free_station", null))) {
            if (selectedKey == null) editor.remove("free_station");
            else editor.putString("free_station", selectedKey);
        }
        editor.commit();
        MetroWidgetProvider.reconcileFreeStation(this);
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        MetroWidgetProvider.updateOneAsync(this, manager, widgetId);
        Intent result = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    private ArrayAdapter<String> adapter(List<String> values) {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }

    private TextView label(String value) {
        TextView label = text(value, 13, Color.rgb(71, 90, 91));
        label.setTypeface(label.getTypeface(), android.graphics.Typeface.BOLD);
        return label;
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.15f);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap(int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = top;
        return lp;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private abstract static class SimpleSelection implements AdapterView.OnItemSelectedListener {
        abstract void selected(int position);
        @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { selected(position); }
        @Override public void onNothingSelected(AdapterView<?> parent) {}
    }
}
