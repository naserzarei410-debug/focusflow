package com.focusflow.app;

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
