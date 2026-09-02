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
        // getInstallSourceInfo() 是 API 30 才有的方法,而 minSdk 是 24——Android 10 以下直接呼叫會
        // 拋 NoSuchMethodError。它是 Error 不是 Exception,原本的 catch (Exception) 接不到,於是
        // 整個 App 在開機時(appUpdateInit 走到這裡)被系統終止。舊版走 getInstallerPackageName(),
        // 答案相同;catch 一併放寬到 Throwable——這裡的本意就是「問不到就當不是從 Play 裝的」。
        try {
            final String pkg = getContext().getPackageName();
            final String installer = android.os.Build.VERSION.SDK_INT >= 30
                ? getContext().getPackageManager().getInstallSourceInfo(pkg).getInstallingPackageName()
                : getContext().getPackageManager().getInstallerPackageName(pkg);
            playInstalled = "com.android.vending".equals(installer);
        } catch (Throwable ignored) {}
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
