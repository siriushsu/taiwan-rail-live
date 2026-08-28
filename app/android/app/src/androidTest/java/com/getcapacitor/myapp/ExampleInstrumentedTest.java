package com.getcapacitor.myapp;

import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Instrumented test, which will execute on an Android device.
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    @Test
    public void useAppContext() {
        // Context of the app under test.
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        // 正式包與 -PrailApplicationId 建出的並存真機測試包都必須留在軌島命名空間；
        // Capacitor 範本的 com.getcapacitor.app 從來不是本專案的 applicationId。
        assertTrue(appContext.getPackageName().startsWith("tw.railisland.app"));
    }
}
