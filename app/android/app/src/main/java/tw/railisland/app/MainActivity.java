package tw.railisland.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(RailMetroWaitPlugin.class);
        registerPlugin(RailTraWaitPlugin.class);
        registerPlugin(RailFollowLivePlugin.class);
        registerPlugin(RailPlacesPlugin.class);
        registerPlugin(RailAudioPlugin.class);
        registerPlugin(RailReviewPlugin.class);
        registerPlugin(RailStorePlugin.class);
        registerPlugin(RailLanguagePlugin.class);
        registerPlugin(RailWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        Bridge b = getBridge();
        if (b != null) {
            b.setWebViewClient(new BridgeWebViewClient(b) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    WebResourceResponse response = super.shouldInterceptRequest(view, request);
                    if (response != null) {
                        String path = request.getUrl() != null ? request.getUrl().getPath() : null;
                        if (path != null) {
                            String mime = response.getMimeType();
                            if (mime == null || mime.trim().isEmpty()) {
                                if (path.endsWith(".bin") || path.endsWith(".pmtiles")) {
                                    response.setMimeType("application/octet-stream");
                                } else if (path.endsWith(".json") || path.endsWith(".geojson")) {
                                    response.setMimeType("application/json");
                                } else {
                                    response.setMimeType("application/octet-stream");
                                }
                            }
                        }
                    }
                    return response;
                }
            });
        }
        RailMetroWaitPlugin.handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        RailMetroWaitPlugin.handleIntent(intent);
    }
}
