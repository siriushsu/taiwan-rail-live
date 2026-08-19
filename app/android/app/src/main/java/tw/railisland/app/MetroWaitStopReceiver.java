package tw.railisland.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class MetroWaitStopReceiver extends BroadcastReceiver {
    static final String ACTION_STOP = "tw.railisland.app.STOP_METRO_WAIT";
    static final String ACTION_EXPIRE = "tw.railisland.app.EXPIRE_METRO_WAIT";
    static final String ACTION_REFRESH = "tw.railisland.app.REFRESH_METRO_WAIT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            PendingResult result = goAsync();
            RailWaitNotification.refreshAsync(context, result::finish);
        } else {
            RailWaitNotification.stop(context);
        }
    }
}
