package tw.railisland.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;

/** 說明中心「加到桌面」：請系統釘選某一種小工具（API 26+）。只轉發，不記結果；確認框與之後的選站流程都是系統／既有 configure activity 的事。 */
@CapacitorPlugin(name = "RailWidget")
public final class RailWidgetPlugin extends Plugin {
    private static final Map<String, Class<?>> PROVIDERS = new HashMap<>();
    static {
        PROVIDERS.put("metro-small", MetroWidgetSmallProvider.class);
        PROVIDERS.put("metro-medium", MetroWidgetProvider.class);
        PROVIDERS.put("metro-large", MetroWidgetLargeProvider.class);
        PROVIDERS.put("rail-small", RailBoardWidgetSmallProvider.class);
        PROVIDERS.put("rail-medium", RailBoardWidgetProvider.class);
        PROVIDERS.put("rail-large", RailBoardWidgetLargeProvider.class);
        PROVIDERS.put("mixed-large", MixedBoardWidgetProvider.class);
    }

    private static boolean supported(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false; // minSdk 24，requestPinAppWidget 是 26 才有
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        return mgr != null && mgr.isRequestPinAppWidgetSupported();
    }

    @PluginMethod public void pinSupported(PluginCall call) {
        JSObject out = new JSObject(); out.put("supported", supported(getContext())); call.resolve(out);
    }

    @PluginMethod public void pin(PluginCall call) {
        String kind = call.getString("kind", "");
        Class<?> provider = PROVIDERS.get(kind);
        if (provider == null) { call.reject("unknown kind: " + kind); return; }
        Context ctx = getContext();
        JSObject out = new JSObject();
        if (!supported(ctx)) { out.put("requested", false); call.resolve(out); return; }
        boolean requested = AppWidgetManager.getInstance(ctx).requestPinAppWidget(new ComponentName(ctx, provider), null, null);
        out.put("requested", requested); call.resolve(out);
    }
}
