// Offline review reminders.
//
// Uses @capacitor/local-notifications, which schedules notifications through
// the OS (AlarmManager on Android) — no server, no network, and no push
// service involved, so it keeps working with the phone fully offline and
// even if the app has been closed/killed.
//
// On the web (running in a normal browser tab, e.g. during `npm run dev`)
// the Capacitor plugin isn't available, so every function here becomes a
// harmless no-op instead of throwing.

import { flashcardRepository } from './repositories.js';

const REVIEW_REMINDER_ID = 100001;

let LocalNotifications = null;
let Capacitor = null;
let loadAttempted = false;

// Capacitor plugins are only real inside the native app shell. We load them
// lazily and swallow the failure on the web so the rest of the app (and
// `npm run dev`) is unaffected.
async function loadPlugin() {
  if (loadAttempted) return LocalNotifications;
  loadAttempted = true;
  try {
    const core = await import('@capacitor/core');
    Capacitor = core.Capacitor;
    if (Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
      const mod = await import('@capacitor/local-notifications');
      LocalNotifications = mod.LocalNotifications;
    }
  } catch (e) {
    // Plugin not installed / not a native build — reminders are simply unavailable.
    LocalNotifications = null;
  }
  return LocalNotifications;
}

export const notifications = {
  /** Whether native scheduled notifications are actually usable right now. */
  async isSupported() {
    return !!(await loadPlugin());
  },

  /** Ask the user for notification permission. Safe to call multiple times. */
  async requestPermission() {
    const plugin = await loadPlugin();
    if (!plugin) return false;
    try {
      const status = await plugin.checkPermissions();
      if (status.display === 'granted') return true;
      const req = await plugin.requestPermissions();
      return req.display === 'granted';
    } catch (e) {
      console.error('Notification permission request failed', e);
      return false;
    }
  },

  /**
   * Looks at every non-deleted flashcard, finds the earliest upcoming
   * `nextReview` time, and (re)schedules a single local notification for
   * that moment: "زمان مرور فلش‌کارت‌ها رسیده است". Any previously scheduled
   * reminder is replaced, so this is always safe to call again after a
   * review session, or after cards are added/edited/deleted.
   */
  async scheduleNextReviewReminder() {
    const plugin = await loadPlugin();
    if (!plugin) return;

    try {
      const granted = await this.requestPermission();
      if (!granted) return;

      // Always clear the previous reminder first so we never end up with
      // stale or duplicate notifications piling up.
      await plugin.cancel({ notifications: [{ id: REVIEW_REMINDER_ID }] });

      const cards = await flashcardRepository.getAll();
      const now = Date.now();
      let earliest = null;

      for (const card of cards) {
        if (card.deleted) continue;
        if (!card.nextReview) continue;
        const t = new Date(card.nextReview).getTime();
        if (isNaN(t)) continue;
        if (earliest === null || t < earliest) earliest = t;
      }

      if (earliest === null) return; // no cards at all yet

      // Notify at the due moment, or in 5 seconds if it's already due (so
      // opening the app after a bunch of cards became due doesn't schedule
      // something in the past — the plugin ignores past schedule times).
      const fireAt = earliest > now ? earliest : now + 5000;

      await plugin.schedule({
        notifications: [
          {
            id: REVIEW_REMINDER_ID,
            title: 'وقت مرور رسیده',
            body: 'زمان مرور فلش‌کارت‌های شما فرا رسیده است.',
            schedule: { at: new Date(fireAt), allowWhileIdle: true },
          },
        ],
      });
    } catch (e) {
      console.error('Failed to schedule review reminder', e);
    }
  },

  /** Cancels the pending review reminder, if any (e.g. when all cards are deleted). */
  async cancelReviewReminder() {
    const plugin = await loadPlugin();
    if (!plugin) return;
    try {
      await plugin.cancel({ notifications: [{ id: REVIEW_REMINDER_ID }] });
    } catch (e) {
      console.error('Failed to cancel review reminder', e);
    }
  },
};
