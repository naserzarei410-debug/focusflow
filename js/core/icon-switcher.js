
import { registerPlugin, Capacitor } from '@capacitor/core';

const IconSwitcherNative = registerPlugin('IconSwitcher');

/** Re-checks/repaints the launcher icon against the current system theme. */
export async function refreshIconState() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await IconSwitcherNative.refresh();
  } catch (err) {
  }
}
