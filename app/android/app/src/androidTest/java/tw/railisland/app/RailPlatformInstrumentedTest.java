package tw.railisland.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.json.*;
import java.io.*;
import java.util.*;

/** 人工月台值只用於測試；實際執行出貨的資料比對與 RemoteViews。 */
public class RailPlatformInstrumentedTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private RailWidgetData.Row row(long now) {
        RailWidgetData.Row r = new RailWidgetData.Row();
        r.sys="tra"; r.no="3177"; r.type="區間車"; r.color="#3979AD";
        r.terminus="潮州"; r.platformOrigin="臺北";
        r.relation=RailWidgetData.Relation.DEPARTURE; r.scheduledAt=now+60000;
        return r;
    }
    @Test public void matchingAndExpiry() throws Exception {
        long now=System.currentTimeMillis(); RailWidgetData.Row r=row(now);
        JSONObject one=new JSONObject().put("stationName","台北").put("trainNo","3177")
            .put("departureAt",r.scheduledAt).put("arrivalAt",r.scheduledAt-120000)
            .put("state","known").put("platform","1A").put("updatedAt",now).put("expiresAt",now+180000);
        JSONObject snap=new JSONObject().put("schema",1).put("expiresAt",now+180000).put("records",new JSONArray().put(one));
        RailWidgetData.attachPlatforms(Arrays.asList(r),snap,now); assertEquals("1A",r.platformAt(now));
        assertNull(r.platformAt(now+180000));
        r.scheduledAt+=86400000; RailWidgetData.attachPlatforms(Arrays.asList(r),snap,now); assertNull(r.platformAt(now));
        r.scheduledAt-=86400000; r.platformOrigin="彰化"; RailWidgetData.attachPlatforms(Arrays.asList(r),snap,now); assertNull(r.platformAt(now));
        r.platformOrigin="臺北"; r.sys="thsr"; RailWidgetData.attachPlatforms(Arrays.asList(r),snap,now); assertNull(r.platformAt(now));
        r.sys="tra"; r.relation=RailWidgetData.Relation.PASS; RailWidgetData.attachPlatforms(Arrays.asList(r),snap,now); assertNull(r.platformAt(now));
        r.relation=RailWidgetData.Relation.ARRIVAL; r.scheduledAt-=120000;
        RailWidgetData.attachPlatforms(Arrays.asList(r),snap,now); assertEquals("1A",r.platformAt(now));
        one.put("state","unavailable").put("platform",JSONObject.NULL);
        RailWidgetData.attachPlatforms(Arrays.asList(r),snap,now); assertNull(r.platformAt(now));
    }
    @Test public void knownVisibleAndUnknownGoneWithoutClipping() throws Exception {
        for(boolean readable:new boolean[]{false,true}) for(int width:new int[]{150,320,380}) {
            RailWidgetData.Row r=row(System.currentTimeMillis()); r.platform="12B"; r.platformExpiresAt=System.currentTimeMillis()+180000;
            View v=RailWidgetRender.row(context,r,readable,false).apply(context,new FrameLayout(context));
            int px=Math.round(width*context.getResources().getDisplayMetrics().density);
            v.measure(View.MeasureSpec.makeMeasureSpec(px,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(v.getLayoutParams().height,View.MeasureSpec.EXACTLY));
            v.layout(0,0,v.getMeasuredWidth(),v.getMeasuredHeight());
            TextView label=v.findViewById(R.id.wrr_platform); assertEquals(View.VISIBLE,label.getVisibility());
            int[] child=new int[2], root=new int[2];label.getLocationOnScreen(child);v.getLocationOnScreen(root);
            assertTrue("月台不可裁出列高",child[1]-root[1]>=0&&child[1]-root[1]+label.getHeight()<=v.getHeight());
            assertTrue("月台文字不可省略",label.getLayout().getEllipsisCount(0)==0&&label.getLayout().getLineWidth(0)<=label.getWidth()+1);
            Bitmap bmp=Bitmap.createBitmap(v.getWidth(),v.getHeight(),Bitmap.Config.ARGB_8888);v.draw(new Canvas(bmp));
            try(FileOutputStream out=new FileOutputStream(new File(context.getExternalFilesDir(null),"platform-"+readable+"-"+width+".png"))){bmp.compress(Bitmap.CompressFormat.PNG,100,out);}
            r.platform=null;
            View empty=RailWidgetRender.row(context,r,readable,false).apply(context,new FrameLayout(context));
            assertEquals(View.GONE,empty.findViewById(R.id.wrr_platform).getVisibility());
        }
    }
}
