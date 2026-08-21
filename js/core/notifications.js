/**
 * Local notifications for FocusFlow (no server / no internet).
 *
 * IDs:
 *   1001–1099  daily schedule-plan reminders
 *   1100       due-cards reminder
 *   2001       pomodoro phase end
 *   4001       ongoing status bar (persistent)
 *   5001       (reserved)
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { db } from './db.js';
import { flashcardRepository, studySessionRepository } from './repositories.js';

const CHANNEL_ID = 'focusflow_alerts';
const CHANNEL_STATUS = 'focusflow_status';

export const NotifIds = {
  dueCards: 1100,
  pomodoro: 2001,
  ongoing: 4001,
  planBase: 1001, // 1001..1049 start, 1051..1099 end
};

let initialized = false;
let permissionGranted = false;

function isNative() {
  try {
    return !!(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  } catch (e) {
    return false;
  }
}

async function ensureChannels() {
  if (!isNative()) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'یادآوری‌ها',
      description: 'مرور، برنامه روزانه و پومودورو',
      importance: 5,
      visibility: 1,
      sound: 'default',
      vibration: true,
    });
  } catch (e) { /* ignore */ }
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_STATUS,
      name: 'وضعیت مطالعه',
      description: 'اعلان دائمی پیشرفت روزانه',
      importance: 3, // default — less intrusive
      visibility: 1,
      sound: undefined,
      vibration: false,
    });
  } catch (e) { /* ignore */ }
}

export async function requestNotificationPermission() {
  if (!isNative()) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const p = await Notification.requestPermission();
      permissionGranted = p === 'granted';
      return permissionGranted;
    }
    permissionGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    return permissionGranted;
  }
  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') {
      permissionGranted = true;
      return true;
    }
    const req = await LocalNotifications.requestPermissions();
    permissionGranted = req.display === 'granted';
    return permissionGranted;
  } catch (e) {
    permissionGranted = false;
    return false;
  }
}

export async function getNotificationPermissionStatus() {
  if (!isNative()) {
    if (typeof Notification === 'undefined') return 'unavailable';
    return Notification.permission;
  }
  try {
    const s = await LocalNotifications.checkPermissions();
    return s.display;
  } catch (e) {
    return 'unavailable';
  }
}

async function masterEnabled() {
  return (await db.getSetting('notif_enabled', '1')) !== '0';
}

async function cancelIds(ids) {
  if (!isNative() || !ids.length) return;
  try {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch (e) { /* ignore */ }
}

function nextOccurrence(hour, minute) {
  const at = new Date();
  at.setSeconds(0, 0);
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= Date.now() + 3000) at.setDate(at.getDate() + 1);
  return at;
}

/** Default weekly-style schedule plans stored as JSON in settings */
export function defaultSchedulePlans() {
  return [
    {
      id: 'plan_morning',
      title: 'مرور صبحگاهی',
      startHour: 9,
      startMinute: 0,
      endHour: 10,
      endMinute: 0,
      notifyStart: true,
      notifyEnd: true,
      enabled: true,
    },
  ];
}

