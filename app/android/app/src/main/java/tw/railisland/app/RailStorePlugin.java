package tw.railisland.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

/** 直接問 Google Play 這台裝置是否有比目前版新的版本，不猜商店頁 HTML。 */
@CapacitorPlugin(name = "RailStore")
public final class RailStorePlugin extends Plugin {
    @PluginMethod public void checkUpdate(PluginCall call) {
        boolean playInstalled = false;
        try {
            String installer = getContext().getPackageManager()
                .getInstallSourceInfo(getContext().getPackageName()).getInstallingPackageName();
            playInstalled = "com.android.vending".equals(installer);
        } catch (Exception ignored) {}
        final boolean verifiedInstall = playInstalled;
        AppUpdateManagerFactory.create(getContext()).getAppUpdateInfo().addOnCompleteListener(task -> {
            JSObject out = new JSObject();
            if (!task.isSuccessful()) {
                out.put("ok", false); out.put("playInstalled", verifiedInstall); call.resolve(out); return;
            }
            AppUpdateInfo info = task.getResult();
            boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE;
            out.put("ok", true); out.put("playInstalled", verifiedInstall); out.put("available", available);
            out.put("availableVersionCode", info.availableVersionCode());
            Integer stale = info.clientVersionStalenessDays(); if (stale != null) out.put("stalenessDays", stale);
            out.put("flexibleAllowed", info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE));
            out.put("immediateAllowed", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE));
            call.resolve(out);
        });
    }
}
