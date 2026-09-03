package tw.railisland.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** 背景也不依賴 WebView 的原生音樂佇列；Media3 自動提供通知與鎖屏控制。 */
public final class RailAudioService extends MediaSessionService {
    static final String ACTION_QUEUE = "tw.railisland.app.audio.QUEUE";
    static final String ACTION_PLAY = "tw.railisland.app.audio.PLAY";
    static final String ACTION_RESUME = "tw.railisland.app.audio.RESUME";
    static final String ACTION_PAUSE = "tw.railisland.app.audio.PAUSE";
    static final String ACTION_VOLUME = "tw.railisland.app.audio.VOLUME";
    static final String ACTION_AMBIENCE = "tw.railisland.app.audio.AMBIENCE";
    static final String EVENT = "tw.railisland.app.audio.EVENT";
    private ExoPlayer player;
    private MediaSession mediaSession;
    // 車聲圖層(2026-09-03):第二個 ExoPlayer 單檔循環,不掛進 MediaSession(通知與鎖屏仍只顯示配樂),
    // 不搶 audio focus(Builder 預設不處理 focus,與主播放器同)。淡入淡出用 Handler 每 50ms 走一步。
    private ExoPlayer amb;
    private String ambSrc = "";
    private boolean ambOn;
    private int ambGen;
    private final Handler ambHandler = new Handler(Looper.getMainLooper());

    @Override public void onCreate() {
        super.onCreate();
        player = new ExoPlayer.Builder(this).build();
        player.setRepeatMode(Player.REPEAT_MODE_ALL);
        player.addListener(new Player.Listener() {
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                event("track", true, player.getCurrentMediaItemIndex());
            }
            @Override public void onIsPlayingChanged(boolean playing) {
                event("state", playing, player.getCurrentMediaItemIndex());
            }
            @Override public void onPlayerError(PlaybackException error) {
                event("trackError", false, player.getCurrentMediaItemIndex());
                if (player.hasNextMediaItem()) { player.seekToNextMediaItem(); player.prepare(); player.play(); }
            }
        });
        mediaSession = new MediaSession.Builder(this, player).build();
        // 這個 service 由 Capacitor 的自訂 action 啟動，不一定先收到外部 controller bind；
        // 主動註冊後 MediaSessionService 才會監看播放狀態、升成 foreground 並建立鎖屏通知。
        addSession(mediaSession);
    }

    @Nullable @Override public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null) handle(intent);
        return super.onStartCommand(intent, flags, startId);
    }

    private void handle(Intent intent) {
        String action = intent.getAction();
        if (ACTION_QUEUE.equals(action)) {
            List<MediaItem> items = new ArrayList<>();
            try {
                JSONArray tracks = new JSONArray(intent.getStringExtra("tracks"));
                for (int i = 0; i < tracks.length(); i++) {
                    JSONObject track = tracks.optJSONObject(i); if (track == null) continue;
                    String src = track.optString("src", ""); if (src.isEmpty()) continue;
                    Uri uri = src.startsWith("https://") || src.startsWith("http://")
                        ? Uri.parse(src) : Uri.parse("asset:///public/" + Uri.encode(src, "/"));
                    MediaMetadata metadata = new MediaMetadata.Builder()
                        .setTitle(RailNativeL10n.text(this, track.optString("title", "背景音樂")))
                        .setArtist(RailNativeL10n.text(this, "軌島"))
                        .setArtworkUri(Uri.parse("asset:///public/favicon-512.png")).build();
                    items.add(new MediaItem.Builder().setUri(uri).setMediaMetadata(metadata).build());
                }
            } catch (Exception ignored) {}
            player.setMediaItems(items, false);
        } else if (ACTION_PLAY.equals(action)) {
            int index = intent.getIntExtra("index", player.getCurrentMediaItemIndex());
            if (player.getMediaItemCount() > 0) {
                player.seekTo(Math.max(0, Math.min(index, player.getMediaItemCount() - 1)), 0);
                player.prepare(); player.play();
            }
        } else if (ACTION_RESUME.equals(action)) {
            if (player.getMediaItemCount() > 0) { player.prepare(); player.play(); }
        } else if (ACTION_PAUSE.equals(action)) player.pause();
        else if (ACTION_VOLUME.equals(action)) player.setVolume(
            Math.max(0f, Math.min(1f, intent.getFloatExtra("volume", 0.5f))));
        else if (ACTION_AMBIENCE.equals(action)) ambience(intent.getBooleanExtra("on", false),
            intent.getStringExtra("src"), intent.getFloatExtra("gain", 0.5f));
    }

    private void ambience(boolean on, String src, float gain) {
        if (on) {
            if (src == null || src.isEmpty()) return;
            if (amb == null) {
                amb = new ExoPlayer.Builder(this).build();
                amb.setRepeatMode(Player.REPEAT_MODE_ONE);
            }
            if (!src.equals(ambSrc)) {
                ambSrc = src;
                amb.setMediaItem(MediaItem.fromUri(Uri.parse("asset:///public/" + Uri.encode(src, "/"))));
                amb.setVolume(0f);
                amb.prepare();
            }
            ambOn = true;
            if (!amb.isPlaying()) amb.play();
            ambFadeTo(Math.max(0f, Math.min(1f, gain)), false);
        } else {
            ambOn = false;
            if (amb == null || !amb.isPlaying()) return;
            ambFadeTo(0f, true);
        }
    }

    private void ambFadeTo(final float target, final boolean pauseAtEnd) {
        final int gen = ++ambGen;
        final float from = amb.getVolume();
        final long t0 = SystemClock.uptimeMillis();
        final long dur = 1200;
        ambHandler.removeCallbacksAndMessages(null);
        ambHandler.post(new Runnable() {
            @Override public void run() {
                if (gen != ambGen || amb == null) return;
                float k = Math.min(1f, (SystemClock.uptimeMillis() - t0) / (float) dur);
                amb.setVolume(from + (target - from) * k);
                if (k < 1f) ambHandler.postDelayed(this, 50);
                else if (pauseAtEnd && !ambOn) amb.pause();
            }
        });
    }

    private void event(String type, boolean playing, int index) {
        sendBroadcast(new Intent(EVENT).setPackage(getPackageName())
            .putExtra("type", type).putExtra("playing", playing).putExtra("index", index));
    }

    @Override public void onDestroy() {
        if (mediaSession != null) mediaSession.release();
        if (player != null) player.release();
        ambHandler.removeCallbacksAndMessages(null);
        if (amb != null) amb.release();
        super.onDestroy();
    }
}