export async function loadSchedulePlans() {
  try {
    const raw = await db.getSetting('notif_schedule_plans', '');
    if (!raw) return defaultSchedulePlans();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (e) { /* ignore */ }
  return defaultSchedulePlans();
}

export async function saveSchedulePlans(plans) {
  await db.setSetting('notif_schedule_plans', JSON.stringify(plans || []));
  await rescheduleAllPlanNotifications();
}

/**
 * Soft floating permission prompt — modern, non-blocking.
 * Shows once (or again after 5 days if dismissed with «بعداً»).
 */
export async function maybeShowPermissionPrompt() {
  if (!isNative()) return;
  const status = await getNotificationPermissionStatus();
  if (status === 'granted') return;

  const dismissedAt = parseInt(localStorage.getItem('notif_perm_dismissed_at') || '0', 10);
  const mode = localStorage.getItem('notif_perm_dismiss_mode') || '';
  if (mode === 'never') return;
  if (mode === 'later' && Date.now() - dismissedAt < 5 * 24 * 60 * 60 * 1000) return;
  if (document.getElementById('ff-notif-perm-sheet')) return;

  const sheet = document.createElement('div');
  sheet.id = 'ff-notif-perm-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.style.cssText = `
    position: fixed; left: 12px; right: 12px; bottom: calc(88px + env(safe-area-inset-bottom, 0px));
    z-index: 9990; max-width: 420px; margin: 0 auto;
    background: color-mix(in srgb, var(--bg-card, #fff) 88%, transparent);
    backdrop-filter: blur(20px) saturate(1.2); -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border: 1px solid color-mix(in srgb, var(--border-soft, #e5e5e5) 80%, transparent);
    border-radius: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.04);
    padding: 18px 18px 16px; direction: rtl; text-align: right;
    animation: ffNotifIn 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  `;

  if (!document.getElementById('ff-notif-perm-style')) {
    const st = document.createElement('style');
    st.id = 'ff-notif-perm-style';
    st.textContent = `
      @keyframes ffNotifIn {
        from { opacity: 0; transform: translateY(18px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes ffNotifOut {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(12px); }
      }
    `;
    document.head.appendChild(st);
  }

  sheet.innerHTML = `
    <div style="display:flex; gap:12px; align-items:flex-start;">
      <div style="width:42px;height:42px;border-radius:14px;background:var(--color-primary-soft, rgba(71,85,105,0.1));
        display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <span class="material-symbols-rounded" style="font-size:24px;color:var(--color-primary,#475569);">notifications_active</span>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;font-size:15px;color:var(--text-primary,#111);margin-bottom:4px;">یادآوری‌های مطالعه</div>
        <div style="font-size:13px;line-height:1.7;color:var(--text-secondary,#666);">
          مجوز اعلان برای این برنامه فعال نیست. با فعال‌کردن آن، زمان مرور کارت‌ها، برنامه روزانه و پایان پومودورو را حتی وقتی داخل برنامه نیستید به شما یادآوری می‌کنیم.
        </div>
      </div>
    </div>
    <div style="display:flex; gap:8px; margin-top:14px; justify-content:flex-end;">
      <button type="button" data-act="later" style="
        flex:1; max-width:140px; padding:11px 14px; border:none; border-radius:14px;
        background:transparent; color:var(--text-secondary,#666); font-weight:700; font-size:13px; cursor:pointer;">
        بعداً
      </button>
      <button type="button" data-act="allow" style="
        flex:1.2; padding:11px 16px; border:none; border-radius:14px;
        background:var(--color-primary,#475569); color:#fff; font-weight:800; font-size:13px; cursor:pointer;
        box-shadow: 0 4px 14px color-mix(in srgb, var(--color-primary,#475569) 35%, transparent);">
        فعال‌سازی اعلان
      </button>
    </div>
  `;

  const close = (mode) => {
    localStorage.setItem('notif_perm_dismissed_at', String(Date.now()));
    localStorage.setItem('notif_perm_dismiss_mode', mode);
    sheet.style.animation = 'ffNotifOut 0.28s ease forwards';
    setTimeout(() => sheet.remove(), 280);
  };

  sheet.querySelector('[data-act="later"]').addEventListener('click', () => close('later'));
  sheet.querySelector('[data-act="allow"]').addEventListener('click', async () => {
    const ok = await requestNotificationPermission();
    close(ok ? 'never' : 'later');
    if (ok) {
      await rescheduleEverything();
      try {
        const { showToast } = await import('./ui.js');
        showToast('اعلان‌ها فعال شدند.', 'success');
      } catch (e) { /* ignore */ }
    }
  });

  document.body.appendChild(sheet);
}

export async function initNotifications() {
  if (initialized) return;
  initialized = true;
  if (!isNative()) return;

  await ensureChannels();
  try {
    const s = await LocalNotifications.checkPermissions();
    permissionGranted = s.display === 'granted';
  } catch (e) {
    permissionGranted = false;
  }

  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const extra = (event && event.notification && event.notification.extra) || {};
      const route = extra.route || 'home';
      try { window.location.hash = '#' + route; } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }

  if (await masterEnabled()) {
    if (permissionGranted) {
      await rescheduleEverything();
    } else {
      // Soft prompt after UI is ready
      setTimeout(() => { maybeShowPermissionPrompt().catch(() => {}); }, 1400);
    }
  }
}

export async function rescheduleEverything() {
  await rescheduleAllPlanNotifications();
  await rescheduleDueCardsReminder();
  await refreshOngoingStatusNotification();
}

/** Schedule plan start/end reminders for the next 24–48h */
export async function rescheduleAllPlanNotifications() {
  const ids = [];
  for (let i = 0; i < 50; i++) ids.push(NotifIds.planBase + i);
  await cancelIds(ids);

  if (!(await masterEnabled())) return false;
  if ((await db.getSetting('notif_schedule_enabled', '1')) === '0') return false;
  if (!isNative()) return false;
  if (!(permissionGranted || (await requestNotificationPermission()))) return false;
  await ensureChannels();

  const plans = await loadSchedulePlans();
  const notifications = [];
  let slot = 0;

  for (const plan of plans) {
    if (!plan || plan.enabled === false) continue;
    const title = plan.title || 'یادآوری';
    if (plan.notifyStart !== false) {
      const at = nextOccurrence(
        Number(plan.startHour) || 0,
        Number(plan.startMinute) || 0
      );
      notifications.push({
        id: NotifIds.planBase + slot,
        title: 'زمان شروع: ' + title,
        body: `الان زمان «${title}» است. شروع کنید.`,
        channelId: CHANNEL_ID,
        schedule: { at, allowWhileIdle: true },
        extra: { route: 'home', planId: plan.id, kind: 'start' },
      });
      slot += 1;
    }
    if (plan.notifyEnd) {
      const at = nextOccurrence(
        Number(plan.endHour) || 0,
        Number(plan.endMinute) || 0
      );
      notifications.push({
        id: NotifIds.planBase + slot,
        title: 'پایان بازه: ' + title,
        body: `بازه «${title}» به پایان رسید. اگر انجام نداده‌اید، الان فرصت خوبی است.`,
        channelId: CHANNEL_ID,
        schedule: { at, allowWhileIdle: true },
        extra: { route: 'home', planId: plan.id, kind: 'end' },
      });
      slot += 1;
    }
    if (slot >= 40) break;
  }

  if (!notifications.length) return false;
  try {
    await LocalNotifications.schedule({ notifications });
    return true;
  } catch (e) {
    console.warn('plan schedule failed', e);
    return false;
  }
}

export async function rescheduleDueCardsReminder() {
  await cancelIds([NotifIds.dueCards]);
  if (!(await masterEnabled())) return false;
  if ((await db.getSetting('notif_due_enabled', '1')) === '0') return false;
  if (!isNative()) return false;
  if (!(permissionGranted || (await requestNotificationPermission()))) return false;
  await ensureChannels();

  let cards = [];
  try { cards = await flashcardRepository.getAll(); } catch (e) { return false; }

  const now = Date.now();
  let nextTs = null;
  let dueCountNow = 0;
  for (const c of cards) {
    if (c.deleted || !c.nextReview) continue;
    const t = new Date(c.nextReview).getTime();
    if (!Number.isFinite(t)) continue;
    if (t <= now) dueCountNow += 1;
    else if (nextTs === null || t < nextTs) nextTs = t;
  }

  if (dueCountNow > 0) {
    const lastNudge = parseInt(localStorage.getItem('notif_last_due_nudge') || '0', 10);
    if (now - lastNudge > 3 * 60 * 60 * 1000) {
      localStorage.setItem('notif_last_due_nudge', String(now));
      try {
        await LocalNotifications.schedule({
          notifications: [{
            id: NotifIds.dueCards,
            title: 'کارت‌های آمادهٔ مرور',
            body: `${dueCountNow.toLocaleString('fa-IR')} کارت منتظر شماست.`,
            channelId: CHANNEL_ID,
            schedule: { at: new Date(now + 45 * 1000), allowWhileIdle: true },
            extra: { route: 'library' },
          }],
        });
        return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  if (!nextTs) return false;
  if (nextTs - now > 7 * 24 * 60 * 60 * 1000) nextTs = now + 7 * 24 * 60 * 60 * 1000;
  if (nextTs < now + 120000) nextTs = now + 120000;

  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: NotifIds.dueCards,
        title: 'زمان مرور رسیده',
        body: 'فلش‌کارت‌های شما آمادهٔ مرور هستند.',
        channelId: CHANNEL_ID,
        schedule: { at: new Date(nextTs), allowWhileIdle: true },
        extra: { route: 'library' },
      }],
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function schedulePomodoroEndNotification(phaseEndsAt, mode) {
  await cancelIds([NotifIds.pomodoro]);
  if (!(await masterEnabled())) return false;
  if ((await db.getSetting('notif_pomodoro_enabled', '1')) === '0') return false;
  if (!isNative() || !phaseEndsAt || phaseEndsAt <= Date.now() + 2000) return false;
  if (!(permissionGranted || (await requestNotificationPermission()))) return false;
  await ensureChannels();

  let title = 'پومودورو';
  let body = 'یک فاز به پایان رسید.';
  if (mode === 'focus') {
    title = 'تمرکز تمام شد';
    body = 'وقت استراحت است.';
  } else if (mode === 'short') {
    title = 'استراحت کوتاه تمام شد';
    body = 'زمان بازگشت به تمرکز است.';
  } else if (mode === 'long') {
    title = 'استراحت بلند تمام شد';
    body = 'آمادهٔ دورهٔ تمرکز جدید هستید؟';
  }

  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: NotifIds.pomodoro,
        title,
        body,
        channelId: CHANNEL_ID,
        schedule: { at: new Date(phaseEndsAt), allowWhileIdle: true },
        extra: { route: 'pomodoro' },
      }],
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function cancelPomodoroNotification() {
  await cancelIds([NotifIds.pomodoro]);
}

/**
 * Persistent status notification in the system shade.
 * Shows daily goal progress + due card count.
 */
export async function refreshOngoingStatusNotification() {
  await cancelIds([NotifIds.ongoing]);

  if (!(await masterEnabled())) return false;
  if ((await db.getSetting('notif_ongoing_enabled', '0')) === '0') return false;
  if (!isNative()) return false;
  if (!(permissionGranted || (await requestNotificationPermission()))) return false;
  await ensureChannels();

  const showGoal = (await db.getSetting('notif_ongoing_show_goal', '1')) !== '0';
  const showDue = (await db.getSetting('notif_ongoing_show_due', '1')) !== '0';
  const showStreak = (await db.getSetting('notif_ongoing_show_streak', '0')) !== '0';

  let dueCount = 0;
  let reviewedToday = 0;
  let goal = 20;
  let streak = 0;

  try {
    const cards = await flashcardRepository.getAll();
    const now = Date.now();
    for (const c of cards) {
      if (c.deleted) continue;
      if (c.nextReview && new Date(c.nextReview).getTime() <= now) dueCount += 1;
    }
  } catch (e) { /* ignore */ }

  try {
    goal = parseInt(await db.getSetting('daily_study_goal', '20'), 10) || 20;
    const sessions = await studySessionRepository.getAll();
    const _td = new Date(); const today = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,'0')}-${String(_td.getDate()).padStart(2,'0')}`;
    for (const s of sessions) {
      if (!s) continue;
      const d = (s.date || s.endedAt || s.startedAt || '').toString().slice(0, 10);
      if (d === today) reviewedToday += Number(s.cardsReviewed || s.reviewed || 0) || 0;
    }
  } catch (e) { /* ignore */ }

  if (showStreak) {
    try {
      const { calculateStreak } = await import('./study.js');
      const streakInfo = await calculateStreak();
      if (streakInfo && typeof streakInfo === 'object') {
        streak = Number(streakInfo.currentStreak) || 0;
      } else {
        streak = Number(streakInfo) || 0;
      }
    } catch (e) { /* ignore */ }
  }

  const parts = [];
  if (showGoal) parts.push(`هدف روزانه: ${reviewedToday.toLocaleString('fa-IR')} / ${goal.toLocaleString('fa-IR')}`);
  if (showDue) parts.push(`آمادهٔ مرور: ${dueCount.toLocaleString('fa-IR')}`);
  if (showStreak) parts.push(`روز پیاپی: ${streak.toLocaleString('fa-IR')}`);
  if (!parts.length) parts.push('FocusFlow آماده است');

  const title = (await db.getSetting('notif_ongoing_title', 'وضعیت مطالعه FocusFlow')) || 'وضعیت مطالعه FocusFlow';
  const body = parts.join(' · ');

  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: NotifIds.ongoing,
        title,
        body,
        channelId: CHANNEL_STATUS,
        schedule: { at: new Date(Date.now() + 400) },
        ongoing: true,
        autoCancel: false,
        extra: { route: 'home' },
      }],
    });
    return true;
  } catch (e) {
    // Fallback without ongoing flag
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: NotifIds.ongoing,
          title,
          body,
          channelId: CHANNEL_STATUS,
          schedule: { at: new Date(Date.now() + 400) },
          extra: { route: 'home' },
        }],
      });
      return true;
    } catch (e2) {
      console.warn('ongoing notif failed', e2);
      return false;
    }
  }
}

export async function cancelAllFocusNotifications() {
  const ids = [NotifIds.dueCards, NotifIds.pomodoro, NotifIds.ongoing];
  for (let i = 0; i < 50; i++) ids.push(NotifIds.planBase + i);
  await cancelIds(ids);
}

// Back-compat aliases used by older call sites
export async function rescheduleDailyReminder() {
  return rescheduleAllPlanNotifications();
}

export async function notifyNow() {
  return false; // test button removed
}
