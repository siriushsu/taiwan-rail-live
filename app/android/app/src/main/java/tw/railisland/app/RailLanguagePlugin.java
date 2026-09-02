package tw.railisland.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 將 WebView 手動語言同步給 Android Widget、鎖定畫面通知與 Now Bar。 */
@CapacitorPlugin(name = "RailLanguage")
public final class RailLanguagePlugin extends Plugin {
    @PluginMethod public void setLanguage(PluginCall call) {
        String language = call.getString("language", "");
        if (!RailNativeL10n.setLanguage(getContext(), language)) {
            call.reject("Unsupported language");
            return;
        }
        MetroWidgetProvider.updateAll(getContext());
        RailBoardWidgetProvider.updateAll(getContext());
        MixedBoardWidgetProvider.updateAll(getContext());
        RailWaitNotification.refreshLanguage(getContext());
        RailFollowNotification.refreshLanguage(getContext());
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("language", RailNativeL10n.language(getContext()));
        call.resolve(result);
    }
}
