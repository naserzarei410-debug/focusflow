package com.focusflow.app;

import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;

import java.util.concurrent.TimeUnit;

import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be called before super.onCreate() per Capacitor's plugin
        // registration rules.
        registerPlugin(IconSwitcherPlugin.class);
        registerPlugin(DeviceTtsPlugin.class);
        registerPlugin(QuickStartPlugin.class);
        registerPlugin(WidgetDataPlugin.class);
        super.onCreate(savedInstanceState);

        // Check #1 - on every app launch: covers the case where the system
        // theme changed while the app wasn't running at all.
        IconStateManager.updateIconState(getApplicationContext());

        // Check #2 - background: ask the OS to re-run the same check about
        // once a day even if the app is never opened. enqueueUniquePeriodicWork
        // + KEEP means this is scheduled only once ever, not re-scheduled on
        // every launch.
        PeriodicWorkRequest iconCheckRequest =
            new PeriodicWorkRequest.Builder(IconCheckWorker.class, 1, TimeUnit.DAYS).build();
        WorkManager.getInstance(getApplicationContext())
            .enqueueUniquePeriodicWork(
                "focusflow_icon_check",
                ExistingPeriodicWorkPolicy.KEEP,
                iconCheckRequest
            );

        // "2-minute mode" widget: a fresh cold start (app wasn't already
        // running) — just record the flag, the JS bootstrap (quick-start.js)
        // will pick it up on its own once it loads.
        handleQuickStartIntent(getIntent(), false);
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // "2-minute mode" widget tapped again while the app was already
        // running in the background: MainActivity's singleTask launch mode
        // means onCreate() above does NOT run in this case, so the JS
        // bootstrap check won't naturally re-run either — nudge the
        // already-loaded page directly instead.
        handleQuickStartIntent(intent, true);
    }

    private void handleQuickStartIntent(Intent intent, boolean appAlreadyRunning) {
        if (intent == null || !intent.getBooleanExtra(TwoMinuteWidgetProvider.EXTRA_QUICK_START, false)) {
            return;
        }
        QuickStartPlugin.markPending(getApplicationContext());
        // Avoid re-triggering this same flag again later from a plain
        // activity recreation (e.g. screen rotation) that isn't a new
        // widget tap.
        intent.removeExtra(TwoMinuteWidgetProvider.EXTRA_QUICK_START);

        if (appAlreadyRunning && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().post(() ->
                bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new Event('quick-start-pending'));",
                    null
                )
            );
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Check #3 - live: catches the user toggling system dark/light mode
        // while this app is running (foreground or backgrounded but still
        // alive in memory) and updates the launcher icon immediately,
        // instead of waiting for the next app launch or the once-a-day
        // background check. Works because AndroidManifest.xml already
        // declares android:configChanges="...|uiMode|..." on MainActivity,
        // so the activity isn't destroyed/recreated on a theme change.
        IconStateManager.updateIconState(getApplicationContext());
    }
}
