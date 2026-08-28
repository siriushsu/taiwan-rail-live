package tw.railisland.app;

import android.appwidget.AppWidgetManager;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.Set;

/** Android 發車看板設定：台鐵／高鐵／共站、起訖站、自動最近站與大字好讀版。 */
public final class RailWidgetConfigActivity extends AppCompatActivity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private RailWidgetData.Catalog catalog;
    private Spinner systemSpinner;
    private Spinner originSpinner;
    private Spinner destinationSpinner;
    private CheckBox readable;
    private Button filtersButton;
    private FrameLayout preview;
    private TextView destinationLabel;
    private final List<String> originKeys = new ArrayList<>();
    private final Set<String> selectedFilters = new LinkedHashSet<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }
        try { catalog = RailWidgetData.catalog(this); }
        catch (Exception error) { finish(); return; }
        buildUi();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(24));
        root.setBackgroundColor(getColor(R.color.wg_paper));

        TextView title = text("發車看板小工具", 24, getColor(R.color.wg_ink));
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title, matchWrap(0));
        TextView hint = text("選台鐵、高鐵或共站，查看接下來的停靠、終到與通過列車。", 14,
            getColor(R.color.wg_ink_soft));
        LinearLayout.LayoutParams hintLp = matchWrap(dp(8));
        hintLp.bottomMargin = dp(18);
        root.addView(hint, hintLp);

        preview = new FrameLayout(this);
        LinearLayout.LayoutParams previewLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(158));
        previewLp.bottomMargin = dp(20);
        root.addView(preview, previewLp);

        root.addView(label("鐵路系統"), matchWrap(0));
        systemSpinner = new Spinner(this);
        systemSpinner.setAdapter(adapter(Arrays.asList("台鐵", "高鐵", "台鐵＋高鐵共站")));
        root.addView(systemSpinner, matchWrap(dp(4)));

        root.addView(label("起站"), matchWrap(dp(16)));
        originSpinner = new Spinner(this);
        root.addView(originSpinner, matchWrap(dp(4)));

        destinationLabel = label("目的站（可留空）");
        root.addView(destinationLabel, matchWrap(dp(16)));
        destinationSpinner = new Spinner(this);
        root.addView(destinationSpinner, matchWrap(dp(4)));

        filtersButton = new Button(this);
        filtersButton.setAllCaps(false);
        filtersButton.setText("只看這些（可留空）");
        root.addView(filtersButton, matchWrap(dp(16)));

        readable = new CheckBox(this);
        readable.setText("大字好讀版");
        readable.setTextColor(getColor(R.color.wg_ink));
        readable.setTextSize(15);
        root.addView(readable, matchWrap(dp(18)));

        Button done = new Button(this);
        done.setText("加到桌面");
        done.setTextSize(16);
        done.setTextColor(getColor(R.color.wg_on_accent));
        done.setAllCaps(false);
        done.setBackgroundColor(getColor(R.color.wg_navy));
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        buttonLp.topMargin = dp(22);
        root.addView(done, buttonLp);

        systemSpinner.setOnItemSelectedListener(new Selection() {
            @Override public void selected(int position) { updateOrigins(position); }
        });
        originSpinner.setOnItemSelectedListener(new Selection() {
            @Override public void selected(int position) { updateDestinations(); refreshPreview(); }
        });
        destinationSpinner.setOnItemSelectedListener(new Selection() {
            @Override public void selected(int position) { refreshPreview(); }
        });
        readable.setOnCheckedChangeListener((button, checked) -> refreshPreview());
        filtersButton.setOnClickListener(view -> showFilters());
        done.setOnClickListener(view -> save());

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
        restore();
    }

    private void restore() {
        SharedPreferences prefs = getSharedPreferences(RailBoardWidgetProvider.PREFS, Context.MODE_PRIVATE);
        String sys = prefs.getString("sys_" + widgetId, "tra");
        int sysIndex = "thsr".equals(sys) ? 1 : RailWidgetData.SYS_COMPOSITE.equals(sys) ? 2 : 0;
        systemSpinner.setSelection(sysIndex);
        updateOrigins(sysIndex);
        String origin = prefs.getString("origin_" + widgetId, null);
        if (origin != null) {
            if (RailWidgetData.AUTO.equals(origin)) originSpinner.setSelection(0);
            else {
                int at = originKeys.indexOf(origin);
                if (at >= 0) originSpinner.setSelection(at + 1);
            }
        }
        updateDestinations();
        String destination = prefs.getString("destination_" + widgetId, "");
        for (int i = 0; i < destinationSpinner.getCount(); i++) {
            Object item = destinationSpinner.getItemAtPosition(i);
            if (item instanceof DestinationValue && destination.equals(((DestinationValue) item).value)) {
                destinationSpinner.setSelection(i); break;
            }
        }
        readable.setChecked(prefs.getBoolean("readable_" + widgetId, false));
        selectedFilters.clear();
        try {
            JSONArray values = new JSONArray(prefs.getString("filters_" + widgetId, "[]"));
            for (int i = 0; i < values.length(); i++) selectedFilters.add(values.optString(i));
        } catch (Exception ignored) {}
        updateFilterLabel();
        refreshPreview();
    }

    private String selectedSystem() {
        int at = systemSpinner.getSelectedItemPosition();
        return at == 1 ? "thsr" : at == 2 ? RailWidgetData.SYS_COMPOSITE : "tra";
    }

    private void updateOrigins(int systemIndex) {
        originKeys.clear();
        List<String> labels = new ArrayList<>();
        labels.add("自動（最近的站）");
        String sys = systemIndex == 1 ? "thsr" : systemIndex == 2 ? RailWidgetData.SYS_COMPOSITE : "tra";
        if (!RailWidgetData.SYS_COMPOSITE.equals(sys)) {
            for (RailWidgetData.PlaceOption place : RailWidgetData.places(this, catalog, "", null)) {
                originKeys.add(place.key);
                labels.add(place.displayLabel(catalog));
            }
        }
        if (RailWidgetData.SYS_COMPOSITE.equals(sys)) {
            for (RailWidgetData.Composite pair : catalog.composites) {
                originKeys.add(pair.key);
                labels.add(pair.label);
            }
        } else {
            RailWidgetData.SystemInfo system = catalog.byId.get(sys);
            if (system != null) for (RailWidgetData.Station station : system.stations) {
                originKeys.add(station.name);
                labels.add(station.name);
            }
        }
        originSpinner.setAdapter(adapter(labels));
        String preferred = RailWidgetData.SYS_COMPOSITE.equals(sys) ? "臺北|台北" : sys.equals("thsr") ? "台北" : "臺北";
        int at = originKeys.indexOf(preferred);
        if (at >= 0) originSpinner.setSelection(at + 1);
        boolean composite = RailWidgetData.SYS_COMPOSITE.equals(sys);
        destinationLabel.setVisibility(composite ? View.GONE : View.VISIBLE);
        destinationSpinner.setVisibility(composite ? View.GONE : View.VISIBLE);
        updateDestinations();
        refreshPreview();
    }

    private String selectedOrigin() {
        int at = originSpinner.getSelectedItemPosition();
        return at <= 0 || at - 1 >= originKeys.size() ? RailWidgetData.AUTO : originKeys.get(at - 1);
    }

    private void updateDestinations() {
        List<String> values = new ArrayList<>();
        values.add("");
        List<String> labels = new ArrayList<>();
        labels.add("全部目的地");
        String sys = selectedSystem();
        String origin = selectedOrigin();
        if (!RailWidgetData.SYS_COMPOSITE.equals(sys) && !RailWidgetData.AUTO.equals(origin)) {
            if (RailWidgetData.isPlace(origin)) {
                RailWidgetData.PlaceOption place = RailWidgetData.resolvePlace(this, catalog, origin, "", null);
                if (place != null) { sys = place.sys; origin = place.station; }
            }
            List<String> direct = RailWidgetData.destinations(catalog, sys, origin);
            java.util.Set<String> allowed = new java.util.LinkedHashSet<>(direct);
            for (RailWidgetData.PlaceOption place : RailWidgetData.places(this, catalog, sys, allowed)) {
                values.add(place.key); labels.add(place.displayLabel(catalog));
            }
            for (String station : direct) { values.add(station); labels.add("往 " + station); }
        }
        destinationSpinner.setAdapter(new DestinationAdapter(this, labels, values));
    }

    private String selectedDestination() {
        Object selected = destinationSpinner.getSelectedItem();
        if (selected instanceof DestinationValue) return ((DestinationValue) selected).value;
        return "";
    }

    private void showFilters() {
        List<RailWidgetData.FilterOption> options = RailWidgetData.filterOptions(
            this, catalog, selectedSystem(), selectedOrigin());
        if (options.isEmpty()) {
            new AlertDialog.Builder(this).setTitle("只看這些")
                .setMessage("這個起站目前沒有可用的篩選項目。")
                .setPositiveButton("知道了", null).show();
            return;
        }
        String[] labels = new String[options.size()];
        boolean[] checked = new boolean[options.size()];
        Set<String> draft = new LinkedHashSet<>(selectedFilters);
        for (int i = 0; i < options.size(); i++) {
            labels[i] = options.get(i).label; checked[i] = draft.contains(options.get(i).key);
        }
        new AlertDialog.Builder(this).setTitle("只看這些（留空就是全部）")
            .setMultiChoiceItems(labels, checked, (dialog, which, value) -> {
                if (value) draft.add(options.get(which).key); else draft.remove(options.get(which).key);
            })
            .setNeutralButton("清除", (dialog, which) -> {
                selectedFilters.clear(); updateFilterLabel(); refreshPreview();
            })
            .setNegativeButton("取消", null)
            .setPositiveButton("完成", (dialog, which) -> {
                selectedFilters.clear(); selectedFilters.addAll(draft); updateFilterLabel(); refreshPreview();
            }).show();
    }

    private void updateFilterLabel() {
        if (filtersButton == null) return;
        filtersButton.setText(selectedFilters.isEmpty() ? "只看這些（可留空）"
            : "已選 " + selectedFilters.size() + " 項篩選");
    }

    private void refreshPreview() {
        if (preview == null) return;
        preview.removeAllViews();
        long now = System.currentTimeMillis();
        RailWidgetData.Snapshot snapshot = new RailWidgetData.Snapshot();
        snapshot.sys = selectedSystem();
        snapshot.systemLabel = RailWidgetData.SYS_COMPOSITE.equals(snapshot.sys) ? "台鐵＋高鐵"
            : snapshot.sys.equals("thsr") ? "高鐵" : "台鐵";
        int originAt = originSpinner == null ? 0 : originSpinner.getSelectedItemPosition();
        snapshot.origin = originAt <= 0 ? "自動選站" : String.valueOf(originSpinner.getSelectedItem());
        snapshot.destination = selectedDestination();
        snapshot.generatedAt = now;
        for (int i = 0; i < 3; i++) {
            RailWidgetData.Row row = new RailWidgetData.Row();
            row.sys = i == 1 && RailWidgetData.SYS_COMPOSITE.equals(snapshot.sys) ? "thsr" : snapshot.sys;
            row.no = i == 0 ? "123" : i == 1 ? "0567" : "2551";
            row.type = row.sys.equals("thsr") ? "高鐵" : i == 0 ? "自強" : "區間車";
            row.color = row.sys.equals("thsr") ? "#E85D0D" : i == 0 ? "#C0392B" : "#2E6FB0";
            row.terminus = snapshot.destination.isEmpty() ? (i == 1 ? "南港" : "花蓮") : snapshot.destination;
            row.relation = i == 2 ? RailWidgetData.Relation.PASS : RailWidgetData.Relation.DEPARTURE;
            row.scheduledAt = now + (i + 1) * 8 * 60_000L;
            row.delayMinutes = i == 0 ? Integer.valueOf(0)
                : i == 2 ? Integer.valueOf(3) : null;
            snapshot.rows.add(row);
        }
        RemoteViewsHost.attach(this, preview,
            RailWidgetRender.board(this, R.layout.widget_rail_4x2, snapshot, 3, readable.isChecked(), false));
    }

    private void save() {
        String sys = selectedSystem();
        String origin = selectedOrigin();
        String destination = RailWidgetData.SYS_COMPOSITE.equals(sys) ? "" : selectedDestination();
        getSharedPreferences(RailBoardWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
            .putString("sys_" + widgetId, sys)
            .putString("origin_" + widgetId, origin)
            .putString("destination_" + widgetId, destination)
            .putBoolean("readable_" + widgetId, readable.isChecked())
            .putString("filters_" + widgetId, new JSONArray(selectedFilters).toString())
            .apply();
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        RailBoardWidgetProvider.updateOneAsync(this, manager, widgetId);
        Intent result = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    private TextView label(String value) {
        TextView out = text(value, 13, getColor(R.color.wg_ink_soft));
        out.setTypeface(out.getTypeface(), android.graphics.Typeface.BOLD);
        return out;
    }

    private TextView text(String value, float size, int color) {
        TextView out = new TextView(this);
        out.setText(value); out.setTextSize(size); out.setTextColor(color);
        return out;
    }

    private ArrayAdapter<String> adapter(List<String> values) {
        ArrayAdapter<String> out = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, values);
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

    private abstract static class Selection implements AdapterView.OnItemSelectedListener {
        public abstract void selected(int position);
        @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { selected(position); }
        @Override public void onNothingSelected(AdapterView<?> parent) {}
    }

    private static final class DestinationValue {
        final String label;
        final String value;
        DestinationValue(String label, String value) { this.label = label; this.value = value; }
        @Override public String toString() { return label; }
    }

    private static final class DestinationAdapter extends ArrayAdapter<DestinationValue> {
        DestinationAdapter(Context context, List<String> labels, List<String> values) {
            super(context, android.R.layout.simple_spinner_item, build(labels, values));
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        }
        private static List<DestinationValue> build(List<String> labels, List<String> values) {
            List<DestinationValue> out = new ArrayList<>();
            for (int i = 0; i < labels.size(); i++) out.add(new DestinationValue(labels.get(i), values.get(i)));
            return out;
        }
    }

    /** RemoteViews.apply 的小包裝，讓設定頁預覽與桌面共用出貨 binder。 */
    private static final class RemoteViewsHost {
        static void attach(Context context, FrameLayout host, android.widget.RemoteViews views) {
            host.addView(views.apply(context, host));
        }
    }
}
