package com.focusflow.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS-facing bridge for the launcher-icon switching feature. See
 * js/core/icon-switcher.js for the JS side and IconStateManager for the
 * actual decision logic (based on the phone's system dark/light theme).
 */
@CapacitorPlugin(name = "IconSwitcher")
public class IconSwitcherPlugin extends Plugin {

    @PluginMethod
    public void refresh(PluginCall call) {
        IconStateManager.updateIconState(getContext());
        call.resolve();
    }
}
