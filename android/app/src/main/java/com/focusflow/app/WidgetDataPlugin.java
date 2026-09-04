package com.focusflow.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge: push home-screen status-widget numbers from the WebView layer
 * (IndexedDB lives only in JS) into SharedPreferences, then refresh any
 * StatusWidgetProvider instances on the launcher.
 */
@CapacitorPlugin(name = "WidgetData")
public class WidgetDataPlugin extends Plugin {

    @PluginMethod
    public void updateStatus(PluginCall call) {
        String goalText = call.getString("goalText", "۰ / ۲۰");
        String dueText = call.getString("dueText", "۰");
        String streakText = call.getString("streakText", "۰");

        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(
            StatusWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(StatusWidgetProvider.KEY_GOAL_TEXT, goalText)
            .putString(StatusWidgetProvider.KEY_DUE_TEXT, dueText)
            .putString(StatusWidgetProvider.KEY_STREAK_TEXT, streakText)
            .apply();

        try {
            StatusWidgetProvider.refreshAll(ctx);
        } catch (Exception e) {
            // Widget may not be placed yet — ignore.
        }

        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }
}
