package tw.railisland.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class RailFollowStopReceiver extends BroadcastReceiver {
    static final String ACTION_STOP = "tw.railisland.app.STOP_RAIL_FOLLOW";
    static final String ACTION_ADVANCE = "tw.railisland.app.ADVANCE_RAIL_FOLLOW";
    static final String ACTION_REFRESH = "tw.railisland.app.REFRESH_RAIL_FOLLOW";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            PendingResult pending = goAsync();
            new Thread(() -> {
                try { RailFollowNotification.refreshOfficial(context.getApplicationContext()); }
                finally { pending.finish(); }
            }, "rail-follow-refresh").start();
        } else if (ACTION_ADVANCE.equals(intent.getAction())) RailFollowNotification.advance(context);
        else RailFollowNotification.stop(context);
    }
}
