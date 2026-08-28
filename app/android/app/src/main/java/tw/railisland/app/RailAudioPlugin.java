package tw.railisland.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RailAudio")
public final class RailAudioPlugin extends Plugin {
    private final BroadcastReceiver events = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            String type = intent.getStringExtra("type"); if (type == null) return;
            JSObject data = new JSObject();
            data.put("index", intent.getIntExtra("index", 0));
            data.put("playing", intent.getBooleanExtra("playing", false));
            notifyListeners(type, data, true);
        }
    };

    @Override public void load() {
        ContextCompat.registerReceiver(getContext(), events,
            new IntentFilter(RailAudioService.EVENT), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(events); } catch (Exception ignored) {}
        super.handleOnDestroy();
    }

    @PluginMethod public void setQueue(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        Intent intent = new Intent(getContext(), RailAudioService.class).setAction(RailAudioService.ACTION_QUEUE)
            .putExtra("tracks", tracks == null ? "[]" : tracks.toString());
        getContext().startService(intent); ok(call);
    }

    @PluginMethod public void play(PluginCall call) {
        Intent intent = new Intent(getContext(), RailAudioService.class).setAction(RailAudioService.ACTION_PLAY)
            .putExtra("index", call.getInt("index", 0));
        ContextCompat.startForegroundService(getContext(), intent); ok(call);
    }

    @PluginMethod public void resume(PluginCall call) {
        ContextCompat.startForegroundService(getContext(),
            new Intent(getContext(), RailAudioService.class).setAction(RailAudioService.ACTION_RESUME)); ok(call);
    }

    @PluginMethod public void pause(PluginCall call) {
        getContext().startService(new Intent(getContext(), RailAudioService.class)
            .setAction(RailAudioService.ACTION_PAUSE)); ok(call);
    }

    @PluginMethod public void setVolume(PluginCall call) {
        getContext().startService(new Intent(getContext(), RailAudioService.class)
            .setAction(RailAudioService.ACTION_VOLUME)
            .putExtra("volume", call.getDouble("v", 0.5).floatValue())); ok(call);
    }

    private static void ok(PluginCall call) { JSObject out = new JSObject(); out.put("ok", true); call.resolve(out); }
}
