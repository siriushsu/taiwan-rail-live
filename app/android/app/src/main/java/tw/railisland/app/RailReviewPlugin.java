package tw.railisland.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/** Play In-App Review；是否真的顯示由 Google Play 決定。 */
@CapacitorPlugin(name = "RailReview")
public final class RailReviewPlugin extends Plugin {
    @PluginMethod public void requestReview(PluginCall call) {
        ReviewManager manager = ReviewManagerFactory.create(getContext());
        manager.requestReviewFlow().addOnCompleteListener(request -> {
            if (!request.isSuccessful() || getActivity() == null) {
                JSObject out = new JSObject(); out.put("ok", false); call.resolve(out); return;
            }
            ReviewInfo info = request.getResult();
            manager.launchReviewFlow(getActivity(), info).addOnCompleteListener(flow -> {
                JSObject out = new JSObject(); out.put("ok", flow.isSuccessful()); call.resolve(out);
            });
        });
    }
}
