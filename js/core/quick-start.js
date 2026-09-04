import { registerPlugin, Capacitor } from '@capacitor/core';
import { router } from './router.js';
import { setNextSessionLimit } from '../features/study-session.js';

const QuickStartNative = registerPlugin('QuickStart');

/**
 * "2-minute mode" home screen widget support. The widget (native Android,
 * see android/.../TwoMinuteWidgetProvider.java) launches the app with a
 * native flag set; this checks/clears that flag (via QuickStartPlugin.java)
 * and routes straight into a 5-card study session.
 *
 * Call once during bootstrap, BEFORE router.initRouter(), so a
 * widget-triggered cold start goes straight to the study session instead
 * of flashing the home page first. Returns true if the launch actually
 * came from the widget.
 */
export async function consumeQuickStartOnLaunch() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await QuickStartNative.consumePending();
    if (result && result.pending) {
      setNextSessionLimit(5);
      return true;
    }
  } catch (err) {
    // Plugin not present on this build (e.g. older APK) — ignore.
  }
  return false;
}

/**
 * Call once during bootstrap to also catch the widget being tapped again
 * while the app is already open in the background. MainActivity's
 * singleTask launch mode means that case does NOT trigger a fresh cold
 * start, so consumeQuickStartOnLaunch() above alone would miss it —
 * MainActivity instead nudges the already-loaded page with this event.
 */
export function listenForQuickStartNudges() {
  if (!Capacitor.isNativePlatform()) return;
  window.addEventListener('quick-start-pending', async () => {
    try {
      const result = await QuickStartNative.consumePending();
      if (result && result.pending) {
        setNextSessionLimit(5);
        router.navigate('study');
      }
    } catch (err) {
      // ignore
    }
  });
}
