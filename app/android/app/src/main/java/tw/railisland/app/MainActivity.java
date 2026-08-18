package tw.railisland.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(RailMetroWaitPlugin.class);
        super.onCreate(savedInstanceState);
        RailMetroWaitPlugin.handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        RailMetroWaitPlugin.handleIntent(intent);
    }
}
