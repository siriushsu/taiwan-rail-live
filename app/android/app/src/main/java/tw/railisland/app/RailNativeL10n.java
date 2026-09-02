package tw.railisland.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Widget、通知與原生設定頁共用的輕量翻譯入口。繁中永遠是安全 fallback。 */
final class RailNativeL10n {
    private static final String PREFS = "rail_native_l10n";
    private static final String KEY_LANGUAGE = "rail.language";
    private static volatile JSONObject languages;

    private RailNativeL10n() {}

    static String language(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = normalize(prefs.getString(KEY_LANGUAGE, ""));
        if (!saved.isEmpty()) return saved;
        String system = normalize(Locale.getDefault().toLanguageTag());
        return system.isEmpty() ? "zh-TW" : system;
    }

    static boolean setLanguage(Context context, String language) {
        String normalized = normalize(language);
        if (normalized.isEmpty()) return false;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_LANGUAGE, normalized).apply();
        return true;
    }

    private static String normalize(String value) {
        String raw = value == null ? "" : value.toLowerCase(Locale.ROOT);
        if (raw.equals("en") || raw.startsWith("en-")) return "en";
        if (raw.equals("ja") || raw.startsWith("ja-")) return "ja";
        if (raw.equals("zh-tw") || raw.equals("zh-hant") || raw.startsWith("zh-")) return "zh-TW";
        return "";
    }

    static String text(Context context, String source) {
        return text(context, source, Collections.emptyMap());
    }

    static String text(Context context, String source, String... values) {
        Map<String, String> vars = new HashMap<>();
        for (int i = 0; i + 1 < values.length; i += 2) vars.put(values[i], values[i + 1]);
        return text(context, source, vars);
    }

    static String text(Context context, String source, Map<String, String> values) {
        if (source == null) return "";
        String result = source;
        String language = language(context);
        if (!"zh-TW".equals(language)) {
            JSONObject catalog = catalog(context).optJSONObject(language);
            if (catalog != null) result = catalog.optString(source, source);
        }
        for (Map.Entry<String, String> entry : values.entrySet()) {
            result = result.replace("{" + entry.getKey() + "}", entry.getValue() == null ? "" : entry.getValue());
        }
        return result;
    }

    /** 官方站名、路線名、車種使用；使用者自行輸入的地點名稱不可呼叫。 */
    static String name(Context context, String source) {
        if (source == null || source.isEmpty()) return "";
        String exact = text(context, source);
        if (!exact.equals(source)) return exact;
        String[] arrow = source.split(" → ", -1);
        if (arrow.length == 2) return name(context, arrow[0]) + " → " + name(context, arrow[1]);
        for (String suffix : new String[] { "車站", "站" }) {
            if (source.endsWith(suffix) && source.length() > suffix.length()) {
                String base = source.substring(0, source.length() - suffix.length());
                String translated = text(context, base);
                if (!translated.equals(base)) return translated;
            }
        }
        return source;
    }

    /** AppWidget 選單的方向、線名＋班數等組合字串。 */
    static String option(Context context, String source) {
        if (source == null || source.isEmpty()) return "";
        String exact = text(context, source);
        if (!exact.equals(source)) return exact;
        if (source.startsWith("我的地點 · ") && source.endsWith("）")) {
            int left = source.lastIndexOf('（');
            if (left > "我的地點 · ".length()) {
                String userName = source.substring("我的地點 · ".length(), left);
                String detail = source.substring(left + 1, source.length() - 1);
                int split = detail.indexOf(' ');
                String system = split > 0 ? detail.substring(0, split) : detail;
                String station = split > 0 ? detail.substring(split + 1) : "";
                return text(context, "我的地點 · {name}（{system} {station}）",
                    "name", userName, "system", name(context, system), "station", name(context, station));
            }
        }
        if (source.startsWith("方向 · 往 ")) {
            return text(context, "方向 · 往 {station}", "station", name(context, source.substring(7)));
        }
        if (source.startsWith("車種 · ") && source.endsWith(" 班）")) {
            int left = source.lastIndexOf('（');
            if (left > 5) {
                String count = source.substring(left + 1, source.length() - 3);
                return text(context, "車種 · {type}（{n} 班）",
                    "type", name(context, source.substring(5, left)), "n", count);
            }
        }
        if (source.startsWith("車次 · ")) {
            return text(context, "車次 · {trainNo}", "trainNo", source.substring(5));
        }
        if (source.startsWith("往 ") && source.endsWith(" 方向")) {
            String station = source.substring(2, source.length() - 3);
            return text(context, "往 {station} 方向", "station", name(context, station));
        }
        if (source.startsWith("往 ")) {
            return text(context, "往 {station}", "station", name(context, source.substring(2)));
        }
        if (source.startsWith("往") && source.length() > 1) {
            return text(context, "往{station}", "station", name(context, source.substring(1)));
        }
        return name(context, source);
    }

    static MetroWidgetPlate.Texts plateTexts(Context context) {
        Context app = context.getApplicationContext();
        return new MetroWidgetPlate.Texts() {
            @Override public String text(String source, String... values) {
                return RailNativeL10n.text(app, source, values);
            }
            @Override public String name(String source) { return RailNativeL10n.name(app, source); }
        };
    }

    private static JSONObject catalog(Context context) {
        JSONObject cached = languages;
        if (cached != null) return cached;
        synchronized (RailNativeL10n.class) {
            if (languages != null) return languages;
            try (InputStream input = context.getAssets().open("RailNativeL10n.json");
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                for (int read; (read = input.read(buffer)) >= 0;) output.write(buffer, 0, read);
                JSONObject root = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
                languages = root.optJSONObject("languages");
            } catch (Exception ignored) {
                languages = new JSONObject();
            }
            return languages;
        }
    }
}
