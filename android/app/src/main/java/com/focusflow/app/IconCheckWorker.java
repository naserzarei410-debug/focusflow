package com.focusflow.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Runs roughly once a day in the background (scheduled from
 * MainActivity.onCreate) and re-evaluates which launcher icon should be
 * shown, based on the phone's current system dark/light theme. This is
 * what lets the icon catch up even if the app hasn't been opened since
 * the system theme changed.
 *
 * Note: like any Android background job, this can still be delayed or
 * skipped by aggressive battery optimization on some devices (MIUI,
 * EMUI, etc.) or if the phone stays off/Doze for a long time. The checks
 * in MainActivity (on launch, and live via onConfigurationChanged) are
 * the reliable fallback for those cases.
 */
public class IconCheckWorker extends Worker {
    public IconCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        IconStateManager.updateIconState(getApplicationContext());
        return Result.success();
    }
}
