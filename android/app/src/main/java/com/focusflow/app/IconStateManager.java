package com.focusflow.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;

/**
 * Switches the launcher icon between a light-background and a
 * dark-background variant to match the PHONE'S current system dark/light
 * theme setting — this has nothing to do with anything the user does
 * inside the app (no streaks, no activity tracking). It uses the same
 * activity-alias + PackageManager technique apps like Duolingo use for
 * their streak icon, just driven by Configuration.UI_MODE_NIGHT_* instead.
 */
public class IconStateManager {

    private static final String ALIAS_LIGHT = "com.focusflow.app.MainActivityLight";
    private static final String ALIAS_DARK = "com.focusflow.app.MainActivityDark";

    public static void updateIconState(Context context) {
        int nightModeFlags = context.getResources().getConfiguration().uiMode
            & Configuration.UI_MODE_NIGHT_MASK;
        boolean isSystemDark = nightModeFlags == Configuration.UI_MODE_NIGHT_YES;

        setAliasEnabled(context, ALIAS_LIGHT, !isSystemDark);
        setAliasEnabled(context, ALIAS_DARK, isSystemDark);
    }

    private static void setAliasEnabled(Context context, String aliasClass, boolean enabled) {
        PackageManager pm = context.getPackageManager();
        ComponentName component = new ComponentName(context.getPackageName(), aliasClass);
        int desired = enabled
            ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        if (pm.getComponentEnabledSetting(component) != desired) {
            pm.setComponentEnabledSetting(component, desired, PackageManager.DONT_KILL_APP);
        }
    }
}
