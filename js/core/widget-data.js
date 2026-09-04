/**
 * Push daily status numbers to the Android home-screen status widget.
 * No-op on web / when the native plugin is missing.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

const WidgetDataNative = registerPlugin('WidgetData');

function toFaDigits(n) {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

/**
 * @param {{ reviewedToday?: number, goal?: number, dueCount?: number, streak?: number }} stats
 */
export async function pushStatusWidget(stats = {}) {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const reviewed = Number(stats.reviewedToday) || 0;
    const goal = Number(stats.goal) || 20;
    const due = Number(stats.dueCount) || 0;
    const streak = Number(stats.streak) || 0;
    await WidgetDataNative.updateStatus({
      goalText: `${toFaDigits(reviewed)} / ${toFaDigits(goal)}`,
      dueText: toFaDigits(due),
      streakText: toFaDigits(streak),
    });
    return true;
  } catch (e) {
    return false;
  }
}
