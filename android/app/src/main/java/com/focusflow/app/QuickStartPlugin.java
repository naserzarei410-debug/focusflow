package com.focusflow.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS-facing bridge for the "2-minute mode" home screen widget
 * (see TwoMinuteWidgetProvider). Tapping the widget launches MainActivity
 * with an intent extra; MainActivity stores a one-shot "pending" flag in
 * SharedPreferences via markPending() (the JS side isn't necessarily
 * ready to receive anything the instant the native process starts).
 * consumePending() reads AND clears that flag in a single call, so it
 * only ever fires once per widget tap. See js/core/quick-start.js for
 * how the JS side uses this.
 */
@CapacitorPlugin(name = "QuickStart")
public class QuickStartPlugin extends Plugin {

    static final String PREFS_NAME = "quick_start_prefs";
    static final String KEY_PENDING = "pending";

    static void markPending(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_PENDING, true).apply();
    }

    @PluginMethod
    public void consumePending(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean pending = prefs.getBoolean(KEY_PENDING, false);
        if (pending) {
            prefs.edit().putBoolean(KEY_PENDING, false).apply();
        }
        JSObject result = new JSObject();
        result.put("pending", pending);
        call.resolve(result);
    }
}
