import { initInteractiveInterval } from './interval-plot.js';
import * as d3 from 'd3';
import * as IW from './interactive/index.js';

function iwWidgetOpts() {
  return {
    saveFile: (f) => import('../core/native-file.js').then((m) => m.saveOrShareFile(f)),
    // renderMath is filled later once renderMarkdownAndMath exists in this scope;
    // engines only need it for optional labels.
    renderMath: null,
  };
}

function fixJsonEscape(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      if (i + 1 < str.length && str[i+1] === '\\') {
        out += '\\\\';
        i++;
      } else if (i + 1 < str.length && (str[i+1] === '"' || str[i+1] === 'n' || str[i+1] === 'r' || str[i+1] === 't')) {
        out += '\\' + str[i+1];
        i++;
      } else {
        out += '\\\\';
      }
    } else {
      out += str[i];
    }
  }
  return out;
}

function extractJsonArray(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}

  const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
  }

  let cleanText = text.replace(/\`\`\`json/gi, '').replace(/\`\`\`/gi, '').trim();
  try {
    const parsed = JSON.parse(cleanText);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}

  try {
    const parsed = JSON.parse(fixJsonEscape(cleanText));
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}

  throw new Error('فرمت پاسخ هوش مصنوعی نامعتبر بود. لطفاً مجدداً تلاش کنید.');
}


import { speak } from '../core/tts.js';
import {
  requestNotificationPermission,
  getNotificationPermissionStatus,
  rescheduleDailyReminder,
  rescheduleDueCardsReminder,
  rescheduleEverything,
  cancelAllFocusNotifications,
  loadSchedulePlans,
  saveSchedulePlans,
  refreshOngoingStatusNotification,
  maybeShowPermissionPrompt,
} from '../core/notifications.js';
import { theme as themeApi, CUSTOM_PALETTES, THEME_GROUPS } from '../core/theme.js';

import {
  createButton, createCard, openDialog, openBottomSheet, showToast,
  createTextField, createTextArea, createSearchBar, createSkeletonList,
  createProgressBar, createProgressRing, createLoadingInline, createTypingIndicator,
  createErrorState, createEmptyState, renderFractionsInText, renderRichText, createSelectField,
  renderMathSegment, escapeHtml, escapeAttr,
} from '../core/ui.js';
import { db } from '../core/db.js';
import { getStudyQueues, calculateStreak, getMostProductiveHour } from '../core/study.js';
import { pushStatusWidget } from '../core/widget-data.js';
import { categoryRepository, flashcardRepository, studySessionRepository, reviewHistoryRepository, aiConversationRepository } from '../core/repositories.js';
import { router } from '../core/router.js';
import { createAiConversationModel, createFlashcardModel, createCategoryModel } from '../core/models.js';

let aiDraftText = '';

let generatingConversationId = null;
let generatingAbortController = null;
let generatingListeners = new Set();

export async function renderHome(container) {
  container.innerHTML = '';
  const skeleton = createSkeletonList(3);
  container.appendChild(skeleton);

  const categories = await categoryRepository.getAll();
  const allCards = await flashcardRepository.getAll();
  const activeCardsCount = allCards.filter(c => !c.deleted).length;
  const queues = await getStudyQueues(); // Global queues
  const streak = await calculateStreak();

  const _hd = new Date(); const todayStr = `${_hd.getFullYear()}-${String(_hd.getMonth()+1).padStart(2,'0')}-${String(_hd.getDate()).padStart(2,'0')}`;
  const sessions = await studySessionRepository.getAll();
  const todaySessions = sessions.filter(s => s.date === todayStr);
  const reviewedToday = todaySessions.reduce((acc, curr) => acc + (curr.cardsReviewed || 0), 0);

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-3);width:100%;max-width:var(--max-content-w);margin:0 auto;';
  container.appendChild(wrap);

  // ── Streak hero + 7-day strip (modern) ─────────────────────────────
  {
    const hasStreak = streak.currentStreak > 0;
    const weekStrip = Array.isArray(streak.weekStrip) ? streak.weekStrip : [];

    if (hasStreak) {
      const hero = document.createElement('div');
      hero.className = 'ds-card';
      hero.style.cssText = `
        position: relative;
        overflow: hidden;
        padding: var(--space-4);
        border-radius: var(--radius-card);
        background:
          linear-gradient(145deg,
            color-mix(in srgb, var(--color-accent) 14%, var(--bg-card)) 0%,
            var(--bg-card) 55%,
            color-mix(in srgb, var(--color-warning) 8%, var(--bg-card)) 100%);
        border: 1px solid color-mix(in srgb, var(--color-accent) 28%, var(--border-soft));
        box-shadow: var(--shadow-card);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      `;

      // Soft glow orb (decorative)
      hero.innerHTML = `
        <div aria-hidden="true" style="
          position:absolute; inset-inline-start:-40px; top:-48px;
          width:140px; height:140px; border-radius:50%;
          background: radial-gradient(circle, color-mix(in srgb, var(--color-accent) 35%, transparent) 0%, transparent 70%);
          pointer-events:none;
        "></div>
      `;

      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px; position:relative; z-index:1;';

      const leftCol = document.createElement('div');
      leftCol.style.cssText = 'display:flex; align-items:center; gap:14px; min-width:0;';

      const flameWrap = document.createElement('div');
      flameWrap.style.cssText = `
        width:56px; height:56px; border-radius:18px; flex-shrink:0;
        display:flex; align-items:center; justify-content:center;
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
        animation: flamePulse 2.4s infinite ease-in-out;
      `;
      flameWrap.innerHTML = `<span class="material-symbols-rounded" style="font-size:30px; color:var(--color-accent);">local_fire_department</span>`;

      const textCol = document.createElement('div');
      textCol.style.cssText = 'display:flex; flex-direction:column; gap:2px; text-align:right; min-width:0;';
      textCol.innerHTML = `
        <span style="font-size:11px; font-weight:700; letter-spacing:0.02em; color:var(--text-tertiary);">روند مطالعه متوالی</span>
        <span style="font-size:var(--text-title); font-weight:900; line-height:1.1; color:var(--color-accent); font-variant-numeric:tabular-nums;">
          ${streak.currentStreak.toLocaleString('fa-IR')}
          <span style="font-size:var(--text-caption); font-weight:700; color:var(--text-secondary); margin-right:4px;">روز</span>
        </span>
      `;

      leftCol.append(flameWrap, textCol);

      const rightCol = document.createElement('div');
      rightCol.style.cssText = 'display:flex; flex-direction:column; align-items:flex-end; gap:6px; flex-shrink:0;';
      if (streak.longestStreak > 0) {
        rightCol.innerHTML = `
          <div style="
            font-size:11px; font-weight:700; color:var(--text-secondary);
            background: var(--bg-sunken); border:1px solid var(--border-soft);
            padding:5px 10px; border-radius:var(--radius-pill);
            display:flex; align-items:center; gap:4px;
          ">
            <span class="material-symbols-rounded" style="font-size:14px; color:var(--color-accent);">emoji_events</span>
            بهترین: ${streak.longestStreak.toLocaleString('fa-IR')}
          </div>
        `;
      }
      if (streak.usedGraceInCurrent) {
        const graceBadge = document.createElement('div');
        graceBadge.style.cssText = `
          font-size:11px; font-weight:700; color:var(--color-primary);
          background: var(--color-primary-soft); border:1px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
          padding:4px 10px; border-radius:var(--radius-pill);
          display:flex; align-items:center; gap:4px;
        `;
        graceBadge.innerHTML = '❄️ روز آزاد';
        rightCol.appendChild(graceBadge);
      }

      topRow.append(leftCol, rightCol);
      hero.appendChild(topRow);

      if (streak.usedGraceInCurrent) {
        const graceLine = document.createElement('div');
        graceLine.style.cssText = 'font-size:11px; color:var(--text-secondary); text-align:right; line-height:1.5; position:relative; z-index:1;';
        graceLine.textContent = 'این استریک با ۱ روز آزاد ادامه دارد — آمار روزهای واقعی تغییر نکرده است.';
        hero.appendChild(graceLine);
      }

      wrap.appendChild(hero);
    }

    // Week strip — always useful (motivates even at 0)
    if (weekStrip.length) {
      const stripCard = document.createElement('div');
      stripCard.className = 'ds-card';
      stripCard.style.cssText = `
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-card);
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        box-shadow: var(--shadow-sm);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      `;

      const stripHeader = document.createElement('div');
      stripHeader.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
      stripHeader.innerHTML = `
        <span style="font-size:13px; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
          <span class="material-symbols-rounded" style="font-size:18px; color:var(--color-accent);">calendar_month</span>
          ۷ روز اخیر
        </span>
        <span style="font-size:11px; font-weight:600; color:var(--text-tertiary);">
          ${hasStreak ? `${streak.currentStreak.toLocaleString('fa-IR')} روز متوالی` : 'شروع یک روند جدید'}
        </span>
      `;
      stripCard.appendChild(stripHeader);

      const daysRow = document.createElement('div');
      daysRow.style.cssText = `
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 6px;
        direction: ltr;
      `;

      weekStrip.forEach((day) => {
        const cell = document.createElement('div');
        cell.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:6px;';

        const dot = document.createElement('div');
        const size = day.isToday ? '34px' : '30px';
        let bg = 'var(--bg-sunken)';
        let border = '1px solid var(--border-soft)';
        let color = 'var(--text-tertiary)';
        let inner = '';

        if (day.studied) {
          bg = 'var(--color-accent)';
          border = '1px solid color-mix(in srgb, var(--color-accent) 80%, #000)';
          color = '#fff';
          inner = '<span class="material-symbols-rounded" style="font-size:16px;">check</span>';
        } else if (day.grace) {
          bg = 'color-mix(in srgb, var(--color-primary) 16%, var(--bg-card))';
          border = '1px dashed color-mix(in srgb, var(--color-primary) 45%, transparent)';
          color = 'var(--color-primary)';
          inner = '❄️';
        }

        if (day.isToday && !day.studied && !day.grace) {
          border = '2px solid var(--color-accent)';
          bg = 'color-mix(in srgb, var(--color-accent) 10%, var(--bg-card))';
        }

        dot.style.cssText = `
          width:${size}; height:${size}; border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          background:${bg}; border:${border}; color:${color};
          font-size:13px; font-weight:800;
          box-shadow: ${day.studied ? '0 4px 12px color-mix(in srgb, var(--color-accent) 35%, transparent)' : 'none'};
          transition: transform 0.15s var(--ease-standard);
        `;
        if (day.isToday) {
          dot.style.boxShadow = day.studied
            ? '0 0 0 3px color-mix(in srgb, var(--color-accent) 25%, transparent), 0 4px 12px color-mix(in srgb, var(--color-accent) 35%, transparent)'
            : '0 0 0 3px color-mix(in srgb, var(--color-accent) 20%, transparent)';
        }
        dot.innerHTML = inner || (day.isToday ? '·' : '');
        if (!inner && day.isToday) {
          dot.textContent = '';
        }

        const lbl = document.createElement('span');
        lbl.style.cssText = `
          font-size:11px; font-weight:${day.isToday ? '800' : '600'};
          color:${day.isToday ? 'var(--color-accent)' : 'var(--text-tertiary)'};
        `;
        lbl.textContent = day.label;

        cell.append(dot, lbl);
        daysRow.appendChild(cell);
      });

      stripCard.appendChild(daysRow);

      // Legend
      const legend = document.createElement('div');
      legend.style.cssText = 'display:flex; flex-wrap:wrap; gap:10px 14px; justify-content:center; font-size:10px; color:var(--text-tertiary); font-weight:600;';
      legend.innerHTML = `
        <span style="display:flex; align-items:center; gap:5px;">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--color-accent);display:inline-block;"></span>
          مطالعه شده
        </span>
        <span style="display:flex; align-items:center; gap:5px;">
          <span style="width:10px;height:10px;border-radius:50%;background:color-mix(in srgb, var(--color-primary) 20%, var(--bg-card));border:1px dashed color-mix(in srgb, var(--color-primary) 50%, transparent);display:inline-block;"></span>
          روز آزاد
        </span>
        <span style="display:flex; align-items:center; gap:5px;">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--bg-sunken);border:1px solid var(--border-soft);display:inline-block;"></span>
          بدون مطالعه
        </span>
      `;
      stripCard.appendChild(legend);

      wrap.appendChild(stripCard);
    }
  }

  // ── Today's snapshot (in-app card — not a launcher widget clone) ────
  {
    const dailyGoalStr = await db.getSetting('daily_study_goal', '20');
    const dailyGoalVal = parseInt(dailyGoalStr, 10) || 20;
    const dueNow = (queues.due?.length || 0) + (queues.learning?.length || 0);
    const goalPct = dailyGoalVal > 0
      ? Math.min(100, Math.round((reviewedToday / dailyGoalVal) * 100))
      : 0;
    const currentStreakVal = streak.currentStreak || 0;

    const statusCard = document.createElement('div');
    statusCard.className = 'ds-card';
    statusCard.style.cssText = `
      background: var(--bg-card);
      border: 1px solid var(--border-soft);
      padding: var(--space-4);
      border-radius: var(--radius-card);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      box-shadow: var(--shadow-sm);
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
    const titleEl = document.createElement('span');
    titleEl.style.cssText = 'font-family:var(--font-heading); font-size:18px; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:var(--space-1);';
    titleEl.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px; color:var(--color-primary);">today</span> خلاصهٔ امروز';
    header.appendChild(titleEl);
    statusCard.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'display:flex; align-items:stretch; gap:var(--space-3);';

    const featured = document.createElement('div');
    featured.style.cssText = `
      flex: 0 0 104px;
      background: var(--bg-sunken);
      border-radius: 16px;
      padding: var(--space-3) var(--space-2);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      text-align: center;
    `;
    featured.innerHTML = `
      <span class="material-symbols-rounded" style="font-size:20px; color:var(--color-primary);">style</span>
      <span style="font-size:var(--text-title); font-weight:800; color:var(--text-primary); line-height:1; font-variant-numeric:tabular-nums;">${dueNow.toLocaleString('fa-IR')}</span>
      <span style="font-size:11px; font-weight:600; color:var(--text-secondary); line-height:1.3;">کارت آماده</span>
    `;

    const side = document.createElement('div');
    side.style.cssText = 'flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; gap:14px;';

    const goalBlock = document.createElement('div');
    goalBlock.style.cssText = 'display:flex; flex-direction:column; gap:7px;';
    goalBlock.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-primary);">هدف روزانه</span>
        <span style="font-size:13px; font-weight:600; color:var(--text-secondary); font-variant-numeric:tabular-nums;">${reviewedToday.toLocaleString('fa-IR')} از ${dailyGoalVal.toLocaleString('fa-IR')}</span>
      </div>
      <div style="height:6px; border-radius:var(--radius-pill); background:var(--bg-sunken); overflow:hidden;">
        <div style="height:100%; width:${goalPct}%; background:var(--color-primary); border-radius:var(--radius-pill);"></div>
      </div>
    `;

    const streakBlock = document.createElement('div');
    streakBlock.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:10px; border-top:1px solid var(--border-soft);';
    const streakMeta = document.createElement('div');
    streakMeta.style.cssText = 'display:flex; flex-direction:column; gap:2px; text-align:right;';
    const streakLabel = document.createElement('div');
    streakLabel.style.cssText = 'display:flex; align-items:center; gap:6px;';
    streakLabel.innerHTML = `
      <span class="material-symbols-rounded" style="font-size:18px; color:var(--color-accent);">local_fire_department</span>
      <span style="font-size:13px; font-weight:700; color:var(--text-primary);">روز پیاپی</span>
    `;
    streakMeta.appendChild(streakLabel);
    if (streak.usedGraceInCurrent) {
      const graceNote = document.createElement('span');
      graceNote.style.cssText = 'font-size:11px; color:var(--text-tertiary); padding-right:24px;';
      graceNote.textContent = 'با یک روز آزاد ادامه دارد';
      streakMeta.appendChild(graceNote);
    }
    const streakVal = document.createElement('span');
    streakVal.style.cssText = 'font-size:18px; font-weight:800; color:var(--text-primary); font-variant-numeric:tabular-nums;';
    streakVal.textContent = currentStreakVal.toLocaleString('fa-IR');
    streakBlock.append(streakMeta, streakVal);

    side.append(goalBlock, streakBlock);
    body.append(featured, side);
    statusCard.appendChild(body);
    wrap.appendChild(statusCard);

    // Keep Android home-screen status widget in sync with the same numbers.
    pushStatusWidget({
      reviewedToday,
      goal: dailyGoalVal,
      dueCount: dueNow,
      streak: currentStreakVal,
    }).catch(() => {});
  }

  {
    const pomodoroCard = document.createElement('div');
    pomodoroCard.className = 'ds-card hover-lift';
    pomodoroCard.style.cssText = 'padding:var(--space-3); display:flex; justify-content:space-between; align-items:center; cursor:pointer; gap:var(--space-2);';
    pomodoroCard.addEventListener('click', () => router.navigate('pomodoro'));

    const leftSide = document.createElement('div');
    leftSide.style.cssText = 'display:flex; align-items:center; gap:var(--space-3); text-align:right;';

    const iconBox = document.createElement('div');
    iconBox.style.cssText = 'width:44px; height:44px; border-radius:12px; background:var(--color-secondary-soft); color:var(--color-secondary); display:flex; align-items:center; justify-content:center;';
    iconBox.innerHTML = '<span class="material-symbols-rounded">schedule</span>';

    const infoBox = document.createElement('div');
    infoBox.style.cssText = 'display:flex; flex-direction:column; gap:2px;';

    const title = document.createElement('span');
    title.style.cssText = 'font-weight:700; color:var(--text-primary); font-size:var(--text-body);';
    title.textContent = 'تایمر پومودورو';

    const sub = document.createElement('span');
    sub.style.cssText = 'font-size:var(--text-caption); color:var(--text-tertiary);';
    sub.textContent = 'تمرکز عمیق';

    infoBox.append(title, sub);
    leftSide.append(iconBox, infoBox);

    const chevron = document.createElement('span');
    chevron.className = 'material-symbols-rounded';
    chevron.style.color = 'var(--text-tertiary)';
    chevron.textContent = 'chevron_left';

    pomodoroCard.append(leftSide, chevron);
    wrap.appendChild(pomodoroCard);
  }

  const totalDue = queues.due.length + queues.learning.length;
  const totalNew = queues.new.length;

  if (navigator.setAppBadge) {
    if (totalDue > 0) {
      navigator.setAppBadge(totalDue).catch(() => {});
    } else {
      navigator.clearAppBadge().catch(() => {});
    }
  }

  if (totalDue > 0 || totalNew > 0) {
    const mainActionRow = document.createElement('div');
    mainActionRow.className = 'ds-card';
    mainActionRow.style.cssText = `
      position: relative;
      background: var(--bg-card);
      border: 1.5px solid var(--border-soft);
      border-radius: var(--radius-card);
      padding: var(--space-4) var(--space-5);
      display: flex;
      flex-flow: row-reverse wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-5);
      box-shadow: var(--shadow-sm);
    `;

    const infoCol = document.createElement('div');
    infoCol.style.cssText = `
      flex: 1.2;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      min-width: 260px;
      text-align: right;
    `;

    const badge = document.createElement('div');
    badge.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 800;
      background: var(--color-primary-soft);
      color: var(--color-primary);
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      width: max-content;
    `;
    badge.innerHTML = '<span class="material-symbols-rounded" style="font-size: 12px;">auto_awesome</span>الگوریتم هوشمند FSRS';

    const title = document.createElement('h2');
    title.style.cssText = `
      font-size: 16px;
      font-weight: 800;
      color: var(--text-primary);
      margin: 0;
    `;
    title.textContent = 'برنامه مرور امروز شما';

    const description = document.createElement('p');
    description.style.cssText = `
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      line-height: var(--lh-normal);
      margin: 0;
    `;
    description.textContent = 'زمان مرور فرا رسیده است. فلش‌کارت‌های خود را مطالعه کنید.';

    const statsRow = document.createElement('div');
    statsRow.style.cssText = `
      display: flex;
      gap: var(--space-3);
      margin-top: 4px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    `;

    const makeStatItem = (value, label, color, icon) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:11px; font-weight:700; color:var(--text-secondary);';
      item.innerHTML = `
        <span class="material-symbols-rounded" style="font-size:14px; color:${color};">${icon}</span>
        <span>${label}:</span>
        <span style="font-family:var(--font-mono); color:var(--text-primary); font-weight:800;">${value.toLocaleString('fa-IR')}</span>
      `;
      return item;
    };

    const dueItem = makeStatItem(totalDue, 'آماده مرور', 'var(--color-primary)', 'schedule');
    const newItem = makeStatItem(totalNew, 'کارت جدید', 'var(--color-accent)', 'auto_awesome');
    const doneItem = makeStatItem(reviewedToday, 'خوانده شده', 'var(--color-success)', 'check_circle');

    statsRow.append(dueItem, newItem, doneItem);

    const startBtn = createButton({
      label: 'شروع مرور روزانه',
      icon: 'play_circle',
      variant: 'primary',
      onClick: () => router.navigate('study')
    });
    startBtn.style.marginTop = 'var(--space-2)';
    startBtn.style.width = '100%';
    startBtn.style.height = '42px';

    infoCol.append(badge, title, description, statsRow, startBtn);

    // Category-scoped review / progress — opened from the corner icon on this card.
    const openCategoryPicker = categories.length > 0 ? async () => {
          const { setNextSessionCategoryIds } = await import('./study-session.js');
          const selected = new Set();

          // Per-category due / new / reviewed-today counts
          const catStats = [];
          for (const cat of categories) {
            const q = await getStudyQueues(cat.id);
            const due = (q.due?.length || 0) + (q.learning?.length || 0);
            const neu = q.new?.length || 0;
            const reviewed = todaySessions
              .filter((s) => s.categoryId === cat.id)
              .reduce((acc, s) => acc + (s.cardsReviewed || 0), 0);
            catStats.push({ cat, due, neu, reviewed, total: due + neu });
          }

          const sheetBody = document.createElement('div');
          sheetBody.style.cssText = 'display:flex; flex-direction:column; gap:12px;';

          const hint = document.createElement('p');
          hint.style.cssText = 'margin:0; font-size:12px; color:var(--text-secondary); line-height:1.6; text-align:right;';
          hint.textContent = 'یک یا چند دسته را انتخاب کنید. سپس مرور همان‌ها را شروع کنید یا فقط پیشرفت امروزشان را ببینید.';
          sheetBody.appendChild(hint);

          const summary = document.createElement('div');
          summary.style.cssText = 'font-size:12px; font-weight:700; color:var(--text-secondary); text-align:right; padding:8px 10px; border-radius:12px; background:var(--bg-sunken);';
          const updateSummary = () => {
            let dueSum = 0, newSum = 0, revSum = 0;
            catStats.forEach(({ cat, due, neu, reviewed }) => {
              if (!selected.has(cat.id)) return;
              dueSum += due; newSum += neu; revSum += reviewed;
            });
            const n = selected.size;
            if (n === 0) {
              summary.textContent = 'هیچ دسته‌ای انتخاب نشده است';
            } else {
              summary.textContent = `${n.toLocaleString('fa-IR')} دسته · ${dueSum.toLocaleString('fa-IR')} آماده · ${newSum.toLocaleString('fa-IR')} جدید · ${revSum.toLocaleString('fa-IR')} خوانده‌شده امروز`;
            }
          };
          updateSummary();
          sheetBody.appendChild(summary);

          const list = document.createElement('div');
          list.style.cssText = 'display:flex; flex-direction:column; gap:6px; max-height:42vh; overflow:auto;';

          catStats
            .sort((a, b) => (b.total - a.total) || (b.reviewed - a.reviewed))
            .forEach(({ cat, due, neu, reviewed }) => {
              const row = document.createElement('button');
              row.type = 'button';
              row.style.cssText = `
                display:flex; align-items:center; justify-content:space-between; gap:10px;
                width:100%; text-align:right; padding:10px 12px; border-radius:14px;
                border:1px solid var(--border-soft); background:var(--bg-card); cursor:pointer;
              `;
              const left = document.createElement('div');
              left.style.cssText = 'display:flex; align-items:center; gap:10px; min-width:0;';
              const check = document.createElement('span');
              check.className = 'material-symbols-rounded';
              check.style.cssText = 'font-size:22px; color:var(--text-tertiary); flex-shrink:0;';
              check.textContent = 'check_box_outline_blank';
              const nameEl = document.createElement('div');
              nameEl.style.cssText = 'font-size:13px; font-weight:700; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
              nameEl.textContent = cat.title || 'بدون عنوان';
              left.append(check, nameEl);

              const meta = document.createElement('div');
              meta.style.cssText = 'font-size:11px; font-weight:600; color:var(--text-tertiary); flex-shrink:0; font-variant-numeric:tabular-nums;';
              meta.textContent = `${due.toLocaleString('fa-IR')} آماده · ${reviewed.toLocaleString('fa-IR')} امروز`;

              row.append(left, meta);
              row.addEventListener('click', () => {
                if (selected.has(cat.id)) selected.delete(cat.id);
                else selected.add(cat.id);
                const on = selected.has(cat.id);
                check.textContent = on ? 'check_box' : 'check_box_outline_blank';
                check.style.color = on ? 'var(--color-primary)' : 'var(--text-tertiary)';
                row.style.borderColor = on
                  ? 'color-mix(in srgb, var(--color-primary) 45%, var(--border-soft))'
                  : 'var(--border-soft)';
                row.style.background = on
                  ? 'color-mix(in srgb, var(--color-primary) 8%, var(--bg-card))'
                  : 'var(--bg-card)';
                updateSummary();
              });
              list.appendChild(row);
            });
          sheetBody.appendChild(list);

          const actions = document.createElement('div');
          actions.style.cssText = 'display:flex; flex-direction:column; gap:8px; margin-top:4px;';

          const startSelected = createButton({
            label: 'شروع مرور دسته‌های انتخاب‌شده',
            icon: 'play_circle',
            variant: 'primary',
            onClick: () => {
              if (selected.size === 0) {
                showToast('حداقل یک دسته را انتخاب کنید', 'warning');
                return;
              }
              setNextSessionCategoryIds([...selected]);
              overlay.close();
              router.navigate('study');
            },
          });
          startSelected.style.width = '100%';

          const viewProgress = createButton({
            label: 'نمایش پیشرفت همین دسته‌ها',
            icon: 'insights',
            variant: 'secondary',
            onClick: () => {
              if (selected.size === 0) {
                showToast('حداقل یک دسته را انتخاب کنید', 'warning');
                return;
              }
              let dueSum = 0, newSum = 0, revSum = 0;
              const names = [];
              catStats.forEach(({ cat, due, neu, reviewed }) => {
                if (!selected.has(cat.id)) return;
                dueSum += due; newSum += neu; revSum += reviewed;
                names.push(cat.title || 'بدون عنوان');
              });
              const totalSel = revSum + dueSum + newSum;
              const pct = totalSel > 0 ? Math.min(100, Math.round((revSum / totalSel) * 100)) : 100;

              // Update the live stats + ring on the home card
              dueItem.querySelector('span:last-child').textContent = dueSum.toLocaleString('fa-IR');
              newItem.querySelector('span:last-child').textContent = newSum.toLocaleString('fa-IR');
              doneItem.querySelector('span:last-child').textContent = revSum.toLocaleString('fa-IR');
              description.textContent = names.length <= 2
                ? `پیشرفت امروز: ${names.join(' و ')}`
                : `پیشرفت امروز: ${names.slice(0, 2).join('، ')} و ${(names.length - 2).toLocaleString('fa-IR')} دسته دیگر`;

              if (typeof visualCol.updateProgress === 'function') {
                visualCol.updateProgress(pct);
              }

              // Next "start daily" should also respect this filter
              startBtn.onclick = () => {
                setNextSessionCategoryIds([...selected]);
                router.navigate('study');
              };
              startBtn.querySelector('span:last-child') && (startBtn.lastChild.textContent = 'شروع مرور انتخاب‌شده');

              overlay.close();
              showToast('آمار به دسته‌های انتخاب‌شده محدود شد', 'success');
            },
          });
          viewProgress.style.width = '100%';

          const selectAll = createButton({
            label: 'انتخاب همه',
            icon: 'select_all',
            variant: 'text',
            onClick: () => {
              list.querySelectorAll('button').forEach((btn) => {
                if (!btn.querySelector('.material-symbols-rounded')?.textContent.includes('check_box_outline_blank') &&
                    !btn.querySelector('.material-symbols-rounded')?.textContent.includes('check_box')) return;
              });
              // Toggle all on
              catStats.forEach(({ cat }) => selected.add(cat.id));
              list.querySelectorAll('button').forEach((btn) => {
                const icon = btn.querySelector('.material-symbols-rounded');
                if (!icon) return;
                icon.textContent = 'check_box';
                icon.style.color = 'var(--color-primary)';
                btn.style.borderColor = 'color-mix(in srgb, var(--color-primary) 45%, var(--border-soft))';
                btn.style.background = 'color-mix(in srgb, var(--color-primary) 8%, var(--bg-card))';
              });
              updateSummary();
            },
          });
          selectAll.style.width = '100%';

          actions.append(startSelected, viewProgress, selectAll);
          sheetBody.appendChild(actions);

          const overlay = openBottomSheet({
            title: '<span class="material-symbols-rounded">category</span> انتخاب دسته برای مرور',
            content: sheetBody,
          });
        
    } : null;

    // "2-minute mode": a deliberately tiny, low-commitment quick-start for
    // days with zero motivation to open the app at all. The hardest part
    // is usually starting, not finishing — promising "just 5 cards" lowers
    // that resistance a lot more than the full daily queue does.
    if (totalDue + totalNew > 5) {
      const quickStartBtn = createButton({
        label: 'یا فقط ۲ دقیقه (۵ کارت)',
        icon: 'bolt',
        variant: 'text',
        onClick: async () => {
          const { setNextSessionLimit } = await import('./study-session.js');
          setNextSessionLimit(5);
          router.navigate('study');
        },
      });
      quickStartBtn.style.cssText += 'width:100%; height:32px; margin-top:-4px; font-size:12px; color:var(--text-secondary);';
      infoCol.appendChild(quickStartBtn);
    }

    const visualCol = document.createElement('div');
    visualCol.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: stretch;
      gap: 8px;
      max-width: 168px;
      width: 100%;
      margin: 0 auto;
      min-width: 120px;
      padding-top: 28px;
    `;

    const totalToday = reviewedToday + totalDue + totalNew;
    const progressPercent = totalToday > 0 ? Math.round((reviewedToday / totalToday) * 100) : 100;

    // Segmented progress bar (battery-style blocks)
    const SEGMENTS = 10;
    const filledCount = Math.round((progressPercent / 100) * SEGMENTS);
    const barColor = progressPercent >= 100
      ? 'var(--color-success)'
      : progressPercent >= 60
        ? 'var(--color-primary)'
        : 'var(--color-accent)';

    const pctLabel = document.createElement('div');
    pctLabel.style.cssText = `
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      direction: ltr;
    `;
    pctLabel.innerHTML = `
      <span data-role="pct-value" style="font-family:var(--font-mono); font-size:18px; font-weight:800; color:var(--text-primary); letter-spacing:-0.02em;">
        ${progressPercent.toLocaleString('fa-IR')}٪
      </span>
      <span style="font-size:11px; font-weight:700; color:var(--text-tertiary);">پیشرفت امروز</span>
    `;

    const segTrack = document.createElement('div');
    segTrack.setAttribute('data-role', 'seg-track');
    segTrack.style.cssText = `
      display: flex;
      flex-direction: row;
      gap: 4px;
      width: 100%;
      padding: 6px;
      border-radius: 12px;
      background: var(--bg-sunken);
      border: 1px solid var(--border-soft);
      box-sizing: border-box;
    `;

    for (let s = 0; s < SEGMENTS; s++) {
      const cell = document.createElement('div');
      const on = s < filledCount;
      const partial = !on && s === filledCount && (progressPercent / 100) * SEGMENTS - filledCount > 0.15;
      cell.setAttribute('data-seg', String(s));
      cell.style.cssText = `
        flex: 1;
        height: 18px;
        border-radius: 4px;
        transition: background 0.35s ease, opacity 0.35s ease;
        background: ${on ? barColor : 'color-mix(in srgb, var(--text-primary) 8%, transparent)'};
        opacity: ${on ? (0.55 + (s / SEGMENTS) * 0.45) : 0.35};
      `;
      if (progressPercent >= 100 && on) {
        cell.style.background = 'var(--color-success)';
        cell.style.opacity = '1';
      }
      segTrack.appendChild(cell);
    }

    // Helper exposed on visualCol for category-filter progress updates
    visualCol.updateProgress = (pct) => {
      const p = Math.max(0, Math.min(100, Math.round(pct)));
      const filled = Math.round((p / 100) * SEGMENTS);
      const color = p >= 100 ? 'var(--color-success)' : p >= 60 ? 'var(--color-primary)' : 'var(--color-accent)';
      const valEl = pctLabel.querySelector('[data-role="pct-value"]');
      if (valEl) valEl.textContent = `${p.toLocaleString('fa-IR')}٪`;
      segTrack.querySelectorAll('[data-seg]').forEach((cell) => {
        const idx = Number(cell.getAttribute('data-seg'));
        const on = idx < filled;
        cell.style.background = on ? color : 'color-mix(in srgb, var(--text-primary) 8%, transparent)';
        cell.style.opacity = on ? String(0.55 + (idx / SEGMENTS) * 0.45) : '0.35';
        if (p >= 100 && on) {
          cell.style.background = 'var(--color-success)';
          cell.style.opacity = '1';
        }
      });
    };

    visualCol.append(pctLabel, segTrack);


    // Corner icon: category-scoped review (top-left of the card)
    if (openCategoryPicker) {
      const catIconBtn = document.createElement('button');
      catIconBtn.type = 'button';
      catIconBtn.title = 'مرور بر اساس دسته';
      catIconBtn.setAttribute('aria-label', 'مرور بر اساس دسته');
      catIconBtn.style.cssText = `
        position: absolute;
        top: 10px;
        left: 10px;
        width: 36px;
        height: 36px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--color-primary) 22%, var(--border-soft));
        background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-card));
        color: var(--color-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 2;
        padding: 0;
        box-shadow: var(--shadow-sm);
        transition: transform 0.15s ease, background 0.15s ease;
      `;
      catIconBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:20px;">category</span>';
      catIconBtn.addEventListener('mouseenter', () => {
        catIconBtn.style.transform = 'scale(1.06)';
        catIconBtn.style.background = 'color-mix(in srgb, var(--color-primary) 16%, var(--bg-card))';
      });
      catIconBtn.addEventListener('mouseleave', () => {
        catIconBtn.style.transform = 'none';
        catIconBtn.style.background = 'color-mix(in srgb, var(--color-primary) 10%, var(--bg-card))';
      });
      catIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCategoryPicker();
      });
      mainActionRow.appendChild(catIconBtn);
    }

    mainActionRow.append(infoCol, visualCol);
    wrap.appendChild(mainActionRow);
  } else if (activeCardsCount > 0) {
    const upToDateCard = document.createElement('div');
    upToDateCard.className = 'ds-card';
    upToDateCard.style.cssText = 'background:var(--bg-card); border:1.5px solid var(--border-subtle); padding:var(--space-4); text-align:center; display:flex; flex-direction:column; align-items:center; gap:var(--space-2);';
    
    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.style.cssText = 'font-size:48px; color:var(--color-success);';
    icon.textContent = 'emoji_events';

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:var(--text-section); font-weight:800; color:var(--text-primary); margin:0;';
    title.textContent = 'کارت‌ها به‌روز هستند.';

    const sub = document.createElement('p');
    sub.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); margin:0;';
    sub.textContent = 'مرور امروز به پایان رسید.';

    upToDateCard.append(icon, title, sub);
    wrap.appendChild(upToDateCard);
  } else if (categories.length > 0) {
    wrap.appendChild(
      createEmptyState({
        icon: 'style',
        title: 'هنوز فلش‌کارتی نساخته‌اید',
        desc: 'برای شروع یادگیری، در دسته‌های خود فلش‌کارت جدید اضافه کنید.',
        action: createButton({
          label: 'رفتن به کتابخانه',
          icon: 'library_books',
          onClick: () => router.navigate('library')
        })
      })
    );
  } else {
    wrap.appendChild(
      createEmptyState({
        icon: 'auto_awesome',
        title: 'هنوز محتوایی وجود ندارد',
        desc: 'پس از ایجاد اولین دسته، اطلاعات در اینجا نمایش داده می‌شود.',
        action: createButton({
          label: 'ساخت اولین دسته در کتابخانه',
          icon: 'library_books',
          onClick: () => router.navigate('library')
        })
      })
    );
  }

  if (categories.length > 0) {
    const header = document.createElement('h3');
    header.style.cssText = 'font-size:var(--text-section); font-weight:800; color:var(--text-primary); margin-top:var(--space-3); margin-bottom:var(--space-2); text-align:right;';
    header.textContent = 'دسته‌های فعال';
    wrap.appendChild(header);

    const listContainer = document.createElement('div');
    listContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
    wrap.appendChild(listContainer);

    for (const cat of categories) {
      const catQueues = await getStudyQueues(cat.id);
      const catDue = catQueues.due.length + catQueues.learning.length;
      const catNew = catQueues.new.length;

      const catCard = document.createElement('div');
      catCard.className = 'ds-card hover-lift';
      catCard.style.cssText = 'padding:var(--space-3); display:flex; justify-content:space-between; align-items:center; cursor:pointer; gap:var(--space-2);';
      catCard.addEventListener('click', () => router.navigate('category', cat.id));

      const leftSide = document.createElement('div');
      leftSide.style.cssText = 'display:flex; align-items:center; gap:var(--space-3); text-align:right;';

      const iconBox = document.createElement('div');
      iconBox.style.cssText = `width:44px; height:44px; border-radius:12px; background:${cat.themeColor}12; color:${cat.themeColor}; display:flex; align-items:center; justify-content:center;`;
      iconBox.innerHTML = `<span class="material-symbols-rounded">${cat.icon || 'folder'}</span>`;

      const infoBox = document.createElement('div');
      infoBox.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
      
      const title = document.createElement('span');
      title.style.cssText = 'font-weight:700; color:var(--text-primary); font-size:var(--text-body);';
      title.textContent = cat.title;

      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:var(--text-caption); color:var(--text-tertiary);';
      badge.innerHTML = `<span style="font-weight:600; color:var(--color-primary);">${catDue.toLocaleString('fa-IR')} مرور</span> · <span style="font-weight:600; color:var(--color-accent);">${catNew.toLocaleString('fa-IR')} جدید</span>`;

      infoBox.append(title, badge);
      leftSide.append(iconBox, infoBox);

      const actionBtn = document.createElement('button');
      actionBtn.className = 'icon-btn';
      actionBtn.innerHTML = '<span class="material-symbols-rounded">chevron_left</span>';

      catCard.append(leftSide, actionBtn);
      listContainer.appendChild(catCard);
    }
  }

  const globalFab = document.createElement('button');
  globalFab.className = 'fab';
  globalFab.setAttribute('aria-label', 'افزودن سریع');
  
  const iconSpan = document.createElement('span');
  iconSpan.className = 'material-symbols-rounded';
  iconSpan.textContent = 'add';
  
  globalFab.appendChild(iconSpan);
  globalFab.addEventListener('click', () => openQuickAddSheet(globalFab));
  
  // Appended to #app so it lives outside the scrolling .page-content container
  document.getElementById('app').appendChild(globalFab);

  return () => {
    if (globalFab.parentNode) {
      globalFab.parentNode.removeChild(globalFab);
    }
  };
}

let activeQuickAddOverlay = null;
async function openQuickAddSheet(fabBtn) {
  if (activeQuickAddOverlay) {
    closeQuickAddSheet(fabBtn);
    return;
  }
  const icon = fabBtn.querySelector('.material-symbols-rounded');
  if (icon) {
    icon.style.transform = 'rotate(135deg)';
  }
  
  fabBtn.style.zIndex = '10001';
  const categories = await categoryRepository.getAll();

  const overlay = document.createElement('div');
  activeQuickAddOverlay = overlay;
  overlay.className = 'overlay';
  overlay.style.animation = 'none'; // disable default fadeIn
  overlay.style.transition = 'background-color 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), backdrop-filter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), -webkit-backdrop-filter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
  overlay.style.backdropFilter = 'blur(0px)';
  overlay.style.webkitBackdropFilter = 'blur(0px)';
  
  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.style.animation = 'none'; // disable default slideUp
  sheet.style.transform = 'translateY(40px) scale(0.98)';
  sheet.style.opacity = '0';
  sheet.style.transformOrigin = 'bottom center';
  sheet.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
  
  // Add enough padding so it sits completely above the FAB
  sheet.style.paddingBottom = 'calc(130px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))';

  const titleEl = document.createElement('h2');
  titleEl.style.cssText = 'font-size:20px;font-weight:600;letter-spacing:-0.01em;margin-bottom:var(--space-5);color:var(--text-primary);display:flex;align-items:center;gap:var(--space-2);';
  titleEl.innerHTML = 'افزودن سریع (Quick Add)';
  sheet.appendChild(titleEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'bs-content';
  bodyEl.style.cssText = 'font-size:14px;color:var(--text-secondary);line-height:1.5;display:flex;flex-direction:column;gap:var(--space-3);';

  const options = [
    { icon: 'description', label: 'تولید کارت از PDF', action: () => startPdfEngineFlow(categories) },
    { icon: 'edit_note', label: 'ایجاد فلش‌کارت', action: () => openManualCardDialog(categories) },
    { icon: 'photo_camera', label: 'تولید کارت با تصویر (OCR)', action: () => openOcrFlow(categories) },
    { icon: 'create_new_folder', label: 'ایجاد دسته', action: () => openNewCategoryDialog() }
  ];

  const buttons = [];
  options.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'card card-interactive';
    btn.style.cssText = `
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      width: 100%;
      border-radius: var(--radius-card);
      text-align: right;
      font-weight: 700;
      opacity: 0;
      transform: translateY(16px);
      transition: opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), 
                  transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), 
                  background-color 0.2s, box-shadow 0.2s, border-color 0.2s;
    `;
    
    // Bottom-up stagger
    btn.style.transitionDelay = `${0.04 * (options.length - 1 - index)}s`;

    btn.innerHTML = `
      <span class="material-symbols-rounded" style="color:var(--color-primary); font-size:24px;">${opt.icon}</span>
      <span style="font-size:var(--text-body); color:var(--text-primary);">${opt.label}</span>
    `;
    
    btn.addEventListener('click', () => {
      closeQuickAddSheet(fabBtn, () => opt.action());
    });
    
    bodyEl.appendChild(btn);
    buttons.push(btn);
  });

  sheet.appendChild(bodyEl);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Move the FAB into the overlay so it sits above the bottom sheet
  if (fabBtn && fabBtn.parentElement) {
    fabBtn._originalParent = fabBtn.parentElement;
    fabBtn._originalNextSibling = fabBtn.nextSibling;
    overlay.appendChild(fabBtn);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeQuickAddSheet(fabBtn);
    }
  });

  // Force reflow
  overlay.offsetHeight;
  
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
  overlay.style.backdropFilter = 'blur(8px)';
  overlay.style.webkitBackdropFilter = 'blur(8px)';

  requestAnimationFrame(() => {
    sheet.style.transform = 'translateY(0) scale(1)';
    sheet.style.opacity = '1';
    
    buttons.forEach(btn => {
      btn.style.opacity = '1';
      btn.style.transform = 'translateY(0)';
    });
  });
}

function closeQuickAddSheet(fabBtn, onComplete) {
  if (!activeQuickAddOverlay) return;
  
  const overlay = activeQuickAddOverlay;
  activeQuickAddOverlay = null;
  
  if (fabBtn) {
    fabBtn.style.zIndex = '';
    const icon = fabBtn.querySelector('.material-symbols-rounded');
    if (icon) {
      icon.style.transform = 'rotate(0deg)';
    }
    // Put FAB back in its original parent
    if (fabBtn._originalParent) {
      if (fabBtn._originalNextSibling && fabBtn._originalNextSibling.parentNode === fabBtn._originalParent) {
        fabBtn._originalParent.insertBefore(fabBtn, fabBtn._originalNextSibling);
      } else {
        fabBtn._originalParent.appendChild(fabBtn);
      }
    }
  }

  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
  overlay.style.backdropFilter = 'blur(0px)';
  overlay.style.webkitBackdropFilter = 'blur(0px)';
  
  const sheet = overlay.querySelector('.bottom-sheet');
  if (sheet) {
    // Smoother and slightly faster exit transition
    sheet.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    sheet.style.transform = 'translateY(40px) scale(0.96)';
    sheet.style.opacity = '0';
    
    const buttons = Array.from(sheet.querySelectorAll('button'));
    buttons.forEach((btn, index) => {
      btn.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      // Top-down stagger for exit
      btn.style.transitionDelay = `${0.03 * index}s`;
      btn.style.opacity = '0';
      btn.style.transform = 'translateY(12px)';
    });
  }

  // Ensure this matches or slightly exceeds the maximum exit duration (0.35s + max stagger ~ 0.45s)
  setTimeout(() => {
    overlay.remove();
    if (onComplete) onComplete();
  }, 500);
}

async function startPdfEngineFlow(categories) {
  if (categories.length === 0) {
    openDialog({
      title: 'دسته یافت نشد',
      content: 'برای افزودن کارت، ابتدا یک دسته ایجاد کنید.',
      actions: [
        { label: 'ایجاد دسته', variant: 'primary', onClick: () => openNewCategoryDialog() },
        { label: 'انصراف', variant: 'secondary' }
      ]
    });
    return;
  }

  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const select = createSelectField({
    label: 'انتخاب دسته:',
    options: categories.map((cat) => ({ value: cat.id, label: cat.title })),
    value: categories[0].id,
  });

  // Optional instruction for the AI (pages, focus, count, ...)
  const instructionWrap = document.createElement('div');
  instructionWrap.className = 'input-wrapper';
  const instructionLabel = document.createElement('label');
  instructionLabel.className = 'input-label';
  instructionLabel.textContent = 'توضیح برای هوش مصنوعی (اختیاری):';
  const instructionArea = document.createElement('textarea');
  instructionArea.className = 'text-area';
  instructionArea.rows = 3;
  instructionArea.placeholder = 'مثال: فقط از ۱۰ صفحهٔ اول فلش‌کارت بساز / فقط فصل ۲ / روی تعریف‌ها تمرکز کن / حداکثر ۸ کارت';
  instructionArea.style.cssText = 'min-height:72px; resize:vertical;';
  instructionWrap.append(instructionLabel, instructionArea);

  const instructionHint = document.createElement('div');
  instructionHint.style.cssText = 'font-size:11px; color:var(--text-tertiary); line-height:1.55; margin-top:-4px;';
  instructionHint.textContent = 'این توضیح همراه متن PDF برای مدل ارسال می‌شود تا دقیقاً مطابق خواسته‌ات کارت بسازد.';

  const uploadBox = document.createElement('div');
  uploadBox.style.cssText = 'border: 2px dashed var(--border-strong); border-radius: var(--radius-card); padding: var(--space-5); text-align: center; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: var(--space-2); background: var(--bg-primary); transition: background var(--duration-fast);';
  uploadBox.innerHTML = `
    <span class="material-symbols-rounded" style="font-size: 48px; color: var(--color-primary);">cloud_upload</span>
    <span data-role="upload-title" style="font-size: 14px; font-weight: 700; color: var(--text-primary);">انتخاب یا رها کردن PDF</span>
    <span data-role="upload-sub" style="font-size: 12px; color: var(--text-secondary);">محدودیت حجم فایل برداشته شده است</span>
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,application/pdf';
  fileInput.style.display = 'none';
  uploadBox.appendChild(fileInput);

  let selectedFile = null;

  const setFileUi = (file) => {
    selectedFile = file || null;
    const titleEl = uploadBox.querySelector('[data-role="upload-title"]');
    const subEl = uploadBox.querySelector('[data-role="upload-sub"]');
    if (!file) {
      if (titleEl) titleEl.textContent = 'انتخاب یا رها کردن PDF';
      if (subEl) subEl.textContent = 'محدودیت حجم فایل برداشته شده است';
      return;
    }
    const sizeMb = file.size / (1024 * 1024);
    const sizeLabel = sizeMb >= 1
      ? `${sizeMb.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت`
      : `${Math.max(1, Math.round(file.size / 1024)).toLocaleString('fa-IR')} کیلوبایت`;
    if (titleEl) titleEl.textContent = file.name || 'فایل PDF';
    if (subEl) subEl.textContent = `انتخاب شد · ${sizeLabel} — برای تغییر، دوباره لمس کنید`;
  };

  uploadBox.addEventListener('click', () => fileInput.click());
  uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.style.background = 'var(--color-primary-soft)';
  });
  uploadBox.addEventListener('dragleave', () => {
    uploadBox.style.background = 'var(--bg-primary)';
  });
  uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.style.background = 'var(--bg-primary)';
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      // Keep a real FileList on the input when possible
      try {
        const dt = new DataTransfer();
        dt.items.add(f);
        fileInput.files = dt.files;
      } catch (_) { /* ignore */ }
      setFileUi(f);
    }
  });
  fileInput.addEventListener('change', () => {
    setFileUi(fileInput.files?.[0] || null);
  });

  content.append(select, instructionWrap, instructionHint, uploadBox);

  const dialogOverlay = openDialog({
    title: 'تولید کارت از فایل PDF',
    content,
    actions: [
      {
        label: 'تولید فلش‌کارت',
        variant: 'primary',
        onClick: () => {
          // openDialog typically closes on action; run generation next tick
          setTimeout(() => startGeneration(), 0);
        },
      },
      { label: 'انصراف', variant: 'secondary' },
    ],
  });

  async function startGeneration() {
    const file = selectedFile || fileInput.files?.[0];
    if (!file) {
      showToast('ابتدا یک فایل PDF انتخاب کنید', 'warning');
      // Re-open flow so the user does not lose context
      startPdfEngineFlow(categories);
      return;
    }

    // Capture UI values before dialog is gone
    const userInstruction = (instructionArea.value || '').trim();
    const selectedCatId = select.value;
    const category = categories.find((c) => c.id === selectedCatId);

    try { dialogOverlay?.remove?.(); } catch (_) { /* ignore */ }

    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'overlay';
    loadingOverlay.style.zIndex = '2000';
    loadingOverlay.innerHTML = `
      <div class="dialog-content" style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-3);">
        <div class="spinner" style="width: 48px; height: 48px;"></div>
        <h3 id="pdf-loading-text" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">در حال استخراج متن PDF...</h3>
        <p style="font-size: 13px; color: var(--text-secondary);">فایل‌های بزرگ ممکن است کمی بیشتر طول بکشند.</p>
      </div>
    `;
    document.body.appendChild(loadingOverlay);

    try {
      const { extractTextFromPdf } = await import('../core/pdf-utils.js');
      const extracted = await extractTextFromPdf(file);

      const loadingTextEl = document.getElementById('pdf-loading-text');
      if (loadingTextEl) {
        loadingTextEl.textContent = 'در حال تحلیل و تولید کارت...';
      }

      // Soft ceiling only for model context — not a file-size limit.
      // Page markers like [صفحه N] remain so the model can obey page-range instructions.
      const MAX_CHARS = 48000;
      let textToAnalyze = extracted.text || '';
      if (textToAnalyze.length > MAX_CHARS) {
        textToAnalyze = textToAnalyze.slice(0, MAX_CHARS) + '\n\n[...متن طولانی‌تر از حد مدل کوتاه شد؛ در توضیح، محدودهٔ صفحات را مشخص کنید...]';
      }

      const { generateCardsWithAI } = await import('../core/ai-client.js');
      const data = await generateCardsWithAI({
        text: textToAnalyze,
        categoryTitle: category ? category.title : 'عمومی',
        userInstruction,
      });

      loadingOverlay.remove();

      let cards = extractJsonArray(data.text);
      if (!cards || cards.length === 0) {
        throw new Error('هیچ کارتی یافت نشد.');
      }

      openApprovalDialog(cards, selectedCatId);
    } catch (err) {
      loadingOverlay.remove();
      console.error(err);
      openDialog({
        title: 'خطا در فرآیند',
        content: err.message || 'خطایی رخ داد. لطفاً اتصال اینترنت را بررسی کنید.',
        actions: [
          { label: 'تلاش مجدد', variant: 'primary', onClick: () => startPdfEngineFlow(categories) },
          { label: 'بستن', variant: 'secondary' },
        ],
      });
    }
  }
}


async function openManualCardDialog(categories) {
  if (categories.length === 0) {
    openDialog({
      title: 'دسته یافت نشد',
      content: 'لطفاً ابتدا یک دسته جدید ایجاد کنید.',
      actions: [
        { label: 'ایجاد دسته', variant: 'primary', onClick: () => openNewCategoryDialog() },
        { label: 'انصراف', variant: 'secondary' }
      ]
    });
    return;
  }

  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const select = createSelectField({
    label: 'انتخاب دسته:',
    options: categories.map((cat) => ({ value: cat.id, label: cat.title })),
    value: categories[0].id,
  });

  const frontGroup = document.createElement('div');
  frontGroup.className = 'input-wrapper';
  const frontLabel = document.createElement('span');
  frontLabel.className = 'input-label';
  frontLabel.textContent = 'روی کارت:';
  const frontInput = document.createElement('input');
  frontInput.className = 'text-input';
  frontGroup.append(frontLabel, frontInput);

  const backGroup = document.createElement('div');
  backGroup.className = 'input-wrapper';
  const backLabel = document.createElement('span');
  backLabel.className = 'input-label';
  backLabel.textContent = 'پشت کارت:';
  const backInput = document.createElement('textarea');
  backInput.className = 'text-area';
  backInput.rows = 3;
  backGroup.append(backLabel, backInput);

  content.append(select, frontGroup, backGroup);

  openDialog({
    title: 'ایجاد فلش‌کارت',
    content,
    actions: [
      { label: 'انصراف', variant: 'secondary' },
      {
        label: 'ذخیره',
        variant: 'primary',
        keepOpen: true,
        onClick: async () => {
          const front = frontInput.value.trim();
          const back = backInput.value.trim();
          const catId = select.value;
          if (!front || !back) {
            showToast('لطفاً هر دو طرف کارت را تکمیل کنید.', 'error');
            (!front ? frontInput : backInput).focus();
            return;
          }

          const newCard = createFlashcardModel({
            categoryId: catId,
            frontContent: [{ type: 'text', value: front }],
            backContent: [{ type: 'text', value: back }],
            source: 'manual'
          });
          await flashcardRepository.create(newCard);

          const cardsInCat = await flashcardRepository.getByIndex('categoryId', catId);
          const activeCount = cardsInCat.filter((c) => !c.deleted).length;
          await categoryRepository.update(catId, { totalCards: activeCount });

          frontInput.value = '';
          backInput.value = '';
          frontInput.focus();
          showToast('کارت با موفقیت ذخیره شد');
        }
      }
    ]
  });
}

function openNewCategoryDialog() {
  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'input-wrapper';
  const titleLabel = document.createElement('span');
  titleLabel.className = 'input-label';
  titleLabel.textContent = 'عنوان دسته:';
  const titleInput = document.createElement('input');
  titleInput.className = 'text-input';
  titleGroup.append(titleLabel, titleInput);

  const descGroup = document.createElement('div');
  descGroup.className = 'input-wrapper';
  const descLabel = document.createElement('span');
  descLabel.className = 'input-label';
  descLabel.textContent = 'توضیحات (اختیاری):';
  const descInput = document.createElement('textarea');
  descInput.className = 'text-area';
  descInput.rows = 2;
  descGroup.append(descLabel, descInput);

  content.append(titleGroup, descGroup);

  const colors = ['#3D6BFF', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
  const colorGroup = document.createElement('div');
  colorGroup.style.cssText = 'display:flex; gap:var(--space-2); margin-top:var(--space-2); justify-content:center;';
  let selectedColor = colors[0];
  
  colors.forEach(col => {
    const colBtn = document.createElement('button');
    colBtn.style.cssText = `width:32px; height:32px; border-radius:50%; background:${col}; border:2px solid transparent; transition:transform 0.1s;`;
    if (col === selectedColor) colBtn.style.borderColor = 'var(--text-primary)';
    colBtn.addEventListener('click', () => {
      selectedColor = col;
      Array.from(colorGroup.children).forEach(child => child.style.borderColor = 'transparent');
      colBtn.style.borderColor = 'var(--text-primary)';
    });
    colorGroup.appendChild(colBtn);
  });
  content.appendChild(colorGroup);

  openDialog({
    title: 'ایجاد دسته',
    content,
    actions: [
      { label: 'انصراف', variant: 'secondary' },
      {
        label: 'ایجاد دسته',
        variant: 'primary',
        onClick: async () => {
          const title = titleInput.value.trim();
          if (!title) {
            showToast('عنوان دسته الزامی است.', 'error');
            titleInput.focus();
            return false;
          }
          const newCat = createCategoryModel({
            title,
            description: descInput.value.trim(),
            themeColor: selectedColor
          });
          await categoryRepository.create(newCat);
          openDialog({
            title: 'دسته ایجاد شد',
            content: `دسته جدید ایجاد شد.`,
            actions: [{ label: 'تأیید', variant: 'primary', onClick: () => router.navigate('library') }]
          });
        }
      }
    ]
  });
}

async function openOcrFlow(categories) {
  if (!categories || categories.length === 0) {
    openDialog({
      title: 'دسته یافت نشد',
      content: 'برای افزودن کارت، ابتدا یک دسته ایجاد کنید.',
      actions: [
        { label: 'ایجاد دسته', variant: 'primary', onClick: () => openNewCategoryDialog() },
        { label: 'انصراف', variant: 'secondary' }
      ]
    });
    return;
  }

  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const select = createSelectField({
    label: 'انتخاب دسته:',
    options: categories.map((cat) => ({ value: cat.id, label: cat.title })),
    value: categories[0].id,
  });

  let extractionMethod = 'tesseract';

  const methodLabel = document.createElement('span');
  methodLabel.className = 'input-label';
  methodLabel.textContent = 'روش استخراج:';

  const methodRow = document.createElement('div');
  methodRow.style.cssText = 'display:flex; gap:var(--space-2);';

  const tesseractBtn = document.createElement('button');
  tesseractBtn.type = 'button';
  tesseractBtn.className = 'btn btn-primary';
  tesseractBtn.style.cssText = 'flex:1; font-size:13px;';
  tesseractBtn.textContent = 'استخراج سریع (آفلاین)';

  const aiExtractBtn = document.createElement('button');
  aiExtractBtn.type = 'button';
  aiExtractBtn.className = 'btn btn-secondary';
  aiExtractBtn.style.cssText = 'flex:1; font-size:13px;';
  aiExtractBtn.textContent = 'استخراج هوشمند';

  function setMethod(method) {
    extractionMethod = method;
    tesseractBtn.className = method === 'tesseract' ? 'btn btn-primary' : 'btn btn-secondary';
    aiExtractBtn.className = method === 'ai' ? 'btn btn-primary' : 'btn btn-secondary';
    tesseractBtn.style.cssText = 'flex:1; font-size:13px;';
    aiExtractBtn.style.cssText = 'flex:1; font-size:13px;';
    methodHint.textContent = method === 'tesseract'
      ? 'سریع و آفلاین؛ مناسب برای متون چاپی.'
      : 'دقیق‌تر برای متون دست‌نویس؛ نیازمند اتصال هوشمند.';
  }

  tesseractBtn.addEventListener('click', () => setMethod('tesseract'));
  aiExtractBtn.addEventListener('click', () => setMethod('ai'));

  methodRow.append(tesseractBtn, aiExtractBtn);

  const methodHint = document.createElement('span');
  methodHint.style.cssText = 'font-size:12px; color:var(--text-secondary);';
  setMethod('tesseract');

  const uploadBox = document.createElement('div');
  uploadBox.style.cssText = 'border: 2px dashed var(--border-strong); border-radius: var(--radius-card); padding: var(--space-5); text-align: center; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: var(--space-2); background: var(--bg-primary); transition: background var(--duration-fast);';
  uploadBox.innerHTML = `
    <span class="material-symbols-rounded" style="font-size: 48px; color: var(--color-primary);">photo_camera</span>
    <span style="font-size: 14px; font-weight: 700; color: var(--text-primary);">انتخاب یا ثبت تصویر</span>
    <span style="font-size: 12px; color: var(--text-secondary);">پشتیبانی از متون فارسی و انگلیسی</span>
  `;

  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'display:flex; gap:var(--space-2); justify-content:center; width:100%; margin-top:var(--space-2);';

  const cameraBtn = document.createElement('button');
  cameraBtn.className = 'btn btn-primary';
  cameraBtn.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; gap:var(--space-1);';
  cameraBtn.innerHTML = '<span class="material-symbols-rounded">photo_camera</span> دوربین';
  cameraBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const { captureFromCamera, showFreeCropper } = await import('../core/image-capture.js');
      const shot = await captureFromCamera();
      const cropped = await showFreeCropper(shot);
      handleOcrFileSelected(cropped);
    } catch (err) {
      if (err && err.message === 'cancelled') return;
      console.error(err);
      const { showToast } = await import('../core/ui.js');
      showToast(err.message || 'باز کردن دوربین ممکن نشد.', 'error');
    }
  });

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn btn-secondary';
  uploadBtn.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; gap:var(--space-1);';
  uploadBtn.innerHTML = '<span class="material-symbols-rounded">image</span> گالری';
  uploadBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const { pickFromGallery, showFreeCropper } = await import('../core/image-capture.js');
      const file = await pickFromGallery();
      const cropped = await showFreeCropper(file);
      handleOcrFileSelected(cropped);
    } catch (err) {
      if (err && err.message === 'cancelled') return;
      console.error(err);
    }
  });

  btnContainer.append(cameraBtn, uploadBtn);
  uploadBox.appendChild(btnContainer);

  // Tapping the dashed area opens gallery + crop (same as gallery button)
  uploadBox.addEventListener('click', async (e) => {
    if (e.target.closest('button')) return;
    try {
      const { pickFromGallery, showFreeCropper } = await import('../core/image-capture.js');
      const file = await pickFromGallery();
      const cropped = await showFreeCropper(file);
      handleOcrFileSelected(cropped);
    } catch (err) {
      if (err && err.message === 'cancelled') return;
    }
  });

  uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.style.background = 'var(--color-primary-soft)';
  });
  uploadBox.addEventListener('dragleave', () => {
    uploadBox.style.background = 'var(--bg-primary)';
  });
  uploadBox.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadBox.style.background = 'var(--bg-primary)';
    if (e.dataTransfer.files.length > 0) {
      try {
        const { showFreeCropper } = await import('../core/image-capture.js');
        const cropped = await showFreeCropper(e.dataTransfer.files[0]);
        handleOcrFileSelected(cropped);
      } catch (err) {
        if (err && err.message === 'cancelled') return;
        handleOcrFileSelected(e.dataTransfer.files[0]);
      }
    }
  });

  content.append(select, methodLabel, methodRow, methodHint, uploadBox);

  const dialogOverlay = openDialog({
    title: 'استخراج متن از تصویر (OCR)',
    content,
    actions: [
      { label: 'انصراف', variant: 'secondary' }
    ]
  });

  async function handleOcrFileSelected(file) {
    if (!file) return;

    if (extractionMethod === 'ai') {
      const { getActiveProviderInfo } = await import('../core/ai-client.js');
      const { configured, label } = await getActiveProviderInfo();
      if (!configured) {
        openDialog({
          title: 'هوش مصنوعی فعال نیست',
          content: `برای استخراج متن با هوش مصنوعی، ابتدا باید یک ارائه‌دهنده هوش مصنوعی (${label}) را از بخش تنظیمات متصل کنید. در غیر این صورت می‌توانید از «استخراج سریع (آفلاین)» استفاده کنید.`,
          actions: [
            { label: 'رفتن به تنظیمات', variant: 'primary', onClick: () => router.navigate('settings') },
            { label: 'بستن', variant: 'secondary' }
          ]
        });
        return;
      }
    }

    dialogOverlay.remove();

    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'overlay';
    loadingOverlay.style.zIndex = '2000';
    loadingOverlay.innerHTML = `
      <div class="dialog-content" style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-3);">
        <div class="spinner" style="width: 48px; height: 48px;"></div>
        <h3 id="ocr-loading-text" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${extractionMethod === 'ai' ? 'در حال ارسال تصویر...' : 'در حال راه‌اندازی OCR...'}</h3>
        <p style="font-size: 13px; color: var(--text-secondary);">${extractionMethod === 'ai' ? 'تصویر برای پردازش ارسال می‌شود.' : 'اطلاعات فقط در این دستگاه ذخیره می‌شود.'}</p>
      </div>
    `;
    document.body.appendChild(loadingOverlay);

    try {
      let extractedText;

      if (extractionMethod === 'ai') {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const base64Data = dataUrl.split(',')[1];

        const { extractTextFromImageWithAI } = await import('../core/ai-client.js');
        extractedText = await extractTextFromImageWithAI({
          mimeType: file.type || 'image/jpeg',
          data: base64Data
        });
      } else {
        const { performOcr } = await import('../core/ocr-utils.js');
        extractedText = await performOcr(file, (progress) => {
          const loadingTextEl = document.getElementById('ocr-loading-text');
          if (loadingTextEl) {
            loadingTextEl.textContent = `در حال پردازش تصویر (${progress}٪)...`;
          }
        });
      }

      loadingOverlay.remove();
      openOcrPreviewDialog(extractedText, select.value, categories);

    } catch (err) {
      loadingOverlay.remove();
      console.error(err);
      openDialog({
        title: extractionMethod === 'ai' ? 'خطا در استخراج هوشمند' : 'خطا در OCR',
        content: err.message || 'خطا در پردازش تصویر. عکسی واضح‌تر انتخاب کنید.',
        actions: [
          { label: 'تلاش مجدد', variant: 'primary', onClick: () => openOcrFlow(categories) },
          { label: 'بستن', variant: 'secondary' }
        ]
      });
    }
  }
}

function openOcrPreviewDialog(extractedText, categoryId, categories) {
  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%;';

  const label = document.createElement('span');
  label.className = 'input-label';
  label.textContent = 'متن استخراج‌شده (قابل ویرایش):';

  const textarea = document.createElement('textarea');
  textarea.className = 'text-area';
  textarea.rows = 8;
  textarea.style.fontFamily = 'Vazirmatn, system-ui';
  textarea.value = extractedText;
  
  content.append(label, textarea);

  openDialog({
    title: 'متن استخراج‌شده از تصویر',
    content,
    actions: [
      { label: 'لغو', variant: 'secondary' },
      {
        label: 'تولید هوشمند کارت',
        variant: 'primary',
        onClick: async () => {
          const text = textarea.value.trim();
          if (!text) {
            showToast('متنی برای بررسی یافت نشد.', 'error');
            textarea.focus();
            return false;
          }

          const loadingOverlay = document.createElement('div');
          loadingOverlay.className = 'overlay';
          loadingOverlay.style.zIndex = '2000';
          loadingOverlay.innerHTML = `
            <div class="dialog-content" style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-3);">
              <div class="spinner" style="width: 48px; height: 48px;"></div>
              <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary);">در حال تولید کارت...</h3>
            </div>
          `;
          document.body.appendChild(loadingOverlay);

          try {
            const category = categories.find(c => c.id === categoryId);
            
            
            const { generateCardsWithAI } = await import('../core/ai-client.js');
            const data = await generateCardsWithAI({
              text: text,
              categoryTitle: category ? category.title : 'عمومی'
            });

            loadingOverlay.remove();

            const cards = extractJsonArray(data.text);
            if (!cards || cards.length === 0) {
              throw new Error('هیچ کارتی یافت نشد.');
            }

            openApprovalDialog(cards, categoryId);

          } catch (err) {
            loadingOverlay.remove();
            console.error(err);
            openDialog({
              title: 'خطا',
              content: err.message || 'ارتباط با سرور برقرار نشد.',
              actions: [{ label: 'متوجه شدم', variant: 'primary' }]
            });
          }
        }
      },
      {
        label: 'ذخیره دستی',
        variant: 'secondary',
        onClick: async () => {
          const text = textarea.value.trim();
          if (!text) {
            showToast('متنی برای ذخیره یافت نشد.', 'error');
            textarea.focus();
            return false;
          }

          const manualContent = document.createElement('div');
          manualContent.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

          const frontGroup = document.createElement('div');
          frontGroup.className = 'input-wrapper';
          const frontLabel = document.createElement('span');
          frontLabel.className = 'input-label';
          frontLabel.textContent = 'روی کارت:';
          const frontInput = document.createElement('input');
          frontInput.className = 'text-input';
          frontGroup.append(frontLabel, frontInput);

          const backGroup = document.createElement('div');
          backGroup.className = 'input-wrapper';
          const backLabel = document.createElement('span');
          backLabel.className = 'input-label';
          backLabel.textContent = 'پشت کارت:';
          const backInput = document.createElement('textarea');
          backInput.className = 'text-area';
          backInput.rows = 4;
          backInput.value = text;
          backGroup.append(backLabel, backInput);

          manualContent.append(frontGroup, backGroup);

          openDialog({
            title: 'ایجاد کارت از OCR',
            content: manualContent,
            actions: [
              { label: 'انصراف', variant: 'secondary' },
              {
                label: 'ذخیره کارت',
                variant: 'primary',
                onClick: async () => {
                  const frontText = frontInput.value.trim();
                  if (!frontText) {
                    showToast('فیلد روی کارت الزامی است.', 'error');
                    frontInput.focus();
                    return false;
                  }

                  const newCard = createFlashcardModel({
                    categoryId,
                    frontContent: [{ type: 'text', value: frontText }],
                    backContent: [{ type: 'text', value: backInput.value.trim() }],
                    source: 'ocr_manual'
                  });
                  await flashcardRepository.create(newCard);

                  const cardsInCat = await flashcardRepository.getByIndex('categoryId', categoryId);
                  const activeCount = cardsInCat.filter((c) => !c.deleted).length;
                  await categoryRepository.update(categoryId, { totalCards: activeCount });

                  openDialog({
                    title: 'کارت ذخیره شد',
                    content: 'کارت ذخیره شد.',
                    actions: [{ label: 'تأیید', variant: 'primary', onClick: () => router.navigate('home') }]
                  });
                }
              }
            ]
          });
        }
      }
    ]
  });
}

const getSystemInstruction = (categoryTitle, categoryDesc) => {
  return `شما دستیار آموزشی هستید که به یادگیری کاربر کمک می‌کند.
موضوع مطالعه فعلی کاربر: "${categoryTitle || 'عمومی'}" ${categoryDesc ? `(توضیحات: ${categoryDesc})` : ''} است.

قانون حیاتی و همیشگی درباره فرمول‌های ریاضی (در سراسر پاسخ، نه فقط در فلش‌کارت‌ها): رابط کاربری فقط زمانی فرمول را زیبا و درست رندر می‌کند که داخل علامت دلار محصور شده باشد؛ در غیر این صورت کد خام LaTeX (مثل \\Delta یا \\frac{}{}) به‌صورت متن ناخوانا به کاربر نمایش داده می‌شود. پس در هر بخش از پاسخ — چه توضیح معمولی در چت، چه حل قدم‌به‌قدم یک مسئله، چه محاسبه میانی — هر نماد یا عبارت ریاضی را همیشه و بدون هیچ استثنایی داخل $ یا $$ بگذار:
- برای فرمول کوتاه وسط یک جمله: یک $ قبل و یک $ بعد از آن (مثلاً می‌دانیم $\\Delta = b^2 - 4ac$ است).
- برای یک معادله یا مرحله محاسباتی که باید در خط جدا و بزرگ‌تر دیده شود (مثل محاسبه دلتا یا ریشه‌های معادله در حل قدم‌به‌قدم): $$ قبل و $$ بعد از آن، هر کدام در خط جدا (مثلاً:
$$\\Delta = (-5)^2 - 4(1)(6) = 25 - 24 = 1$$
$$x_1 = \\frac{-(-5) + \\sqrt{1}}{2(1)} = 3$$
).
این قانون شامل تمام نمادها می‌شود: توان (^)، اندیس (_)، ریشه (\\sqrt)، کسر (\\frac)، حروف یونانی مثل دلتا و آلفا (\\Delta، \\alpha)، مجموعه، بازه، نامعادله، تساوی چندمرحله‌ای و غیره. هرگز اجازه نده حتی یک نماد یا عبارت ریاضی خارج از $...$ یا $$...$$ در متن پاسخ باقی بماند.

وظایف شما:
۱. به سوالات کاربر دقیق، روان و به زبان فارسی پاسخ دهید. از بکار بردن اصطلاحات بیجا خودداری کنید و به زبان ساده توضیح دهید.
۲. اگر کاربر از شما خواست فلش‌کارت بسازید (یا دکمه مربوطه را زد)، بر اساس مفاهیم گفتگو، بین ۱ تا ۱۰ فلش‌کارت باکیفیت و کلیدی تولید کنید.
۳. در صورتی که کاربر درخواست تولید فلش‌کارت داشت، علاوه بر توضیحات معمولی، حتماً فلش‌کارت‌ها را در انتهای پاسخ خود به این فرمت دقیق JSON قرار دهید تا سیستم بتواند آن‌ها را به طور تعاملی به دسته او اضافه کند:
[FLASHCARDS_JSON]
[
  {
    "front": "پرسش روی کارت (مثلا: پایتخت فرانسه چیست؟)",
    "back": "پاسخ پشت کارت (مثلا: پاریس)",
    "wrongOptions": ["گزینه غلط باورپذیر ۱ (مثلا: لندن)", "گزینه غلط باورپذیر ۲ (مثلا: رم)", "گزینه غلط باورپذیر ۳ (مثلا: مادرید)"],
    "falseStatement": "نسخه نادرست پاسخ (مثلا: پایتخت فرانسه لندن است)"
  }
]
[/FLASHCARDS_JSON]

نکته بسیار مهم: حتماً بخش JSON بین دو تگ [FLASHCARDS_JSON] و [/FLASHCARDS_JSON] باشد و فرمت معتبر JSON داشته باشد. فیلدهای wrongOptions و falseStatement را هم همیشه پر کن تا گزینه‌های غلط آزمون بعداً از فلش‌کارت‌های دیگر و نامرتبط قرض گرفته نشوند.

نکته مهم درباره فرمول‌های ریاضی داخل front و back فلش‌کارت‌ها: هر عبارت ریاضی (کسر، توان، ریشه، مجموعه، بازه، نامعادله و...) را همیشه با علامت دلار احاطه کن — برای فرمول داخل متن یک $ در ابتدا و یک $ در انتها (مثلاً $n(A \\cup B) = n(A) + n(B) - n(A \\cap B)$) و از دستورات استاندارد LaTeX مثل \\frac{}{}, ^{}, _{}, \\sqrt{}, \\cup, \\cap, \\in, \\leq, \\geq, \\infty, \\alpha و مشابه آن استفاده کن. بازه‌های عددی مثل [a, b) را به شکل معمولی و فقط داخل $...$ بنویس.
هر وقت (چه در چت، چه داخل فلش‌کارت) داری مراحل ساده‌کردن یک عبارت یا کسر را قدم‌به‌قدم نشان می‌دهی و می‌خواهی جمله‌ای یا عاملی که حذف/ساده می‌شود را با خط زدن رویش نشان بدهی (دقیقاً مثل چیزی که روی کاغذ یا تخته می‌کشند)، از \\cancel{عبارت} برای خط‌زدن ساده استفاده کن، و اگر بعد از خط‌زدن یک عدد یا مقدار کوچک‌تر جایگزینش می‌شود از \\cancelto{مقدار جدید}{عبارت قدیم} استفاده کن — مثلاً برای ساده کردن $\\frac{12}{18}$ با تقسیم صورت و مخرج بر ۶: $\\frac{\\cancelto{2}{12}}{\\cancelto{3}{18}} = \\frac{2}{3}$، یا برای حذف عامل مشترک $(x-3)$ از صورت و مخرج: $\\frac{(x-2)\\cancel{(x-3)}}{\\cancel{(x-3)}(x+3)}$.

۴. اگر کاربر درخواست رسم نمودار، خط، یا معادله ریاضی دو بعدی کرد یا خواست چند خط/معادله یا نقطه را روی یک نمودار مشخص کند، حتماً یک بلاک کد با زبان plot تولید کنید. سیستم می‌تواند تا ۵ معادله و چندین نقطه را روی یک دستگاه مختصات با قابلیت زوم دو انگشتی یا اسکرول رسم کند:
\`\`\`plot
y = x^2 - 4
y = 2x + 1
point: 2, 0 | نقطه ریشه
point: -1, -3 | نقطه تلاقی
\`\`\`
توضیحات بلاک plot:
- هر خط جدید می‌تواند یک معادله به فرم y = ax^2 + bx + c یا y = mx + c باشد.
- هر نقطه به صورت "point: x, y | برچسب" مشخص می‌شود تا روی دستگاه مختصات علامت‌گذاری و نام‌گذاری شود.
- در این بلاک هیچ متن اضافه دیگری ننویسید.

۵. اگر کاربر درباره مجموعه‌ها، رابطه بین مجموعه‌ها یا رسم نمودار ون (Venn Diagram) صحبت کرد یا سوال پرسید، حتماً یک بلاک کد با زبان venn تولید کنید. سیستم از ۲ یا ۳ یا ۴ مجموعه با چیدمان‌های متداخل (overlapping)، جدا از هم (disjoint) یا زیرمجموعه (subset) پشتیبانی می‌کند.
فرمت بلاک venn برای ۲ یا ۳ یا ۴ مجموعه:
\`\`\`venn
title: نمودار ون مجموعه‌ها
layout: overlapping # می‌تواند overlapping (متداخل)، disjoint (جدا از هم) یا subset (زیرمجموعه تو در تو) باشد
label_A: مجموعه A
label_B: مجموعه B
label_C: مجموعه C # در صورت وجود مجموعه سوم
label_D: مجموعه D # در صورت وجود مجموعه چهارم

# تعریف اعضا برای هر بخش (با ویرگول جدا شوند):
elements_A: ۱, ۳
elements_B: ۲, ۴
elements_C: ۵ # در صورت وجود مجموعه سوم
elements_D: ۷ # در صورت وجود مجموعه چهارم
elements_AB: ۸ # اعضای مشترک فقط بین A و B (در ۲ مجموعه به جای این از elements_intersection استفاده کنید)
elements_AC: ۹ # اعضای مشترک فقط بین A و C
elements_AD: ۱۰ # اعضای مشترک فقط بین A و D
elements_BC: ۱۱ # اعضای مشترک فقط بین B و C
elements_BD: ۱۲ # اعضای مشترک فقط بین B و D
elements_CD: ۱۳ # اعضای مشترک فقط بین C و D
elements_ABC: ۱۴ # اعضای مشترک فقط بین A و B و C
elements_ABD: ۱۵ # اعضای مشترک فقط بین A و B و D
elements_ACD: ۱۶ # اعضای مشترک فقط بین A و C و D
elements_BCD: ۱۷ # اعضای مشترک فقط بین B و C و D
elements_ABCD: ۱۸ # اعضای مشترک هر چهار مجموعه
elements_intersection: ۱۹ # برای ۲ مجموعه: عضوهای اشتراک A و B
elements_U: ۲۰, ۲۱ # اعضای مجموعه مرجع U خارج از دایره‌ها

# سایه‌زدن یا مشخص کردن بخش‌های خاص (برای اشتراک، تفاضل، متمم و...):
# می‌توانید نام چند بخش را با ویرگول بنویسید تا همگی رنگ‌آمیزی شوند.
# بخش‌های مجاز برای ۲ مجموعه: A_only, B_only, intersection, U_only
# بخش‌های مجاز برای ۳ مجموعه: A_only, B_only, C_only, AB_only, AC_only, BC_only, ABC, U_only
# بخش‌های مجاز برای ۴ مجموعه: A_only, B_only, C_only, D_only, AB_only, AC_only, AD_only, BC_only, BD_only, CD_only, ABC_only, ABD_only, ACD_only, BCD_only, ABCD, U_only
# ماکروهای ویژه: A_all, B_all, C_all, D_all, union
shade: B_only, intersection, U_only # متناسب با فرمول درخواستی کاربر، بخش‌ها را سایه بزنید (مثلا در اینجا متمم تفاضل (A-B)' مشخص شده است)
\`\`\`

۶. اگر کاربر درباره بازه‌های حقیقی ریاضی، اشتراک یا اجتماع بازه‌ها روی محور اعداد صحبت کرد یا سوال پرسید، حتماً یک بلاک کد با زبان interval تولید کنید تا یک محور حقیقی تعاملی رسم شود:
\`\`\`interval
title: بررسی بازه‌های تعاملی حقیقی
interval: A | [-3, 0) | blue | بازه آ
interval: B | [-1.5, 0.5) | red | بازه ب
interval: C | [-1, 1) | green | بازه ج
\`\`\`
توضیح بخش‌های interval:
- هر خط با interval مشخص‌کننده یک بازه است و دارای ۴ بخش است که با | از هم جدا می‌شوند:
  ۱. نام بازه (مثلاً A)
  ۲. محدوده ریاضی بازه با علامت [ ] برای بازه بسته و ( ) برای بازه باز (مثلاً [-3, 0) به معنی بازه بسته از منفی ۳ تا باز صفر). می‌توانید از اعداد کسری هم استفاده کنید مانند [-3/2, 1/2).
  ۳. رنگ بازه به انگلیسی (blue, red, green, orange, teal)
  ４. توضیحات دلخواه فارسی برای آن بازه
- برای بیشترین وضوح، ۲ یا ۳ بازه را با همین فرمت وارد کنید.

۷. اگر کاربر مسئله هندسی مطرح کرد که نیاز به رسم شکل، محاسبه زوایا و اضلاع دارد، حتماً یک بلاک کد با زبان geometry تولید کنید. از این قابلیت برای نمایش اشکال پویا (مثلث، مستطیل، و چندضلعی‌ها) استفاده کنید:
\`\`\`geometry
title: مثلث قائم‌الزاویه
type: triangle
# تعریف نقاط با مختصات (اعداد ساده بین 0 تا 100 مناسب است)
point: A | 0 | 0
point: B | 4 | 0
point: C | 0 | 3
# تعریف اضلاع (نقطه ۱، نقطه ۲ | طول یا برچسب | فرمول)
side: A, B | 4 | a = 4
side: B, C | 5 | c = \\sqrt{4^2 + 3^2} = 5
side: C, A | 3 | b = 3
# تعریف زوایا (نقطه راس | مقدار یا برچسب | فرمول)
angle: A | 90° | A = 90^\\circ
angle: B | 36.9° | \\sin(B) = 3/5 \\Rightarrow B \\approx 36.9^\\circ
angle: C | 53.1° | \\cos(C) = 4/5 \\Rightarrow C \\approx 53.1^\\circ
# مساحت یا اطلاعات دیگر
area: S = \\frac{1}{2} \\times 3 \\times 4 = 6
\`\`\`

۸. در صورت نیاز به نمایش داده‌های ساختاریافته، مقایسه‌ای یا جدولی، از جدول مارک‌داون استاندارد مانند زیر استفاده کنید تا سیستم آن را به زیبایی برای کاربر رندر کند:
| ستون ۱ | ستون ۲ |
|---|---|
| داده ۱ | داده ۲ |

۹. اگر پاسخ شامل کسر یا کسر‌های ساده یا تودرتو (دوتایی یا سه‌تایی) است، حتماً از ساختار ریاضی استاندارد LaTeX یعنی \\frac{صورت}{مخرج} استفاده کنید (آن را در تگ‌های ریاضی مانند $ یا $$ محصور کنید). سیستم آن را به صورت کسرهای چند طبقه عمودی با کیفیت بالا دقیقا مانند تصاویر درخواستی رندر می‌کند:
- کسر تکی (ساده): \\frac{A}{B}
- کسر دوتایی (تودرتو دوطبقه): \\frac{\\frac{A}{B}}{C}
- کسر سه‌تایی (تودرتو سه‌طبقه): \\frac{\\frac{A}{B}}{\\frac{C}{D}}

۱۰. اگر کاربر درباره دسته‌بندی‌ها، انواع، نقشه‌های ذهنی (Mind Map) یا نمودارهای درختی (در دروسی مثل زیست‌شناسی، تاریخ، گرامر زبان و...) سوال کرد، حتماً یک بلاک کد با زبان mindmap یا tree تولید کنید تا نمودار درختی تعاملی رسم شود.
فرمت بلاک mindmap به این صورت است که هر گره و والد آن با | جدا می‌شوند. گره اصلی بدون والد (یا با والد root) تعریف می‌شود:
\`\`\`mindmap
title: دسته‌بندی گیاهان
node: گیاهان | root
node: ریشه‌دار | گیاهان
node: بدون ریشه | گیاهان
node: نهان‌دانگان | ریشه‌دار
node: بازدانگان | ریشه‌دار
node: خزه | بدون ریشه
\`\`\`
در نوشتن نام گره‌ها سعی کنید کوتاه و خلاصه باشند تا در نمودار به خوبی جا شوند.

۱۱. اگر کاربر مسئله فیزیک مطرح کرد، حتماً یک بلاک کد با زبان physics تولید کنید تا شبیه‌ساز فیزیک رسم شود.
انواع شبیه‌ساز پشتیبانی می‌شود (مطابق سرفصل فیزیک پایه‌های دهم تا دوازدهم):
- پرتابه (projectile): v0 (سرعت)، angle (زاویه)، h0 (ارتفاع)، g (گرانش)
- نیروها روی سطح (forces): angle (زاویه سطح)، mass (جرم)، mu (ضریب اصطکاک)، force: نام|اندازه|زاویه|رنگ
- آونگ ساده (pendulum): length (طول آونگ متر)، angle (زاویه اولیه درجه)، g (شتاب گرانش)
- فنر و جرم (spring): mass (جرم kg)، k (ثابت فنر N/m)، x0 (جابجایی اولیه m)
- برخورد یک‌بعدی (collision): m1 (جرم ۱)، v1 (سرعت ۱)، m2 (جرم ۲)، v2 (سرعت ۲)، elastic (true برای برخورد کشسان، false برای برخورد کاملاً نچسبان - پیش‌فرض true)
- حرکت با شتاب ثابت روی خط راست (kinematics1d): v0 (سرعت اولیه m/s)، a (شتاب m/s²، می‌تواند منفی باشد)، x0 (موقعیت اولیه m، اختیاری)، t (بازه زمانی نمایش s، اختیاری)
- حرکت دایره‌ای یکنواخت (circular): radius (شعاع m)، period (دوره تناوب s)
- موج مکانیکی عرضی (wave): amplitude (دامنه m)، wavelength (طول موج m)، frequency (بسامد Hz)
- مدار الکتریکی سری (circuit): voltage (ولتاژ باتری V)، resistors (مقاومت‌ها با کاما جدا شوند، مثلاً 10, 20, 30)
- آینه و عدسی (optics): element (یکی از concave_mirror، convex_mirror، convex_lens، concave_lens)، f (فاصله کانونی cm، برای آینه کاو و عدسی همگرا مثبت)، do (فاصله جسم از رأس/مرکز cm)، ho (ارتفاع جسم cm، اختیاری، پیش‌فرض ۲)
- قوانین گازهای کامل (gas_laws): T (دما کلوین)، V (حجم لیتر)، n (مول)
- شناوری و اصل ارشمیدس (buoyancy): rho_f (چگالی مایع kg/m³)، rho_s (چگالی جسم kg/m³)، v_obj (حجم جسم m³)
- قانون کولن و میدان الکتریکی (electric_field): charges (بارهای اولیه بر حسب میکروکولن با کاما جدا شوند، مثلا 1, -1)
- خازن تخت (capacitor): area (مساحت صفحات m²)، distance (فاصله صفحات mm)، dielectric (ثابت دی‌الکتریک)، voltage (ولتاژ V)
- انحراف در میدان مغناطیسی (lorentz): mass (جرم ذره)، q (بار ذره)، v (سرعت ذره)، B (شدت میدان)
- القای فاراده و لنز (faraday): turns (دور سیم‌پیچ)، reversed_poles (true/false برای جایگشت قطب‌ها)
- سطح شیب‌دار با اصطکاک (incline_friction): angle (زاویه درجه)، mass (جرم kg)، mu_s (ضریب اصطکاک ایستایی)، mu_k (ضریب اصطکاک جنبشی)
- اثر داپلر در صوت (doppler): v_s (سرعت چشمه m/s)، v_o (سرعت ناظر m/s)، frequency (فرکانس Hz)
- اثر فوتوالکتریک (photoelectric): wavelength (طول موج nm)، intensity (شدت نور 0 تا 100)، work_function (تابع کار eV)، voltage (ولتاژ معکوس V)
- شبکه‌ لوله‌های متصل (tube_system): arms (آرایه از آبجکت‌ها با w, h, type=gas/open/closed)، connections (آرایه با from, to, type=bottom/top)، liquids (آرایه با arm, h1, h2, color یا conn:[a,b], type, color)، labels (آرایه با text, arm, h1, h2, pos=left/right)، lines (آرایه با h). توجه: مقادیر را به صورت JSON معتبر بنویسید.
- مانومتر چند مخزنی (manometer_tanks): مخزن A و B و دو لوله U شکل. پارامترها: p_a (فشار مخزن A)، h1 (ارتفاع لوله اول)، h2 (ارتفاع لوله دوم)، liq1 (مایع اول)، liq2 (مایع دوم)، text_a (متن مخزن A)، text_b (متن مخزن B).

مثال پرتابه:
\`\`\`physics
title: شبیه‌سازی پرتابه
type: projectile
v0: 20
angle: 45
\`\`\`
مثال آونگ:
\`\`\`physics
title: نوسان آونگ ساده
type: pendulum
length: 2
angle: 30
\`\`\`
مثال فنر:
\`\`\`physics
title: سیستم جرم و فنر
type: spring
mass: 1.5
k: 20
x0: 0.5
\`\`\`
مثال برخورد کشسان:
\`\`\`physics
title: برخورد دو جسم
type: collision
m1: 2
v1: 5
m2: 3
v2: -2
elastic: true
\`\`\`
مثال حرکت با شتاب ثابت:
\`\`\`physics
title: حرکت شتاب‌دار روی خط راست
type: kinematics1d
v0: 4
a: 2
t: 5
\`\`\`
مثال حرکت دایره‌ای:
\`\`\`physics
title: حرکت دایره‌ای یکنواخت
type: circular
radius: 2
period: 4
\`\`\`
مثال موج:
\`\`\`physics
title: موج مکانیکی عرضی
type: wave
amplitude: 0.5
wavelength: 4
frequency: 1
\`\`\`
مثال مدار الکتریکی:
\`\`\`physics
title: مدار سری مقاومت‌ها
type: circuit
voltage: 12
resistors: 10, 20, 30
\`\`\`
مثال عدسی همگرا:
\`\`\`physics
title: تشکیل تصویر در عدسی همگرا
type: optics
element: convex_lens
f: 10
do: 20
\`\`\`
۱۲. اگر کاربر خواست چیزی را با کدنویسی رسم کنید، بسازید یا شبیه‌سازی کنید (مثلاً 'یک دایره با کد بکش'، 'یک انیمیشن ساده بساز'، 'یک بازی کوچک درست کن'، 'یک شبیه‌ساز یا شکل سه‌بعدی بساز')، حتماً یک بلاک کد با زبان run تولید کنید. کد داخل این بلاک باید یک سند HTML کامل و به‌تنهایی قابل‌اجرا باشد (تگ‌های style و script می‌توانند inline داخل همان بلاک باشند). در این بلاک هیچ متن توضیحی اضافه ننویسید؛ فقط کد.

کیفیت در اولویت اول است: طول کد را عمداً کوتاه یا ساده نکن. کد را کامل، تمیز، دارای کامنت‌های کوتاه راهنما، ساختاریافته (توابع/کلاس‌های جدا برای بخش‌های مختلف) و با جزئیات بصری و رفتاری واقعی بنویس — دقیقاً مثل چیزی که یک برنامه‌نویس حرفه‌ای برای یک دمو باکیفیت تحویل می‌دهد، نه یک اسکچ حداقلی. از انیمیشن روان با requestAnimationFrame، مدیریت رویدادهای لمسی/ماوس، حالت‌های پایانی بازی (باخت/برد/امتیاز) و بازخورد بصری (رنگ، سایه، ذره، صدا در صورت نیاز) دریغ نکن.

استفاده از کتابخانه‌های خارجی معتبر از طریق CDN مجاز و برای کیفیت بالا توصیه می‌شود (این بلاک داخل یک iframe با دسترسی اینترنت اجرا می‌شود، پس بارگذاری اسکریپت از CDN مشکلی ندارد). به‌خصوص برای درخواست‌های سه‌بعدی از three.js استفاده کن؛ به‌جای تلاش برای شبیه‌سازی دستی سه‌بعدی با canvas 2D (که کیفیتش همیشه پایین است)، همیشه ترجیح بده واقعاً یک صحنه سه‌بعدی با WebGL بسازی. کتابخانه‌های پیشنهادی بر اساس نیاز (فقط در صورت نیاز واقعی اضافه کن، نه همیشه):
- سه‌بعدی و WebGL: three.js (مثلاً <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>)
- فیزیک دوبعدی (برخورد، جاذبه، طناب و...): matter.js
- نمودار و چارت: chart.js
- صدا و موسیقی تعاملی: Tone.js
- انیمیشن و افکت‌های نقاشی خلاقانه: p5.js
اگر نیازی به کتابخانه نبود (مثلاً یک انیمیشن دوبعدی ساده)، همان canvas/SVG خام هم کاملاً کافی و قابل قبول است؛ کتابخانه را فقط برای بالا بردن واقعی کیفیت اضافه کن، نه بدون دلیل.

بسیار مهم درباره‌ی اندازه: کل طراحی را برای یک بوم (canvas) با اندازه ثابت ۹۶۰ در ۶۰۰ پیکسل انجام بده. عرض و ارتفاع body یا صفحه را با vw یا vh یا 100% تنظیم نکن؛ به‌جایش اندازه بوم را دقیقاً 960px در 600px با پیکسل ثابت در نظر بگیر (مثلاً body { width:960px; height:600px; margin:0; overflow:hidden; position:relative; }) و تمام عناصر (شامل canvas دوبعدی یا renderer سه‌بعدی three.js) را دقیقاً با همین ابعاد ثابت (960 در 600، نه window.innerWidth/innerHeight) بساز. این کار باعث می‌شود پیش‌نمایش روی هر اندازه صفحه‌ای، بدون افتادگی یا بریدگی، به‌درستی نمایش داده شود. برای صحنه‌های three.js نیازی به گوش‌دادن به رویداد resize پنجره نیست، چون اندازه بوم همیشه ثابت است.

مثال یک بلاک run سه‌بعدی با three.js (فقط برای نشان‌دادن الگو؛ کد واقعی باید کامل‌تر و متناسب با درخواست کاربر باشد):
\`\`\`run
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:960px;height:600px;overflow:hidden;background:#111;}</style>
</head>
<body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 960/600, 0.1, 1000);
camera.position.set(0, 2, 6);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(960, 600);
document.body.appendChild(renderer.domElement);
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(3, 5, 2);
scene.add(light, new THREE.AmbientLight(0x404040));
const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), new THREE.MeshStandardMaterial({ color: 0x4f8ef7 }));
scene.add(cube);
function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.013;
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>
\`\`\`

ویرایش تکرارشونده‌ی پروژه (بسیار مهم، دقیقاً مثل یک دستیار برنامه‌نویس عمل کن نه یک نویسنده‌ی از صفر):
اگر در پیام‌های قبلی همین گفتگو، یک بلاک run ساخته‌ای و حالا کاربر می‌گوید یک اشکال دارد، چیزی کار نمی‌کند، یا می‌خواهد ویژگی‌ای اضافه/تغییر کند — این یعنی داری روی همان پروژه‌ی قبلی کار می‌کنی، نه اینکه از صفر چیز جدیدی بسازی. در این حالت:
- آخرین بلاک run که در همین گفتگو فرستادی را عیناً به‌عنوان نقطه‌ی شروع در نظر بگیر (کامل در تاریخچه‌ی گفتگو در اختیار توست).
- فقط بخش‌هایی از کد را تغییر بده که واقعاً باید عوض شوند تا مشکل گفته‌شده حل شود یا ویژگی خواسته‌شده اضافه شود؛ نام متغیرها، ساختار کلی، توابع و بخش‌هایی از بازی/برنامه که درست کار می‌کنند و ربطی به درخواست فعلی ندارند را بدون دلیل تغییر نده یا بازنویسی نکن.
- در پاسخ، دوباره یک بلاک run کامل بفرست (چون سیستم نمایش امکان اعمال فقط یک تکه کد را ندارد و به کل فایل نیاز دارد)، اما این فایل کامل باید نسخه‌ی اصلاح‌شده‌ی همان کد قبلی باشد، نه یک بازنویسی کامل و متفاوت.
- اگر واقعاً مطمئن نیستی کدام بخش باعث اشکال شده، اول با یک یا دو جمله (خارج از بلاک run) بپرس یا حدس بزن کجای کد مشکل دارد، سپس فقط همان بخش را اصلاح کن.

در بلاک‌های physics توضیحات اضافه ننویسید.

۱۳. اگر کاربر درباره شیمی، پیوندهای کووالانسی، ساختار لوویس (Lewis Structure)، الکترون‌های ظرفیت یا آرایش الکترونی مولکول‌ها و یون‌ها سوال کرد، حتماً یک بلاک کد با زبان lewis تولید کنید تا ساختار لوویس آن مولکول با کیفیت بالا رسم شود.
فرمت بلاک lewis:
- هر اتم با یک خط atom مشخص می‌شود: atom: شناسه | نماد عنصر | بار فرمال | x | y
  (x و y مختصات روی یک شبکه‌ی انتزاعی بین 0 تا 10 هستند؛ آن‌ها را طوری انتخاب کن که شکل مولکول واقعی و متعادل باشد، مثلاً برای مولکول خطی روی یک ردیف، برای زاویه‌دار با کمی زاویه، برای مولکول‌های مرکزی-اطراف مثل CH4 یا NH3 اتم مرکزی وسط و اتم‌های اطراف در جهات مختلف)
- هر پیوند با یک خط bond مشخص می‌شود: bond: شناسه۱-شناسه۲ | مرتبه پیوند (1 برای یگانه، 2 برای دوگانه، 3 برای سه‌گانه)
- جفت‌های الکترون ناپیوندی (لون پر) با خط lone مشخص می‌شوند: lone: شناسه | تعداد جفت الکترون ناپیوندی روی آن اتم
- بار الکتریکی کل ساختار (برای یون‌ها): charge: مقدار بار (مثلاً -2 یا +1)
مثال آب (H2O):
\`\`\`lewis
title: مولکول آب (H2O)
atom: O1 | O | 0 | 5 | 4
atom: H1 | H | 0 | 3 | 5.5
atom: H2 | H | 0 | 7 | 5.5
bond: O1-H1 | 1
bond: O1-H2 | 1
lone: O1 | 2
\`\`\`
مثال دی‌اکسید کربن (CO2، پیوند دوگانه و بدون بار):
\`\`\`lewis
title: مولکول دی‌اکسید کربن (CO2)
atom: C1 | C | 0 | 5 | 5
atom: O1 | O | 0 | 2 | 5
atom: O2 | O | 0 | 8 | 5
bond: C1-O1 | 2
bond: C1-O2 | 2
lone: O1 | 2
lone: O2 | 2
\`\`\`
مثال یون آمونیوم (NH4+، با بار فرمال مثبت روی نیتروژن):
\`\`\`lewis
title: یون آمونیوم (NH4+)
charge: 1
atom: N1 | N | 1 | 5 | 5
atom: H1 | H | 0 | 5 | 2
atom: H2 | H | 0 | 5 | 8
atom: H3 | H | 0 | 2 | 5
atom: H4 | H | 0 | 8 | 5
bond: N1-H1 | 1
bond: N1-H2 | 1
bond: N1-H3 | 1
bond: N1-H4 | 1
\`\`\`
در بلاک‌های lewis توضیحات اضافه ننویسید و همیشه بار فرمال هر اتم را (حتی اگر صفر است) بنویسید.

۱۵. هر وقت لازم است نظر یا اطلاعات بیشتری از کاربر بپرسید تا بهتر کمکش کنید (مثلاً می‌خواهید بدانید سطح او مبتدی است یا پیشرفته، کدام گزینه را ترجیح می‌دهد، یا می‌خواهید او را با یک سوال تمرینی محک بزنید)، مجاز و تشویق شده‌اید این کار را همیشه انجام دهید — چه در وسط گفتگو، چه در پایان پاسخ.
اگر می‌خواهید یک سوال تمرینی/کوییز از کاربر بپرسید که پاسخش قابل بررسی باشد (یعنی یک کادر پاسخ زیر آن نمایش داده شود)، حتماً یک بلاک دقیقاً به این فرمت JSON در همان‌جا از پاسخ خود قرار دهید:
[ASK_QUESTION_JSON]
{
  "question": "متن سوال تمرینی که از کاربر می‌پرسید",
  "expectedAnswer": "پاسخ صحیح یا معیار پاسخ صحیح، برای راهنمایی خودت هنگام بررسی — این به کاربر نشان داده نمی‌شود مگر پاسخش غلط باشد",
  "explanation": "توضیح کوتاه اینکه چرا پاسخ درست، درست است — فقط وقتی کاربر پاسخ غلط بدهد یا روی × بزند به او نشان داده می‌شود"
}
[/ASK_QUESTION_JSON]
نکات مهم درباره این بلاک:
- متن سوال را هم به صورت عادی و روان در بدنه پاسخ خودت بنویس، و هم داخل فیلد question در JSON تکرار کن (چون سیستم این بلاک را از متن اصلی حذف کرده و به‌جایش یک کادر پاسخ تعاملی نمایش می‌دهد).
- در هر پاسخ حداکثر یک بلاک [ASK_QUESTION_JSON] بگذار.
- بعداً وقتی کاربر پاسخش را در آن کادر وارد کند و بفرستد، پیامی از طرف سیستم با فرمت مشخص برایت می‌آید که در آن پاسخ کاربر را نسبت به سوال و پاسخ مورد انتظار بررسی می‌کنی. آن موقع باید حتماً و فقط یک بلاک [GRADE_JSON] به این فرمت برگردانی (بدون هیچ متن اضافه‌ی دیگر):
[GRADE_JSON]
{"correct": true یا false, "explanation": "توضیح کوتاه و مفید — چرا درست/غلط بود و پاسخ درست چیست"}
[/GRADE_JSON]
- هنگام بررسی پاسخ کاربر سخت‌گیر نباش: منظور و مفهوم را بررسی کن نه فقط تطابق کلمه‌به‌کلمه؛ غلط املایی جزئی یا فرمت متفاوت را اگر مفهوم درست بود، درست حساب کن.

۱۶. پرسش‌های تعاملی و فرم‌های چندمرحله‌ای (Interactive Questions):
اگر نیاز دارید اطلاعات بیشتری از کاربر بگیرید (مثلاً تعیین سطح، انتخاب موضوع، یا هر پرسش چندگزینه‌ای) و می‌خواهید کاربر به جای تایپ کردن، از میان گزینه‌ها انتخاب کند، از قابلیت «پرسش تعاملی» استفاده کنید.
باید یک بلاک JSON با فرمت زیر در پاسخ خود قرار دهید. می‌توانید یک یا چند مرحله سوال تعریف کنید.
[INTERACTIVE_FORM_JSON]
{
  "steps": [
    {
      "question": "متن سوال اول",
      "description": "توضیح یا راهنمای کوتاه (اختیاری)",
      "options": ["گزینه ۱", "گزینه ۲"],
      "selectionType": "single",
      "allowCustomText": true
    },
    {
      "question": "متن سوال دوم (امکان انتخاب چندگانه)",
      "options": ["گزینه الف", "گزینه ب", "گزینه ج"],
      "selectionType": "multi",
      "allowCustomText": false
    }
  ]
}
[/INTERACTIVE_FORM_JSON]
- فیلد selectionType می‌تواند "single" (تک‌انتخابی) یا "multi" (چندانتخابی) باشد.
- فیلد allowCustomText (true/false) تعیین می‌کند که آیا کادر متنی هم به کاربر نمایش داده شود یا نه.
- پس از پاسخ کاربر، نتایج همه مراحل به صورت یکجا برای شما ارسال می‌شود.`;
};

export async function renderAI(container) {
  container.innerHTML = '';
  
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; flex: 1; height:100%; width:100%; max-width:var(--max-content-w); margin:0 auto; gap:var(--space-2); box-sizing:border-box; min-width:0; position:relative;';
  container.appendChild(wrap);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:998; background:rgba(0,0,0,0.5); opacity:0; pointer-events:none; transition:opacity 0.3s ease;';
  document.body.appendChild(overlay);

  const sidebar = document.createElement('div');
  sidebar.style.cssText = 'position:fixed; top:0; bottom:0; left:0; width:300px; max-width:80vw; z-index:999; background:color-mix(in srgb, var(--bg-card) 85%, transparent); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); transform:translateX(-100%); transition:transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 4px 0 24px rgba(0,0,0,0.1); display:flex; flex-direction:column; padding:calc(var(--space-3) + var(--safe-area-inset-top, env(safe-area-inset-top, 0px))) var(--space-3) var(--space-3) var(--space-3); gap:var(--space-3);';
  
  const sidebarHeader = document.createElement('div');
  sidebarHeader.style.cssText = 'display:flex; align-items:center; justify-content:space-between; font-weight:800; font-size:var(--text-h3); color:var(--text-primary); border-bottom:1px solid var(--border-subtle); padding-bottom:var(--space-2);';
  sidebarHeader.textContent = 'تاریخچه گفتگوها';
  
  const closeSidebarBtn = document.createElement('button');
  closeSidebarBtn.className = 'icon-btn';
  closeSidebarBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';
  sidebarHeader.appendChild(closeSidebarBtn);
  sidebar.appendChild(sidebarHeader);

  const newChatBtn = createButton({
    label: 'چت جدید',
    icon: 'add',
    variant: 'primary',
    onClick: () => {
      openCategoryPickerForNewChat();
    }
  });
  sidebar.appendChild(newChatBtn);

  const historyList = document.createElement('div');
  historyList.style.cssText = 'flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:var(--space-2);';
  sidebar.appendChild(historyList);
  document.body.appendChild(sidebar);

  function closeSidebar() {
    sidebar.style.transform = 'translateX(-100%)';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
  }
  
  closeSidebarBtn.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  const originalAppend = container.appendChild;
  container.appendChild = function(node) {
     return originalAppend.call(this, node);
  };
  const cleanup = () => {
     if (document.body.contains(sidebar)) document.body.removeChild(sidebar);
     if (document.body.contains(overlay)) document.body.removeChild(overlay);
  };
  const mo = new MutationObserver(() => {
     if (!document.body.contains(container) || !container.contains(wrap)) {
        cleanup();
        mo.disconnect();
     }
  });
  mo.observe(document.body, {childList: true, subtree: true});

  const menuBtn = document.getElementById('menu-btn');
  if (menuBtn) {
    const newMenuBtn = menuBtn.cloneNode(true);
    menuBtn.parentNode.replaceChild(newMenuBtn, menuBtn);
    newMenuBtn.addEventListener('click', () => {
      renderHistoryList();
      sidebar.style.transform = 'translateX(0)';
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';
    });
  }

  async function renderHistoryList() {
    historyList.innerHTML = '';
    const convs = await aiConversationRepository.getAll();
    convs.sort((a,b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
    
    for (const conv of convs) {
      const item = document.createElement('div');
      item.style.cssText = 'padding:var(--space-2); border-radius:var(--radius-card); background:var(--bg-secondary); cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background 0.2s; position:relative;';
      
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = 'flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:var(--space-2);';
      
      const catText = conv.categoryId ? ((await categoryRepository.getById(conv.categoryId))?.title || 'نامشخص') : 'عمومی';
      
      const infoDiv = document.createElement('div');
      infoDiv.style.cssText = 'display:flex; align-items:center; gap:6px; min-width:0; flex:1;';

      const catSpan = document.createElement('span');
      catSpan.style.cssText = 'font-weight:700; font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-shrink:0; max-width:45%;';
      catSpan.textContent = catText;

      const separator = document.createElement('span');
      separator.style.cssText = 'width:4px; height:4px; border-radius:50%; background:var(--text-tertiary); opacity:0.4; flex-shrink:0; margin-top:1px;';

      const topicSpan = document.createElement('span');
      topicSpan.style.cssText = 'font-size:12px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0;';
      topicSpan.textContent = conv.topic || 'چت';

      infoDiv.append(catSpan, separator, topicSpan);
      
      const dateEl = document.createElement('div');
      dateEl.style.cssText = 'font-size:11px; color:var(--text-tertiary); white-space:nowrap; flex-shrink:0; margin-right:4px;';
      dateEl.textContent = new Date(conv.updatedAt || conv.createdAt).toLocaleDateString('fa-IR');
      
      contentDiv.append(infoDiv, dateEl);
      item.appendChild(contentDiv);
      
      let pressTimer;
      const startPress = () => {
        pressTimer = setTimeout(() => {
          showDeleteIcon(item, conv.id);
        }, 500);
      };
      const cancelPress = () => clearTimeout(pressTimer);
      
      item.addEventListener('mousedown', startPress);
      item.addEventListener('touchstart', startPress);
      item.addEventListener('mouseup', cancelPress);
      item.addEventListener('mouseleave', cancelPress);
      item.addEventListener('touchend', cancelPress);
      item.addEventListener('touchcancel', cancelPress);
      
      item.addEventListener('click', (e) => {
        if (e.target.closest('.del-btn')) return;
        activeConversation = conv;
        currentCategoryId = conv.categoryId || 'general';
        loadConversation();
        closeSidebar();
        conv.updatedAt = new Date().toISOString();
        aiConversationRepository.update(conv.id, { updatedAt: conv.updatedAt }).catch((err) => console.error('Failed to bump conversation updatedAt', err));
      });
      
      historyList.appendChild(item);
    }
  }

  function showDeleteIcon(item, convId) {
    if (item.querySelector('.del-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'icon-btn del-btn material-symbols-rounded';
    btn.textContent = 'delete';
    btn.style.cssText = 'color:var(--color-danger); font-size:20px;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDialog({
        title: 'حذف تاریخچه چت',
        body: 'آیا از حذف این گفتگو مطمئن هستید؟',
        actions: [
          { label: 'انصراف', variant: 'text' },
          { label: 'حذف', variant: 'danger', onClick: async () => {
             await aiConversationRepository.delete(convId);
             if (activeConversation && activeConversation.id === convId) {
                activeConversation = null;
                currentCategoryId = 'general';
                loadConversation();
             }
             renderHistoryList();
          }}
        ]
      });
    });
    item.appendChild(btn);
  }

  async function openCategoryPickerForNewChat() {
    const cats = await categoryRepository.getAll();
    const actions = cats.map(c => ({
      label: c.title,
      variant: 'secondary',
      onClick: () => {
        activeConversation = null;
        currentCategoryId = c.id;
        loadConversation();
        closeSidebar();
      }
    }));
    actions.unshift({
      label: 'عمومی',
      variant: 'primary',
      onClick: () => {
        activeConversation = null;
        currentCategoryId = 'general';
        loadConversation();
        closeSidebar();
      }
    });
    openDialog({
      title: 'انتخاب دسته',
      body: 'برای شروع چت، یک دسته انتخاب کنید:',
      actions: actions
    });
  }


  const chatList = document.createElement('div');
  chatList.style.cssText = 'flex: 1 1 0; overflow-y:auto; padding:var(--space-2) 0; display:flex; flex-direction:column; gap:var(--space-3); min-height: 0;';
  wrap.appendChild(chatList);


  const fileSelector = document.createElement('input');
  fileSelector.type = 'file';
  fileSelector.multiple = true;
  fileSelector.accept = 'image/*,application/pdf,text/*,audio/*';
  fileSelector.style.display = 'none';
  wrap.appendChild(fileSelector);

  const attachmentListContainer = document.createElement('div');
  attachmentListContainer.style.cssText = 'display:flex; flex-wrap:wrap; gap:var(--space-2); width:100%; box-sizing:border-box;';
  wrap.appendChild(attachmentListContainer);

  const inputContainer = document.createElement('div');
  inputContainer.style.cssText = 'display:flex; align-items:flex-end; gap:var(--space-2); padding:var(--space-1) var(--space-1); background: color-mix(in srgb, var(--bg-card) 60%, transparent); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1.5px solid var(--border-soft); border-radius: 28px; box-shadow: 0 8px 32px rgba(0,0,0,0.06); width:100%; box-sizing:border-box; min-width:0; margin-top: auto; margin-bottom: var(--space-2); flex-shrink: 0;';

  const attachWrapper = document.createElement('div');
  attachWrapper.style.cssText = 'position:relative; display:flex; align-items:center; justify-content:center; margin-bottom:2px; margin-right:4px; flex-shrink:0;';

  const attachMenu = document.createElement('div');
  attachMenu.style.cssText = 'position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%); display:flex; flex-direction:column-reverse; gap:8px; pointer-events:none; z-index:100;';

  const options = [
    { id: 'camera', icon: 'photo_camera', accept: 'image/*', capture: 'environment' },
    { id: 'document', icon: 'description', accept: '*/*' },
    { id: 'image', icon: 'image', accept: 'image/*' }
  ];

  const optionElements = options.map((opt, i) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<span class="material-symbols-rounded" style="font-size:20px;">${opt.icon}</span>`;
    btn.style.cssText = `
      width: 40px; height: 40px; border-radius: 20px; 
      background: color-mix(in srgb, var(--bg-card) 60%, transparent); 
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.1);
      display: flex; align-items: center; justify-content: center;
      color: var(--color-primary); cursor: pointer; outline: none; padding: 0;
      transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.04}s;
      transform: translateY(${20 + i * 8}px) scale(0.5);
      opacity: 0;
      pointer-events: none;
    `;
    btn.addEventListener('mouseenter', () => btn.style.background = 'var(--color-primary-soft)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'color-mix(in srgb, var(--bg-card) 60%, transparent)');
    btn.addEventListener('click', () => {
      closeMenu();
      fileSelector.accept = opt.accept;
      if (opt.capture) {
        fileSelector.setAttribute('capture', opt.capture);
      } else {
        fileSelector.removeAttribute('capture');
      }
      fileSelector.click();
    });
    attachMenu.appendChild(btn);
    return btn;
  });

  let menuOpen = false;

  const attachBtn = createButton({
    label: '',
    icon: 'add',
    variant: 'text',
    onClick: () => {
      if (menuOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    }
  });
  attachBtn.style.cssText += '; width:40px; height:40px; border-radius:20px; display:flex; align-items:center; justify-content:center; padding:0; flex-shrink:0; color:var(--text-secondary); transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); z-index:2; position:relative;';
  
  const attachBtnIcon = attachBtn.querySelector('.material-symbols-rounded');
  if (attachBtnIcon) {
    attachBtnIcon.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
  }

  function openMenu() {
    menuOpen = true;
    attachMenu.style.pointerEvents = 'auto';
    if (attachBtnIcon) attachBtnIcon.style.transform = 'rotate(45deg)';
    attachBtn.style.color = 'var(--color-primary)';
    attachBtn.style.background = 'var(--color-primary-soft)';
    
    optionElements.forEach((el) => {
      el.style.transform = 'translateY(0) scale(1)';
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    });
  }

  function closeMenu() {
    menuOpen = false;
    attachMenu.style.pointerEvents = 'none';
    if (attachBtnIcon) attachBtnIcon.style.transform = 'rotate(0deg)';
    attachBtn.style.color = 'var(--text-secondary)';
    attachBtn.style.background = 'transparent';
    
    optionElements.forEach((el, i) => {
      el.style.transform = `translateY(${20 + i * 8}px) scale(0.5)`;
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    });
  }

  document.addEventListener('click', (e) => {
    if (menuOpen && !attachWrapper.contains(e.target)) {
      closeMenu();
    }
  });

  attachBtn.addEventListener('mouseenter', () => { if(!menuOpen) { attachBtn.style.background = 'var(--bg-sunken)'; attachBtn.style.color = 'var(--color-primary)'; } });
  attachBtn.addEventListener('mouseleave', () => { if(!menuOpen) { attachBtn.style.background = 'transparent'; attachBtn.style.color = 'var(--text-secondary)'; } });

  attachWrapper.append(attachMenu, attachBtn);

  const inputField = createTextArea({
    placeholder: 'پیام خود را بنویسید...',
    rows: 1
  });
  inputField.style.cssText += '; flex-grow:1; min-width:0; margin-bottom:2px;';
  inputField.input.style.cssText = 'width: 100%; box-sizing: border-box; resize: none; min-height: 40px; height: 40px; padding: 9px 8px; overflow-y: hidden; max-height: 150px; line-height: 1.5; border: none; background-color: transparent; color: var(--text-primary); font-family: inherit; font-size: 15px; outline: none; box-shadow: none;';

  function adjustInputHeight() {
    inputField.input.style.height = '40px'; // reset
    const scrollHeight = inputField.input.scrollHeight;
    if (scrollHeight > 40) {
      inputField.input.style.height = Math.min(scrollHeight, 150) + 'px';
      if (scrollHeight > 150) {
        inputField.input.style.overflowY = 'auto';
      } else {
        inputField.input.style.overflowY = 'hidden';
      }
    } else {
      inputField.input.style.overflowY = 'hidden';
    }
  }
  function handleInputChange() {
    adjustInputHeight();
    aiDraftText = inputField.input.value;
    if (heroAnimEl) {
      const hasText = inputField.input.value.trim().length > 0;
      heroAnimEl.style.opacity = hasText ? '0' : '1';
      heroAnimEl.style.transform = hasText ? 'scale(0.9)' : 'scale(1)';
      heroAnimEl.style.pointerEvents = hasText ? 'none' : '';
      heroAnimEl.style.height = hasText ? '0' : '';
      heroAnimEl.style.overflow = hasText ? 'hidden' : '';
    }
    // Dim send while local file preparation is still running
    try {
      if (sendBtn) {
        const busy = selectedAttachments.some((a) => a.status === 'loading' || a.status === 'processing' || a.status === 'uploading');
        if (!(generatingAbortController && generatingConversationId === (activeConversation && activeConversation.id))) {
          sendBtn.style.opacity = busy ? '0.55' : '1';
          sendBtn.style.pointerEvents = busy ? 'none' : '';
        }
      }
    } catch (_) { /* sendBtn not initialized yet */ }
  }
  inputField.input.addEventListener('input', handleInputChange);

  if (aiDraftText) {
    inputField.input.value = aiDraftText;
  }

  const SEND_ICON_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  const STOP_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>';

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'btn btn-primary';
  sendBtn.innerHTML = SEND_ICON_SVG;
  sendBtn.addEventListener('click', () => {
    if (generatingAbortController && generatingConversationId === (activeConversation && activeConversation.id)) {
      generatingAbortController.abort();
    } else {
      handleSend();
    }
  });
  sendBtn.style.cssText += '; width:40px; height:40px; border-radius:20px; display:flex; align-items:center; justify-content:center; padding:0; flex-shrink:0; margin-bottom: 2px; margin-left: 4px; box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 30%, transparent);';

  function setGeneratingState(generating) {
    sendBtn.innerHTML = generating ? STOP_ICON_SVG : SEND_ICON_SVG;
    sendBtn.title = generating ? 'توقف پاسخ' : '';
  }

  const interactivePanelContainer = document.createElement('div');
  interactivePanelContainer.style.cssText = 'display:none; flex-direction:column; gap:var(--space-2); padding:var(--space-4); background: var(--bg-card); border: 1.5px solid var(--color-primary-soft); border-radius: 24px; box-shadow: 0 12px 48px rgba(0,0,0,0.08); width:100%; box-sizing:border-box; margin-top: auto; margin-bottom: var(--space-2); position: relative; overflow-y: auto; flex-shrink: 0; min-height: 0; max-height: 60vh; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);';
  wrap.appendChild(interactivePanelContainer);

  inputContainer.append(attachWrapper, inputField, sendBtn);
  wrap.appendChild(inputContainer);

  let interactiveFormFlow = null;
  let interactiveFormAnswers = [];
  let currentInteractiveStep = 0;
  
  let currentCategoryId = 'general';
  let activeConversation = null;
  let heroAnimEl = null;
  let selectedAttachments = [];

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function attachmentTypeLabel(mimeType, name) {
    const m = (mimeType || '').toLowerCase();
    const n = (name || '').toLowerCase();
    if (m.startsWith('image/')) return 'IMG';
    if (m === 'application/pdf' || n.endsWith('.pdf')) return 'PDF';
    if (m.startsWith('audio/')) return 'AUD';
    if (m.includes('json') || n.endsWith('.json')) return 'JSON';
    if (m.includes('zip') || n.endsWith('.zip')) return 'ZIP';
    if (m.startsWith('text/') || n.endsWith('.txt') || n.endsWith('.md')) return 'TXT';
    return 'FILE';
  }

  function updateAttachmentsUI() {
    attachmentListContainer.innerHTML = '';
    if (selectedAttachments.length === 0) {
      attachmentListContainer.style.padding = '0';
      attachmentListContainer.style.display = 'none';
      return;
    }

    // Horizontal strip (Claude-like): chips in one row, scroll if needed
    attachmentListContainer.style.display = 'flex';
    attachmentListContainer.style.flexDirection = 'row';
    attachmentListContainer.style.flexWrap = 'nowrap';
    attachmentListContainer.style.alignItems = 'stretch';
    attachmentListContainer.style.gap = '10px';
    attachmentListContainer.style.padding = '8px 2px 10px';
    attachmentListContainer.style.overflowX = 'auto';
    attachmentListContainer.style.overflowY = 'hidden';
    attachmentListContainer.style.width = '100%';
    attachmentListContainer.style.boxSizing = 'border-box';
    attachmentListContainer.style.webkitOverflowScrolling = 'touch';

    selectedAttachments.forEach((file, idx) => {
      const loading = file.status === 'loading' || file.status === 'processing' || file.status === 'uploading';
      const failed = file.status === 'error';
      const pct = Math.max(0, Math.min(100, Math.round(Number(file.progress) || 0)));

      const chip = document.createElement('div');
      chip.dataset.attId = file.id || String(idx);
      chip.style.cssText = `
        position: relative;
        flex: 0 0 auto;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 10px;
        min-width: 168px;
        max-width: 220px;
        padding: 10px 12px;
        border-radius: 16px;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        box-shadow: var(--shadow-sm);
      `;

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', 'حذف پیوست');
      removeBtn.style.cssText = `
        position: absolute;
        top: 6px;
        inset-inline-start: 6px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: none;
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--text-primary) 10%, transparent);
        color: var(--text-secondary);
        z-index: 2;
      `;
      removeBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:13px;">close</span>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedAttachments = selectedAttachments.filter((a) => a.id !== file.id);
        updateAttachmentsUI();
        handleInputChange();
      });

      // Thumb / icon with optional progress ring
      const media = document.createElement('div');
      media.style.cssText = `
        position: relative;
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: var(--bg-sunken);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex-shrink: 0;
      `;

      if (file.dataUrl && (file.mimeType || '').startsWith('image/') && !loading) {
        const img = document.createElement('img');
        img.src = file.dataUrl;
        img.alt = '';
        img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
        media.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'material-symbols-rounded';
        icon.style.cssText = 'font-size:22px; color:var(--color-primary); opacity:0.9;';
        const m = (file.mimeType || '').toLowerCase();
        if (m === 'application/pdf') icon.textContent = 'picture_as_pdf';
        else if (m.startsWith('audio/')) icon.textContent = 'audio_file';
        else if (m.startsWith('image/')) icon.textContent = 'image';
        else icon.textContent = 'draft';
        media.appendChild(icon);
      }

      if (loading) {
        const r = 15;
        const c = 2 * Math.PI * r;
        const offset = c - (pct / 100) * c;
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        ring.setAttribute('width', '40');
        ring.setAttribute('height', '40');
        ring.setAttribute('viewBox', '0 0 40 40');
        ring.style.cssText = 'position:absolute; inset:0; margin:auto; transform:rotate(-90deg); pointer-events:none;';
        ring.innerHTML = `
          <circle cx="20" cy="20" r="${r}" fill="none" stroke="color-mix(in srgb, var(--text-primary) 12%, transparent)" stroke-width="2.5"/>
          <circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--color-primary)" stroke-width="2.5"
            stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
            style="transition: stroke-dashoffset 0.2s ease;"/>
        `;
        media.appendChild(ring);
      }

      if (failed) {
        const err = document.createElement('span');
        err.className = 'material-symbols-rounded';
        err.style.cssText = 'position:absolute; font-size:20px; color:var(--color-danger);';
        err.textContent = 'error';
        media.appendChild(err);
      }

      // Text column
      const meta = document.createElement('div');
      meta.style.cssText = 'min-width:0; flex:1; display:flex; flex-direction:column; gap:3px; padding-top:2px;';

      const typeRow = document.createElement('div');
      typeRow.style.cssText = 'display:flex; align-items:center; justify-content:flex-end; gap:6px;';
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:10px; font-weight:800; letter-spacing:0.04em; color:var(--text-tertiary); direction:ltr;';
      badge.textContent = attachmentTypeLabel(file.mimeType, file.name);
      typeRow.appendChild(badge);

      const nameLabel = document.createElement('div');
      nameLabel.style.cssText = `
        font-size: 12px;
        font-weight: 700;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: ltr;
        text-align: left;
        line-height: 1.25;
      `;
      nameLabel.title = file.name || '';
      nameLabel.textContent = file.name || 'فایل';

      const statusLine = document.createElement('div');
      statusLine.style.cssText = 'font-size:10px; font-weight:600; color:var(--text-tertiary); direction:ltr; text-align:left;';
      if (loading) {
        statusLine.textContent = file.status === 'processing'
          ? 'آماده‌سازی…'
          : file.status === 'uploading'
            ? `ارسال به هوش مصنوعی… ${pct.toLocaleString('fa-IR')}٪`
            : `${pct.toLocaleString('fa-IR')}٪`;
      } else if (failed) {
        statusLine.style.color = 'var(--color-danger)';
        statusLine.textContent = 'ناموفق';
      } else {
        statusLine.textContent = formatBytes(file.size || 0);
      }

      // Thin progress bar under text while loading (extra clarity)
      if (loading) {
        const barTrack = document.createElement('div');
        barTrack.style.cssText = 'height:3px; border-radius:99px; background:color-mix(in srgb, var(--text-primary) 10%, transparent); overflow:hidden; margin-top:2px;';
        const barFill = document.createElement('div');
        barFill.style.cssText = `height:100%; width:${pct}%; background:var(--color-primary); border-radius:99px; transition:width 0.2s ease;`;
        barTrack.appendChild(barFill);
        meta.append(typeRow, nameLabel, statusLine, barTrack);
      } else {
        meta.append(typeRow, nameLabel, statusLine);
      }

      chip.append(removeBtn, media, meta);
      attachmentListContainer.appendChild(chip);
    });
  }

  function patchAttachment(id, patch) {
    const item = selectedAttachments.find((a) => a.id === id);
    if (!item) return;
    Object.assign(item, patch);
    updateAttachmentsUI();
    handleInputChange();
  }

  function readFileWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable && typeof onProgress === 'function') {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  fileSelector.addEventListener('change', async () => {
    const files = Array.from(fileSelector.files || []);
    fileSelector.value = '';
    if (!files.length) return;

    for (const file of files) {
      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const mimeType = file.type || 'application/octet-stream';

      selectedAttachments.push({
        id,
        name: file.name || 'فایل',
        mimeType,
        size: file.size || 0,
        status: 'loading',
        progress: 0,
        data: null,
        dataUrl: null,
      });
      updateAttachmentsUI();
      handleInputChange();

      try {
        let processed = file;

        // Image crop is optional UX; show "processing" while the cropper is open
        if ((file.type || '').startsWith('image/')) {
          patchAttachment(id, { status: 'processing', progress: 8 });
          try {
            const { showFreeCropper } = await import('../core/image-capture.js');
            processed = await showFreeCropper(file);
          } catch (err) {
            if (err && (err.message === 'cancelled' || String(err).includes('cancel'))) {
              selectedAttachments = selectedAttachments.filter((a) => a.id !== id);
              updateAttachmentsUI();
              handleInputChange();
              continue;
            }
            processed = file;
          }
          patchAttachment(id, {
            status: 'loading',
            progress: 12,
            name: processed.name || file.name,
            mimeType: processed.type || file.type || mimeType,
            size: processed.size || file.size || 0,
          });
        }

        const dataUrl = await readFileWithProgress(processed, (pct) => {
          // Keep a little headroom so 100% only appears when fully ready
          patchAttachment(id, { status: 'loading', progress: Math.min(96, Math.max(12, pct)) });
        });

        const base64Data = String(dataUrl).split(',')[1] || '';
        const readyInfo = {
          data: base64Data,
          dataUrl,
          name: processed.name || file.name,
          mimeType: processed.type || file.type || mimeType,
          size: processed.size || file.size || 0,
        };

        // Try to actually push the file to the AI provider's servers now,
        // while it's being attached, instead of waiting for Send. This is
        // currently only possible with Gemini (it has a real Files API
        // reachable from the browser); for every other provider this is a
        // quick no-op and the file is simply marked ready with its base64
        // copy, exactly like before.
        let canPreUpload = false;
        try {
          const { canPreUploadAttachments } = await import('../core/ai-client.js');
          canPreUpload = await canPreUploadAttachments();
        } catch (e) { /* treat as unsupported */ }

        if (canPreUpload) {
          patchAttachment(id, { status: 'uploading', progress: 0, ...readyInfo });
          try {
            const { preUploadAttachment } = await import('../core/ai-client.js');
            const pre = await preUploadAttachment({
              blob: processed,
              mimeType: readyInfo.mimeType,
              displayName: readyInfo.name,
              onProgress: (pct) => patchAttachment(id, { status: 'uploading', progress: pct }),
            });
            if (pre && pre.fileUri) {
              patchAttachment(id, { fileUri: pre.fileUri, aiProvider: pre.provider });
            }
          } catch (e) {
            console.warn('Pre-upload to AI provider failed, will send inline instead:', e);
            // No problem — readyInfo.data (base64) is already there as a fallback.
          }
        }

        patchAttachment(id, {
          status: 'ready',
          progress: 100,
          ...readyInfo,
        });
      } catch (err) {
        console.error('Error reading file:', err);
        patchAttachment(id, { status: 'error', progress: 0 });
        showToast('خواندن یکی از فایل‌ها ناموفق بود', 'error');
      }
    }
  });

  inputField.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.matchMedia('(max-width: 768px)').matches;
      if (!isMobile) {
        e.preventDefault();
        handleSend();
      }
    }
  });

  await loadConversation();
  handleInputChange();

  async function loadConversation() {
    chatList.innerHTML = '';
    
    
    if (!activeConversation) {
      renderGreeting();
    } else {
      activeConversation.messages.forEach((msg, idx) => {
        renderMessage(msg.sender, msg.text, msg.attachments, { messageIndex: idx, isLast: idx === activeConversation.messages.length - 1 });
      });
      chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });

      if (generatingConversationId === activeConversation.id) {
        setGeneratingState(true);
        const loadBubble = renderLoadingBubble();
        chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });
        generatingListeners.add(async () => {
          loadBubble.remove();
          setGeneratingState(false);
          const fresh = await aiConversationRepository.getById(activeConversation.id);
          if (fresh) {
            activeConversation = fresh;
            await loadConversation();
          }
        });
      }
    }
  }

  function renderGreeting() {
    chatList.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex; flex-direction:column; flex:1; align-items:center; justify-content:center; padding:var(--space-4); animation: slideUp 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; opacity: 0; gap: var(--space-4);';
    
    const animContainer = document.createElement('div');
    animContainer.style.cssText = 'display:flex; align-items:center; justify-content:center; margin-bottom:var(--space-2); transition:opacity 0.15s, transform 0.15s;';
    heroAnimEl = animContainer;
    animContainer.innerHTML = `
      <svg viewBox="0 0 300 200" width="270" height="180" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>
            .hero-text {
              font-family: 'Lora', serif, system-ui, -apple-system, sans-serif;
              font-weight: 600;
              font-size: 22px;
              letter-spacing: 0.8px;
              text-anchor: middle;
              dominant-baseline: central;
              fill: var(--color-primary);
            }
            .hero-highlight {
              fill: white;
            }
            
            .dot-line {
              transform-box: fill-box;
              transform-origin: center;
              animation: animDotLine 8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }
            
            .text-container {
              transform-box: fill-box;
              transform-origin: center;
              animation: animTextGrow 8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }
            
            .breathe-group {
              transform-box: fill-box;
              transform-origin: center;
              animation: animBreathe 8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }
            
            @keyframes animDotLine {
              0%, 2% { transform: scaleX(0) scaleY(1); opacity: 0; }
              4% { transform: scaleX(0.02) scaleY(1); opacity: 1; }
              9% { transform: scaleX(1) scaleY(1); opacity: 1; }
              14%, 86% { transform: scaleX(1) scaleY(0); opacity: 0; }
              91% { transform: scaleX(1) scaleY(1); opacity: 1; }
              96% { transform: scaleX(0.02) scaleY(1); opacity: 1; }
              98%, 100% { transform: scaleX(0) scaleY(1); opacity: 0; }
            }
            
            @keyframes animTextGrow {
              0%, 9% { transform: scaleY(0); opacity: 0; }
              14%, 86% { transform: scaleY(1); opacity: 1; }
              91%, 100% { transform: scaleY(0); opacity: 0; }
            }
            
            @keyframes animBreathe {
              0%, 21.5% { transform: scale(1); }
              34% { transform: scale(1.02); }
              46.5%, 100% { transform: scale(1); }
            }
          </style>
          
          <mask id="sweep-mask">
            <g transform="skewX(-20)">
              <rect y="40" height="120" width="35" fill="white">
                <animate attributeName="x" 
                         values="-80; -80; 360; 360" 
                         keyTimes="0; 0.465; 0.665; 1" 
                         keySplines="0.4 0 0.2 1; 0.4 0 0.2 1; 0.4 0 0.2 1" 
                         calcMode="spline" 
                         dur="8s" 
                         repeatCount="indefinite" />
              </rect>
            </g>
          </mask>
        </defs>

        <g class="breathe-group">
          <!-- The central dot/line -->
          <rect class="dot-line" x="20" y="92" width="260" height="2" fill="var(--color-primary)" rx="1" />
          
          <!-- The morphing text -->
          <g class="text-container">
            <text class="hero-text" x="150" y="92">Learn Beyond Limits</text>
            <!-- Highlight text overlay -->
            <text class="hero-text hero-highlight" x="150" y="92" opacity="0.6" mask="url(#sweep-mask)">Learn Beyond Limits</text>
          </g>
        </g>
      </svg>
    `;

    const textContainer = document.createElement('div');
    textContainer.style.cssText = 'display:flex; flex-direction:column; align-items:center; text-align:center; gap:var(--space-2); margin-top:-20px;';

    const title = document.createElement('div');
    title.style.cssText = 'font-family: \'BKamran\', \'B Kamran\', var(--font-heading); font-weight:bold; font-size:36px; color:var(--text-primary); opacity: 0.9; margin-bottom: -4px;';
    title.textContent = 'همراه هوشمند یادگیری';

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:14px; color:var(--text-secondary); line-height:1.6; font-weight:400; max-width:280px; opacity:0.75;';
    desc.textContent = 'سوالی بپرسید یا سندی را برای تحلیل و بررسی ارسال کنید.';

    textContainer.append(title, desc);
    wrapper.append(animContainer, textContainer);
    chatList.appendChild(wrapper);
  }

  async function handleResetChat() {
    if (!activeConversation) return;
    openDialog({
      title: 'پاک کردن تاریخچه گفتگو؟',
      body: 'این گفتگو دیگر قابل بازیابی نخواهد بود.',
      actions: [
        { label: 'انصراف', variant: 'text' },
        {
          label: 'پاک کردن',
          variant: 'danger',
          onClick: async () => {
            await aiConversationRepository.delete(activeConversation.id);
            activeConversation = null;
            renderGreeting();
          }
        }
      ]
    });
  }

  async function handleSend() {
    const text = inputField.input.value.trim();
    if (!text && selectedAttachments.length === 0) return;

    if (selectedAttachments.some((a) => a.status === 'loading' || a.status === 'processing' || a.status === 'uploading')) {
      showToast('لطفاً صبر کنید تا بارگذاری فایل‌ها تمام شود.', 'info');
      return;
    }
    if (selectedAttachments.some((a) => a.status === 'error')) {
      showToast('یک یا چند پیوست ناقص است. آن‌ها را حذف کنید یا دوباره اضافه کنید.', 'warning');
      return;
    }

    if (activeConversation && generatingConversationId === activeConversation.id) {
      showToast('لطفاً صبر کنید تا پاسخ فعلی تمام شود (یا آن را متوقف کنید).', 'info');
      return;
    }

    inputField.input.value = '';
    aiDraftText = '';
    inputField.input.focus();
    adjustInputHeight();

    if (!activeConversation) {
      chatList.innerHTML = '';
    }

    const msgAttachments = selectedAttachments
      .filter((a) => a.status === 'ready' && a.data)
      .map(({ name, mimeType, size, data, dataUrl, fileUri, aiProvider }) => ({ name, mimeType, size, data, dataUrl, fileUri, aiProvider }));
    selectedAttachments = [];
    updateAttachmentsUI();

    const dbCatId = currentCategoryId === 'general' ? null : currentCategoryId;
    if (!activeConversation) {
      activeConversation = createAiConversationModel({
        categoryId: dbCatId,
        messages: []
      });
      await aiConversationRepository.create(activeConversation);
    }
    const newMessageIndex = activeConversation.messages.length;

    renderMessage('user', text, msgAttachments, { messageIndex: newMessageIndex });
    chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });

    activeConversation.messages.push({
      sender: 'user',
      text,
      attachments: msgAttachments,
      timestamp: new Date().toISOString()
    });
    activeConversation.updatedAt = new Date().toISOString();
    await aiConversationRepository.update(activeConversation.id, { messages: activeConversation.messages, updatedAt: activeConversation.updatedAt });

    await requestAIResponse();
  }

  function createStreamingBubble() {
    const bubble = document.createElement('div');
    bubble.style.cssText = 'align-self:flex-start; background:color-mix(in srgb, var(--bg-card) 60%, transparent); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.2); padding:var(--space-4); border-radius:24px 24px 24px 4px; max-width:85%; line-height:1.8; font-size:var(--text-body); color:var(--text-primary); box-shadow:0 8px 32px rgba(0,0,0,0.06); word-break:break-word; min-width:0; margin-bottom:var(--space-2);';

    const textNode = document.createElement('div');
    textNode.style.cssText = 'word-break:break-word; overflow-wrap:break-word; width:100%; white-space:pre-wrap;';
    bubble.appendChild(textNode);

    const cursor = document.createElement('span');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = 'display:inline-block; width:2px; height:1.1em; margin-right:2px; vertical-align:text-bottom; background:var(--color-primary); border-radius:1px; animation:aiCursorBlink 1s step-end infinite;';
    if (!document.getElementById('ai-stream-cursor-style')) {
      const style = document.createElement('style');
      style.id = 'ai-stream-cursor-style';
      style.textContent = '@keyframes aiCursorBlink{0%,100%{opacity:1}50%{opacity:0}}';
      document.head.appendChild(style);
    }
    bubble.appendChild(cursor);

    chatList.appendChild(bubble);

    let pending = '';
    let raf = 0;
    let lastScroll = 0;

    const flush = () => {
      raf = 0;
      // Lightweight live view: escape HTML, keep line breaks. Full markdown/math on finish.
      const escaped = pending
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      textNode.innerHTML = escaped;
      const now = Date.now();
      if (now - lastScroll > 80) {
        chatList.scrollTop = chatList.scrollHeight;
        lastScroll = now;
      }
    };

    return {
      el: bubble,
      setText(full) {
        pending = full || '';
        if (!raf) raf = requestAnimationFrame(flush);
      },
      remove() {
        if (raf) cancelAnimationFrame(raf);
        bubble.remove();
      },
    };
  }

  async function requestAIResponse() {
    const dbCatId = currentCategoryId === 'general' ? null : currentCategoryId;
    const lastUserMsg = [...activeConversation.messages].reverse().find((m) => m.sender === 'user');
    if (!lastUserMsg) return;

    // If an attachment wasn't pre-uploaded (no fileUri — e.g. a non-Gemini
    // provider, or pre-upload failed/wasn't available), its raw bytes are
    // still about to travel over the network as part of this very request.
    // Say so explicitly instead of showing a bare "AI is thinking" dots
    // indicator, so a slow connection reads as "still sending your file"
    // rather than "something's broken".
    const pendingRawAttachments = (lastUserMsg.attachments || []).some(
      (a) => !a.fileUri && (a.size || 0) > 150 * 1024
    );
    const loadBubble = renderLoadingBubble(pendingRawAttachments ? 'در حال ارسال پیوست…' : null);
    chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });

    generatingConversationId = activeConversation.id;
    generatingAbortController = new AbortController();
    setGeneratingState(true);

    let streamUi = null;
    let streamedText = '';

    try {
      const activeCat = dbCatId ? await categoryRepository.getById(dbCatId) : null;

      const customInstruction = await db.getSetting('gemini_system_instruction', '');

      let systemInstruction = getSystemInstruction(activeCat ? activeCat.title : null, activeCat ? activeCat.description : null);
      if (customInstruction) {
        systemInstruction = customInstruction + "\n\n" + systemInstruction;
      }

      const { chatWithAI } = await import('../core/ai-client.js');
      const resData = await chatWithAI({
        message: lastUserMsg.text,
        history: activeConversation.messages.slice(0, -1),
        systemInstruction,
        attachments: lastUserMsg.attachments || [],
        signal: generatingAbortController.signal,
        onChunk: (_delta, full) => {
          streamedText = full || '';
          if (!streamUi) {
            loadBubble.remove();
            streamUi = createStreamingBubble();
          }
          streamUi.setText(streamedText);
        },
      });

      if (streamUi) streamUi.remove();
      else loadBubble.remove();

      const finalText = (resData && resData.text) || streamedText;
      renderMessage('ai', finalText, null, { isLast: true });
      chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });

      activeConversation.messages.push({ sender: 'ai', text: finalText, timestamp: new Date().toISOString() });
      activeConversation.updatedAt = new Date().toISOString();
      await aiConversationRepository.update(activeConversation.id, { messages: activeConversation.messages, updatedAt: activeConversation.updatedAt });

      updateConversationTopic();

    } catch (err) {
      if (streamUi) streamUi.remove();
      else loadBubble.remove();
      const wasStoppedByUser = err && (err.name === 'AbortError' || /abort/i.test(err.message || ''));
      if (wasStoppedByUser) {
        if (streamedText && streamedText.trim()) {
          renderMessage('ai', streamedText.trim() + '\n\n_(پاسخ متوقف شد)_', null, { isLast: true });
          activeConversation.messages.push({ sender: 'ai', text: streamedText.trim(), timestamp: new Date().toISOString() });
          activeConversation.updatedAt = new Date().toISOString();
          await aiConversationRepository.update(activeConversation.id, { messages: activeConversation.messages, updatedAt: activeConversation.updatedAt });
        } else {
          renderMessage('system_info', 'پاسخ متوقف شد.');
        }
      } else {
        console.error(err);
        renderMessage('system_error', err.message || 'مشکلی در اتصال به دستیار هوشمند به وجود آمد.', null, { onRetry: requestAIResponse });
      }
      chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });
    } finally {
      if (generatingConversationId === activeConversation.id) {
        generatingConversationId = null;
        generatingAbortController = null;
      }
      setGeneratingState(false);
      const listeners = [...generatingListeners];
      generatingListeners.clear();
      listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    }
  }

  async function updateConversationTopic() {
    const conv = activeConversation;
    if (!conv) return;
    try {
      const { chatWithAI, getActiveProviderInfo } = await import('../core/ai-client.js');
      const { configured } = await getActiveProviderInfo();
      if (!configured) return;

      const transcript = conv.messages
        .filter(m => m.text)
        .map(m => `${m.sender === 'user' ? 'کاربر' : 'دستیار'}: ${m.text}`)
        .join('\n')
        .slice(-6000); // keep the prompt bounded for long chats

      const topicRes = await chatWithAI({
        message: `با توجه به کل مکالمه زیر، یک موضوع بسیار کوتاه (حداکثر ۴ کلمه) و گویا برای این گفتگو بنویس که خلاصه کل گفتگو باشد، نه فقط اولین پیام. فقط خود موضوع را بدون هیچ توضیح، گیومه یا نقطه اضافه بنویس.\n\nمکالمه:\n${transcript}`
      });

      const topicText = (topicRes && topicRes.text || '').trim().replace(/^["'«]+|["'».]+$/g, '');
      if (topicText && activeConversation && activeConversation.id === conv.id) {
        activeConversation.topic = topicText;
        await aiConversationRepository.update(conv.id, { topic: topicText });
      }
    } catch (e) {
      console.error('Topic extraction failed', e);
    }
  }

  function renderLoadingBubble(labelText) {
    const bubble = document.createElement('div');
    bubble.style.cssText = 'align-self:flex-start; background:var(--bg-card); border:1px solid var(--border-subtle); padding:var(--space-2) var(--space-3); border-radius:16px 16px 16px 4px; display:flex; align-items:center; gap:8px; max-width:80%;';

    if (labelText) {
      const label = document.createElement('span');
      label.style.cssText = 'font-size:12px; font-weight:600; color:var(--text-tertiary); white-space:nowrap;';
      label.textContent = labelText;
      bubble.appendChild(label);
    }

    const typingIndicator = createTypingIndicator();
    bubble.append(typingIndicator);
    chatList.appendChild(bubble);
    return bubble;
  }

  function parseLineEquation(eqStr) {
    let eq = eqStr.replace(/\s+/g, '').toLowerCase();
    const farsiDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
    const arabicDigits = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
    for (let i = 0; i < 10; i++) {
      eq = eq.replace(farsiDigits[i], i).replace(arabicDigits[i], i);
    }

    if (eq.startsWith('y=')) {
      eq = eq.slice(2);
    } else if (eq.startsWith('y==')) {
      eq = eq.slice(3);
    }

    eq = eq.replace(/x\^2|x\*\*2|x²|x_2/g, 'X2');
    eq = eq.replace(/x/g, 'X1');

    const termRegex = /([+-]?[^+-]+)/g;
    const terms = eq.match(termRegex) || [eq];

    let a = 0; // coefficient for x^2
    let b = 0; // coefficient for x
    let c = 0; // constant term

    for (let term of terms) {
      if (term.includes('X2')) {
        let coeffStr = term.replace('X2', '');
        if (coeffStr === '' || coeffStr === '+') {
          a = 1;
        } else if (coeffStr === '-') {
          a = -1;
        } else if (coeffStr.includes('/')) {
          const parts = coeffStr.split('/');
          const numer = parseFloat(parts[0]) || (coeffStr.startsWith('-') ? -1 : 1);
          const denom = parseFloat(parts[1]) || 1;
          a = numer / denom;
        } else {
          a = parseFloat(coeffStr);
          if (isNaN(a)) a = 1;
        }
      } else if (term.includes('X1')) {
        let coeffStr = term.replace('X1', '');
        if (coeffStr === '' || coeffStr === '+') {
          b = 1;
        } else if (coeffStr === '-') {
          b = -1;
        } else if (coeffStr.includes('/')) {
          const parts = coeffStr.split('/');
          const numer = parseFloat(parts[0]) || (coeffStr.startsWith('-') ? -1 : 1);
          const denom = parseFloat(parts[1]) || 1;
          b = numer / denom;
        } else {
          b = parseFloat(coeffStr);
          if (isNaN(b)) b = 1;
        }
      } else {
        const val = parseFloat(term);
        if (!isNaN(val)) {
          c = val;
        }
      }
    }

    return { a, b, c };
  }

  function parsePlotSpec(specText) {
    const lines = specText.split('\n');
    const isMultiLineSpec = lines.some(line => line.includes(':'));
    
    const spec = {
      title: 'نمودار تعاملی ریاضی',
      equations: [],
      points: [],
      minX: -10,
      maxX: 10,
      minY: -10,
      maxY: 10
    };

    const colors = [
      'var(--color-primary)', 
      '#EF4444', 
      '#10B981', 
      '#F59E0B', 
      '#8B5CF6', 
      '#EC4899'
    ];

    if (!isMultiLineSpec) {
      const eqStr = specText.trim();
      const parsed = parseLineEquation(eqStr);
      spec.equations.push({
        a: parsed.a,
        b: parsed.b,
        c: parsed.c,
        raw: eqStr,
        color: colors[0]
      });
    } else {
      let eqCount = 0;
      lines.forEach((line) => {
        line = line.trim();
        if (!line) return;

        const parts = line.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim().toLowerCase();
          const val = parts.slice(1).join(':').trim();
          if (key === 'charge') {
        spec.charge = parseFloat(val);
      } else if (key === 'title') {
            spec.title = val;
          } else if (key === 'eq') {
            const parsed = parseLineEquation(val);
            spec.equations.push({
              a: parsed.a,
              b: parsed.b,
              c: parsed.c,
              raw: val,
              color: colors[eqCount % colors.length]
            });
            eqCount++;
          } else if (key === 'point') {
            const pParts = val.split('|').map(s => s.trim());
            const coords = pParts[0].split(',').map(s => parseFloat(s));
            if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
              spec.points.push({
                x: coords[0],
                y: coords[1],
                label: pParts[1] || '',
                color: pParts[2] || '#EF4444'
              });
            }
          } else if (key === 'range') {
            const rangeParts = val.split(',').map(s => parseFloat(s));
            if (rangeParts.length >= 2 && !isNaN(rangeParts[0]) && !isNaN(rangeParts[1])) {
              spec.minX = rangeParts[0];
              spec.maxX = rangeParts[1];
            }
          } else if (key === 'y' || key === 'y=') {
            const parsed = parseLineEquation(val);
            spec.equations.push({
              a: parsed.a,
              b: parsed.b,
              c: parsed.c,
              raw: val,
              color: colors[eqCount % colors.length]
            });
            eqCount++;
          } else {
            const lowerVal = val.toLowerCase();
            if (lowerVal.includes('x') || lowerVal.includes('y') || /^[0-9+\-*/().\s]+$/.test(val)) {
              const parsed = parseLineEquation(line);
              if (parsed.a !== 0 || parsed.b !== 0 || parsed.c !== 0) {
                spec.equations.push({
                  a: parsed.a,
                  b: parsed.b,
                  c: parsed.c,
                  raw: line,
                  color: colors[eqCount % colors.length]
                });
                eqCount++;
              }
            }
          }
        } else {
          const lower = line.toLowerCase();
          if (lower.startsWith('y=') || lower.includes('x') || /^[0-9+\-*/().\s]+$/.test(line)) {
            const parsed = parseLineEquation(line);
            spec.equations.push({
              a: parsed.a,
              b: parsed.b,
              c: parsed.c,
              raw: line,
              color: colors[eqCount % colors.length]
            });
            eqCount++;
          }
        }
      });
    }

    return spec;
  }

    function initInteractivePlots(parent) {
    try { IW.initPlots(parent, iwWidgetOpts()); } catch (e) { console.error("plot init", e); }
  }

  function toPersianDigits(str) {
    if (!str) return '';
    const farsi = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return str.toString().replace(/[0-9]/g, w => farsi[+w]);
  }

  function parseVennSpec(specText) {
    const lines = specText.split('\n');
    const spec = {
      title: 'نمودار ون مجموعه‌ها',
      label_A: 'A',
      label_B: 'B',
      label_C: '',
      label_D: '',
      elements_A: [],
      elements_B: [],
      elements_C: [],
      elements_D: [],
      elements_AB: [],
      elements_AC: [],
      elements_AD: [],
      elements_BC: [],
      elements_BD: [],
      elements_CD: [],
      elements_ABC: [],
      elements_ABD: [],
      elements_ACD: [],
      elements_BCD: [],
      elements_ABCD: [],
      elements_intersection: [],
      elements_U: [],
      shade: 'none',
      layout: 'overlapping'
    };

    lines.forEach((line) => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase();
        const val = parts.slice(1).join(':').trim();
        if (key === 'title') spec.title = val;
        else if (key === 'label_a') spec.label_A = val;
        else if (key === 'label_b') spec.label_B = val;
        else if (key === 'label_c') spec.label_C = val;
        else if (key === 'label_d') spec.label_D = val;
        else if (key === 'elements_a') spec.elements_A = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_b') spec.elements_B = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_c') spec.elements_C = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_d') spec.elements_D = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_ab') spec.elements_AB = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_ac') spec.elements_AC = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_ad') spec.elements_AD = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_bc') spec.elements_BC = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_bd') spec.elements_BD = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_cd') spec.elements_CD = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_abc') spec.elements_ABC = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_abd') spec.elements_ABD = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_acd') spec.elements_ACD = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_bcd') spec.elements_BCD = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_abcd') spec.elements_ABCD = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_intersection') spec.elements_intersection = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'elements_u') spec.elements_U = val.split(',').map(s => s.trim()).filter(Boolean);
        else if (key === 'shade') spec.shade = val;
        else if (key === 'layout') spec.layout = val.toLowerCase().trim();
      }
    });

    return spec;
  }

  function parseIntervalSpec(specText) {
    const lines = specText.split('\n');
    const spec = {
      title: 'بازه روی محور اعداد',
      intervals: []
    };

    lines.forEach((line) => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase();
        const val = parts.slice(1).join(':').trim();
        if (key === 'charge') {
        spec.charge = parseFloat(val);
      } else if (key === 'title') {
          spec.title = val;
        } else if (key === 'interval') {
          const iParts = val.split('|').map(s => s.trim());
          if (iParts.length >= 2) {
            const label = iParts[0];
            const rangeStr = iParts[1];
            const color = iParts[2] || 'var(--color-primary)';
            const desc = iParts[3] || '';
            spec.intervals.push({ label, rangeStr, color, desc });
          }
        }
      }
    });

    return spec;
  }

  function parseRange(rangeStr) {
    const clean = rangeStr.trim();
    if (clean.length < 5) return null;
    const startChar = clean[0];
    const endChar = clean[clean.length - 1];
    const inner = clean.slice(1, -1);
    const parts = inner.split(',').map(s => s.trim());
    if (parts.length === 2) {
      const startValStr = parts[0];
      const endValStr = parts[1];
      
      const evalVal = (str) => {
        const s = str.toLowerCase().replace(/[\s\\]/g, '');
        if (s.includes('-infty') || s.includes('-∞') || s.includes('infty-') || s.includes('∞-')) return Number.NEGATIVE_INFINITY;
        if (s.includes('+infty') || s.includes('+∞') || s.includes('infty+') || s.includes('∞+') || s === 'infty' || s === '∞') return Number.POSITIVE_INFINITY;
        if (str.includes('/')) {
          const p = str.split('/');
          return parseFloat(p[0]) / parseFloat(p[1]);
        }
        return parseFloat(str);
      };

      const startVal = evalVal(startValStr);
      const endVal = evalVal(endValStr);

      return {
        startOpen: startChar === '(',
        startVal,
        startLabel: startValStr,
        endOpen: endChar === ')',
        endVal,
        endLabel: endValStr
      };
    }
    return null;
  }

  function intersectIntervals(i1, i2) {
    const r1 = parseRange(i1.rangeStr);
    const r2 = parseRange(i2.rangeStr);
    if (!r1 || !r2) return null;

    let startVal, startOpen;
    if (r1.startVal > r2.startVal) {
      startVal = r1.startVal;
      startOpen = r1.startOpen;
    } else if (r2.startVal > r1.startVal) {
      startVal = r2.startVal;
      startOpen = r2.startOpen;
    } else {
      startVal = r1.startVal;
      startOpen = r1.startOpen || r2.startOpen;
    }

    let endVal, endOpen;
    if (r1.endVal < r2.endVal) {
      endVal = r1.endVal;
      endOpen = r1.endOpen;
    } else if (r2.endVal < r1.endVal) {
      endVal = r2.endVal;
      endOpen = r2.endOpen;
    } else {
      endVal = r1.endVal;
      endOpen = r1.endOpen || r2.endOpen;
    }

    if (startVal > endVal || (startVal === endVal && (startOpen || endOpen))) {
      return null;
    }

    const startChar = startOpen ? '(' : '[';
    const endChar = endOpen ? ')' : ']';
    const startLabel = (startVal === r1.startVal) ? r1.startLabel : r2.startLabel;
    const endLabel = (endVal === r1.endVal) ? r1.endLabel : r2.endLabel;

    return {
      rangeStr: `${startChar}${startLabel}, ${endLabel}${endChar}`,
      startVal,
      startOpen,
      endVal,
      endOpen
    };
  }

  function unionIntervals(i1, i2) {
    const r1 = parseRange(i1.rangeStr);
    const r2 = parseRange(i2.rangeStr);
    if (!r1 || !r2) return null;

    const r1Start = r1.startVal;
    const r1End = r1.endVal;
    const r2Start = r2.startVal;
    const r2End = r2.endVal;

    const overlap = !(r1End < r2Start || r2End < r1Start || 
                      (r1End === r2Start && r1.endOpen && r2.startOpen) ||
                      (r2End === r1Start && r2.endOpen && r1.startOpen));

    if (overlap) {
      let startVal, startOpen, startLabel;
      if (r1Start < r2Start) {
        startVal = r1Start;
        startOpen = r1.startOpen;
        startLabel = r1.startLabel;
      } else if (r2Start < r1Start) {
        startVal = r2Start;
        startOpen = r2.startOpen;
        startLabel = r2.startLabel;
      } else {
        startVal = r1Start;
        startOpen = r1.startOpen && r2.startOpen;
        startLabel = r1.startLabel;
      }

      let endVal, endOpen, endLabel;
      if (r1End > r2End) {
        endVal = r1End;
        endOpen = r1.endOpen;
        endLabel = r1.endLabel;
      } else if (r2End > r1End) {
        endVal = r2End;
        endOpen = r2.endOpen;
        endLabel = r2.endLabel;
      } else {
        endVal = r1End;
        endOpen = r1.endOpen && r2.endOpen;
        endLabel = r1.endLabel;
      }

      const startChar = startOpen ? '(' : '[';
      const endChar = endOpen ? ')' : ']';
      return {
        rangeStr: `${startChar}${startLabel}, ${endLabel}${endChar}`,
        startVal,
        startOpen,
        endVal,
        endOpen
      };
    } else {
      return {
        rangeStr: `${i1.rangeStr} ∪ ${i2.rangeStr}`,
        isSplit: true
      };
    }
  }

  function renderSvgTickLabel(x, y, labelStr) {
    if (labelStr.includes('/')) {
      const isNeg = labelStr.startsWith('-');
      const cleanStr = isNeg ? labelStr.slice(1) : labelStr;
      const p = cleanStr.split('/');
      const num = toPersianDigits(p[0]);
      const den = toPersianDigits(p[1]);
      
      let html = `<g transform="translate(${x}, ${y + 8})">`;
      if (isNeg) {
        html += `<text x="-10" y="-1" font-size="10" fill="var(--text-primary)" text-anchor="middle" font-weight="700">-</text>`;
        html += `<line x1="-5" x2="7" y1="-4" y2="-4" stroke="var(--text-primary)" stroke-width="1" />`;
        html += `<text x="1" y="-9" font-size="8" fill="var(--text-primary)" text-anchor="middle" font-weight="700">${num}</text>`;
        html += `<text x="1" y="3" font-size="8" fill="var(--text-primary)" text-anchor="middle" font-weight="700">${den}</text>`;
      } else {
        html += `<line x1="-6" x2="6" y1="-4" y2="-4" stroke="var(--text-primary)" stroke-width="1" />`;
        html += `<text x="0" y="-9" font-size="8" fill="var(--text-primary)" text-anchor="middle" font-weight="700">${num}</text>`;
        html += `<text x="0" y="3" font-size="8" fill="var(--text-primary)" text-anchor="middle" font-weight="700">${den}</text>`;
      }
      html += `</g>`;
      return html;
    } else {
      return `<text x="${x}" y="${y + 10}" font-size="10" fill="var(--text-primary)" text-anchor="middle" font-weight="700">${toPersianDigits(labelStr)}</text>`;
    }
  }

  function parseMindmapSpec(specStr) {
    const lines = specStr.split('\n');
    const spec = {
      title: 'نمودار درختی / نقشه ذهنی',
      nodes: []
    };
    
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      
      let id = null;
      let parent = null;
      
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const key = line.substring(0, colonIdx).trim().toLowerCase();
        const val = line.substring(colonIdx + 1).trim();
        if (key === 'title') {
          spec.title = val;
          continue;
        } else if (key === 'node') {
          const parts = val.split('|').map(s => s.trim());
          id = parts[0];
          parent = parts.length >= 2 ? parts[1] : null;
        }
      }
      
      if (!id && line.includes('|')) {
         const parts = line.split('|').map(s => s.trim());
         id = parts[0];
         parent = parts.length >= 2 ? parts[1] : null;
      }
      
      if (id) {
         if (parent === 'root' || parent === '') parent = null;
         spec.nodes.push({ id, parent });
      }
    }
    
    const uniqueNodesMap = new Map();
    spec.nodes.forEach(n => {
       if (!uniqueNodesMap.has(n.id)) {
           uniqueNodesMap.set(n.id, n);
       } else if (n.parent && !uniqueNodesMap.get(n.id).parent) {
           uniqueNodesMap.get(n.id).parent = n.parent;
       }
    });
    
    const missingParents = new Set();
    uniqueNodesMap.forEach(n => {
       if (n.parent && !uniqueNodesMap.has(n.parent)) {
           missingParents.add(n.parent);
       }
    });
    
    missingParents.forEach(pid => {
       uniqueNodesMap.set(pid, { id: pid, parent: null });
    });
    
    spec.nodes = Array.from(uniqueNodesMap.values());
    
    return spec;
  }

  function downloadSvgAsPng(svgElement, filename) {
    const svgClone = svgElement.cloneNode(true);
    
    const styles = getComputedStyle(document.body);
    const bgCard = styles.getPropertyValue('--bg-card').trim() || '#ffffff';
    const borderStrong = styles.getPropertyValue('--border-strong').trim() || '#cccccc';
    const colorPrimary = styles.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const textPrimary = styles.getPropertyValue('--text-primary').trim() || '#111827';
    const bgSunken = styles.getPropertyValue('--bg-sunken').trim() || '#f9fafb';
    
    const elements = svgClone.querySelectorAll('*');
    elements.forEach(el => {
      ['fill', 'stroke'].forEach(attr => {
        let val = el.getAttribute(attr);
        if (val) {
          val = val.replace(/var\(--bg-card\)/g, bgCard);
          val = val.replace(/var\(--border-strong\)/g, borderStrong);
          val = val.replace(/var\(--color-primary\)/g, colorPrimary);
          val = val.replace(/var\(--text-primary\)/g, textPrimary);
          val = val.replace(/var\(--bg-sunken\)/g, bgSunken);
          el.setAttribute(attr, val);
        }
      });
    });

    const vbMatch = svgClone.getAttribute('viewBox').split(',');
    if (vbMatch && vbMatch.length >= 4) {
      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("x", vbMatch[0]);
      bgRect.setAttribute("y", vbMatch[1]);
      bgRect.setAttribute("width", vbMatch[2]);
      bgRect.setAttribute("height", vbMatch[3]);
      bgRect.setAttribute("fill", bgCard);
      svgClone.insertBefore(bgRect, svgClone.firstChild);
    }
    
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svgClone);
    
    const canvas = document.createElement('canvas');
    const width = parseFloat(svgClone.getAttribute('width')) || 800;
    const height = parseFloat(svgClone.getAttribute('height')) || 600;
    
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    img.onload = async () => {
      ctx.fillStyle = bgCard;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, width * scale, height * scale);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const { saveOrShareFile } = await import('../core/native-file.js');
      await saveOrShareFile({ filename: `${filename}.png`, content: base64, mimeType: 'image/png', isBase64: true });
    };
    img.src = url;
  }

    function initMindmaps(parent) {
    try { IW.initMindmaps(parent, iwWidgetOpts()); } catch (e) { console.error("mindmap init", e); }
  }

  function parsePhysicsSpec(specStr) {
    const lines = specStr.split('\n');
    const spec = {
      title: 'شبیه‌سازی فیزیک',
      type: 'projectile',
      v0: 10,
      angle: 45,
      h0: 0,
      g: 9.8,
      mass: 1,
      mu: 0,
      forces: []
    };
    
    for (let line of lines) {
      line = line.split('#')[0].trim();
      if (!line) continue;
      const [keyPart, ...valParts] = line.split(':');
      const key = keyPart.trim();
      const val = valParts.join(':').trim();
      
      if (key === 'title') spec.title = val;
      else if (key === 'type') spec.type = val;
      else if (key === 'v0') spec.v0 = parseFloat(val);
      else if (key === 'angle') spec.angle = parseFloat(val);
      else if (key === 'h0') spec.h0 = parseFloat(val);
      else if (key === 'g') spec.g = parseFloat(val);
      else if (key === 'mass') spec.mass = parseFloat(val);
      else if (key === 'mu') spec.mu = parseFloat(val);
      else if (key === 'mu_s') spec.mu_s = parseFloat(val);
      else if (key === 'mu_k') spec.mu_k = parseFloat(val);
      else if (key === 'length') spec.length = parseFloat(val);
      else if (key === 'k') spec.k = parseFloat(val);
      else if (key === 'x0') spec.x0 = parseFloat(val);
      else if (key === 'm1') spec.m1 = parseFloat(val);
      else if (key === 'v1') spec.v1 = parseFloat(val);
      else if (key === 'm2') spec.m2 = parseFloat(val);
      else if (key === 'v2') spec.v2 = parseFloat(val);
      else if (key === 'v_s') spec.v_s = parseFloat(val);
      else if (key === 'v_o') spec.v_o = parseFloat(val);
      else if (key === 'elastic') spec.elastic = (val.trim().toLowerCase() !== 'false');
      else if (key === 'a') spec.a = parseFloat(val);
      else if (key === 't') spec.t = parseFloat(val);
      else if (key === 'radius') spec.radius = parseFloat(val);
      else if (key === 'period') spec.period = parseFloat(val);
      else if (key === 'amplitude') spec.amplitude = parseFloat(val);
      else if (key === 'wavelength') spec.wavelength = parseFloat(val);
      else if (key === 'frequency') spec.frequency = parseFloat(val);
      else if (key === 'intensity') spec.intensity = parseFloat(val);
      else if (key === 'work_function') spec.work_function = parseFloat(val);
      else if (key === 'left_type') spec.left_type = val.trim();
      else if (key === 'rho_base') spec.rho_base = parseFloat(val);
      else if (key === 'rho_add') spec.rho_add = parseFloat(val);
      else if (key === 'h_add') spec.h_add = parseFloat(val);
      else if (key === 'rho_right') spec.rho_right = parseFloat(val);
      else if (key === 'h_right') spec.h_right = parseFloat(val);
      else if (key === 'rho_left') spec.rho_left = parseFloat(val);
      else if (key === 'h_left') spec.h_left = parseFloat(val);
      else if (key === 'p_gas') spec.p_gas = parseFloat(val);
      else if (key === 'arms' || key === 'connections' || key === 'liquids' || key === 'labels' || key === 'lines') {
          try { spec[key] = JSON.parse(val); } catch(e) { spec[key] = []; }
      }
      else if (key === 'T') spec.T = parseFloat(val);
      else if (key === 'V') spec.V = parseFloat(val);
      else if (key === 'n') spec.n = parseFloat(val);
      else if (key === 'rho_f') spec.rho_f = parseFloat(val);
      else if (key === 'rho_s') spec.rho_s = parseFloat(val);
      else if (key === 'v_obj') spec.v_obj = parseFloat(val);
      else if (key === 'area') spec.area = parseFloat(val);
      else if (key === 'distance') spec.distance = parseFloat(val);
      else if (key === 'dielectric') spec.dielectric = parseFloat(val);
      else if (key === 'voltage') spec.voltage = parseFloat(val);
      else if (key === 'q') spec.q = parseFloat(val);
      else if (key === 'v') spec.v = parseFloat(val);
      else if (key === 'B') spec.B = parseFloat(val);
      else if (key === 'turns') spec.turns = parseFloat(val);
      else if (key === 'reversed_poles') spec.reversed_poles = (val.trim().toLowerCase() === 'true');
      else if (key === 'charges') {
        spec.charges = val.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      }
      else if (key === 'resistors') {
        spec.resistors = val.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
      }
      else if (key === 'element') spec.element = val.trim();
      else if (key === 'f') spec.f = parseFloat(val);
      else if (key === 'do') spec.do = parseFloat(val);
      else if (key === 'ho') spec.ho = parseFloat(val);
      else if (key === 'force') {
        const parts = val.split('|').map(s => s.trim());
        if (parts.length >= 3) {
          spec.forces.push({
            name: parts[0],
            mag: parseFloat(parts[1]),
            angle: parseFloat(parts[2]),
            color: parts[3] || 'var(--color-primary)'
          });
        }
      } else {
        spec[key] = val; // Catch-all for new or arbitrary string parameters
      }
    }
    return spec;
  }

  function initLiveCodeBlocks(parent) {
    const LIVE_CANVAS_W = 960;
    const LIVE_CANVAS_H = 600;

    const viewports = parent.querySelectorAll('.live-code-viewport');
    viewports.forEach(viewport => {
      const scaler = viewport.querySelector('.live-code-scaler');
      if (!scaler) return;
      const applyScale = () => {
        const w = viewport.clientWidth;
        if (!w) return;
        const scale = w / LIVE_CANVAS_W;
        scaler.style.transform = `scale(${scale})`;
      };
      applyScale();
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(applyScale);
        ro.observe(viewport);
      } else {
        window.addEventListener('resize', applyScale);
      }
    });

    const expandBtns = parent.querySelectorAll('.live-code-expand-btn');
    expandBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.live-code-card');
        const iframe = card.querySelector('iframe');
        const docStr = iframe.srcdoc;

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:9999; background:#000; display:flex; align-items:center; justify-content:center; overflow:hidden;';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'icon-btn material-symbols-rounded';
        closeBtn.textContent = 'close';
        closeBtn.style.cssText = 'position:fixed; top:16px; left:16px; z-index:10000; background:rgba(0,0,0,0.6); color:#fff; width:44px; height:44px; border-radius:50%; border:none; cursor:pointer; font-size:24px; display:flex; align-items:center; justify-content:center;';

        const bigWrap = document.createElement('div');
        bigWrap.style.cssText = `position:relative; width:${LIVE_CANVAS_W}px; height:${LIVE_CANVAS_H}px; transform-origin:center center;`;

        const bigIframe = document.createElement('iframe');
        bigIframe.sandbox = 'allow-scripts';
        bigIframe.srcdoc = docStr;
        bigIframe.style.cssText = `width:${LIVE_CANVAS_W}px; height:${LIVE_CANVAS_H}px; border:none; display:block; background:#fff;`;

        bigWrap.appendChild(bigIframe);
        overlay.appendChild(closeBtn);
        overlay.appendChild(bigWrap);
        document.body.appendChild(overlay);

        const fitToScreen = () => {
          const scale = Math.min(window.innerWidth / LIVE_CANVAS_W, window.innerHeight / LIVE_CANVAS_H);
          bigWrap.style.transform = `scale(${scale})`;
        };
        fitToScreen();
        window.addEventListener('resize', fitToScreen);
        closeBtn.onclick = () => {
          window.removeEventListener('resize', fitToScreen);
          overlay.remove();
        };
      });
    });

    const codeBtns = parent.querySelectorAll('.live-code-view-btn');
    codeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const rawCode = decodeURIComponent(btn.getAttribute('data-code'));
        
        const container = document.createElement('div');
        container.style.cssText = 'display:flex; flex-direction:column; gap:16px;';
        
        const pre = document.createElement('pre');
        pre.className = 'code-block';
        pre.style.cssText = 'background:var(--bg-sunken); font-family:var(--font-mono); direction:ltr; text-align:left; overflow-x:auto; padding:16px; border-radius:12px; margin:0; border:1px solid var(--border-soft); font-size:var(--text-caption); max-height: 50vh;';
        const code = document.createElement('code');
        code.textContent = rawCode;
        pre.appendChild(code);
        
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:12px; justify-content:flex-end;';
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-outline';
        copyBtn.textContent = 'کپی کد';
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(rawCode).then(() => {
            import('../core/ui.js').then(({ showToast }) => showToast('کد کپی شد', 'success'));
          });
        };
        
        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn btn-primary';
        dlBtn.textContent = 'دانلود / اشتراک‌گذاری فایل';
        dlBtn.onclick = async () => {
          dlBtn.disabled = true;
          const originalText = dlBtn.textContent;
          dlBtn.textContent = 'در حال آماده‌سازی...';
          try {
            const { saveOrShareFile } = await import('../core/native-file.js');
            const { showToast } = await import('../core/ui.js');
            const result = await saveOrShareFile({ filename: 'ai-creation.html', content: rawCode, mimeType: 'text/html' });
            if (result.method === 'share') {
              showToast('حالا محل ذخیره فایل (دانلودها، درایو و...) را انتخاب کنید.', 'success');
            }
          } catch (err) {
            const { showToast } = await import('../core/ui.js');
            showToast(`خطا در آماده‌سازی فایل: ${err.message}`, 'error');
          } finally {
            dlBtn.disabled = false;
            dlBtn.textContent = originalText;
          }
        };
        
        actions.append(copyBtn, dlBtn);
        container.append(pre, actions);
        
        import('../core/ui.js').then(({ openBottomSheet }) => {
          openBottomSheet({
            title: 'مشاهده کد',
            content: container
          });
        });
      });
    });

    const continueBtns = parent.querySelectorAll('.live-code-continue-btn');
    continueBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        inputField.input.value = 'روی همان پروژه‌ی بالا (بدون بازنویسی کامل، فقط با اصلاح لازم) این تغییر را اعمال کن: ';
        inputField.input.focus();
        handleInputChange();
        const len = inputField.input.value.length;
        inputField.input.setSelectionRange(len, len);
        wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    });
  }

    function initPhysicsSimulations(parent) {
    try { IW.initPhysicsSimulations(parent, iwWidgetOpts()); } catch (e) { console.error("physics init", e); }
  }

  function parseGeometrySpec(specStr) {
    const lines = specStr.split('\n');
    const spec = {
      title: 'شکل هندسی',
      type: 'polygon',
      points: {},
      sides: [],
      angles: [],
      area: ''
    };
    
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const [keyPart, ...valParts] = line.split(':');
      const key = keyPart.trim();
      const val = valParts.join(':').trim();
      
      if (key === 'title') spec.title = val;
      else if (key === 'type') spec.type = val;
      else if (key === 'area') spec.area = val;
      else if (key === 'point') {
        const parts = val.split('|').map(s => s.trim());
        if (parts.length >= 3) {
          spec.points[parts[0]] = { x: parseFloat(parts[1]), y: parseFloat(parts[2]) };
        }
      } else if (key === 'side') {
        const parts = val.split('|').map(s => s.trim());
        if (parts.length >= 3) {
          const pts = parts[0].split(',').map(s => s.trim());
          if (pts.length === 2) {
            spec.sides.push({ p1: pts[0], p2: pts[1], label: parts[1], formula: parts.slice(2).join(' | ') });
          }
        }
      } else if (key === 'angle') {
        const parts = val.split('|').map(s => s.trim());
        if (parts.length >= 3) {
          spec.angles.push({ p: parts[0], label: parts[1], formula: parts.slice(2).join(' | ') });
        }
      }
    }
    return spec;
  }

    function initInteractiveGeometry(parent) {
    try { IW.initInteractiveGeometry(parent, iwWidgetOpts()); } catch (e) { console.error("geometry init", e); }
  }

  function parseLewisSpec(specText) {
    const spec = { title: 'ساختار لوویس', charge: null, atoms: [], bonds: [], lones: [] };
    specText.split('\n').forEach((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return;
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = line.slice(colonIdx + 1).trim();
      if (key === 'charge') {
        spec.charge = parseFloat(val);
      } else if (key === 'title') {
        spec.title = val;
      } else if (key === 'atom') {
        const parts = val.split('|').map((s) => s.trim());
        if (parts.length >= 5) {
          spec.atoms.push({
            id: parts[0],
            symbol: parts[1],
            charge: parseFloat(parts[2]) || 0,
            x: parseFloat(parts[3]) || 0,
            y: parseFloat(parts[4]) || 0,
          });
        }
      } else if (key === 'bond') {
        const parts = val.split('|').map((s) => s.trim());
        const pair = (parts[0] || '').split('-');
        if (pair.length === 2) {
          spec.bonds.push({ a: pair[0].trim(), b: pair[1].trim(), order: parseInt(parts[1], 10) || 1 });
        }
      } else if (key === 'lone') {
        const parts = val.split('|').map((s) => s.trim());
        if (parts.length >= 2) {
          spec.lones.push({ id: parts[0], count: parseInt(parts[1], 10) || 0 });
        }
      }
    });
    return spec;
  }

  const ELEMENT_COLORS = {
    H: '#5b6472', C: '#2d2d2d', N: '#2563eb', O: '#dc2626', F: '#16a34a',
    Cl: '#16a34a', Br: '#92400e', I: '#7c3aed', S: '#ca8a04', P: '#ea580c',
    Na: '#7c3aed', K: '#7c3aed', Mg: '#059669', Ca: '#059669', Si: '#78716c',
  };

  function formatCharge(charge) {
    if (!charge) return '';
    const abs = Math.abs(charge);
    const num = abs === 1 ? '' : String(Math.round(abs));
    return num + (charge > 0 ? '+' : '−');
  }

  function buildLewisSvg(spec) {
    const PX_PER_UNIT = 46;
const PADDING = spec.charge != null ? 65 : 50; // extra padding for brackets
    const ATOM_R = 15; // buffer radius so bonds/lone pairs don't overlap the symbol

    const xs = spec.atoms.map((a) => a.x);
    const ys = spec.atoms.map((a) => a.y);
    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 0);
    const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0);

    const toPx = (a) => ({
      x: PADDING + (a.x - minX) * PX_PER_UNIT,
      y: PADDING + (a.y - minY) * PX_PER_UNIT,
    });

    const width = PADDING * 2 + (maxX - minX) * PX_PER_UNIT;
    const height = PADDING * 2 + (maxY - minY) * PX_PER_UNIT;

    const posById = {};
    spec.atoms.forEach((a) => { posById[a.id] = { ...toPx(a), atom: a }; });

    let bondsSvg = '';
    const bondAnglesByAtom = {};
    spec.bonds.forEach((bond) => {
      const p1 = posById[bond.a];
      const p2 = posById[bond.b];
      if (!p1 || !p2) return;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len; // unit vector along the bond
      const px = -uy, py = ux; // perpendicular unit vector

      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      (bondAnglesByAtom[bond.a] = bondAnglesByAtom[bond.a] || []).push(angleDeg);
      (bondAnglesByAtom[bond.b] = bondAnglesByAtom[bond.b] || []).push((angleDeg + 180) % 360);

      const x1 = p1.x + ux * ATOM_R, y1 = p1.y + uy * ATOM_R;
      const x2 = p2.x - ux * ATOM_R, y2 = p2.y - uy * ATOM_R;

      const order = Math.min(Math.max(bond.order, 1), 3);
      const offsets = order === 1 ? [0] : order === 2 ? [-3.5, 3.5] : [-6, 0, 6];
      offsets.forEach((off) => {
        bondsSvg += `<line x1="${x1 + px * off}" y1="${y1 + py * off}" x2="${x2 + px * off}" y2="${y2 + py * off}" stroke="var(--text-primary)" stroke-width="2.2" stroke-linecap="round" />`;
      });
    });

    let atomsSvg = '';
    let lonesSvg = '';
    spec.atoms.forEach((a) => {
      const p = posById[a.id];
      const color = ELEMENT_COLORS[a.symbol] || 'var(--text-primary)';
      atomsSvg += `
        <circle cx="${p.x}" cy="${p.y}" r="${ATOM_R + 3}" fill="var(--bg-card)" />
        <text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" font-size="21" font-weight="800" font-family="var(--font-mono), sans-serif" fill="${color}">${a.symbol}</text>
      `;
      if (a.charge) {
        atomsSvg += `<text x="${p.x + 14}" y="${p.y - 14}" text-anchor="middle" font-size="13" font-weight="800" fill="${color}">${formatCharge(a.charge)}</text>`;
      }

      const loneEntry = spec.lones.find((l) => l.id === a.id);
      if (loneEntry && loneEntry.count > 0) {
        const usedAngles = bondAnglesByAtom[a.id] || [];
        const candidates = [90, 270, 0, 180, 45, 135, 225, 315];
        const isFree = (deg) => usedAngles.every((u) => {
          let diff = Math.abs(((deg - u + 540) % 360) - 180);
          return diff > 35;
        });
        const freeDirs = candidates.filter(isFree);
        const dirsToUse = (freeDirs.length > 0 ? freeDirs : candidates).slice(0, loneEntry.count);
        dirsToUse.forEach((deg) => {
          const rad = (deg * Math.PI) / 180;
          const dx = Math.cos(rad), dy = Math.sin(rad);
          const px = -dy, py = dx; // perpendicular, for spacing the 2 dots of the pair
          const cx = p.x + dx * (ATOM_R + 10);
          const cy = p.y + dy * (ATOM_R + 10);
          [-3.2, 3.2].forEach((off) => {
            lonesSvg += `<circle cx="${cx + px * off}" cy="${cy + py * off}" r="2.1" fill="var(--text-primary)" />`;
          });
        });
      }
    });

    
    let overallChargeSvg = '';
    if (spec.charge != null && spec.charge !== 0) {
      const bX = 25;
      const bW = width - 50;
      const bY = 25;
      const bH = height - 50;
      const tlen = 10;
      
      overallChargeSvg += `
        <path d="M ${bX + tlen} ${bY} L ${bX} ${bY} L ${bX} ${bY + bH} L ${bX + tlen} ${bY + bH}" fill="none" stroke="var(--text-primary)" stroke-width="2" />
        <path d="M ${bX + bW - tlen} ${bY} L ${bX + bW} ${bY} L ${bX + bW} ${bY + bH} L ${bX + bW - tlen} ${bY + bH}" fill="none" stroke="var(--text-primary)" stroke-width="2" />
        <text x="${bX + bW + 4}" y="${bY}" font-size="18" font-weight="800" font-family="var(--font-mono), sans-serif" fill="var(--text-primary)">${formatCharge(spec.charge)}</text>
      `;
    }

    const svg = `<svg class="lewis-svg" viewBox="0,0,${width},${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${bondsSvg}${atomsSvg}${lonesSvg}${overallChargeSvg}
    </svg>`;

    return { svg, width, height };
  }

    function initVennDiagrams(parent) {
    try { IW.initVennDiagrams(parent, iwWidgetOpts()); } catch (e) { console.error("venn init", e); }
  }

    function initLewisStructures(parent) {
    try { IW.initLewisStructures(parent, iwWidgetOpts()); } catch (e) { console.error("lewis init", e); }
  }

  function initIntervalPlots(parent) {
    const cards = parent.querySelectorAll('.interactive-interval-card');
    cards.forEach((card) => {
        initInteractiveInterval(card);
    });
  }

  function initMathZoom(parent) {
    const nodes = parent.querySelectorAll('.math-inline, .math-block');
    nodes.forEach((node) => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.style.cssText = 'z-index:3000; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; padding:var(--space-5);';

        const box = document.createElement('div');
        box.style.cssText = 'background:var(--bg-card); border-radius:16px; padding:var(--space-5); max-width:92vw; max-height:80vh; overflow:auto; box-shadow:0 12px 40px rgba(0,0,0,0.35); direction:ltr; text-align:center;';

        const formulaWrap = document.createElement('div');
        formulaWrap.style.cssText = 'font-family:var(--font-mono); font-style:italic; color:var(--text-primary); font-size:34px; line-height:1.5; white-space:nowrap; display:inline-block;';
        formulaWrap.innerHTML = node.innerHTML;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'material-symbols-rounded';
        closeBtn.textContent = 'close';
        closeBtn.style.cssText = 'display:block; margin:0 0 var(--space-3) auto; background:transparent; border:none; color:var(--text-secondary); font-size:26px; cursor:pointer; direction:rtl;';
        closeBtn.addEventListener('click', () => overlay.remove());

        box.append(closeBtn, formulaWrap);
        overlay.appendChild(box);
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
          let size = 34;
          const minSize = 17;
          while (formulaWrap.scrollWidth > box.clientWidth - 8 && size > minSize) {
            size -= 2;
            formulaWrap.style.fontSize = size + 'px';
          }
          if (formulaWrap.scrollWidth > box.clientWidth - 8) {
            formulaWrap.style.whiteSpace = 'normal';
          }
        });
      });
    });
  }

  function replaceLatexSymbols(mathText, displayMode = false) {
    return renderMathSegment(mathText, displayMode);
  }


  function renderTableHTML(lines) {
    if (lines.length === 0) return '';
    
    const parseRow = (rowLine) => {
      const parts = rowLine.split('|');
      if (parts[0] === '') parts.shift();
      if (parts[parts.length - 1] === '') parts.pop();
      return parts.map(cell => cell.trim());
    };

    let headerRow = parseRow(lines[0]);
    let alignments = [];
    let startIndex = 1;
    
    if (lines.length > 1) {
      const secondRow = parseRow(lines[1]);
      const isSeparator = secondRow.every(cell => /^[-\s:]+$/.test(cell));
      if (isSeparator) {
        alignments = secondRow.map(cell => {
          const left = cell.startsWith(':');
          const right = cell.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'left';
          if (left) return 'right';
          return '';
        });
        startIndex = 2;
      }
    }
    
    let html = `
      <div style="overflow-x: auto; margin: var(--space-3) 0; border-radius: 12px; border: 1.5px solid var(--border-soft); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); background: var(--bg-card);">
        <table style="width: 100%; border-collapse: collapse; min-width: 400px; text-align: right; font-size: 13px; font-family: inherit;">
          <thead>
            <tr style="background: var(--bg-sunken); border-bottom: 2px solid var(--border-soft);">
    `;
    
    headerRow.forEach((cell, idx) => {
      const align = alignments[idx] || '';
      const alignStyle = align ? `text-align: ${align};` : '';
      html += `<th style="padding: 12px 16px; font-weight: 800; color: var(--text-primary); ${alignStyle}">${cell}</th>`;
    });
    
    html += `
            </tr>
          </thead>
          <tbody>
    `;
    
    for (let i = startIndex; i < lines.length; i++) {
      const row = parseRow(lines[i]);
      const bg = i % 2 === 0 ? 'var(--bg-sunken)' : 'var(--bg-card)';
      const borderBottom = i === lines.length - 1 ? '' : 'border-bottom: 1px solid var(--border-subtle);';
      html += `<tr style="background: ${bg}; ${borderBottom} transition: background 0.2s;">`;
      
      row.forEach((cell, idx) => {
        const align = alignments[idx] || '';
        const alignStyle = align ? `text-align: ${align};` : '';
        html += `<td style="padding: 10px 16px; color: var(--text-secondary); line-height: 1.6; ${alignStyle}">${cell}</td>`;
      });
      
      html += `</tr>`;
    }
    
    html += `
          </tbody>
        </table>
      </div>
    `;
    
    return html;
  }

  function renderMarkdownAndMath(text) {
    if (!text) return '';

    const mathBlocks = [];
    const mathInlines = [];
    const codeBlocks = [];
    const mathPlots = [];
    const vennDiagrams = [];
    const liveCodeBlocks = [];
    const intervalPlots = [];
    const geometryPlots = [];
    const mindmapPlots = [];
    const physicsPlots = [];
    const lewisStructures = [];

    let html = text;

    html = html.replace(/\`\`\`([\w-]*)\n([\s\S]*?)\`\`\`/g, (match, lang, code) => {
      if (lang === 'math' || lang === 'latex' || lang === 'tex') {
        const cleanMath = replaceLatexSymbols(code.trim(), true);
        const placeholder = `MATHBLOCKPLACEHOLDER${mathBlocks.length}`;
        mathBlocks.push(`<div class="math-block katex-display-wrapper" style="text-align:center; padding:var(--space-2) var(--space-3); margin:var(--space-2) 0; direction:ltr; display:block; overflow-x:auto; -webkit-overflow-scrolling:touch;">${cleanMath}</div>`);
        return placeholder;
      }
      if (lang === 'plot' || lang === 'chart') {
        const placeholder = `MATHPLOTPLACEHOLDER${mathPlots.length}`;
        mathPlots.push(code.trim());
        return placeholder;
      }
      if (lang === 'venn') {
        const placeholder = `VENNDIAGRAMPLACEHOLDER${vennDiagrams.length}`;
        vennDiagrams.push(code.trim());
        return placeholder;
      }
      if (lang === 'interval' || lang === 'intervals') {
        const placeholder = `INTERVALPLOTPLACEHOLDER${intervalPlots.length}`;
        intervalPlots.push(code.trim());
        return placeholder;
      }
      if (lang === 'geometry') {
        const placeholder = `GEOMETRYPLOTPLACEHOLDER${geometryPlots.length}`;
        geometryPlots.push(code.trim());
        return placeholder;
      }
      if (lang === 'mindmap' || lang === 'tree') {
        const placeholder = `MINDMAPPLOTPLACEHOLDER${mindmapPlots.length}`;
        mindmapPlots.push(code.trim());
        return placeholder;
      }
      if (lang === 'run' || lang === 'live') {
        const placeholder = `LIVECODEPLACEHOLDER${liveCodeBlocks.length}`;
        liveCodeBlocks.push(code.trim());
        return placeholder;
      }
      if (lang === 'physics') {
        const placeholder = `PHYSICSPLOTPLACEHOLDER${physicsPlots.length}`;
        physicsPlots.push(code.trim());
        return placeholder;
      }
      if (lang === 'lewis') {
        const placeholder = `LEWISPLACEHOLDER${lewisStructures.length}`;
        lewisStructures.push(code.trim());
        return placeholder;
      }
      const placeholder = `CODEBLOCKPLACEHOLDER${codeBlocks.length}`;
      codeBlocks.push(`<pre class="code-block" style="background:var(--bg-sunken); border:1px solid var(--border-soft); border-radius:12px; padding:var(--space-3); font-family:var(--font-mono); font-size:var(--text-caption); direction:ltr; text-align:left; overflow-x:auto; margin:var(--space-2) 0; box-shadow:inset 0 1px 3px rgba(0,0,0,0.05);"><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`);
      return placeholder;
    });

    // Common AI delimiters \(...\) / \[...\] → $...$ / $$...$$
    html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$${math.trim()}$$`);
    html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`);

    html = html.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (match, math) => {
      const cleanMath = replaceLatexSymbols(math.trim(), true);
      const placeholder = `MATHBLOCKPLACEHOLDER${mathBlocks.length}`;
      mathBlocks.push(`<div class="math-block katex-display-wrapper" style="text-align:center; padding:var(--space-2) var(--space-3); margin:var(--space-2) 0; direction:ltr; display:block; overflow-x:auto; -webkit-overflow-scrolling:touch;">${cleanMath}</div>`);
      return placeholder;
    });

    html = html.replace(/\$\s*([^$]+?)\s*\$/g, (match, math) => {
      const cleanMath = replaceLatexSymbols(math.trim(), false);
      const placeholder = `MATHINLINEPLACEHOLDER${mathInlines.length}`;
      // KaTeX already styles itself; keep a light wrapper for zoom + RTL isolation
      mathInlines.push(`<span class="math-inline katex-inline-wrapper" style="direction:ltr; display:inline-block; max-width:100%; overflow-x:auto; vertical-align:middle; -webkit-overflow-scrolling:touch;">${cleanMath}</span>`);
      return placeholder;
    });

    // Safety net: the AI is instructed to always wrap math in $ / $$, but if it ever
    // forgets on a standalone calculation line (e.g. "\Delta = (-5)^2 - 4(1)(6)"),
    // detect lines that are pure LaTeX (no Persian/Arabic text mixed in) and auto-wrap
    // them as display math instead of leaving raw backslash commands on screen.
    html = html.split('\n').map((line) => {
      const trimmed = line.trim();
      if (!trimmed || /PLACEHOLDER/.test(trimmed)) return line;
      if (/[\u0600-\u06FF]/.test(trimmed)) return line; // narrative Persian/Arabic text, leave alone
      const hasLatexCommand = /\\(frac|sqrt|Delta|delta|alpha|beta|gamma|theta|pi|sigma|omega|infty|sum|int|prod|lim|leq|geq|neq|approx|times|div|pm|cdot|circ|in|cup|cap|left|right|text|mathrm|mathbf|mathbb)\b/.test(trimmed);
      const hasSupSub = /[A-Za-z0-9)\]]\^\{?-?\d|[A-Za-z]_\{?-?[A-Za-z0-9]/.test(trimmed);
      if (!hasLatexCommand && !hasSupSub) return line;
      if (!/[=<>]/.test(trimmed)) return line; // require it to look like an equation, not a stray fragment
      const cleanMath = replaceLatexSymbols(trimmed, true);
      const placeholder = `MATHBLOCKPLACEHOLDER${mathBlocks.length}`;
      mathBlocks.push(`<div class="math-block katex-display-wrapper" style="text-align:center; padding:var(--space-2) var(--space-3); margin:var(--space-2) 0; direction:ltr; display:block; overflow-x:auto; -webkit-overflow-scrolling:touch;">${cleanMath}</div>`);
      return placeholder;
    }).join('\n');

    html = escapeHtml(html);

    const lines = html.split('\n');
    let resultLines = [];
    let inUnorderedList = false;
    let inOrderedList = false;
    let inTable = false;
    let tableLines = [];

    for (let line of lines) {
      const trimmed = line.trim();
      const isTableLine = trimmed.startsWith('|') && trimmed.endsWith('|');

      if (isTableLine) {
        closeLists(resultLines);
        if (!inTable) {
          inTable = true;
          tableLines = [];
        }
        tableLines.push(trimmed);
        continue;
      } else {
        if (inTable) {
          resultLines.push(renderTableHTML(tableLines));
          inTable = false;
          tableLines = [];
        }
      }

      if (trimmed === '---') {
        closeLists(resultLines);
        resultLines.push('<hr style="border:0; border-top:1.5px dashed var(--border-subtle); margin:var(--space-3) 0; width:100%;">');
        continue;
      }

      const heading3Match = line.match(/^(###|###\s)\s*(.*)$/);
      if (heading3Match) {
        closeLists(resultLines);
        resultLines.push(`<h3 style="font-size:1.1em; font-weight:800; color:var(--text-primary); margin-top:var(--space-3); margin-bottom:var(--space-2); display:block; border-right:3px solid var(--color-primary); padding-right:8px; line-height:1.5;">${heading3Match[2].trim()}</h3>`);
        continue;
      }

      const heading2Match = line.match(/^(##|##\s)\s*(.*)$/);
      if (heading2Match) {
        closeLists(resultLines);
        resultLines.push(`<h2 style="font-size:1.2em; font-weight:800; color:var(--text-primary); margin-top:var(--space-4); margin-bottom:var(--space-2); display:block; border-right:4px solid var(--color-primary); padding-right:10px; line-height:1.5;">${heading2Match[2].trim()}</h2>`);
        continue;
      }

      const heading1Match = line.match(/^(#|#\s)\s*(.*)$/);
      if (heading1Match) {
        closeLists(resultLines);
        resultLines.push(`<h1 style="font-size:1.3em; font-weight:800; color:var(--text-primary); margin-top:var(--space-4); margin-bottom:var(--space-2); display:block; border-right:5px solid var(--color-primary); padding-right:12px; line-height:1.5;">${heading1Match[2].trim()}</h1>`);
        continue;
      }

      const quoteMatch = line.match(/^>\s*(.*)$/);
      if (quoteMatch) {
        closeLists(resultLines);
        resultLines.push(`<blockquote style="border-right:3px solid var(--color-primary); background:var(--bg-sunken); padding:var(--space-2) var(--space-3); margin:var(--space-2) 0; border-radius:0 8px 8px 0; color:var(--text-secondary); font-style:italic; line-height:1.6;">${quoteMatch[1].trim()}</blockquote>`);
        continue;
      }

      const ulMatch = line.match(/^[\*\-]\s+(.*)$/);
      if (ulMatch) {
        if (inOrderedList) {
          resultLines.push('</ol>');
          inOrderedList = false;
        }
        if (!inUnorderedList) {
          resultLines.push('<ul style="margin:var(--space-2) 0; padding-right:var(--space-4); list-style-type:disc; display:flex; flex-direction:column; gap:6px;">');
          inUnorderedList = true;
        }
        resultLines.push(`<li style="line-height:1.6; color:var(--text-primary);">${ulMatch[1].trim()}</li>`);
        continue;
      }

      const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
      if (olMatch) {
        if (inUnorderedList) {
          resultLines.push('</ul>');
          inUnorderedList = false;
        }
        if (!inOrderedList) {
          resultLines.push('<ol style="margin:var(--space-2) 0; padding-right:var(--space-4); list-style-type:decimal; display:flex; flex-direction:column; gap:6px;">');
          inOrderedList = true;
        }
        resultLines.push(`<li style="line-height:1.6; color:var(--text-primary);">${olMatch[2].trim()}</li>`);
        continue;
      }

      if (trimmed === '') {
        closeLists(resultLines);
        resultLines.push('<div style="height:var(--space-2);"></div>');
      } else {
        closeLists(resultLines);
        resultLines.push(`<p style="line-height:1.7; margin-bottom:var(--space-2); color:var(--text-primary);">${line}</p>`);
      }
    }

    if (inTable) {
      resultLines.push(renderTableHTML(tableLines));
      inTable = false;
      tableLines = [];
    }

    closeLists(resultLines);

    function closeLists(arr) {
      if (inUnorderedList) {
        arr.push('</ul>');
        inUnorderedList = false;
      }
      if (inOrderedList) {
        arr.push('</ol>');
        inOrderedList = false;
      }
    }

    let finalHtml = resultLines.join('\n');

    finalHtml = finalHtml.replace(/\*\*([\s\S]*?)\*\*/g, '<strong style="font-weight:800; color:var(--text-primary);">$1</strong>');
    finalHtml = finalHtml.replace(/\*([\s\S]*?)\*/g, '<em style="font-style:italic;">$1</em>');
    finalHtml = finalHtml.replace(/_([\s\S]*?)_/g, '<em style="font-style:italic;">$1</em>');
    finalHtml = finalHtml.replace(/`([^`]+)`/g, '<code style="background:var(--bg-sunken); border:1.5px solid var(--border-soft); padding:2px 6px; border-radius:6px; font-family:var(--font-mono); font-size:0.9em; color:var(--color-primary); font-weight:600; direction:ltr; display:inline-block;">$1</code>');

    for (let i = 0; i < mathBlocks.length; i++) {
      finalHtml = finalHtml.replace(`MATHBLOCKPLACEHOLDER${i}`, mathBlocks[i]);
    }
    for (let i = 0; i < mathInlines.length; i++) {
      finalHtml = finalHtml.replace(`MATHINLINEPLACEHOLDER${i}`, mathInlines[i]);
    }

    finalHtml = renderFractionsInText(finalHtml);

    for (let i = 0; i < codeBlocks.length; i++) {
      finalHtml = finalHtml.replace(`CODEBLOCKPLACEHOLDER${i}`, codeBlocks[i]);
    }

    for (let i = 0; i < mathPlots.length; i++) {
      const eqStr = mathPlots[i];
      const plotCardHtml = `
        <div class="interactive-plot-card" data-spec="${escapeHtml(eqStr)}" data-equation="${escapeHtml(eqStr)}" style="
          background: var(--bg-card); border: 1.5px solid var(--border-soft); border-radius: var(--radius-card);
          padding: var(--space-3); margin: var(--space-3) 0; width: 100%; box-sizing: border-box; direction: rtl;
        ">
          <div style="font-weight:800;color:var(--color-primary);">نمودار تعاملی ریاضی</div>
        </div>
      `;
      finalHtml = finalHtml.replace(`MATHPLOTPLACEHOLDER${i}`, plotCardHtml);
    }

    for (let i = 0; i < vennDiagrams.length; i++) {
      const specStr = vennDiagrams[i];
      const spec = parseVennSpec(specStr);
      const isFourSets = (spec.label_D && spec.label_D.trim() !== '') || spec.elements_D.length > 0;
      const isThreeSets = !isFourSets && ((spec.label_C && spec.label_C.trim() !== '') || spec.elements_C.length > 0);
      
      let svgHtml = '';
      let buttonsHtml = '';

      let cxA, cyA, rA, cxB, cyB, rB, cxC, cyC, rC, cxD, cyD, rD;

      if (isFourSets) {
        if (spec.layout === 'disjoint') {
          cxA = 70; cyA = 75; rA = 32;
          cxB = 150; cyB = 75; rB = 32;
          cxC = 230; cyC = 75; rC = 32;
          cxD = 150; cyD = 145; rD = 32;
        } else if (spec.layout === 'subset') {
          cxA = 150; cyA = 110; rA = 90;
          cxB = 150; cyB = 110; rB = 65;
          cxC = 150; cyC = 110; rC = 42;
          cxD = 150; cyD = 110; rD = 20;
        } else { // overlapping
          cxA = 115; cyA = 85; rA = 48;
          cxB = 185; cyB = 85; rB = 48;
          cxC = 115; cyC = 145; rC = 48;
          cxD = 185; cyD = 145; rD = 48;
        }
      } else if (isThreeSets) {
        if (spec.layout === 'disjoint') {
          cxA = 65; cyA = 110; rA = 35;
          cxB = 150; cyB = 110; rB = 35;
          cxC = 235; cyC = 110; rC = 35;
        } else if (spec.layout === 'subset') {
          cxA = 150; cyA = 110; rA = 80;
          cxB = 150; cyB = 110; rB = 52;
          cxC = 150; cyC = 110; rC = 25;
        } else { // overlapping
          cxA = 115; cyA = 85; rA = 50;
          cxB = 185; cyB = 85; rB = 50;
          cxC = 150; cyC = 145; rC = 50;
        }
      } else { // Two sets
        if (spec.layout === 'disjoint') {
          cxA = 85; cyA = 100; rA = 40;
          cxB = 215; cyB = 100; rB = 40;
        } else if (spec.layout === 'subset') {
          cxA = 150; cyA = 100; rA = 65;
          cxB = 150; cyB = 100; rB = 32;
        } else { // overlapping
          cxA = 115; cyA = 100; rA = 55;
          cxB = 185; cyB = 100; rB = 55;
        }
      }

      if (isFourSets) {
        svgHtml = `
          <svg viewBox="0 0 300 220" style="width: 100%; height: 100%; display: block;" class="venn-svg">
            <defs>
              <clipPath id="clip-4-A-${i}"><circle cx="${cxA}" cy="${cyA}" r="${rA}" /></clipPath>
              <clipPath id="clip-4-B-${i}"><circle cx="${cxB}" cy="${cyB}" r="${rB}" /></clipPath>
              <clipPath id="clip-4-C-${i}"><circle cx="${cxC}" cy="${cyC}" r="${rC}" /></clipPath>
              <clipPath id="clip-4-D-${i}"><circle cx="${cxD}" cy="${cyD}" r="${rD}" /></clipPath>
              <clipPath id="clip-4-not-A-${i}"><path d="M 0,0 H 300 V 220 H 0 Z M ${cxA},${cyA} m -${rA},0 a ${rA},${rA} 0 1,0 ${2*rA},0 a ${rA},${rA} 0 1,0 -${2*rA},0" fill-rule="evenodd" /></clipPath>
              <clipPath id="clip-4-not-B-${i}"><path d="M 0,0 H 300 V 220 H 0 Z M ${cxB},${cyB} m -${rB},0 a ${rB},${rB} 0 1,0 ${2*rB},0 a ${rB},${rB} 0 1,0 -${2*rB},0" fill-rule="evenodd" /></clipPath>
              <clipPath id="clip-4-not-C-${i}"><path d="M 0,0 H 300 V 220 H 0 Z M ${cxC},${cyC} m -${rC},0 a ${rC},${rC} 0 1,0 ${2*rC},0 a ${rC},${rC} 0 1,0 -${2*rC},0" fill-rule="evenodd" /></clipPath>
              <clipPath id="clip-4-not-D-${i}"><path d="M 0,0 H 300 V 220 H 0 Z M ${cxD},${cyD} m -${rD},0 a ${rD},${rD} 0 1,0 ${2*rD},0 a ${rD},${rD} 0 1,0 -${2*rD},0" fill-rule="evenodd" /></clipPath>
            </defs>

            <!-- Region backgrounds -->
            <g clip-path="url(#clip-4-not-A-${i})">
              <g clip-path="url(#clip-4-not-B-${i})">
                <g clip-path="url(#clip-4-not-C-${i})">
                  <g clip-path="url(#clip-4-not-D-${i})">
                    <rect class="venn-region U-rect" data-region="U_only" x="15" y="15" width="270" height="190" fill="transparent" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                  </g>
                </g>
              </g>
            </g>

            <g clip-path="url(#clip-4-A-${i})"><g clip-path="url(#clip-4-not-B-${i})"><g clip-path="url(#clip-4-not-C-${i})"><g clip-path="url(#clip-4-not-D-${i})">
              <rect class="venn-region A-path" data-region="A_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-B-${i})"><g clip-path="url(#clip-4-not-A-${i})"><g clip-path="url(#clip-4-not-C-${i})"><g clip-path="url(#clip-4-not-D-${i})">
              <rect class="venn-region B-path" data-region="B_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-C-${i})"><g clip-path="url(#clip-4-not-A-${i})"><g clip-path="url(#clip-4-not-B-${i})"><g clip-path="url(#clip-4-not-D-${i})">
              <rect class="venn-region C-path" data-region="C_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-D-${i})"><g clip-path="url(#clip-4-not-A-${i})"><g clip-path="url(#clip-4-not-B-${i})"><g clip-path="url(#clip-4-not-C-${i})">
              <rect class="venn-region D-path" data-region="D_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-A-${i})"><g clip-path="url(#clip-4-B-${i})"><g clip-path="url(#clip-4-not-C-${i})"><g clip-path="url(#clip-4-not-D-${i})">
              <rect class="venn-region AB-path" data-region="AB_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-A-${i})"><g clip-path="url(#clip-4-C-${i})"><g clip-path="url(#clip-4-not-B-${i})"><g clip-path="url(#clip-4-not-D-${i})">
              <rect class="venn-region AC-path" data-region="AC_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-A-${i})"><g clip-path="url(#clip-4-D-${i})"><g clip-path="url(#clip-4-not-B-${i})"><g clip-path="url(#clip-4-not-C-${i})">
              <rect class="venn-region AD-path" data-region="AD_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-B-${i})"><g clip-path="url(#clip-4-C-${i})"><g clip-path="url(#clip-4-not-A-${i})"><g clip-path="url(#clip-4-not-D-${i})">
              <rect class="venn-region BC-path" data-region="BC_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-B-${i})"><g clip-path="url(#clip-4-D-${i})"><g clip-path="url(#clip-4-not-A-${i})"><g clip-path="url(#clip-4-not-C-${i})">
              <rect class="venn-region BD-path" data-region="BD_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-C-${i})"><g clip-path="url(#clip-4-D-${i})"><g clip-path="url(#clip-4-not-A-${i})"><g clip-path="url(#clip-4-not-B-${i})">
              <rect class="venn-region CD-path" data-region="CD_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-A-${i})"><g clip-path="url(#clip-4-B-${i})"><g clip-path="url(#clip-4-C-${i})"><g clip-path="url(#clip-4-not-D-${i})">
              <rect class="venn-region ABC_only-path" data-region="ABC_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-A-${i})"><g clip-path="url(#clip-4-B-${i})"><g clip-path="url(#clip-4-D-${i})"><g clip-path="url(#clip-4-not-C-${i})">
              <rect class="venn-region ABD_only-path" data-region="ABD_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-A-${i})"><g clip-path="url(#clip-4-C-${i})"><g clip-path="url(#clip-4-D-${i})"><g clip-path="url(#clip-4-not-B-${i})">
              <rect class="venn-region ACD_only-path" data-region="ACD_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-B-${i})"><g clip-path="url(#clip-4-C-${i})"><g clip-path="url(#clip-4-D-${i})"><g clip-path="url(#clip-4-not-A-${i})">
              <rect class="venn-region BCD_only-path" data-region="BCD_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <g clip-path="url(#clip-4-A-${i})"><g clip-path="url(#clip-4-B-${i})"><g clip-path="url(#clip-4-C-${i})"><g clip-path="url(#clip-4-D-${i})">
              <rect class="venn-region ABCD-path" data-region="ABCD" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
            </g></g></g></g>

            <!-- Outlines -->
            <circle cx="${cxA}" cy="${cyA}" r="${rA}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <circle cx="${cxB}" cy="${cyB}" r="${rB}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <circle cx="${cxC}" cy="${cyC}" r="${rC}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <circle cx="${cxD}" cy="${cyD}" r="${rD}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <rect x="15" y="15" width="270" height="190" stroke="var(--color-danger)" stroke-width="1.5" fill="none" style="pointer-events: none;" />

            <!-- Labels -->
            <text x="25" y="33" font-size="12" fill="var(--color-danger)" font-weight="800" text-anchor="start">U</text>
            <text x="${cxA - 15}" y="${cyA - rA - 4}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-A-text">${escapeHtml(spec.label_A)}</text>
            <text x="${cxB + 15}" y="${cyB - rB - 4}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-B-text">${escapeHtml(spec.label_B)}</text>
            <text x="${cxC - 15}" y="${cyC + rC + 14}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-C-text">${escapeHtml(spec.label_C || 'C')}</text>
            <text x="${cxD + 15}" y="${cyD + rD + 14}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-D-text">${escapeHtml(spec.label_D || 'D')}</text>

            <g class="elements-A-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-B-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-C-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-D-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-AB-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-AC-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-AD-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-BC-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-BD-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-CD-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-ABC-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-ABD-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-ACD-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-BCD-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-ABCD-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-U-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
          </svg>
        `;

        buttonsHtml = `
          <button class="venn-op-btn" data-op="A_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A - (B ∪ C ∪ D)</button>
          <button class="venn-op-btn" data-op="B_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">B - (A ∪ C ∪ D)</button>
          <button class="venn-op-btn" data-op="C_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">C - (A ∪ B ∪ D)</button>
          <button class="venn-op-btn" data-op="D_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">D - (A ∪ B ∪ C)</button>
          <button class="venn-op-btn" data-op="intersection_abcd" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A ∩ B ∩ C ∩ D</button>
          <button class="venn-op-btn" data-op="union_abcd" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A ∪ B ∪ C ∪ D</button>
          <button class="venn-op-btn" data-op="A_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه A</button>
          <button class="venn-op-btn" data-op="B_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه B</button>
          <button class="venn-op-btn" data-op="C_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه C</button>
          <button class="venn-op-btn" data-op="D_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه D</button>
          <button class="venn-op-btn" data-op="U_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">(A ∪ B ∪ C ∪ D)'</button>
          <button class="venn-op-btn" data-op="clear" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--color-danger); background: var(--color-danger-soft); color: var(--color-danger); cursor: pointer; font-weight: 700; transition: all 0.2s;">پاک کردن</button>
        `;
      } else if (isThreeSets) {
        svgHtml = `
          <svg viewBox="0 0 300 220" style="width: 100%; height: 100%; display: block;" class="venn-svg">
            <defs>
              <clipPath id="clip-3-A-${i}"><circle cx="${cxA}" cy="${cyA}" r="${rA}" /></clipPath>
              <clipPath id="clip-3-B-${i}"><circle cx="${cxB}" cy="${cyB}" r="${rB}" /></clipPath>
              <clipPath id="clip-3-C-${i}"><circle cx="${cxC}" cy="${cyC}" r="${rC}" /></clipPath>
              <clipPath id="clip-3-not-A-${i}"><path d="M 0,0 H 300 V 220 H 0 Z M ${cxA},${cyA} m -${rA},0 a ${rA},${rA} 0 1,0 ${2*rA},0 a ${rA},${rA} 0 1,0 -${2*rA},0" fill-rule="evenodd" /></clipPath>
              <clipPath id="clip-3-not-B-${i}"><path d="M 0,0 H 300 V 220 H 0 Z M ${cxB},${cyB} m -${rB},0 a ${rB},${rB} 0 1,0 ${2*rB},0 a ${rB},${rB} 0 1,0 -${2*rB},0" fill-rule="evenodd" /></clipPath>
              <clipPath id="clip-3-not-C-${i}"><path d="M 0,0 H 300 V 220 H 0 Z M ${cxC},${cyC} m -${rC},0 a ${rC},${rC} 0 1,0 ${2*rC},0 a ${rC},${rC} 0 1,0 -${2*rC},0" fill-rule="evenodd" /></clipPath>
            </defs>

            <!-- Region backgrounds -->
            <g clip-path="url(#clip-3-not-A-${i})">
              <g clip-path="url(#clip-3-not-B-${i})">
                <g clip-path="url(#clip-3-not-C-${i})">
                  <rect class="venn-region U-rect" data-region="U_only" x="15" y="15" width="270" height="190" fill="transparent" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                </g>
              </g>
            </g>

            <g clip-path="url(#clip-3-A-${i})">
              <g clip-path="url(#clip-3-not-B-${i})">
                <g clip-path="url(#clip-3-not-C-${i})">
                  <rect class="venn-region A-path" data-region="A_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                </g>
              </g>
            </g>

            <g clip-path="url(#clip-3-B-${i})">
              <g clip-path="url(#clip-3-not-A-${i})">
                <g clip-path="url(#clip-3-not-C-${i})">
                  <rect class="venn-region B-path" data-region="B_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                </g>
              </g>
            </g>

            <g clip-path="url(#clip-3-C-${i})">
              <g clip-path="url(#clip-3-not-A-${i})">
                <g clip-path="url(#clip-3-not-B-${i})">
                  <rect class="venn-region C-path" data-region="C_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                </g>
              </g>
            </g>

            <g clip-path="url(#clip-3-A-${i})">
              <g clip-path="url(#clip-3-B-${i})">
                <g clip-path="url(#clip-3-not-C-${i})">
                  <rect class="venn-region AB-path" data-region="AB_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                </g>
              </g>
            </g>

            <g clip-path="url(#clip-3-A-${i})">
              <g clip-path="url(#clip-3-C-${i})">
                <g clip-path="url(#clip-3-not-B-${i})">
                  <rect class="venn-region AC-path" data-region="AC_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                </g>
              </g>
            </g>

            <g clip-path="url(#clip-3-B-${i})">
              <g clip-path="url(#clip-3-C-${i})">
                <g clip-path="url(#clip-3-not-A-${i})">
                  <rect class="venn-region BC-path" data-region="BC_only" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                </g>
              </g>
            </g>

            <g clip-path="url(#clip-3-A-${i})">
              <g clip-path="url(#clip-3-B-${i})">
                <g clip-path="url(#clip-3-C-${i})">
                  <rect class="venn-region ABC-path" data-region="ABC" x="0" y="0" width="300" height="220" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
                </g>
              </g>
            </g>

            <!-- Outlines -->
            <circle cx="${cxA}" cy="${cyA}" r="${rA}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <circle cx="${cxB}" cy="${cyB}" r="${rB}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <circle cx="${cxC}" cy="${cyC}" r="${rC}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <rect x="15" y="15" width="270" height="190" stroke="var(--color-danger)" stroke-width="1.5" fill="none" style="pointer-events: none;" />

            <!-- Labels -->
            <text x="25" y="33" font-size="12" fill="var(--color-danger)" font-weight="800" text-anchor="start">U</text>
            <text x="${cxA - 15}" y="${cyA - rA - 4}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-A-text">${escapeHtml(spec.label_A)}</text>
            <text x="${cxB + 15}" y="${cyB - rB - 4}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-B-text">${escapeHtml(spec.label_B)}</text>
            <text x="${cxC}" y="${cyC + rC + 14}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-C-text">${escapeHtml(spec.label_C || 'C')}</text>

            <!-- Elements groups -->
            <g class="elements-A-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-B-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-C-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-AB-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-AC-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-BC-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-ABC-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-U-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
          </svg>
        `;

        buttonsHtml = `
          <button class="venn-op-btn" data-op="A_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A - (B ∪ C)</button>
          <button class="venn-op-btn" data-op="B_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">B - (A ∪ C)</button>
          <button class="venn-op-btn" data-op="C_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">C - (A ∪ B)</button>
          <button class="venn-op-btn" data-op="intersection_abc" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A ∩ B ∩ C</button>
          <button class="venn-op-btn" data-op="union_abc" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A ∪ B ∪ C</button>
          <button class="venn-op-btn" data-op="A_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه A</button>
          <button class="venn-op-btn" data-op="B_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه B</button>
          <button class="venn-op-btn" data-op="C_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه C</button>
          <button class="venn-op-btn" data-op="U_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">(A ∪ B ∪ C)'</button>
          <button class="venn-op-btn" data-op="clear" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--color-danger); background: var(--color-danger-soft); color: var(--color-danger); cursor: pointer; font-weight: 700; transition: all 0.2s;">پاک کردن</button>
        `;
      } else {
        svgHtml = `
          <svg viewBox="0 0 300 200" style="width: 100%; height: 100%; display: block;" class="venn-svg">
            <defs>
              <clipPath id="clip-2-A-${i}"><circle cx="${cxA}" cy="${cyA}" r="${rA}" /></clipPath>
              <clipPath id="clip-2-B-${i}"><circle cx="${cxB}" cy="${cyB}" r="${rB}" /></clipPath>
              <clipPath id="clip-2-not-A-${i}"><path d="M 0,0 H 300 V 200 H 0 Z M ${cxA},${cyA} m -${rA},0 a ${rA},${rA} 0 1,0 ${2*rA},0 a ${rA},${rA} 0 1,0 -${2*rA},0" fill-rule="evenodd" /></clipPath>
              <clipPath id="clip-2-not-B-${i}"><path d="M 0,0 H 300 V 200 H 0 Z M ${cxB},${cyB} m -${rB},0 a ${rB},${rB} 0 1,0 ${2*rB},0 a ${rB},${rB} 0 1,0 -${2*rB},0" fill-rule="evenodd" /></clipPath>
            </defs>

            <!-- Region backgrounds -->
            <g clip-path="url(#clip-2-not-A-${i})">
              <g clip-path="url(#clip-2-not-B-${i})">
                <rect class="venn-region U-rect" data-region="U_only" x="15" y="15" width="270" height="170" fill="transparent" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
              </g>
            </g>

            <g clip-path="url(#clip-2-A-${i})">
              <g clip-path="url(#clip-2-not-B-${i})">
                <rect class="venn-region A-path" data-region="A_only" x="0" y="0" width="300" height="200" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
              </g>
            </g>

            <g clip-path="url(#clip-2-B-${i})">
              <g clip-path="url(#clip-2-not-A-${i})">
                <rect class="venn-region B-path" data-region="B_only" x="0" y="0" width="300" height="200" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
              </g>
            </g>

            <g clip-path="url(#clip-2-A-${i})">
              <g clip-path="url(#clip-2-B-${i})">
                <rect class="venn-region intersection-path" data-region="intersection" x="0" y="0" width="300" height="200" fill="var(--bg-sunken)" style="cursor: pointer; transition: fill 0.2s; pointer-events: all;" />
              </g>
            </g>

            <!-- Outlines -->
            <circle cx="${cxA}" cy="${cyA}" r="${rA}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <circle cx="${cxB}" cy="${cyB}" r="${rB}" stroke="var(--color-primary)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            <rect x="15" y="15" width="270" height="170" stroke="var(--color-danger)" stroke-width="1.5" fill="none" style="pointer-events: none;" />
            
            <!-- Labels -->
            <text x="25" y="33" font-size="12" fill="var(--color-danger)" font-weight="800" text-anchor="start">U</text>
            <text x="${cxA - 15}" y="${cyA - rA - 4}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-A-text">${escapeHtml(spec.label_A)}</text>
            <text x="${cxB + 15}" y="${cyB - rB - 4}" font-size="11" fill="var(--text-primary)" font-weight="700" text-anchor="middle" class="label-B-text">${escapeHtml(spec.label_B)}</text>
            
            <g class="elements-A-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-B-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-intersection-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
            <g class="elements-U-group" fill="var(--text-secondary)" font-size="10" font-weight="700" text-anchor="middle" style="pointer-events: none;"></g>
          </svg>
        `;

        buttonsHtml = `
          <button class="venn-op-btn" data-op="A_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A - B</button>
          <button class="venn-op-btn" data-op="B_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">B - A</button>
          <button class="venn-op-btn" data-op="intersection" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A ∩ B</button>
          <button class="venn-op-btn" data-op="union" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">A ∪ B</button>
          <button class="venn-op-btn" data-op="U_only" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">(A ∪ B)'</button>
          <button class="venn-op-btn" data-op="A_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه A</button>
          <button class="venn-op-btn" data-op="B_all" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s;">مجموعه B</button>
          <button class="venn-op-btn" data-op="clear" style="padding: 4px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--color-danger); background: var(--color-danger-soft); color: var(--color-danger); cursor: pointer; font-weight: 700; transition: all 0.2s;">پاک کردن</button>
        `;
      }

      const vennCardHtml = `
        <div class="interactive-venn-card" data-spec="${escapeHtml(specStr)}" style="
          background: var(--bg-card);
          border: 1.5px solid var(--border-soft);
          border-radius: var(--radius-card);
          padding: var(--space-3);
          margin: var(--space-3) 0;
          box-shadow: var(--shadow-card);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          width: 100%;
          box-sizing: border-box;
          direction: rtl;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
            <div style="font-weight: 800; color: var(--color-primary); font-size: var(--text-body); display: flex; align-items: center; gap: 6px;">
              <span class="material-symbols-rounded" style="color: var(--color-primary);">groups</span>
              <span>${escapeHtml(spec.title)}</span>
            </div>
          </div>
          
          <div class="svg-container" style="position: relative; width: 100%; aspect-ratio: 3/2; max-width: 320px; margin: var(--space-2) auto; background: var(--bg-sunken); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden; touch-action: none;">
            ${svgHtml}
            <div class="hover-info" style="position: absolute; bottom: 8px; right: 8px; left: 8px; background: rgba(0, 0, 0, 0.75); color: #FFFFFF; font-size: 11px; padding: 4px 8px; border-radius: 6px; text-align: center; pointer-events: none; opacity: 0; transition: opacity 0.15s; font-weight: 700;">
              -
            </div>
          </div>
          
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px; border-top: 1px dashed var(--border-soft); padding-top: 8px;">
            <div style="font-size: 11px; color: var(--text-secondary); font-weight: 700; display: flex; align-items: center; justify-content: space-between;">
              <span>عملیات روی مجموعه‌ها (لمس کنید):</span>
            </div>
            <div class="buttons-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
              ${buttonsHtml}
            </div>
            <div class="result-display" style="background: var(--bg-sunken); padding: 8px; border-radius: 8px; border: 1px solid var(--border-subtle); display: none; flex-direction: column; gap: 4px;">
              <div style="font-weight: 800; font-size: 11px; color: var(--color-primary);" class="result-title">-</div>
              <div style="font-size: 10px; color: var(--text-secondary); line-height: 1.5;" class="result-desc">-</div>
              <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); font-weight: 700; margin-top: 2px;" class="result-set">-</div>
            </div>
          </div>
        </div>
      `;
      finalHtml = finalHtml.replace(`VENNDIAGRAMPLACEHOLDER${i}`, vennCardHtml);
    }

    for (let i = 0; i < intervalPlots.length; i++) {
      const specStr = intervalPlots[i];
      const spec = parseIntervalSpec(specStr);
      const intervalCardHtml = `
        <div class="interactive-interval-card" data-spec="${escapeHtml(specStr)}" style="
          background: var(--bg-card);
          border: 1.5px solid var(--border-soft);
          border-radius: var(--radius-card);
          padding: var(--space-3);
          margin: var(--space-3) 0;
          box-shadow: var(--shadow-card);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          width: 100%;
          box-sizing: border-box;
          direction: rtl;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
            <div style="font-weight: 800; color: var(--color-primary); font-size: var(--text-body); display: flex; align-items: center; gap: 6px;">
              <span class="material-symbols-rounded" style="color: var(--color-primary);">timeline</span>
              <span>${escapeHtml(spec.title)}</span>
            </div>
          </div>
          
          <div class="svg-container" style="position: relative; width: 100%; height: 160px; margin: var(--space-2) auto; background: var(--bg-sunken); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden; touch-action: none;">
            <svg viewBox="0 0 350 160" style="width: 100%; height: 100%; display: block;" class="interval-svg">
              <!-- SVG elements drawn dynamically in initIntervalPlots -->
            </svg>
            <div class="interval-hover-info" style="position: absolute; bottom: 8px; right: 8px; left: 8px; background: rgba(0, 0, 0, 0.75); color: #FFFFFF; font-size: 11px; padding: 4px 8px; border-radius: 6px; text-align: center; pointer-events: none; opacity: 0; transition: opacity 0.15s; font-weight: 700;">
              -
            </div>
          </div>
          
          <!-- Action panel -->
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px; border-top: 1px dashed var(--border-soft); padding-top: 8px;">
            <div style="font-size: 11px; color: var(--text-secondary); font-weight: 700;">عملیات روی بازه‌ها (لمس کنید):</div>
            <div class="interval-buttons" style="display: flex; flex-wrap: wrap; gap: 6px;">
              <!-- Dynamic buttons -->
            </div>
            <div class="interval-result-display" style="background: var(--bg-sunken); padding: 8px; border-radius: 8px; border: 1px solid var(--border-subtle); display: none; flex-direction: column; gap: 4px;">
              <div style="font-weight: 800; font-size: 11px; color: var(--color-primary);" class="result-title">-</div>
              <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); font-weight: 700;" class="result-set">-</div>
              <div style="font-size: 10px; color: var(--text-secondary); line-height: 1.5;" class="result-desc">-</div>
            </div>
          </div>
        </div>
      `;
      finalHtml = finalHtml.replace(`INTERVALPLOTPLACEHOLDER${i}`, intervalCardHtml);
    }

    for (let i = 0; i < geometryPlots.length; i++) {
      const codeStr = geometryPlots[i];
      const geometryHtml = `
        <div class="interactive-geometry-card" data-spec="${escapeHtml(codeStr)}" style="
          background: var(--bg-card);
          border: 1px solid var(--border-soft);
          border-radius: 16px;
          padding: var(--space-4);
          margin: var(--space-3) 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          width: 100%;
          box-sizing: border-box;
          direction: rtl;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
            <div style="font-weight: 800; color: var(--color-primary); font-size: var(--text-body); display: flex; align-items: center; gap: 6px;">
              <span class="material-symbols-rounded" style="color: var(--color-primary);">architecture</span>
              <span>شکل هندسی تعاملی</span>
            </div>
            <div class="geometry-title-display" style="font-weight: 700; color: var(--text-secondary); font-size: 12px;">
            </div>
          </div>
          
          <div class="geometry-svg-container" style="position: relative; width: 100%; max-width: 320px; aspect-ratio: 4/3; margin: var(--space-2) auto; background: var(--bg-sunken); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden; touch-action: none;">
            <svg viewBox="0 0 320 240" style="width: 100%; height: 100%; display: block;" class="geometry-svg">
               <!-- SVG content will be generated by initInteractiveGeometry -->
            </svg>
          </div>
          
          <div class="geometry-info-panel" style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding: 8px; background: rgba(61, 107, 255, 0.05); border-radius: 8px; font-size: 13px; color: var(--text-primary); text-align: right; min-height: 24px; font-weight: 600;">
             روی اضلاع یا زوایا کلیک کنید تا اطلاعات محاسبه را ببینید.
          </div>
        </div>
      `;
      finalHtml = finalHtml.replace(`GEOMETRYPLOTPLACEHOLDER${i}`, geometryHtml);
    }

    for (let i = 0; i < mindmapPlots.length; i++) {
      const codeStr = mindmapPlots[i];
      const mindmapHtml = `
        <div class="interactive-mindmap-card" data-spec="${escapeHtml(codeStr)}" style="
          background: var(--bg-card);
          border: 1px solid var(--border-soft);
          border-radius: 16px;
          padding: var(--space-4);
          margin: var(--space-3) 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          width: 100%;
          box-sizing: border-box;
          direction: rtl;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
            <div style="font-weight: 800; color: var(--color-primary); font-size: var(--text-body); display: flex; align-items: center; gap: 6px;">
              <span class="material-symbols-rounded" style="color: var(--color-primary);">account_tree</span>
              <span>نقشه ذهنی</span>
            </div>
            <div class="mindmap-title-display" style="font-weight: 700; color: var(--text-secondary); font-size: 12px;">
            </div>
          </div>
          <div class="mindmap-svg-container" style="position: relative; width: 100%; margin: 0 auto; overflow-x: auto; overflow-y: hidden; background: var(--bg-sunken); border-radius: 12px; border: 1px solid var(--border-subtle); padding: var(--space-2) 0;">
            <!-- SVG content will be generated by initMindmaps -->
          </div>
        </div>
      `;
      finalHtml = finalHtml.replace(`MINDMAPPLOTPLACEHOLDER${i}`, mindmapHtml);
    }

    for (let i = 0; i < physicsPlots.length; i++) {
      const codeStr = physicsPlots[i];
      const physicsHtml = `
        <div class="interactive-physics-card" data-spec="${escapeHtml(codeStr)}" style="
          background: var(--bg-card);
          border: 1px solid var(--border-soft);
          border-radius: 16px;
          padding: var(--space-4);
          margin: var(--space-3) 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          width: 100%;
          box-sizing: border-box;
          direction: rtl;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
            <div style="font-weight: 800; color: var(--color-primary); font-size: var(--text-body); display: flex; align-items: center; gap: 6px;">
              <span class="material-symbols-rounded" style="color: var(--color-primary);">science</span>
              <span>شبیه‌ساز فیزیک</span>
            </div>
            <div class="physics-title-display" style="font-weight: 700; color: var(--text-secondary); font-size: 12px;">
            </div>
          </div>
          <div class="physics-svg-container" style="position: relative; width: 100%; max-width: 400px; margin: 0 auto; overflow: hidden; background: var(--bg-sunken); border-radius: 12px; border: 1px solid var(--border-subtle); touch-action: none;">
            <!-- SVG content will be generated by initPhysicsSimulations -->
          </div>
          <div class="physics-info-panel" style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding: 8px; background: rgba(61, 107, 255, 0.05); border-radius: 8px; font-size: 13px; color: var(--text-primary); text-align: right; min-height: 24px; font-weight: 600;">
          </div>
        </div>
      `;
      finalHtml = finalHtml.replace(`PHYSICSPLOTPLACEHOLDER${i}`, physicsHtml);
    }

    for (let i = 0; i < lewisStructures.length; i++) {
      const rawSpec = lewisStructures[i];
      const spec = parseLewisSpec(rawSpec);
      const lewisHtml = `
        <div class="interactive-lewis-card" data-spec="${escapeHtml(rawSpec)}" style="
          background: var(--bg-card);
          border: 1px solid var(--border-soft);
          border-radius: 16px;
          padding: var(--space-4);
          margin: var(--space-3) 0;
          width: 100%;
          box-sizing: border-box;
          direction: rtl;
        ">
          <div style="font-weight:800;color:var(--color-primary);">${escapeHtml(spec.title || 'ساختار لوویس')}</div>
        </div>
      `;
      finalHtml = finalHtml.replace(`LEWISPLACEHOLDER${i}`, lewisHtml);
    }


    const LIVE_CANVAS_W = 960;
    const LIVE_CANVAS_H = 600;

    for (let i = 0; i < liveCodeBlocks.length; i++) {
      const codeStr = liveCodeBlocks[i];
      if (!codeStr.trim()) {
        finalHtml = finalHtml.replace(`LIVECODEPLACEHOLDER${i}`, '<div style="padding:16px;background:var(--bg-sunken);color:var(--text-secondary);border-radius:var(--radius-card);text-align:center;border:1px solid var(--border-soft);margin:var(--space-2) 0;">پیش‌نمایش در دسترس نیست</div>');
        continue;
      }
      if (codeStr.length > 300000) {
        finalHtml = finalHtml.replace(`LIVECODEPLACEHOLDER${i}`, '<div style="padding:16px;background:var(--color-danger-soft);color:var(--color-danger);border-radius:var(--radius-card);text-align:center;">این کد برای پیش‌نمایش بسیار طولانی است؛ لطفاً از هوش مصنوعی بخواهید ساده‌ترش کند.</div>');
        continue;
      }

      let docStr = '';
      if (codeStr.toLowerCase().includes('<html')) {
        docStr = codeStr;
      } else {
        docStr = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${LIVE_CANVAS_W}px;height:${LIVE_CANVAS_H}px;overflow:hidden;background:#fff;}</style></head><body>${codeStr}</body></html>`;
      }

      const encodedCode = encodeURIComponent(codeStr);
      const uid = `lc${Date.now()}${i}`;

      const liveCardHtml = `
        <div class="live-code-card" style="
          background: var(--bg-card);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-card);
          margin: var(--space-3) 0;
          box-shadow: var(--shadow-card);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          width: 100%;
          box-sizing: border-box;
        ">
          <div style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--bg-secondary);
            padding: 8px 16px;
            border-bottom: 1px solid var(--border-soft);
          ">
            <span style="font-size: 13px; font-weight: 700; color: var(--text-primary);">پیش‌نمایش زنده</span>
            <div style="display:flex; gap: 4px;">
              <button class="icon-btn material-symbols-rounded live-code-view-btn" data-code="${encodedCode}" style="width:32px; height:32px; font-size: 18px; color: var(--text-secondary); border-radius: var(--radius-btn); cursor: pointer; transition: background 0.2s; background:none; border:none;" title="مشاهده کد">code</button>
              <button class="icon-btn material-symbols-rounded live-code-expand-btn" style="width:32px; height:32px; font-size: 18px; color: var(--text-secondary); border-radius: var(--radius-btn); cursor: pointer; transition: background 0.2s; background:none; border:none;" title="بزرگنمایی">open_in_full</button>
            </div>
          </div>
          <div class="live-code-viewport" id="${uid}" style="position:relative; width:100%; aspect-ratio:${LIVE_CANVAS_W}/${LIVE_CANVAS_H}; overflow:hidden; background:#fff;">
            <div class="live-code-scaler" style="position:absolute; top:0; left:0; width:${LIVE_CANVAS_W}px; height:${LIVE_CANVAS_H}px; transform-origin:top left;">
              <iframe sandbox="allow-scripts" srcdoc="${escapeHtml(docStr)}" style="width:${LIVE_CANVAS_W}px; height:${LIVE_CANVAS_H}px; border:none; display:block;"></iframe>
            </div>
          </div>
          <div style="padding:8px 12px; border-top:1px solid var(--border-subtle);">
            <button class="btn btn-outline live-code-continue-btn" style="width:100%; font-size:12px; padding:6px 10px;">
              <span class="material-symbols-rounded" style="font-size:15px;">edit_note</span> اصلاح یا افزودن به همین پروژه
            </button>
          </div>
        </div>
      `;
      finalHtml = finalHtml.replace(`LIVECODEPLACEHOLDER${i}`, liveCardHtml);
    }

    return finalHtml;
  }

  function createMsgActionBtn(icon, title, onClick, flashOnClick = false) {
    const btn = document.createElement('button');
    btn.className = 'material-symbols-rounded';
    btn.type = 'button';
    btn.title = title;
    btn.textContent = icon;
    btn.style.cssText = 'background:transparent; border:none; cursor:pointer; font-size:16px; padding:2px; opacity:0.6; transition:opacity 0.15s;';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await onClick();
      if (flashOnClick) {
        const original = btn.textContent;
        btn.textContent = 'check';
        setTimeout(() => { btn.textContent = original; }, 1200);
      }
    });
    return btn;
  }

  async function gradeUserAnswerWithAI({ question, expectedAnswer, explanation, userAnswer }) {
    const dbCatId = currentCategoryId === 'general' ? null : currentCategoryId;
    const activeCat = dbCatId ? await categoryRepository.getById(dbCatId) : null;
    const customInstruction = await db.getSetting('gemini_system_instruction', '');
    let systemInstruction = getSystemInstruction(activeCat ? activeCat.title : null, activeCat ? activeCat.description : null);
    if (customInstruction) systemInstruction = customInstruction + "\n\n" + systemInstruction;

    const gradingMessage = `[بررسی پاسخ سوال تمرینی — فقط و فقط یک بلاک GRADE_JSON برگردان، بدون هیچ متن یا توضیح دیگری خارج از آن]\nسوال: ${question}\nپاسخ مورد انتظار (فقط برای بررسی خودت، به کاربر نگو مگر لازم شود): ${expectedAnswer || '(مشخص نشده — بر اساس درستی مفهومی قضاوت کن)'}\nتوضیح مرجع: ${explanation || '(ندارد)'}\nپاسخ کاربر: ${userAnswer}`;

    const { chatWithAI } = await import('../core/ai-client.js');
    const resData = await chatWithAI({
      message: gradingMessage,
      history: activeConversation ? activeConversation.messages.slice(-6) : [],
      systemInstruction,
      attachments: [],
    });

    const m = (resData.text || '').match(/\[GRADE_JSON\]([\s\S]*?)\[\/GRADE_JSON\]/);
    if (!m) return null;
    try {
      return JSON.parse(m[1].trim());
    } catch (e) {
      try { return JSON.parse(fixJsonEscape(m[1].trim())); } catch (e2) { return null; }
    }
  }

  function buildAskQuestionWidget(aq) {
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:var(--space-3); padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-3); border:1px solid var(--border-soft); border-radius:var(--radius-card); background:var(--bg-card); box-shadow:0 2px 8px rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.02); width:100%; box-sizing:border-box; transition: border-color 0.2s ease, box-shadow 0.2s ease;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12px; font-weight:800; color:var(--text-primary); margin-bottom:2px;';
    header.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px; color:var(--color-primary);">psychology_alt</span><span>سوال تمرینی</span>';
    box.appendChild(header);

    const qEl = document.createElement('div');
    qEl.style.cssText = 'font-size:15px; font-weight:700; color:var(--text-primary); line-height:1.7; min-height:1.4em;';
    qEl.innerHTML = renderMarkdownAndMath(aq.question || 'سوال تمرینی را در کادر زیر پاسخ دهید.');
    box.appendChild(qEl);
    initMathZoom(qEl);

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';

    const textarea = document.createElement('textarea');
    textarea.rows = 2;
    textarea.placeholder = 'پاسخ خود را اینجا بنویسید...';
    textarea.className = 'text-area';
    textarea.style.cssText = 'width:100%; min-width:0; font-size:14px; resize:vertical; padding:12px; background:var(--bg-sunken); border:1px solid transparent; border-radius:12px; box-sizing:border-box; color:var(--text-primary); transition:all 0.2s ease; outline:none;';
    
    textarea.addEventListener('focus', () => {
      textarea.style.background = 'var(--bg-card)';
      textarea.style.border = '1px solid var(--color-primary)';
      textarea.style.boxShadow = '0 0 0 3px var(--color-primary-soft)';
      box.style.borderColor = 'var(--color-primary-soft)';
      box.style.boxShadow = '0 4px 12px rgba(47, 95, 168, 0.05)';
    });
    textarea.addEventListener('blur', () => {
      textarea.style.background = 'var(--bg-sunken)';
      textarea.style.border = '1px solid transparent';
      textarea.style.boxShadow = 'none';
      box.style.borderColor = 'var(--border-soft)';
      box.style.boxShadow = '0 2px 8px rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.02)';
    });

    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex; justify-content:flex-end; align-items:center; margin-top:4px;';

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'btn btn-primary';
    checkBtn.style.cssText = 'height:36px; padding:0 16px; border-radius:10px; font-size:13px; font-weight:700; display:flex; align-items:center; gap:6px; white-space:nowrap; cursor:pointer; border:none; background:var(--color-primary); color:#FFFFFF; transition:background 0.2s ease, transform 0.1s ease;';
    checkBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">check_circle</span><span>بررسی پاسخ</span>';

    checkBtn.addEventListener('mouseenter', () => { if (!checkBtn.disabled) checkBtn.style.background = 'var(--color-primary-hover)'; });
    checkBtn.addEventListener('mouseleave', () => { if (!checkBtn.disabled) checkBtn.style.background = 'var(--color-primary)'; });
    checkBtn.addEventListener('mousedown', () => { if (!checkBtn.disabled) checkBtn.style.transform = 'scale(0.97)'; });
    checkBtn.addEventListener('mouseup', () => { if (!checkBtn.disabled) checkBtn.style.transform = 'scale(1)'; });

    actionRow.appendChild(checkBtn);
    inputRow.append(textarea, actionRow);
    box.appendChild(inputRow);

    const resultRow = document.createElement('div');
    resultRow.style.cssText = 'display:none; align-items:flex-start; gap:12px; margin-top:var(--space-2); padding:14px; border-radius:12px; transition:all 0.3s ease;';
    
    const resultIconContainer = document.createElement('div');
    resultIconContainer.style.cssText = 'display:flex; align-items:center; justify-content:center; flex-shrink:0; width:28px; height:28px; border-radius:50%; margin-top:2px;';
    
    const resultMark = document.createElement('span');
    resultMark.className = 'material-symbols-rounded';
    resultMark.style.cssText = 'font-size:20px; color:#FFFFFF; font-weight:800;';
    
    resultIconContainer.appendChild(resultMark);
    
    const resultTextContent = document.createElement('div');
    resultTextContent.style.cssText = 'display:flex; flex-direction:column; gap:6px; flex:1;';
    
    const resultLabel = document.createElement('span');
    resultLabel.style.cssText = 'font-size:14px; color:var(--text-primary); font-weight:800; display:flex; align-items:center; gap:4px;';
    
    const explanationBox = document.createElement('div');
    explanationBox.style.cssText = 'display:none; font-size:13px; line-height:1.7; color:var(--text-secondary);';
    
    resultTextContent.append(resultLabel, explanationBox);
    resultRow.append(resultIconContainer, resultTextContent);
    box.appendChild(resultRow);

    async function runCheck() {
      const userAnswer = textarea.value.trim();
      if (!userAnswer) { textarea.focus(); return; }
      checkBtn.disabled = true;
      textarea.disabled = true;
      checkBtn.style.opacity = '0.7';
      checkBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">sync</span><span>در حال بررسی...</span>';

      let grade = null;
      try {
        grade = await gradeUserAnswerWithAI({ question: aq.question, expectedAnswer: aq.expectedAnswer || '', explanation: aq.explanation || '', userAnswer });
      } catch (e) {
        grade = null;
      }

      if (!grade || typeof grade.correct !== 'boolean') {
        const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/[\u200c\s]+/g, ' ');
        const ua = norm(userAnswer);
        const ea = norm(aq.expectedAnswer);
        const isCorrect = !!ea && (ua === ea || (ua.length > 2 && ea.includes(ua)) || (ea.length > 2 && ua.includes(ea)));
        grade = { correct: isCorrect, explanation: aq.explanation || '' };
        showToast('اتصال به هوش مصنوعی برای بررسی دقیق برقرار نشد؛ نتیجه با مقایسه‌ی ساده نمایش داده شد.', 'info');
      }

      checkBtn.disabled = false;
      textarea.disabled = false;
      checkBtn.style.opacity = '1';
      checkBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">refresh</span><span>بررسی دوباره</span>';

      resultRow.style.display = 'flex';
      resultRow.animate([
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 300, easing: 'ease-out' });

      if (grade.correct) {
        resultRow.style.background = 'var(--color-success-soft)';
        resultRow.style.border = '1px solid rgba(47, 143, 91, 0.2)';
        resultIconContainer.style.background = 'var(--color-success)';
        resultMark.textContent = 'check';
        resultLabel.textContent = 'آفرین، پاسخ شما درست است!';
        explanationBox.style.display = grade.explanation ? 'block' : 'none';
        explanationBox.innerHTML = grade.explanation ? renderMarkdownAndMath(grade.explanation) : '';
        if (grade.explanation) initMathZoom(explanationBox);
      } else {
        resultRow.style.background = 'var(--color-danger-soft)';
        resultRow.style.border = '1px solid rgba(201, 74, 63, 0.2)';
        resultIconContainer.style.background = 'var(--color-danger)';
        resultMark.textContent = 'close';
        resultLabel.textContent = 'پاسخ شما کامل نیست یا نادرست است.';
        explanationBox.innerHTML = renderMarkdownAndMath(grade.explanation || 'توضیحی دریافت نشد.');
        explanationBox.style.display = 'block';
        initMathZoom(explanationBox);
      }
    }

    checkBtn.addEventListener('click', runCheck);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runCheck();
    });

    return box;
  }

  function renderMessage(sender, text, attachments = null, opts = {}) {
    let suggestedCards = null;

    const regex = /\[FLASHCARDS_JSON\]([\s\S]*?)\[\/FLASHCARDS_JSON\]/;
    const match = text.match(regex);
    let cleanText = text;

    if (match) {
      cleanText = text.replace(regex, '').trim();
      try {
        suggestedCards = JSON.parse(match[1].trim());
      } catch (e) {
        try {
          suggestedCards = JSON.parse(fixJsonEscape(match[1].trim()));
        } catch (e2) {
          console.error('Failed to parse suggested flashcards JSON:', e, e2);
        }
      }
    }

    let askQuestion = null;
    const qRegex = /\[ASK_QUESTION_JSON\]([\s\S]*?)\[\/ASK_QUESTION_JSON\]/;
    const qMatch = cleanText.match(qRegex);
    if (qMatch) {
      cleanText = cleanText.replace(qRegex, '').trim();
      let parsedAq = null;
      try {
        parsedAq = JSON.parse(qMatch[1].trim());
      } catch (e) {
        try {
          parsedAq = JSON.parse(fixJsonEscape(qMatch[1].trim()));
        } catch (e2) {
          console.error('Failed to parse ask-question JSON:', e, e2);
        }
      }
      if (parsedAq && typeof parsedAq === 'object') {
        let q = parsedAq.question ?? parsedAq.q ?? parsedAq.text ?? parsedAq.prompt ?? parsedAq.questionText ?? '';
        if (q && typeof q === 'object') q = q.text || q.question || '';
        q = String(q || '').trim();
        let expected = parsedAq.expectedAnswer ?? parsedAq.answer ?? parsedAq.expected ?? '';
        if (expected && typeof expected === 'object') expected = expected.text || '';
        let explanation = parsedAq.explanation ?? parsedAq.explain ?? parsedAq.reason ?? '';
        if (explanation && typeof explanation === 'object') explanation = explanation.text || '';
        askQuestion = {
          question: q || 'سوال تمرینی را در کادر زیر پاسخ دهید.',
          expectedAnswer: String(expected || ''),
          explanation: String(explanation || ''),
        };
      }
    }

    let interactiveForm = null;
    const ifRegex = /\[INTERACTIVE_FORM_JSON\]([\s\S]*?)\[\/INTERACTIVE_FORM_JSON\]/;
    const ifMatch = cleanText.match(ifRegex);
    if (ifMatch) {
      cleanText = cleanText.replace(ifRegex, '').trim();
      try {
        interactiveForm = JSON.parse(ifMatch[1].trim());
      } catch (e) {
        try {
          interactiveForm = JSON.parse(fixJsonEscape(ifMatch[1].trim()));
        } catch (e2) {
          console.error('Failed to parse interactive-form JSON:', e, e2);
        }
      }
      if (interactiveForm && (!interactiveForm.steps || !interactiveForm.steps.length)) interactiveForm = null;
    }

    const bubble = document.createElement('div');
    bubble.style.animation = 'slideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
    
    if (!document.getElementById('ai-animations')) {
      const style = document.createElement('style');
      style.id = 'ai-animations';
      style.textContent = `
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `;
      document.head.appendChild(style);
    }
    
    if (sender === 'user') {
      bubble.style.cssText = 'align-self:flex-end; background:linear-gradient(135deg, var(--color-primary), var(--color-secondary)); color:#FFFFFF; padding:var(--space-3) var(--space-4); border-radius:24px 24px 4px 24px; max-width:80%; line-height:1.6; font-size:var(--text-body); font-weight:500; box-shadow:0 8px 24px rgba(47, 95, 168, 0.25); word-break: break-word; display:flex; flex-direction:column; gap:var(--space-2); position:relative;';
      
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        const attContainer = document.createElement('div');
        attContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); margin-bottom:var(--space-2);';
        
        attachments.forEach((att) => {
          const attRow = document.createElement('div');
          attRow.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); background:rgba(255, 255, 255, 0.15); padding:var(--space-2); border-radius:12px; font-size:11px; max-width:100%; box-sizing:border-box; overflow:hidden;';
          
          if (att.mimeType.startsWith('image/')) {
            const previewImg = document.createElement('img');
            previewImg.src = att.dataUrl || `data:${att.mimeType};base64,${att.data}`;
            previewImg.style.cssText = 'width:44px; height:44px; border-radius:8px; object-fit:cover; border:1px solid rgba(255,255,255,0.3); flex-shrink:0; cursor:pointer; transition: transform 0.2s;';
            previewImg.addEventListener('mouseenter', () => {
              previewImg.style.transform = 'scale(1.05)';
            });
            previewImg.addEventListener('mouseleave', () => {
              previewImg.style.transform = 'scale(1)';
            });
            
            previewImg.addEventListener('click', (e) => {
              e.stopPropagation();
              const fullOverlay = document.createElement('div');
              fullOverlay.className = 'overlay';
              fullOverlay.style.zIndex = '3000';
              fullOverlay.style.background = 'rgba(0,0,0,0.85)';
              fullOverlay.innerHTML = `
                <div style="position:relative; max-width:90%; max-height:90%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                  <img src="${previewImg.src}" style="max-width:100%; max-height:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.5);">
                  <button class="material-symbols-rounded" style="position:absolute; top:-40px; right:0; background:transparent; border:none; color:white; font-size:32px; cursor:pointer;">close</button>
                </div>
              `;
              fullOverlay.querySelector('button').addEventListener('click', () => fullOverlay.remove());
              fullOverlay.addEventListener('click', () => fullOverlay.remove());
              document.body.appendChild(fullOverlay);
            });

            const fileMeta = document.createElement('div');
            fileMeta.style.cssText = 'display:flex; flex-direction:column; text-align:right; flex-grow:1; min-width:0;';
            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'font-weight:700; color:#ffffff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; direction:ltr; text-align:right;';
            nameSpan.textContent = att.name;
            const sizeSpan = document.createElement('span');
            sizeSpan.style.cssText = 'color:rgba(255,255,255,0.7); font-size:10px;';
            sizeSpan.textContent = formatBytes(att.size);
            fileMeta.append(nameSpan, sizeSpan);

            attRow.append(previewImg, fileMeta);
          } else {
            const icon = document.createElement('span');
            icon.className = 'material-symbols-rounded';
            icon.style.cssText = 'font-size:28px; color:#ffffff; flex-shrink:0;';
            if (att.mimeType === 'application/pdf') {
              icon.textContent = 'picture_as_pdf';
            } else if (att.mimeType.startsWith('audio/')) {
              icon.textContent = 'audio_file';
            } else {
              icon.textContent = 'description';
            }

            const fileMeta = document.createElement('div');
            fileMeta.style.cssText = 'display:flex; flex-direction:column; text-align:right; flex-grow:1; min-width:0;';
            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'font-weight:700; color:#ffffff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; direction:ltr; text-align:right;';
            nameSpan.textContent = att.name;
            const sizeSpan = document.createElement('span');
            sizeSpan.style.cssText = 'color:rgba(255,255,255,0.7); font-size:10px;';
            sizeSpan.textContent = formatBytes(att.size);
            fileMeta.append(nameSpan, sizeSpan);

            attRow.append(icon, fileMeta);
          }
          attContainer.appendChild(attRow);
        });
        bubble.appendChild(attContainer);
      }

      if (cleanText) {
        const textSpan = document.createElement('span');
        textSpan.textContent = cleanText;
        bubble.appendChild(textSpan);

        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex; gap:2px; justify-content:flex-end; margin-top:2px; color:rgba(255,255,255,0.85);';
        actionRow.appendChild(createMsgActionBtn('content_copy', 'کپی متن', () => {
          navigator.clipboard.writeText(cleanText).catch(() => {});
        }, true));
        actionRow.appendChild(createMsgActionBtn('edit', 'ویرایش و ارسال دوباره', () => {
          if (activeConversation && generatingConversationId === activeConversation.id) {
            showToast('لطفاً صبر کنید تا پاسخ فعلی تمام شود (یا آن را متوقف کنید).', 'info');
            return;
          }

          if (activeConversation && typeof opts.messageIndex === 'number') {
            activeConversation.messages = activeConversation.messages.slice(0, opts.messageIndex);
            activeConversation.updatedAt = new Date().toISOString();
            aiConversationRepository.update(activeConversation.id, { messages: activeConversation.messages, updatedAt: activeConversation.updatedAt });
            while (bubble.nextSibling) bubble.nextSibling.remove();
            bubble.remove();
          }

          inputField.input.value = cleanText;
          inputField.input.focus();
          handleInputChange();
          if (attachments && attachments.length > 0) {
            showToast('توجه: پیوست‌های این پیام دوباره اضافه نشدند؛ در صورت نیاز آن‌ها را دوباره انتخاب کنید.', 'info');
          }
        }));
        bubble.appendChild(actionRow);
      }
    } else if (sender === 'system_error') {
      bubble.style.cssText = 'align-self:center; background:var(--color-danger-soft); border:1px solid var(--color-danger); color:var(--color-danger); padding:var(--space-3) var(--space-4); border-radius:12px; max-width:90%; font-size:var(--text-caption); text-align:center; font-weight:700; display:flex; align-items:center; gap:var(--space-2);';
      const errText = document.createElement('span');
      errText.textContent = cleanText;
      bubble.appendChild(errText);
      if (typeof opts.onRetry === 'function') {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'material-symbols-rounded';
        retryBtn.type = 'button';
        retryBtn.title = 'تلاش مجدد برای ارسال';
        retryBtn.textContent = 'refresh';
        retryBtn.style.cssText = 'background:transparent; border:1px solid var(--color-danger); border-radius:8px; cursor:pointer; font-size:16px; padding:2px 4px; color:var(--color-danger); flex-shrink:0;';
        retryBtn.addEventListener('click', () => {
          bubble.remove();
          opts.onRetry();
        });
        bubble.appendChild(retryBtn);
      }
    } else if (sender === 'system_info') {
      bubble.style.cssText = 'align-self:center; background:var(--bg-sunken); border:1px solid var(--border-subtle); color:var(--text-secondary); padding:var(--space-2) var(--space-4); border-radius:12px; max-width:90%; font-size:var(--text-caption); text-align:center; font-weight:600;';
      bubble.textContent = cleanText;
    } else {
      bubble.style.cssText = 'align-self:flex-start; background:color-mix(in srgb, var(--bg-card) 60%, transparent); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.2); padding:var(--space-4); border-radius:24px 24px 24px 4px; max-width:85%; line-height:1.8; font-size:var(--text-body); color:var(--text-primary); box-shadow:0 8px 32px rgba(0,0,0,0.06); word-break: break-word; min-width:0; margin-bottom:var(--space-2);';
      
      const textNode = document.createElement('div');
      textNode.style.cssText = 'word-break:break-word; overflow-wrap:break-word; width:100%;';
      textNode.innerHTML = renderMarkdownAndMath(cleanText);
      bubble.appendChild(textNode);

      const aiActionRow = document.createElement('div');
      aiActionRow.style.cssText = 'display:flex; gap:2px; justify-content:flex-start; margin-top:4px;';
      aiActionRow.appendChild(createMsgActionBtn('content_copy', 'کپی متن', () => {
        navigator.clipboard.writeText(cleanText).catch(() => {});
      }, true));
      bubble.appendChild(aiActionRow);

      if (suggestedCards && Array.isArray(suggestedCards) && suggestedCards.length > 0) {
        const cardsWrap = document.createElement('div');
        cardsWrap.style.cssText = 'margin-top:var(--space-3); border-top:1.5px dashed var(--border-subtle); padding-top:var(--space-3); display:flex; flex-direction:column; gap:var(--space-2); width:100%; box-sizing:border-box; min-width:0;';
        
        const title = document.createElement('div');
        title.style.cssText = 'font-size:11px; font-weight:800; color:var(--color-primary); display:flex; align-items:center; gap:4px;';
        title.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">style</span> فلش‌کارت‌های پیشنهادی هوش مصنوعی:';
        cardsWrap.appendChild(title);

        let rememberedCategoryForBatch = null;

        suggestedCards.forEach((c) => {
          if (!c.front || !c.back) return;
          const cardBox = document.createElement('div');
          cardBox.style.cssText = 'background:rgba(61, 107, 255, 0.04); border:1px solid var(--color-primary-soft); border-radius:var(--radius-input); padding:var(--space-2); display:flex; justify-content:space-between; align-items:center; gap:var(--space-2); min-width:0;';
          
          const cardContent = document.createElement('div');
          cardContent.style.cssText = 'display:flex; flex-direction:column; gap:2px; text-align:right; flex-grow:1; font-size:11px; min-width:0; word-break:break-word; overflow-wrap:break-word;';
          
          const qText = document.createElement('div');
          qText.style.cssText = 'font-weight:700; color:var(--text-primary); word-break:break-word; overflow-wrap:break-word;';
          qText.innerHTML = `روی کارت: ${renderRichText(c.front)}`;
          
          const aText = document.createElement('div');
          aText.style.cssText = 'color:var(--text-secondary); word-break:break-word; overflow-wrap:break-word;';
          aText.innerHTML = `پشت کارت: ${renderRichText(c.back)}`;
          
          cardContent.append(qText, aText);

          const addBtn = createButton({
            label: 'افزودن',
            icon: 'add_circle',
            variant: 'secondary',
            onClick: async () => {
              const performSave = async (categoryId) => {
                const normalize = (s) => (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
                const existingCards = await flashcardRepository.getByIndex('categoryId', categoryId);
                const isDuplicate = existingCards.some((card) =>
                  !card.deleted &&
                  Array.isArray(card.frontContent) &&
                  card.frontContent[0] &&
                  normalize(card.frontContent[0].value) === normalize(c.front)
                );
                if (isDuplicate) {
                  const proceed = await new Promise((resolve) => {
                    openDialog({
                      title: 'فلش‌کارت مشابه پیدا شد',
                      content: 'فلش‌کارتی با همین سوال از قبل در این دسته وجود دارد. باز هم اضافه شود؟',
                      actions: [
                        { label: 'اضافه کن', variant: 'primary', onClick: () => resolve(true) },
                        { label: 'انصراف', variant: 'text', onClick: () => resolve(false) }
                      ]
                    });
                  });
                  if (!proceed) return;
                }

                const wrongOptions = Array.isArray(c.wrongOptions)
                  ? c.wrongOptions.map((s) => (s || '').toString().trim()).filter(Boolean).slice(0, 3)
                  : [];
                const falseStatement = (c.falseStatement || '').toString().trim();
                const flashcard = createFlashcardModel({
                  categoryId: categoryId,
                  frontContent: [{ type: 'text', value: c.front }],
                  backContent: [{ type: 'text', value: c.back }],
                  source: 'ai',
                  aiGenerated: true,
                  answerType: wrongOptions.length > 0 ? 'choice' : 'auto',
                  choiceOptions: wrongOptions,
                  falseStatement,
                });
                await flashcardRepository.create(flashcard);

                const categoryCards = await flashcardRepository.getByIndex('categoryId', categoryId);
                const activeCount = categoryCards.filter((card) => !card.deleted).length;
                await categoryRepository.update(categoryId, { totalCards: activeCount });

                addBtn.disabled = true;
                addBtn.firstChild.textContent = 'check_circle';
                addBtn.lastChild.textContent = 'افزوده شد';
                addBtn.style.cssText += '; background:var(--color-success-soft); border-color:var(--color-success); color:var(--color-success); cursor:default; opacity:1;';
              };

              if (currentCategoryId === 'general') {
                if (rememberedCategoryForBatch) {
                  await performSave(rememberedCategoryForBatch);
                  return;
                }

                const cats = await categoryRepository.getAll();
                const availableCats = cats.filter(cat => cat.id !== 'general' && !cat.deleted);
                
                if (availableCats.length === 0) {
                  openDialog({
                    title: 'هیچ دسته‌ای یافت نشد!',
                    body: 'شما هنوز هیچ دسته‌ای نساخته‌اید. ابتدا در صفحه اصلی یک دسته بسازید تا بتوانید فلش‌کارت‌ها را ذخیره کنید.',
                    actions: [{ label: 'تایید', variant: 'primary' }]
                  });
                  return;
                }

                const bodyContainer = document.createElement('div');
                
                const label = document.createElement('div');
                label.textContent = 'هیچ دسته‌ای انتخاب نشده است. لطفاً ابتدا دسته‌ای برای افزودن این کارت انتخاب کنید:';
                label.style.cssText = 'font-size:14px; color:var(--text-secondary); line-height:1.6; margin-bottom: 12px;';
                
                const select = document.createElement('select');
                select.className = 'ds-input';
                select.style.cssText = 'width: 100%; padding: 12px; border-radius: var(--radius-md); background: var(--bg-card); border: 1px solid var(--border-soft); color: var(--text-primary); font-size: 15px; cursor: pointer;';
                
                availableCats.forEach(cat => {
                  const option = document.createElement('option');
                  option.value = cat.id;
                  option.textContent = cat.title;
                  select.appendChild(option);
                });

                const rememberLabel = document.createElement('label');
                rememberLabel.style.cssText = 'display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; color:var(--text-secondary); cursor:pointer;';
                const rememberCheckbox = document.createElement('input');
                rememberCheckbox.type = 'checkbox';
                rememberCheckbox.style.cssText = 'width:16px; height:16px; cursor:pointer;';
                rememberLabel.append(rememberCheckbox, document.createTextNode('برای بقیه فلش‌کارت‌های این پاسخ هم به‌خاطر بسپار'));

                bodyContainer.append(label, select, rememberLabel);

                openDialog({
                  title: 'انتخاب دسته',
                  body: bodyContainer,
                  actions: [
                    { 
                      label: 'ذخیره کارت', 
                      variant: 'primary',
                      onClick: async () => {
                        if (rememberCheckbox.checked) {
                          rememberedCategoryForBatch = select.value;
                        }
                        await performSave(select.value);
                      }
                    },
                    {
                      label: 'انصراف',
                      variant: 'text'
                    }
                  ]
                });
              } else {
                await performSave(currentCategoryId);
              }
            }
          });
          addBtn.style.cssText += '; border-radius: 12px; font-size: 10px; height: 26px; padding: 2px 8px; flex-shrink: 0;';
          
          cardBox.append(cardContent, addBtn);
          cardsWrap.appendChild(cardBox);
        });

        bubble.appendChild(cardsWrap);
      }

      if (askQuestion) {
        bubble.appendChild(buildAskQuestionWidget(askQuestion));
      }
    }

    chatList.appendChild(bubble);
    initInteractivePlots(bubble);
    initInteractiveGeometry(bubble);
    initVennDiagrams(bubble);
    initIntervalPlots(bubble);
    initMindmaps(bubble);
    initPhysicsSimulations(bubble);
    initLiveCodeBlocks(bubble);
    initLewisStructures(bubble);
    initMathZoom(bubble);
    
    if (interactiveForm && opts.isLast && sender === 'ai') {
      startInteractiveFormFlow(interactiveForm);
    }
  }
}

/**
 * Builds the "memory growth" card for the stats page: a weekly-average
 * chart of FSRS "stability" (roughly, how many days a card tends to stay
 * remembered before it needs review again) across every review the user
 * has ever done. Returns null when there isn't enough history yet for a
 * trend to mean anything (fewer than 2 distinct weeks of reviews).
 */
function buildMemoryGrowthCard(logs) {
  // Only count reviews of cards that had already been seen before — i.e. a
  // genuine "how well is this sticking in memory" signal. A card's very
  // first-ever review (elapsedDays === 0, see fsrs.js) always gets one of
  // four *fixed* "initial stability" values that depend only on which
  // button was pressed, not on actual retention. Mixing those into the
  // average meant a week where the user simply added a lot of new cards
  // could make "Memory Strength" look like it had collapsed, even though
  // nothing about previously-learned material had actually gotten weaker.
  const validLogs = (logs || []).filter(
    (l) => l && l.reviewDate && typeof l.stability === 'number' && isFinite(l.stability) && l.stability > 0
      && typeof l.elapsedDays === 'number' && l.elapsedDays > 0
  );
  if (validLogs.length === 0) return null;

  // Week buckets aligned to Saturday (matches the heatmap week convention).
  const weekKeyOf = (isoDate) => {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    const rowIndex = (d.getDay() + 1) % 7;
    d.setDate(d.getDate() - rowIndex);
    return d.toISOString().slice(0, 10);
  };

  // Within each week, keep only the LATEST stability value per card rather
  // than every single review row. Otherwise a single card that needed
  // several relearning attempts in one week (several rows, all with a low
  // post-lapse stability) would drag that week's average down far more than
  // its fair share — the metric should reflect the spread of cards touched
  // that week, not how many times each one happened to be shown.
  const weekCardLatest = new Map(); // weekKey -> Map(cardId -> {time, stability})
  validLogs.forEach((log) => {
    const key = weekKeyOf(log.reviewDate);
    if (!key) return;
    const t = new Date(log.reviewDate).getTime();
    if (!Number.isFinite(t)) return;
    let cardMap = weekCardLatest.get(key);
    if (!cardMap) { cardMap = new Map(); weekCardLatest.set(key, cardMap); }
    const existing = cardMap.get(log.cardId);
    if (!existing || t >= existing.time) {
      cardMap.set(log.cardId, { time: t, stability: log.stability });
    }
  });

  const weeks = Array.from(weekCardLatest.entries())
    .map(([key, cardMap]) => {
      const vals = Array.from(cardMap.values(), (v) => v.stability);
      const sum = vals.reduce((a, b) => a + b, 0);
      return { key, avgDays: sum / vals.length, cardCount: vals.length };
    })
    .sort((a, b) => new Date(a.key) - new Date(b.key));

  if (weeks.length < 2) return null;

  const shown = weeks.slice(-8);
  const first = shown[0];
  const last = shown[shown.length - 1];
  const growthAbs = last.avgDays - first.avgDays;
  const growthPct = first.avgDays > 0.05
    ? Math.round((growthAbs / first.avgDays) * 100)
    : null;
  const positive = growthAbs > 0.05;
  const flat = Math.abs(growthAbs) <= 0.05;

  const fmtDays = (v) => {
    const rounded = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
    return rounded.toLocaleString('fa-IR');
  };

  // ── Card shell ────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.className = 'ds-card';
  card.style.cssText = `
    position: relative;
    overflow: hidden;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: 14px;
    text-align: right;
    background:
      linear-gradient(160deg,
        color-mix(in srgb, var(--color-primary) 10%, var(--bg-card)) 0%,
        var(--bg-card) 48%,
        color-mix(in srgb, var(--color-accent) 6%, var(--bg-card)) 100%);
    border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--border-soft));
  `;

  // Soft decorative orb
  card.insertAdjacentHTML('afterbegin', `
    <div aria-hidden="true" style="
      position:absolute; inset-inline-end:-36px; top:-40px;
      width:120px; height:120px; border-radius:50%;
      background: radial-gradient(circle, color-mix(in srgb, var(--color-primary) 22%, transparent) 0%, transparent 70%);
      pointer-events:none;
    "></div>
  `);

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex; align-items:flex-start; justify-content:space-between; gap:10px; position:relative; z-index:1;';

  const headText = document.createElement('div');
  headText.style.cssText = 'display:flex; flex-direction:column; gap:4px; min-width:0;';
  headText.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; font-weight:800; font-size:15px; color:var(--text-primary);">
      <span class="material-symbols-rounded" style="font-size:20px; color:var(--color-primary);">psychology</span>
      <span>قدرت حافظه</span>
    </div>
    <div style="font-size:12px; font-weight:600; color:var(--text-secondary); line-height:1.55; padding-right:28px;">
      بعد از هر مرور، مطالب چند روز در ذهنت می‌مانند؟
    </div>
  `;

  header.appendChild(headText);
  card.appendChild(header);

  // Hero metric + comparison
  const heroRow = document.createElement('div');
  heroRow.style.cssText = 'display:flex; align-items:stretch; gap:12px; position:relative; z-index:1;';

  const hero = document.createElement('div');
  hero.style.cssText = `
    flex: 1.15;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--bg-card);
    border: 1px solid var(--border-soft);
    box-shadow: var(--shadow-sm);
  `;
  hero.innerHTML = `
    <div style="font-size:11px; font-weight:700; color:var(--text-tertiary);">میانگین این هفته</div>
    <div style="display:flex; align-items:baseline; gap:6px;">
      <span style="font-family:var(--font-mono); font-size:28px; font-weight:800; color:var(--text-primary); line-height:1.1; letter-spacing:-0.02em;">
        ${fmtDays(last.avgDays)}
      </span>
      <span style="font-size:13px; font-weight:700; color:var(--text-secondary);">روز</span>
    </div>
    <div style="font-size:11px; font-weight:600; color:var(--text-tertiary); margin-top:2px;">مدت ماندگاری در حافظه</div>
    <div style="font-size:10px; font-weight:600; color:var(--text-tertiary); margin-top:4px; opacity:0.85;">بر اساس ${last.cardCount.toLocaleString('fa-IR')} کارت</div>
  `;

  const compare = document.createElement('div');
  compare.style.cssText = `
    flex: 0.95;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-soft);
  `;

  const deltaColor = positive ? 'var(--color-success)' : flat ? 'var(--text-secondary)' : 'var(--color-warning)';
  const deltaIcon = positive ? 'trending_up' : flat ? 'trending_flat' : 'trending_down';
  const deltaLabel = flat
    ? 'تقریباً ثابت'
    : positive
      ? `${Math.abs(growthPct ?? 0).toLocaleString('fa-IR')}٪ قوی‌تر`
      : `${Math.abs(growthPct ?? 0).toLocaleString('fa-IR')}٪ ضعیف‌تر`;

  compare.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
      <span style="font-size:11px; font-weight:700; color:var(--text-tertiary);">شروع بازه</span>
      <span style="font-family:var(--font-mono); font-size:13px; font-weight:800; color:var(--text-primary);">${fmtDays(first.avgDays)} روز</span>
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
      <span style="font-size:11px; font-weight:700; color:var(--text-tertiary);">الان</span>
      <span style="font-family:var(--font-mono); font-size:13px; font-weight:800; color:var(--text-primary);">${fmtDays(last.avgDays)} روز</span>
    </div>
    <div style="display:flex; align-items:center; gap:6px; padding-top:2px; border-top:1px solid var(--border-soft);">
      <span class="material-symbols-rounded" style="font-size:18px; color:${deltaColor};">${deltaIcon}</span>
      <span style="font-size:12px; font-weight:800; color:${deltaColor};">${deltaLabel}</span>
    </div>
  `;

  heroRow.append(hero, compare);
  card.appendChild(heroRow);

  // Sparkline (area + line) — last weeks trend
  const sparkWrap = document.createElement('div');
  sparkWrap.style.cssText = 'position:relative; z-index:1; padding:4px 2px 0;';

  const W = 320;
  const H = 88;
  const padX = 8;
  const padY = 12;
  const vals = shown.map((w) => w.avgDays);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = Math.max(maxV - minV, 0.2);

  const pts = vals.map((v, i) => {
    const x = padX + (vals.length === 1 ? (W - padX * 2) / 2 : (i / (vals.length - 1)) * (W - padX * 2));
    const y = H - padY - ((v - minV) / span) * (H - padY * 2);
    return { x, y, v };
  });

  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  // Smooth-ish area using the same polyline closed to baseline
  const areaD = `${lineD} L ${pts[pts.length - 1].x.toFixed(1)} ${H - 2} L ${pts[0].x.toFixed(1)} ${H - 2} Z`;
  const lastPt = pts[pts.length - 1];
  const strokeColor = positive ? 'var(--color-success)' : flat ? 'var(--color-primary)' : 'var(--color-warning)';
  const fillFrom = positive
    ? 'color-mix(in srgb, var(--color-success) 28%, transparent)'
    : 'color-mix(in srgb, var(--color-primary) 22%, transparent)';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'width:100%; height:88px; display:block;';
  svg.innerHTML = `
    <defs>
      <linearGradient id="memGrowthFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${fillFrom}"/>
        <stop offset="100%" stop-color="transparent"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#memGrowthFill)" />
    <path d="${lineD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="4.5" fill="${strokeColor}" />
    <circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="8" fill="${strokeColor}" opacity="0.18" />
  `;
  sparkWrap.appendChild(svg);

  // Week labels under sparkline
  const labels = document.createElement('div');
  labels.style.cssText = 'display:flex; justify-content:space-between; padding:0 4px; margin-top:2px;';
  const leftLbl = document.createElement('span');
  leftLbl.style.cssText = 'font-size:10px; font-weight:700; color:var(--text-tertiary);';
  leftLbl.textContent = shown.length >= 2 ? `${shown.length.toLocaleString('fa-IR')} هفته پیش` : 'شروع';
  const rightLbl = document.createElement('span');
  rightLbl.style.cssText = 'font-size:10px; font-weight:800; color:var(--text-secondary);';
  rightLbl.textContent = 'این هفته';
  labels.append(leftLbl, rightLbl);
  sparkWrap.appendChild(labels);
  card.appendChild(sparkWrap);

  // Insight strip
  const insight = document.createElement('div');
  insight.style.cssText = `
    position: relative; z-index: 1;
    display: flex; align-items: flex-start; gap: 8px;
    padding: 10px 12px; border-radius: 14px;
    background: ${positive ? 'var(--color-success-soft)' : 'var(--bg-sunken)'};
    border: 1px solid ${positive ? 'color-mix(in srgb, var(--color-success) 22%, transparent)' : 'var(--border-soft)'};
  `;
  let insightText;
  const lowSample = last.cardCount < 5;
  if (lowSample) {
    insightText = `این هفته فقط ${last.cardCount.toLocaleString('fa-IR')} کارت مرور شده — برای یک روند قابل‌اتکا، چند هفتهٔ دیگر با مرور بیشتر لازم است.`;
  } else if (positive) {
    insightText = `حافظه‌ات حدود ${fmtDays(Math.abs(growthAbs))} روز ماندگارتر شده — یعنی فاصلهٔ مرورها می‌تواند بیشتر شود.`;
  } else if (flat) {
    insightText = 'روند تقریباً ثابت است. با مرور منظم، این عدد کم‌کم بالا می‌رود.';
  } else {
    insightText = 'مدت ماندگاری کمی کمتر شده. چند روز مرور پیوسته معمولاً روند را برمی‌گرداند.';
  }
  insight.innerHTML = `
    <span class="material-symbols-rounded" style="font-size:18px; color:${lowSample ? 'var(--text-tertiary)' : deltaColor}; flex-shrink:0;">${lowSample ? 'info' : (positive ? 'auto_awesome' : flat ? 'info' : 'bolt')}</span>
    <span style="font-size:12px; font-weight:700; color:var(--text-primary); line-height:1.55;">${insightText}</span>
  `;
  card.appendChild(insight);

  return card;
}


export async function renderStats(container) {
  container.innerHTML = '';
  const skeleton = createSkeletonList(3);
  container.appendChild(skeleton);

  const sessions = await studySessionRepository.getAll();
  const logs = await reviewHistoryRepository.getAll();
  const streak = await calculateStreak();

  let hasPomodoroHistory = false;
  try {
    const raw = JSON.parse(localStorage.getItem('pomodoro_stats') || 'null');
    if (raw && typeof raw === 'object') {
      if ((raw.focusMinutes || 0) > 0 || (raw.completed || 0) > 0) hasPomodoroHistory = true;
      const bd = raw.byDate || {};
      for (const k of Object.keys(bd)) {
        if ((bd[k] && (bd[k].focusMinutes || 0) > 0) || (bd[k] && (bd[k].completed || 0) > 0)) {
          hasPomodoroHistory = true;
          break;
        }
      }
    }
  } catch (e) { /* ignore */ }

  container.innerHTML = '';

  if (sessions.length === 0 && !hasPomodoroHistory) {
    const emptyContainer = document.createElement('div');
    emptyContainer.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding: 48px 20px; min-height: 50vh;';
    
    emptyContainer.innerHTML = `
      <div style="position:relative; width: 280px; height: 220px; margin-bottom: 36px;">
        <svg viewBox="0 0 300 220" style="width:100%; height:100%; overflow:visible;">
          <defs>
            <radialGradient id="asc-glow" cx="50%" cy="42%" r="58%">
              <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.14" />
              <stop offset="55%" stop-color="var(--color-primary)" stop-opacity="0.05" />
              <stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0" />
            </radialGradient>

            <filter id="asc-glow-blur" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="30" />
            </filter>

            <linearGradient id="asc-bar-grad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.03" />
              <stop offset="65%" stop-color="var(--color-primary)" stop-opacity="0.45" />
              <stop offset="100%" stop-color="var(--color-accent)" stop-opacity="0.9" />
            </linearGradient>

            <linearGradient id="asc-line-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0.35" />
              <stop offset="100%" stop-color="var(--color-accent)" stop-opacity="1" />
            </linearGradient>

            <radialGradient id="asc-cap-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0.9" />
              <stop offset="100%" stop-color="var(--color-accent)" stop-opacity="0" />
            </radialGradient>

            <filter id="asc-soft-blur" x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur stdDeviation="3" />
            </filter>

            <filter id="asc-particle-blur" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
          </defs>

          <!-- Ambient glow, no card, no border -->
          <circle cx="150" cy="100" r="130" fill="url(#asc-glow)" filter="url(#asc-glow-blur)" />

          <!-- Slowly drifting light particles for depth, kept away from the chart -->
          <g class="asc-particles" filter="url(#asc-particle-blur)">
            <circle cx="40" cy="40" r="2" fill="var(--color-accent)" opacity="0" class="asc-p1" />
            <circle cx="265" cy="35" r="1.6" fill="var(--color-primary)" opacity="0" class="asc-p2" />
            <circle cx="20" cy="150" r="1.8" fill="var(--color-primary)" opacity="0" class="asc-p3" />
            <circle cx="280" cy="140" r="2.2" fill="var(--color-accent)" opacity="0" class="asc-p4" />
            <circle cx="150" cy="18" r="1.5" fill="var(--color-accent)" opacity="0" class="asc-p5" />
            <circle cx="60" cy="190" r="1.6" fill="var(--color-primary)" opacity="0" class="asc-p6" />
          </g>

          <!-- Floating chart group -->
          <g class="asc-float">
            <!-- Faint baseline guides (no enclosing frame) -->
            <g opacity="0.06" stroke="var(--text-primary)" stroke-width="1" stroke-linecap="round">
              <line x1="30" y1="80" x2="270" y2="80" />
              <line x1="30" y1="125" x2="270" y2="125" />
              <line x1="30" y1="170" x2="270" y2="170" />
            </g>

            <!-- Bars -->
            <g>
              <rect x="45" y="170" width="18" height="0" rx="7" fill="url(#asc-bar-grad)" class="asc-b1" />
              <rect x="95" y="170" width="18" height="0" rx="7" fill="url(#asc-bar-grad)" class="asc-b2" />
              <rect x="145" y="170" width="18" height="0" rx="7" fill="url(#asc-bar-grad)" class="asc-b3" />
              <rect x="195" y="170" width="18" height="0" rx="7" fill="url(#asc-bar-grad)" class="asc-b4" />
              <rect x="245" y="170" width="18" height="0" rx="7" fill="url(#asc-bar-grad)" class="asc-b5" />
            </g>

            <!-- Line -->
            <path d="M 54 150 C 74 150, 84 118, 104 118 C 124 118, 134 80, 154 80 C 174 80, 184 106, 204 106 C 224 106, 234 62, 254 62"
              fill="none" stroke="url(#asc-line-grad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="asc-line" />

            <!-- Traveling comet of light along the line, with a soft blurred trail -->
            <path d="M 54 150 C 74 150, 84 118, 104 118 C 124 118, 134 80, 154 80 C 174 80, 184 106, 204 106 C 224 106, 234 62, 254 62"
              fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
              filter="url(#asc-soft-blur)" class="asc-sweep-trail" />
            <path d="M 54 150 C 74 150, 84 118, 104 118 C 124 118, 134 80, 154 80 C 174 80, 184 106, 204 106 C 224 106, 234 62, 254 62"
              fill="none" stroke="#ffffff" stroke-opacity="0.95" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="asc-sweep" />
          </g>
        </svg>
        <style>
          /* Gentle continuous float, independent of the build/reset cycle */
          @keyframes ascFloat {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-7px); }
          }
          .asc-float { animation: ascFloat 6s ease-in-out infinite; transform-origin: center; }

          /* Particles twinkle softly and drift, each on its own gentle offset */
          @keyframes ascParticle {
            0%, 100% { opacity: 0; transform: translateY(0px); }
            50% { opacity: 0.55; transform: translateY(-6px); }
          }
          .asc-p1 { animation: ascParticle 5.5s ease-in-out infinite; }
          .asc-p2 { animation: ascParticle 6.5s ease-in-out infinite 0.8s; }
          .asc-p3 { animation: ascParticle 7s ease-in-out infinite 1.6s; }
          .asc-p4 { animation: ascParticle 5.8s ease-in-out infinite 2.2s; }
          .asc-p5 { animation: ascParticle 6.2s ease-in-out infinite 0.4s; }
          .asc-p6 { animation: ascParticle 7.4s ease-in-out infinite 3s; }

          /* Bars rise from the baseline, hold, then settle back before the next pass */
          @keyframes ascBar1 { 0%, 8% { height: 0px; y: 170px; opacity: 0; } 16% { opacity: 1; } 26%, 78% { height: 20px; y: 150px; opacity: 1; } 90%, 100% { height: 0px; y: 170px; opacity: 0; } }
          @keyframes ascBar2 { 0%, 11% { height: 0px; y: 170px; opacity: 0; } 19% { opacity: 1; } 29%, 78% { height: 52px; y: 118px; opacity: 1; } 90%, 100% { height: 0px; y: 170px; opacity: 0; } }
          @keyframes ascBar3 { 0%, 14% { height: 0px; y: 170px; opacity: 0; } 22% { opacity: 1; } 32%, 78% { height: 90px; y: 80px; opacity: 1; } 90%, 100% { height: 0px; y: 170px; opacity: 0; } }
          @keyframes ascBar4 { 0%, 17% { height: 0px; y: 170px; opacity: 0; } 25% { opacity: 1; } 35%, 78% { height: 64px; y: 106px; opacity: 1; } 90%, 100% { height: 0px; y: 170px; opacity: 0; } }
          @keyframes ascBar5 { 0%, 20% { height: 0px; y: 170px; opacity: 0; } 28% { opacity: 1; } 38%, 78% { height: 108px; y: 62px; opacity: 1; } 90%, 100% { height: 0px; y: 170px; opacity: 0; } }
          .asc-b1 { animation: ascBar1 9s cubic-bezier(0.22, 0.8, 0.2, 1) infinite; }
          .asc-b2 { animation: ascBar2 9s cubic-bezier(0.22, 0.8, 0.2, 1) infinite; }
          .asc-b3 { animation: ascBar3 9s cubic-bezier(0.22, 0.8, 0.2, 1) infinite; }
          .asc-b4 { animation: ascBar4 9s cubic-bezier(0.22, 0.8, 0.2, 1) infinite; }
          .asc-b5 { animation: ascBar5 9s cubic-bezier(0.22, 0.8, 0.2, 1) infinite; }

          /* Line draws in smoothly, holds, fades before reset */
          @keyframes ascLineDraw {
            0%, 18% { stroke-dashoffset: 260; opacity: 0; }
            20% { opacity: 1; }
            42%, 78% { stroke-dashoffset: 0; opacity: 1; }
            90%, 100% { stroke-dashoffset: 260; opacity: 0; }
          }
          .asc-line { stroke-dasharray: 260; stroke-dashoffset: 260; animation: ascLineDraw 9s cubic-bezier(0.3, 0.1, 0.2, 1) infinite; }

          /* A single comet of light travels the finished line, with a soft blurred trail behind it, then everything fades for a seamless restart */
          @keyframes ascSweep {
            0%, 56% { stroke-dasharray: 22 400; stroke-dashoffset: 430; opacity: 0; }
            60% { opacity: 1; }
            74% { stroke-dasharray: 22 400; stroke-dashoffset: -30; opacity: 1; }
            80%, 100% { opacity: 0; }
          }
          .asc-sweep { stroke-dasharray: 22 400; stroke-dashoffset: 430; animation: ascSweep 9s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
          .asc-sweep-trail { stroke-dasharray: 22 400; stroke-dashoffset: 430; animation: ascSweep 9s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        </style>
      </div>

      <h3 style="font-size: 21px; font-weight: 700; color: var(--text-primary); margin: 0 0 10px 0; letter-spacing: -0.4px;">مسیر رشد شما از همین‌جا شروع می‌شود</h3>
      <p style="font-size: 15px; color: var(--text-secondary); max-width: 340px; margin: 0 0 32px 0; line-height: 1.8;">
        با هر مرور، این نمودار کمی روشن‌تر می‌شود. اولین قدم را بردارید و پیشرفت خود را با چشم ببینید.
      </p>
    `;

    const actionButton = createButton({
      label: 'شروع یادگیری',
      icon: 'rocket_launch',
      onClick: () => router.navigate('home')
    });
    
    actionButton.style.padding = '12px 24px';
    actionButton.style.fontSize = '15px';
    
    emptyContainer.appendChild(actionButton);
    container.appendChild(emptyContainer);
    return;
  }

  const totalSessions = sessions.length;
  const totalReviews = sessions.reduce((acc, s) => acc + (s.cardsReviewed || 0), 0);

  const scoredSessions = sessions.filter((s) => s.isPracticeSession || s.isExamSession);
  const totalScoredQuestions = scoredSessions.reduce((acc, s) => acc + (s.cardsReviewed || 0), 0);
  const totalCorrect = scoredSessions.reduce((acc, s) => acc + (s.correctAnswers || 0), 0);
  const globalAccuracy = totalScoredQuestions > 0 ? Math.round((totalCorrect / totalScoredQuestions) * 100) : null;
  
  const totalTimeSec = sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
  const totalTimeMin = Math.round(totalTimeSec / 60);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%; max-width:var(--max-content-w); margin:0 auto;';
  container.appendChild(wrap);

  const statsGrid = document.createElement('div');
  statsGrid.style.cssText = 'display:grid; grid-template-columns:repeat(2, 1fr); gap:var(--space-2);';
  wrap.appendChild(statsGrid);

  const statCards = [
    { label: 'کل دفعات مرور', val: totalReviews.toLocaleString('fa-IR'), icon: 'style', color: 'var(--color-primary)' },
    { label: 'دقت پاسخ‌دهی (تمرین و آزمون)', val: globalAccuracy === null ? '—' : `${globalAccuracy.toLocaleString('fa-IR')}%`, icon: 'verified', color: 'var(--color-success)' },
    { label: 'زمان کل مطالعه', val: `${totalTimeMin.toLocaleString('fa-IR')} دقیقه`, icon: 'schedule', color: 'var(--color-accent)' },
    { label: 'جلسات مطالعه', val: totalSessions.toLocaleString('fa-IR'), icon: 'menu_book', color: 'var(--text-secondary)' },
  ];

  statCards.forEach(sc => {
    const card = document.createElement('div');
    card.className = 'ds-card';
    card.style.cssText = 'padding:var(--space-3); display:flex; align-items:center; gap:var(--space-3); text-align:right;';
    
    const iconBox = document.createElement('div');
    iconBox.style.cssText = `width:40px; height:40px; border-radius:50%; background:${sc.color}12; color:${sc.color}; display:flex; align-items:center; justify-content:center;`;
    iconBox.innerHTML = `<span class="material-symbols-rounded">${sc.icon}</span>`;

    const info = document.createElement('div');
    info.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
    
    const label = document.createElement('span');
    label.style.cssText = 'font-size:11px; color:var(--text-tertiary); font-weight:600;';
    label.textContent = sc.label;

    const value = document.createElement('span');
    value.style.cssText = 'font-size:var(--text-section); font-weight:800; color:var(--text-primary);';
    value.textContent = sc.val;

    info.append(label, value);
    card.append(iconBox, info);
    statsGrid.appendChild(card);
  });

  const streakCard = document.createElement('div');
  streakCard.className = 'ds-card';
  streakCard.style.cssText = `
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    text-align: right;
    background:
      linear-gradient(145deg,
        color-mix(in srgb, var(--color-accent) 10%, var(--bg-card)) 0%,
        var(--bg-card) 60%);
    border: 1px solid color-mix(in srgb, var(--color-accent) 22%, var(--border-soft));
    box-shadow: var(--shadow-card);
  `;

  const streakHeader = document.createElement('div');
  streakHeader.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); font-weight:800; font-size:var(--text-body); color:var(--color-accent);';
  streakHeader.innerHTML = '<span class="material-symbols-rounded" style="animation:flamePulse 2.4s infinite ease-in-out;">local_fire_department</span><span>آمار روندهای مطالعه روزانه</span>';

  const streakGrid = document.createElement('div');
  streakGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3);';

  const currentStreakCol = document.createElement('div');
  currentStreakCol.style.cssText = `
    background: color-mix(in srgb, var(--color-accent) 12%, var(--bg-card));
    border: 1px solid color-mix(in srgb, var(--color-accent) 28%, transparent);
    padding: var(--space-3); border-radius: 16px;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  `;
  currentStreakCol.innerHTML = `
    <span style="font-size:var(--text-title); font-weight:900; color:var(--color-accent); font-variant-numeric:tabular-nums;">${streak.currentStreak.toLocaleString('fa-IR')}</span>
    <span style="font-size:11px; font-weight:700; color:var(--text-secondary);">روند متوالی فعلی</span>`;

  const longestStreakCol = document.createElement('div');
  longestStreakCol.style.cssText = `
    background: var(--bg-sunken);
    border: 1px solid var(--border-soft);
    padding: var(--space-3); border-radius: 16px;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  `;
  longestStreakCol.innerHTML = `
    <span style="font-size:var(--text-title); font-weight:900; color:var(--text-primary); font-variant-numeric:tabular-nums;">${streak.longestStreak.toLocaleString('fa-IR')}</span>
    <span style="font-size:11px; font-weight:700; color:var(--text-secondary); display:flex; align-items:center; gap:3px;">
      <span class="material-symbols-rounded" style="font-size:14px; color:var(--color-accent);">emoji_events</span>
      بهترین تاریخی
    </span>`;

  streakGrid.append(currentStreakCol, longestStreakCol);
  streakCard.append(streakHeader, streakGrid);

  // Mini week strip on stats page
  const weekStrip = Array.isArray(streak.weekStrip) ? streak.weekStrip : [];
  if (weekStrip.length) {
    const daysRow = document.createElement('div');
    daysRow.style.cssText = 'display:grid; grid-template-columns:repeat(7,1fr); gap:6px; direction:ltr; margin-top:2px;';
    weekStrip.forEach((day) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:5px;';
      const dot = document.createElement('div');
      let bg = 'var(--bg-sunken)';
      let border = '1px solid var(--border-soft)';
      let color = 'var(--text-tertiary)';
      let content = '';
      if (day.studied) {
        bg = 'var(--color-accent)';
        border = '1px solid color-mix(in srgb, var(--color-accent) 80%, #000)';
        color = '#fff';
        content = '<span class="material-symbols-rounded" style="font-size:14px;">check</span>';
      } else if (day.grace) {
        bg = 'color-mix(in srgb, var(--color-primary) 16%, var(--bg-card))';
        border = '1px dashed color-mix(in srgb, var(--color-primary) 45%, transparent)';
        color = 'var(--color-primary)';
        content = '❄️';
      }
      if (day.isToday && !day.studied && !day.grace) {
        border = '2px solid var(--color-accent)';
        bg = 'color-mix(in srgb, var(--color-accent) 10%, var(--bg-card))';
      }
      dot.style.cssText = `width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${bg};border:${border};color:${color};font-size:12px;font-weight:800;`;
      if (day.isToday) {
        dot.style.boxShadow = '0 0 0 2px color-mix(in srgb, var(--color-accent) 22%, transparent)';
      }
      dot.innerHTML = content;
      const lbl = document.createElement('span');
      lbl.style.cssText = `font-size:10px;font-weight:${day.isToday ? '800' : '600'};color:${day.isToday ? 'var(--color-accent)' : 'var(--text-tertiary)'};`;
      lbl.textContent = day.label;
      cell.append(dot, lbl);
      daysRow.appendChild(cell);
    });
    streakCard.appendChild(daysRow);
  }

  if (streak.usedGraceInCurrent) {
    const graceHint = document.createElement('div');
    graceHint.style.cssText = 'font-size:11px; color:var(--text-secondary); text-align:right; line-height:1.6; padding:8px 10px; border-radius:12px; background:var(--color-primary-soft); border:1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);';
    graceHint.textContent = '❄️ این استریک با ۱ روز آزاد ادامه دارد — آمار روزهای واقعی مطالعه تغییر نکرده است.';
    streakCard.appendChild(graceHint);
  }

  wrap.appendChild(streakCard);

  {
    const dailyGoalStr = await db.getSetting('daily_study_goal', '20');
    const dailyGoal = parseInt(dailyGoalStr, 10) || 20;
    const focusGoalStr = await db.getSetting('daily_focus_goal_min', '60');
    const focusGoal = parseInt(focusGoalStr, 10) || 60;

    const dailyCounts = new Map(); // date -> cards reviewed
    sessions.forEach((s) => {
      if (!s.date) return;
      dailyCounts.set(s.date, (dailyCounts.get(s.date) || 0) + (s.cardsReviewed || 0));
    });

    // Pomodoro focus minutes by date (today + archived history)
    let focusByDate = {};
    try {
      const { getPomodoroFocusByDate } = await import('./pomodoro.js');
      focusByDate = getPomodoroFocusByDate() || {};
    } catch (e) {
      try {
        const raw = JSON.parse(localStorage.getItem('pomodoro_stats') || 'null');
        if (raw && typeof raw === 'object') {
          focusByDate = { ...(raw.byDate || {}) };
          if (raw.date) {
            focusByDate[raw.date] = {
              completed: raw.completed || 0,
              focusMinutes: raw.focusMinutes || 0,
            };
          }
        }
      } catch (e2) { /* ignore */ }
    }

    const NUM_WEEKS = 18;
    const toDateStr = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const dayLabels = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // شنبه..جمعه, row 0..6
    const rowIndexOf = (date) => (date.getDay() + 1) % 7;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - (NUM_WEEKS * 7 - 1));
    rangeStart.setDate(rangeStart.getDate() - rowIndexOf(rangeStart));
    const totalDaysSpan = Math.round((today - rangeStart) / 86400000) + 1;
    const weeksToRender = Math.ceil(totalDaysSpan / 7);

    const weeks = [];
    let cursor = new Date(rangeStart);
    for (let w = 0; w < weeksToRender; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const inRange = cursor >= rangeStart && cursor <= today;
        const key = toDateStr(cursor);
        const cards = inRange ? (dailyCounts.get(key) || 0) : null;
        const focusMin = inRange ? ((focusByDate[key] && focusByDate[key].focusMinutes) || 0) : null;
        week.push({
          date: new Date(cursor),
          count: cards, // null = outside range
          focusMin,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }

    const activeDaysInRange = weeks.flat().filter((c) => c.count !== null && ((c.count || 0) > 0 || (c.focusMin || 0) > 0)).length;
    const totalDaysInRange = weeks.flat().filter((c) => c.count !== null).length;

    // Colour by proximity to either the card goal or the focus-time goal.
    const levelOf = (cards, focusMin) => {
      const rCards = dailyGoal > 0 ? (cards || 0) / dailyGoal : 0;
      const rFocus = focusGoal > 0 ? (focusMin || 0) / focusGoal : 0;
      const ratio = Math.max(rCards, rFocus);
      if (ratio <= 0) return 0;
      if (ratio >= 1) return 4;
      if (ratio >= 0.6) return 3;
      if (ratio >= 0.3) return 2;
      return 1;
    };
    const levelStyle = (level) => {
      if (level === 0) return 'background:var(--bg-sunken);';
      const opacity = [0, 0.35, 0.6, 0.8, 1][level];
      return `background:var(--color-accent); opacity:${opacity};`;
    };

    const heatmapCard = document.createElement('div');
    heatmapCard.className = 'ds-card';
    heatmapCard.style.cssText = 'padding:var(--space-3); display:flex; flex-direction:column; gap:var(--space-2); text-align:right;';

    const heatmapHeader = document.createElement('div');
    heatmapHeader.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); font-weight:800; font-size:var(--text-body); color:var(--color-accent);';
    heatmapHeader.innerHTML = '<span class="material-symbols-rounded">history</span><span>تقویم مطالعه</span>';

    const heatmapSubtitle = document.createElement('span');
    heatmapSubtitle.style.cssText = 'font-size:11px; color:var(--text-tertiary); font-weight:600;';
    heatmapSubtitle.textContent = `${activeDaysInRange.toLocaleString('fa-IR')} روز از ${totalDaysInRange.toLocaleString('fa-IR')} روز اخیر · هدف: ${dailyGoal.toLocaleString('fa-IR')} کارت یا ${focusGoal.toLocaleString('fa-IR')} دقیقه تمرکز`;

    const heatmapRow = document.createElement('div');
    heatmapRow.style.cssText = 'display:flex; gap:6px; align-items:flex-start;';

    const CELL = 13; // px
    const GAP = 3; // px

    const labelsCol = document.createElement('div');
    labelsCol.style.cssText = `display:grid; grid-template-rows:repeat(7, ${CELL}px); gap:${GAP}px; flex-shrink:0;`;
    dayLabels.forEach((lbl, i) => {
      const l = document.createElement('span');
      l.style.cssText = `font-size:9px; line-height:${CELL}px; color:var(--text-tertiary); text-align:center; visibility:${i % 2 === 0 ? 'visible' : 'hidden'};`;
      l.textContent = lbl;
      labelsCol.appendChild(l);
    });

    const scrollArea = document.createElement('div');
    scrollArea.style.cssText = 'overflow-x:auto; overflow-y:hidden; flex:1; min-width:0;';
    scrollArea.setAttribute('dir', 'rtl');

    const grid = document.createElement('div');
    grid.style.cssText = `display:grid; grid-auto-flow:column; grid-template-rows:repeat(7, ${CELL}px); gap:${GAP}px; width:max-content;`;

    for (let w = weeks.length - 1; w >= 0; w--) {
      weeks[w].forEach((cell) => {
        const box = document.createElement('div');
        if (cell.count === null) {
          box.style.cssText = `width:${CELL}px; height:${CELL}px; border-radius:3px; visibility:hidden;`;
        } else {
          const level = levelOf(cell.count, cell.focusMin);
          const dateLabel = cell.date.toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' });
          const parts = [];
          if ((cell.count || 0) > 0) parts.push(`${cell.count.toLocaleString('fa-IR')} مرور`);
          if ((cell.focusMin || 0) > 0) parts.push(`${cell.focusMin.toLocaleString('fa-IR')} دقیقه تمرکز`);
          box.title = parts.length ? `${dateLabel} — ${parts.join(' · ')}` : dateLabel;
          box.style.cssText = `width:${CELL}px; height:${CELL}px; border-radius:3px; ${levelStyle(level)}`;
        }
        grid.appendChild(box);
      });
    }

    scrollArea.appendChild(grid);
    heatmapRow.append(labelsCol, scrollArea);

    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; align-items:center; justify-content:flex-end; gap:4px; margin-top:2px;';
    const legendLess = document.createElement('span');
    legendLess.style.cssText = 'font-size:10px; color:var(--text-tertiary);';
    legendLess.textContent = 'کمتر';
    const legendMore = document.createElement('span');
    legendMore.style.cssText = 'font-size:10px; color:var(--text-tertiary);';
    legendMore.textContent = 'بیشتر';
    legend.appendChild(legendMore);
    for (let lvl = 4; lvl >= 0; lvl--) {
      const sq = document.createElement('span');
      sq.style.cssText = `display:inline-block; width:10px; height:10px; border-radius:2px; ${levelStyle(lvl)}`;
      legend.appendChild(sq);
    }
    legend.appendChild(legendLess);

    heatmapCard.append(heatmapHeader, heatmapSubtitle, heatmapRow, legend);
    wrap.appendChild(heatmapCard);
  }

  // "Memory growth" — the app already computes an FSRS "stability" value
  // (roughly: how many days a card stays remembered) for every single
  // review, but never showed it to the user. Turning it into a simple
  // weekly-average chart gives real, earned evidence of progress — not
  // a decorative badge — which is what the streak/goal widgets above
  // can't provide on their own.
  {
    const growthCard = buildMemoryGrowthCard(logs);
    if (growthCard) wrap.appendChild(growthCard);
  }

  const listHeaderRow = document.createElement('div');
  listHeaderRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:var(--space-2); margin-bottom:var(--space-2);';
  const listHeader = document.createElement('h3');
  listHeader.style.cssText = 'font-size:var(--text-section); font-weight:800; color:var(--text-primary); margin:0; text-align:right;';
  listHeader.textContent = 'تاریخچه جلسات اخیر';
  const selectActions = document.createElement('div');
  selectActions.style.cssText = 'display:none; align-items:center; gap:6px;';
  const selectCountLabel = document.createElement('span');
  selectCountLabel.style.cssText = 'font-size:12px; font-weight:700; color:var(--text-secondary);';
  const deleteSelectedBtn = document.createElement('button');
  deleteSelectedBtn.type = 'button';
  deleteSelectedBtn.className = 'btn btn-primary';
  deleteSelectedBtn.style.cssText = 'height:32px; padding:0 12px; border-radius:10px; font-size:12px; font-weight:700; background:var(--color-danger); border:none; color:#fff;';
  deleteSelectedBtn.textContent = 'حذف';
  const cancelSelectBtn = document.createElement('button');
  cancelSelectBtn.type = 'button';
  cancelSelectBtn.style.cssText = 'height:32px; padding:0 10px; border-radius:10px; font-size:12px; font-weight:700; background:var(--bg-sunken); border:1px solid var(--border-soft); color:var(--text-secondary); cursor:pointer;';
  cancelSelectBtn.textContent = 'انصراف';
  selectActions.append(selectCountLabel, deleteSelectedBtn, cancelSelectBtn);
  listHeaderRow.append(listHeader, selectActions);
  wrap.appendChild(listHeaderRow);

  const sessionsContainer = document.createElement('div');
  sessionsContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  wrap.appendChild(sessionsContainer);

  const sortedSessions = [...sessions].sort((a, b) => new Date(b.startTime) - new Date(a.startTime)).slice(0, 40);
  let selectMode = false;
  const selectedIds = new Set();
  const cardById = new Map();

  function updateSelectChrome() {
    selectActions.style.display = selectMode ? 'flex' : 'none';
    selectCountLabel.textContent = selectMode
      ? `${selectedIds.size.toLocaleString('fa-IR')} انتخاب‌شده`
      : '';
    deleteSelectedBtn.disabled = selectedIds.size === 0;
    deleteSelectedBtn.style.opacity = selectedIds.size === 0 ? '0.5' : '1';
    cardById.forEach((card, id) => {
      const check = card.querySelector('[data-select-check]');
      if (check) {
        check.style.display = selectMode ? 'flex' : 'none';
        check.textContent = selectedIds.has(id) ? 'check_box' : 'check_box_outline_blank';
        check.style.color = selectedIds.has(id) ? 'var(--color-primary)' : 'var(--border-strong)';
      }
      card.style.border = selectedIds.has(id) && selectMode
        ? '1.5px solid var(--color-primary)'
        : '1px solid transparent';
      card.style.background = selectedIds.has(id) && selectMode
        ? 'var(--color-primary-soft)'
        : 'var(--bg-card)';
    });
  }

  function enterSelectMode(seedId) {
    selectMode = true;
    if (seedId) selectedIds.add(seedId);
    updateSelectChrome();
  }
  function exitSelectMode() {
    selectMode = false;
    selectedIds.clear();
    updateSelectChrome();
  }

  cancelSelectBtn.addEventListener('click', exitSelectMode);
  deleteSelectedBtn.addEventListener('click', async () => {
    if (!selectedIds.size) return;
    const n = selectedIds.size;
    const ok = window.confirm(`آیا از حذف ${n.toLocaleString('fa-IR')} جلسه مطمئن هستید؟ این عمل قابل بازگشت نیست.`);
    if (!ok) return;
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      try {
        await studySessionRepository.delete(id);
        const card = cardById.get(id);
        if (card) card.remove();
        cardById.delete(id);
        selectedIds.delete(id);
      } catch (e) {
        console.error('delete session failed', id, e);
      }
    }
    exitSelectMode();
    showToast(`${n.toLocaleString('fa-IR')} جلسه حذف شد.`, 'success');
    if (!sessionsContainer.children.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center; color:var(--text-tertiary); font-size:13px; padding:12px;';
      empty.textContent = 'جلسه‌ای باقی نمانده است.';
      sessionsContainer.appendChild(empty);
    }
  });

  sortedSessions.forEach(s => {
    if (!s || !s.id) return;
    const sessCard = document.createElement('div');
    sessCard.className = 'ds-card';
    sessCard.style.cssText = 'padding:var(--space-3); display:flex; justify-content:space-between; align-items:center; gap:var(--space-2); border:1px solid transparent; transition:background 0.15s, border-color 0.15s; user-select:none; -webkit-user-select:none;';
    sessCard.dataset.sessionId = s.id;

    const checkIcon = document.createElement('span');
    checkIcon.className = 'material-symbols-rounded';
    checkIcon.setAttribute('data-select-check', '1');
    checkIcon.style.cssText = 'display:none; font-size:22px; color:var(--border-strong); flex-shrink:0;';
    checkIcon.textContent = 'check_box_outline_blank';

    const textCol = document.createElement('div');
    textCol.style.cssText = 'display:flex; flex-direction:column; gap:2px; text-align:right; flex:1; min-width:0;';

    const date = new Date(s.startTime);
    const dateStr = date.toLocaleDateString('fa-IR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    const title = document.createElement('span');
    title.style.cssText = 'font-weight:700; color:var(--text-primary); font-size:var(--text-body);';
    title.textContent = `${dateStr} ساعت ${timeStr}`;

    const durationMin = Math.ceil((s.duration || 0) / 60);
    const isScored = s.isPracticeSession || s.isExamSession;
    const kindLabel = s.isExamSession ? 'آزمون' : (s.isPracticeSession ? 'تمرین' : 'مرور کارت');
    const accuracyPart = isScored
      ? ` · دقت: <span style="color:var(--color-success); font-weight:600;">${Math.round((s.correctAnswers / (s.cardsReviewed || 1)) * 100).toLocaleString('fa-IR')}%</span>`
      : '';
    const detail = document.createElement('span');
    detail.style.cssText = 'font-size:var(--text-caption); color:var(--text-tertiary);';
    detail.innerHTML = `${kindLabel} · مدت زمان: ${durationMin.toLocaleString('fa-IR')} دقیقه · <span style="color:var(--color-primary); font-weight:600;">${(s.cardsReviewed || 0).toLocaleString('fa-IR')} کارت</span>${accuracyPart}`;

    textCol.append(title, detail);

    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.style.cssText = 'color:var(--color-success); font-size:24px; flex-shrink:0;';
    icon.textContent = 'check_circle';

    sessCard.append(checkIcon, textCol, icon);
    sessionsContainer.appendChild(sessCard);
    cardById.set(s.id, sessCard);

    let longPressTimer = null;
    const clearLongPress = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    };
    const onPointerDown = (e) => {
      if (selectMode) return;
      clearLongPress();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (navigator.vibrate) { try { navigator.vibrate(18); } catch (err) {} }
        enterSelectMode(s.id);
      }, 480);
    };
    sessCard.addEventListener('pointerdown', onPointerDown);
    sessCard.addEventListener('pointerup', clearLongPress);
    sessCard.addEventListener('pointercancel', clearLongPress);
    sessCard.addEventListener('pointerleave', clearLongPress);
    sessCard.addEventListener('click', (e) => {
      if (!selectMode) return;
      e.preventDefault();
      if (selectedIds.has(s.id)) selectedIds.delete(s.id);
      else selectedIds.add(s.id);
      updateSelectChrome();
    });
  });
}

export async function renderSettings(container) {
  container.innerHTML = '';
  const loading = createLoadingInline ? createLoadingInline('در حال بارگذاری تنظیمات...') : document.createElement('div');
  loading.style.padding = 'var(--space-4) 0';
  loading.style.textAlign = 'center';
  container.appendChild(loading);

  
  const apiKey = await db.getSetting('gemini_api_key', '');
  const preferredModel = await db.getSetting('gemini_model', 'gemini-3.5-flash');
  const aiProvider = await db.getSetting('ai_provider', 'gemini');
  const groqApiKey = await db.getSetting('groq_api_key', '');
  const groqModel = await db.getSetting('groq_model', 'openai/gpt-oss-120b');
  const openrouterApiKey = await db.getSetting('openrouter_api_key', '');
  const openrouterModel = await db.getSetting('openrouter_model', 'openrouter/free');
  const deepseekApiKey = await db.getSetting('deepseek_api_key', '');
  const deepseekModel = await db.getSetting('deepseek_model', 'deepseek-chat');
  const dictationMethod = await db.getSetting('dictation_method', 'auto');
  const customInstruction = await db.getSetting('gemini_system_instruction', '');
  const ttsSpeed = await db.getSetting('tts_speed', '0.95');
  const ttsLang = await db.getSetting('tts_lang', 'en-US');
  const dailyGoal = await db.getSetting('daily_study_goal', '20');
  const dailyFocusGoal = await db.getSetting('daily_focus_goal_min', '60');
  const newCardsPerDay = await db.getSetting('new_cards_per_day', '20');

  const intervalAgain = localStorage.getItem('interval_again') || '1';
  const intervalHard = localStorage.getItem('interval_hard') || '2';
  const intervalGood = localStorage.getItem('interval_good') || '4';
  const intervalEasy = localStorage.getItem('interval_easy') || '8';

  const cats = await categoryRepository.getAll();
  const cards = await flashcardRepository.getAll();
  const sessions = await studySessionRepository.getAll();

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = 'var(--space-3)';
  wrap.style.width = '100%';
  wrap.style.maxWidth = 'var(--max-content-w)';
  wrap.style.margin = '0 auto';
  wrap.style.paddingBottom = 'var(--space-4)';
  container.appendChild(wrap);

  function showStatusMessage(msgContainer, text, type = 'success') {
    const existing = msgContainer.querySelector('.settings-status-msg');
    if (existing) existing.remove();
    
    const msg = document.createElement('div');
    msg.className = 'settings-status-msg';
    msg.style.cssText = `
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-input);
      font-size: var(--text-caption);
      font-weight: 700;
      margin-top: var(--space-2);
      display: flex;
      align-items: center;
      gap: 8px;
      animation: fadeIn 0.2s ease-out;
    `;
    if (type === 'success') {
      msg.style.background = 'rgba(16, 185, 129, 0.1)';
      msg.style.color = '#10B981';
      msg.style.border = '1px solid rgba(16, 185, 129, 0.2)';
      msg.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">check_circle</span>' + text;
    } else if (type === 'info') {
      msg.style.background = 'rgba(59, 130, 246, 0.1)';
      msg.style.color = '#3B82F6';
      msg.style.border = '1px solid rgba(59, 130, 246, 0.2)';
      msg.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">info</span>' + text;
    } else {
      msg.style.background = 'rgba(239, 68, 68, 0.1)';
      msg.style.color = '#EF4444';
      msg.style.border = '1px solid rgba(239, 68, 68, 0.2)';
      msg.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">error</span>' + text;
    }
    msgContainer.appendChild(msg);
    setTimeout(() => { if (msg.parentNode) msg.remove(); }, 5000);
  }

  const tabContainer = document.createElement('div');
  tabContainer.style.cssText = `
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding: var(--space-1);
    background: var(--bg-card);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-card);
    margin-bottom: var(--space-2);
    direction: rtl;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  `;
  tabContainer.style.setProperty('::-webkit-scrollbar', 'display: none');

  const aiSvgHtml = `
<svg class="ai-custom-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; display: inline-block; vertical-align: middle;">
  <path d="M12 5a3.5 3.5 0 0 0-3.5-3.5 4.5 4.5 0 0 0-4.5 4.5 3.5 3.5 0 0 0 1 5.5 3.5 3.5 0 0 0-1 4.5 4.5 4.5 0 0 0 4.5 4.5A3.5 3.5 0 0 0 12 17" />
  <path d="M12 5a3.5 3.5 0 0 1 3.5-3.5 4.5 4.5 0 0 1 4.5 4.5 3.5 3.5 0 0 1-1 5.5 3.5 3.5 0 0 1 1 4.5 4.5 4.5 0 0 1-4.5 4.5A3.5 3.5 0 0 1 12 17" stroke-dasharray="2 2" />
  <line x1="12" y1="5" x2="15.5" y2="5" stroke-width="1.2" />
  <circle cx="15.5" cy="5" r="1.5" fill="currentColor" stroke="none" />
  <line x1="12" y1="11" x2="18" y2="11" stroke-width="1.2" />
  <circle cx="18" cy="11" r="1.5" fill="currentColor" stroke="none" />
  <line x1="12" y1="17" x2="15.5" y2="17" stroke-width="1.2" />
  <circle cx="15.5" cy="17" r="1.5" fill="currentColor" stroke="none" />
  <line x1="12" y1="1.5" x2="12" y2="22.5" stroke-width="1" stroke-dasharray="1 3" />
</svg>
  `;

  const tabs = [
    { id: 'study', label: 'مطالعه و فواصل', icon: 'school' },
    { id: 'ai', label: 'هوش مصنوعی و صدا', icon: aiSvgHtml.trim() },
    { id: 'appearance', label: 'ظاهر و پوسته', icon: 'palette' },
    { id: 'system', label: 'سیستم و پشتیبان', icon: 'settings_suggest' },
  ];

  const contentWrap = document.createElement('div');
  contentWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%;';

  const studyTabContent = document.createElement('div');
  studyTabContent.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%;';

  const goalContainer = document.createElement('div');
  goalContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const goalField = createTextField({
    label: 'هدف روزانه مرور (تعداد کارت)',
    placeholder: 'مثلاً ۲۰',
    value: dailyGoal,
    type: 'number'
  });
  const focusGoalField = createTextField({
    label: 'هدف روزانه تمرکز تایمر (دقیقه)',
    placeholder: 'مثلاً ۶۰',
    value: dailyFocusGoal,
    type: 'number'
  });
  const newCardsField = createTextField({
    label: 'سقف کارت جدید در روز',
    placeholder: 'مثلاً ۲۰',
    value: newCardsPerDay,
    type: 'number'
  });
  const newCardsHint = document.createElement('div');
  newCardsHint.style.cssText = 'font-size:11px; color:var(--text-tertiary); line-height:1.6; text-align:right; margin-top:-6px;';
  newCardsHint.textContent = 'بیش از این تعداد کارت تازه (هیچ‌وقت مرور نشده) در یک روز نشان داده نمی‌شود؛ بقیه فردا می‌آیند. برای غیرفعال‌کردن سقف، عدد ۰ را وارد نکنید — عدد بزرگ (مثلاً ۹۹۹) بگذارید.';
  const saveGoalBtn = createButton({
    label: 'ذخیره اهداف مطالعه',
    icon: 'done',
    variant: 'primary',
    onClick: async () => {
      const val = parseInt(goalField.input.value.trim(), 10);
      const focusVal = parseInt(focusGoalField.input.value.trim(), 10);
      const newCardsVal = parseInt(newCardsField.input.value.trim(), 10);
      if (isNaN(val) || val <= 0) {
        showStatusMessage(goalContainer, 'هدف کارت باید عددی بزرگتر از صفر باشد.', 'error');
        return;
      }
      if (isNaN(focusVal) || focusVal <= 0) {
        showStatusMessage(goalContainer, 'هدف تمرکز باید عددی بزرگتر از صفر (به دقیقه) باشد.', 'error');
        return;
      }
      if (isNaN(newCardsVal) || newCardsVal < 0) {
        showStatusMessage(goalContainer, 'سقف کارت جدید باید صفر یا عددی مثبت باشد.', 'error');
        return;
      }
      await db.setSetting('daily_study_goal', val.toString());
      await db.setSetting('daily_focus_goal_min', focusVal.toString());
      await db.setSetting('new_cards_per_day', newCardsVal.toString());
      showStatusMessage(goalContainer, 'اهداف روزانه (کارت، تمرکز و سقف کارت جدید) ذخیره شد.', 'success');
    }
  });
  saveGoalBtn.style.alignSelf = 'flex-end';
  goalContainer.append(goalField, focusGoalField, newCardsField, newCardsHint, saveGoalBtn);

  const goalCard = createCard({ title: 'برنامه‌ریزی و اهداف روزانه', content: goalContainer });


  // ── Local notifications settings (redesigned) ─────────────────────
  const notifEnabled = (await db.getSetting('notif_enabled', '1')) !== '0';
  const notifDue = (await db.getSetting('notif_due_enabled', '1')) !== '0';
  const notifPomo = (await db.getSetting('notif_pomodoro_enabled', '1')) !== '0';
  const notifScheduleOn = (await db.getSetting('notif_schedule_enabled', '1')) !== '0';
  const notifSmartHourOn = (await db.getSetting('notif_smart_hour_enabled', '0')) !== '0';
  const notifOngoing = (await db.getSetting('notif_ongoing_enabled', '0')) !== '0';
  const ongoingShowGoal = (await db.getSetting('notif_ongoing_show_goal', '1')) !== '0';
  const ongoingShowDue = (await db.getSetting('notif_ongoing_show_due', '1')) !== '0';
  const ongoingShowStreak = (await db.getSetting('notif_ongoing_show_streak', '0')) !== '0';
  const ongoingTitle = await db.getSetting('notif_ongoing_title', 'وضعیت مطالعه FocusFlow');
  const notifPerm = await getNotificationPermissionStatus();
  let schedulePlans = await loadSchedulePlans();

  const notifContainer = document.createElement('div');
  notifContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const notifHero = document.createElement('div');
  notifHero.style.cssText = 'padding:12px 14px; border-radius:16px; background:var(--color-primary-soft); text-align:right;';
  notifHero.innerHTML = `<div style="font-size:13px; line-height:1.75; color:var(--text-secondary);">
    اعلان‌ها <b style="color:var(--text-primary)">محلی و آفلاین</b> هستند — بدون سرور.
    سوئیچ اصلی همهٔ اعلان‌های برنامه را یکجا خاموش/روشن می‌کند.
  </div>`;
  notifContainer.appendChild(notifHero);

  const permBadge = document.createElement('div');
  permBadge.style.cssText = 'font-size:12px; font-weight:700; color:var(--text-tertiary); text-align:right;';
  const permMap = { granted: 'مجوز اعلان: فعال ✓', denied: 'مجوز اعلان: رد شده — از تنظیمات گوشی فعال کنید', prompt: 'مجوز اعلان: هنوز داده نشده', default: 'مجوز اعلان: هنوز داده نشده', unavailable: 'مجوز اعلان: در این محیط در دسترس نیست' };
  permBadge.textContent = permMap[notifPerm] || notifPerm;
  notifContainer.appendChild(permBadge);

  function makeToggleRow(title, subtitle, checked, onChange) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-radius:14px; background:var(--bg-primary); border:1px solid var(--border-soft);';
    const textCol = document.createElement('div');
    textCol.style.cssText = 'text-align:right; flex:1; min-width:0;';
    textCol.innerHTML = `<div style="font-size:14px; font-weight:800; color:var(--text-primary);">${title}</div>` +
      (subtitle ? `<div style="font-size:11px; color:var(--text-tertiary); margin-top:3px; line-height:1.5;">${subtitle}</div>` : '');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.style.cssText = 'width:22px; height:22px; accent-color:var(--color-primary); flex-shrink:0;';
    input.addEventListener('change', () => onChange(input.checked, input));
    row.append(textCol, input);
    return row;
  }

  notifContainer.appendChild(makeToggleRow(
    'اعلان‌های برنامه',
    'خاموش کردن این گزینه همهٔ اعلان‌های FocusFlow را متوقف می‌کند.',
    notifEnabled,
    async (v) => {
      await db.setSetting('notif_enabled', v ? '1' : '0');
      if (v) {
        const ok = await requestNotificationPermission();
        if (ok) await rescheduleEverything();
        else maybeShowPermissionPrompt();
      } else {
        await cancelAllFocusNotifications();
      }
      showStatusMessage(notifContainer, v ? 'اعلان‌های برنامه فعال شدند.' : 'همهٔ اعلان‌های برنامه خاموش شدند.', 'success');
    }
  ));

  notifContainer.appendChild(makeToggleRow(
    'یادآوری کارت‌های سررسید',
    'وقتی زمان مرور فلش‌کارت‌ها برسد خبر می‌دهد.',
    notifDue,
    async (v) => {
      await db.setSetting('notif_due_enabled', v ? '1' : '0');
      await rescheduleDueCardsReminder();
    }
  ));

  notifContainer.appendChild(makeToggleRow(
    'اعلان پومودورو',
    'پایان تمرکز و استراحت را حتی با صفحهٔ خاموش یادآوری می‌کند.',
    notifPomo,
    async (v) => {
      await db.setSetting('notif_pomodoro_enabled', v ? '1' : '0');
    }
  ));

  // ── Schedule plans ──
  const scheduleSection = document.createElement('div');
  scheduleSection.style.cssText = 'display:flex; flex-direction:column; gap:10px; padding:14px; border-radius:16px; border:1px solid var(--border-soft); background:var(--bg-card);';
  scheduleSection.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
    <div style="font-weight:800; font-size:14px; color:var(--text-primary);">برنامهٔ روزانه</div>
  </div>
  <div style="font-size:11px; color:var(--text-tertiary); line-height:1.6; text-align:right;">
    بازه‌های زمانی بسازید (مثلاً مطالعه ۹ تا ۱۰). در شروع و/یا پایان بازه اعلان می‌گیرید.
  </div>`;

  const scheduleMaster = makeToggleRow('فعال بودن برنامهٔ روزانه', 'اعلان‌های بازه‌های زیر', notifScheduleOn, async (v) => {
    await db.setSetting('notif_schedule_enabled', v ? '1' : '0');
    await rescheduleDailyReminder();
  });
  scheduleSection.appendChild(scheduleMaster);

  // Smart hour: only offer when there is enough history to be meaningful.
  let productiveHourHint = null;
  try {
    productiveHourHint = await getMostProductiveHour();
  } catch (e) { /* ignore */ }

  const smartSubtitle = productiveHourHint != null
    ? `بر اساس سابقهٔ شما حدود ساعت ${String(productiveHourHint).padStart(2, '0')}:۰۰ مطالعه می‌کنید. با فعال‌سازی، اعلان شروع به‌جای ساعت دستی روی همین ساعت تنظیم می‌شود.`
    : 'بعد از حدود ۲ هفته مطالعه (حداقل ۲۰ جلسه در ۷ روز مختلف) ساعت پربازده‌تان محاسبه می‌شود و این گزینه فعال می‌گردد.';

  const smartRow = makeToggleRow(
    'یادآوری هوشمند (ساعت پربازده)',
    smartSubtitle,
    notifSmartHourOn && productiveHourHint != null,
    async (v, input) => {
      if (v && productiveHourHint == null) {
        input.checked = false;
        showStatusMessage(notifContainer, 'هنوز سابقهٔ کافی برای تشخیص ساعت پربازده وجود ندارد.', 'info');
        return;
      }
      await db.setSetting('notif_smart_hour_enabled', v ? '1' : '0');
      await rescheduleDailyReminder();
      showStatusMessage(
        notifContainer,
        v ? 'یادآوری هوشمند فعال شد — اعلان شروع روی ساعت پربازده شما تنظیم می‌شود.' : 'یادآوری هوشمند خاموش شد؛ ساعت دستی برنامه استفاده می‌شود.',
        'success'
      );
    }
  );
  if (productiveHourHint == null) {
    const cb = smartRow.querySelector('input[type="checkbox"]');
    if (cb) {
      cb.disabled = true;
      cb.style.opacity = '0.45';
    }
  }
  scheduleSection.appendChild(smartRow);

  const plansList = document.createElement('div');
  plansList.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

  function renderPlans() {
    plansList.innerHTML = '';
    schedulePlans.forEach((plan, index) => {
      const card = document.createElement('div');
      card.style.cssText = 'padding:12px; border-radius:14px; background:var(--bg-primary); border:1px solid var(--border-soft); display:flex; flex-direction:column; gap:8px; text-align:right;';
      const titleInput = document.createElement('input');
      titleInput.className = 'text-input';
      titleInput.value = plan.title || '';
      titleInput.placeholder = 'عنوان کار (مثلاً مرور لغت)';
      titleInput.style.cssText = 'font-size:13px; font-weight:700;';
      titleInput.addEventListener('change', () => { plan.title = titleInput.value.trim() || 'یادآوری'; });

      const timeGrid = document.createElement('div');
      timeGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:8px;';
      function numField(label, val, min, max, onSet) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
        const lb = document.createElement('span');
        lb.style.cssText = 'font-size:10px; color:var(--text-tertiary); font-weight:600;';
        lb.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'text-input';
        inp.value = val;
        inp.min = min; inp.max = max;
        inp.style.cssText = 'font-size:13px;';
        inp.addEventListener('change', () => {
          let n = parseInt(inp.value, 10);
          if (!Number.isFinite(n)) n = min;
          n = Math.min(max, Math.max(min, n));
          inp.value = n;
          onSet(n);
        });
        wrap.append(lb, inp);
        return wrap;
      }
      timeGrid.append(
        numField('شروع — ساعت', plan.startHour ?? 9, 0, 23, (n) => { plan.startHour = n; }),
        numField('شروع — دقیقه', plan.startMinute ?? 0, 0, 59, (n) => { plan.startMinute = n; }),
        numField('پایان — ساعت', plan.endHour ?? 10, 0, 23, (n) => { plan.endHour = n; }),
        numField('پایان — دقیقه', plan.endMinute ?? 0, 0, 59, (n) => { plan.endMinute = n; }),
      );

      const flags = document.createElement('div');
      flags.style.cssText = 'display:flex; flex-wrap:wrap; gap:10px; font-size:12px;';
      function flag(label, key) {
        const lab = document.createElement('label');
        lab.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer; color:var(--text-secondary); font-weight:600;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = plan[key] !== false && plan[key] !== false;
        if (key === 'notifyEnd') cb.checked = !!plan.notifyEnd;
        if (key === 'notifyStart') cb.checked = plan.notifyStart !== false;
        if (key === 'enabled') cb.checked = plan.enabled !== false;
        cb.addEventListener('change', () => { plan[key] = cb.checked; });
        lab.append(cb, document.createTextNode(label));
        return lab;
      }
      flags.append(
        flag('اعلان شروع', 'notifyStart'),
        flag('اعلان پایان بازه', 'notifyEnd'),
        flag('فعال', 'enabled'),
      );

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = 'حذف این بازه';
      delBtn.style.cssText = 'align-self:flex-start; border:none; background:transparent; color:#EF4444; font-size:12px; font-weight:700; padding:4px 0; cursor:pointer;';
      delBtn.addEventListener('click', () => {
        schedulePlans = schedulePlans.filter((_, i) => i !== index);
        renderPlans();
      });

      card.append(titleInput, timeGrid, flags, delBtn);
      plansList.appendChild(card);
    });
  }
  renderPlans();
  scheduleSection.appendChild(plansList);

  const planActions = document.createElement('div');
  planActions.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;';
  const addPlanBtn = createButton({
    label: 'بازهٔ جدید',
    icon: 'add',
    variant: 'secondary',
    onClick: () => {
      schedulePlans.push({
        id: 'plan_' + Date.now(),
        title: 'کار جدید',
        startHour: 18,
        startMinute: 0,
        endHour: 19,
        endMinute: 0,
        notifyStart: true,
        notifyEnd: false,
        enabled: true,
      });
      renderPlans();
    }
  });
  const savePlansBtn = createButton({
    label: 'ذخیره برنامه',
    icon: 'save',
    variant: 'primary',
    onClick: async () => {
      await saveSchedulePlans(schedulePlans);
      showStatusMessage(notifContainer, 'برنامهٔ روزانه ذخیره و زمان‌بندی شد.', 'success');
    }
  });
  planActions.append(addPlanBtn, savePlansBtn);
  scheduleSection.appendChild(planActions);
  notifContainer.appendChild(scheduleSection);

  // ── Ongoing status notification ──
  const ongoingSection = document.createElement('div');
  ongoingSection.style.cssText = 'display:flex; flex-direction:column; gap:10px; padding:14px; border-radius:16px; border:1px solid var(--border-soft); background:var(--bg-card);';
  ongoingSection.innerHTML = `<div style="font-weight:800; font-size:14px; color:var(--text-primary); text-align:right;">اعلان دائمی وضعیت</div>
    <div style="font-size:11px; color:var(--text-tertiary); line-height:1.6; text-align:right;">
      یک اعلان ثابت در نوار اعلان‌ها که پیشرفت مطالعه را نشان می‌دهد. می‌توانید محتوایش را شخصی‌سازی کنید.
    </div>`;

  ongoingSection.appendChild(makeToggleRow('نمایش اعلان دائمی', 'در نوار اعلان‌های سیستم می‌ماند', notifOngoing, async (v) => {
    await db.setSetting('notif_ongoing_enabled', v ? '1' : '0');
    if (v) await refreshOngoingStatusNotification();
    else await rescheduleEverything(); // refreshOngoing cancels itself when disabled
  }));

  const titleField = createTextField({
    label: 'عنوان اعلان دائمی',
    value: ongoingTitle,
    placeholder: 'وضعیت مطالعه FocusFlow',
  });
  ongoingSection.appendChild(titleField);

  ongoingSection.appendChild(makeToggleRow('نمایش هدف روزانه', '', ongoingShowGoal, async (v) => {
    await db.setSetting('notif_ongoing_show_goal', v ? '1' : '0');
    await refreshOngoingStatusNotification();
  }));
  ongoingSection.appendChild(makeToggleRow('نمایش تعداد کارت آماده', '', ongoingShowDue, async (v) => {
    await db.setSetting('notif_ongoing_show_due', v ? '1' : '0');
    await refreshOngoingStatusNotification();
  }));
  ongoingSection.appendChild(makeToggleRow('نمایش روزهای پیاپی (streak)', '', ongoingShowStreak, async (v) => {
    await db.setSetting('notif_ongoing_show_streak', v ? '1' : '0');
    await refreshOngoingStatusNotification();
  }));

  const saveOngoingBtn = createButton({
    label: 'اعمال تنظیمات اعلان دائمی',
    icon: 'done',
    variant: 'primary',
    onClick: async () => {
      await db.setSetting('notif_ongoing_title', titleField.input.value.trim() || 'وضعیت مطالعه FocusFlow');
      await refreshOngoingStatusNotification();
      showStatusMessage(notifContainer, 'اعلان دائمی به‌روز شد.', 'success');
    }
  });
  saveOngoingBtn.style.alignSelf = 'flex-end';
  ongoingSection.appendChild(saveOngoingBtn);
  notifContainer.appendChild(ongoingSection);

  const notifCard = createCard({ title: 'اعلان‌ها', content: notifContainer });



  const intervalsContainer = document.createElement('div');
  intervalsContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';
  const intervalsDesc = document.createElement('div');
  intervalsDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); line-height:1.6; text-align:right;';
  intervalsDesc.textContent = 'تنظیم فواصل زمانی پیش‌فرض (برحسب دقیقه) برای کارت‌هایی که در وضعیت یادگیری یا یادگیری مجدد هستند. این مقادیر زمان تکرار کارت‌ها در زمان مرور فعال را تعیین می‌کنند. توجه: این تنظیم مخصوص همین دستگاه است و در فایل پشتیبان (Backup) گنجانده نمی‌شود.';
  
  const intervalsGrid = document.createElement('div');
  intervalsGrid.style.cssText = 'display:grid; grid-template-columns: repeat(2, 1fr); gap:var(--space-3); text-align:right;';
  
  const againField = createTextField({
    label: 'فاصله گزینه دوباره (دقیقه)',
    placeholder: 'پیش‌فرض: ۱',
    value: intervalAgain,
    type: 'number'
  });
  const hardField = createTextField({
    label: 'فاصله گزینه سخت (دقیقه)',
    placeholder: 'پیش‌فرض: ۲',
    value: intervalHard,
    type: 'number'
  });
  const goodField = createTextField({
    label: 'فاصله گزینه خوب (دقیقه)',
    placeholder: 'پیش‌فرض: ۴',
    value: intervalGood,
    type: 'number'
  });
  const easyField = createTextField({
    label: 'فاصله گزینه آسان (دقیقه)',
    placeholder: 'پیش‌فرض: ۸',
    value: intervalEasy,
    type: 'number'
  });
  intervalsGrid.append(againField, hardField, goodField, easyField);
  
  const saveIntervalsBtn = createButton({
    label: 'ذخیره فواصل زمانی جدید',
    icon: 'done_all',
    variant: 'primary',
    onClick: async () => {
      const againVal = parseInt(againField.input.value.trim());
      const hardVal = parseInt(hardField.input.value.trim());
      const goodVal = parseInt(goodField.input.value.trim());
      const easyVal = parseInt(easyField.input.value.trim());

      if (isNaN(againVal) || againVal <= 0 ||
          isNaN(hardVal) || hardVal <= 0 ||
          isNaN(goodVal) || goodVal <= 0 ||
          isNaN(easyVal) || easyVal <= 0) {
        showStatusMessage(intervalsContainer, 'لطفاً مقادیر معتبر و بزرگتر از صفر برای تمام فواصل وارد کنید.', 'error');
        return;
      }

      localStorage.setItem('interval_again', againVal.toString());
      localStorage.setItem('interval_hard', hardVal.toString());
      localStorage.setItem('interval_good', goodVal.toString());
      localStorage.setItem('interval_easy', easyVal.toString());
      showStatusMessage(intervalsContainer, 'فواصل زمانی مرور هوشمند با موفقیت در تنظیمات این دستگاه ذخیره شدند.', 'success');
    }
  });
  saveIntervalsBtn.style.alignSelf = 'flex-end';
  intervalsContainer.append(intervalsDesc, intervalsGrid, saveIntervalsBtn);
  const intervalsCard = createCard({ title: 'تنظیم فواصل زمانی مرور ابتدایی فلش‌کارت‌ها', content: intervalsContainer });

  studyTabContent.append(goalCard, notifCard, intervalsCard);


  const aiTabContent = document.createElement('div');
  aiTabContent.style.cssText = 'display:none; flex-direction:column; gap:var(--space-3); width:100%;';

  const aiContainer = document.createElement('div');
  aiContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const connDesc = document.createElement('div');
  connDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); line-height:1.6; text-align:right;';
  connDesc.textContent = 'یک ارائه‌دهنده هوش مصنوعی انتخاب کنید و کلید API آن را وارد نمایید. این انتخاب روی چت هوش مصنوعی و تولید خودکار فلش‌کارت اعمال می‌شود. اطلاعات فقط در این دستگاه ذخیره می‌شود.';

  const providerField = createSelectField({
    label: 'ارائه‌دهنده هوش مصنوعی برای چت و تولید فلش‌کارت',
    value: aiProvider,
    options: [
      { value: 'gemini', label: 'Google Gemini' },
      { value: 'groq', label: 'Groq (سرعت پاسخ بسیار بالا)' },
      { value: 'openrouter', label: 'OpenRouter (دسترسی به چند مدل مختلف)' },
      { value: 'deepseek', label: 'DeepSeek (هزینه پایین، قدرتمند در استدلال)' },
    ],
    onChange: (val) => updateProviderFieldsVisibility(val),
  });

  const geminiFieldsWrap = document.createElement('div');
  geminiFieldsWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); padding:var(--space-2); border-radius:var(--radius-input); background:var(--bg-sunken);';
  const geminiFieldsTitle = document.createElement('div');
  geminiFieldsTitle.style.cssText = 'font-weight:700; font-size:var(--text-caption); color:var(--text-secondary);';
  geminiFieldsTitle.textContent = 'Gemini (Google AI Studio) — همچنین برای تبدیل گفتار به متن و خواندن صوتی فارسی استفاده می‌شود';
  const keyField = createTextField({
    label: 'کلید API اختصاصی Gemini',
    placeholder: 'AIzaSy...',
    value: apiKey,
    type: 'password'
  });
  const modelField = createSelectField({
    label: 'مدل Gemini',
    value: preferredModel,
    options: [
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (هوشمند و بسیار سریع - پیش‌فرض)' },
      { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (بسیار سریع و سبک)' },
      { value: 'gemini-flash-latest', label: 'Gemini Flash Latest (جدیدترین نسخه Flash)' },
    ],
  });
  const modelSelect = modelField;
  geminiFieldsWrap.append(geminiFieldsTitle, keyField, modelField);

  const groqFieldsWrap = document.createElement('div');
  groqFieldsWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); padding:var(--space-2); border-radius:var(--radius-input); background:var(--bg-sunken);';
  const groqKeyField = createTextField({
    label: 'کلید API Groq (از console.groq.com)',
    placeholder: 'gsk_...',
    value: groqApiKey,
    type: 'password'
  });
  const groqModelField = createTextField({
    label: 'شناسه مدل Groq',
    placeholder: 'openai/gpt-oss-120b',
    value: groqModel || 'openai/gpt-oss-120b',
  });
  const groqModelHint = document.createElement('div');
  groqModelHint.style.cssText = 'font-size:var(--text-caption); color:var(--text-tertiary); line-height:1.6;';
  groqModelHint.textContent = 'فهرست مدل‌های فعال Groq و شناسه دقیق آن‌ها را می‌توانید در console.groq.com/docs/models ببینید (این فهرست گاهی تغییر می‌کند).';
  groqFieldsWrap.append(groqKeyField, groqModelField, groqModelHint);

  const openrouterFieldsWrap = document.createElement('div');
  openrouterFieldsWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); padding:var(--space-2); border-radius:var(--radius-input); background:var(--bg-sunken);';
  const openrouterKeyField = createTextField({
    label: 'کلید API OpenRouter (از openrouter.ai/keys)',
    placeholder: 'sk-or-v1-...',
    value: openrouterApiKey,
    type: 'password'
  });
  const openrouterModelField = createTextField({
    label: 'شناسه مدل OpenRouter',
    placeholder: 'openrouter/free',
    value: openrouterModel || 'openrouter/free',
  });
  const openrouterModelHint = document.createElement('div');
  openrouterModelHint.style.cssText = 'font-size:var(--text-caption); color:var(--text-tertiary); line-height:1.6;';
  openrouterModelHint.textContent = 'مقدار پیش‌فرض «openrouter/free» به‌صورت خودکار یکی از مدل‌های رایگان موجود را انتخاب می‌کند. برای انتخاب مدل مشخص، شناسه آن را از openrouter.ai/models کپی کنید.';
  openrouterFieldsWrap.append(openrouterKeyField, openrouterModelField, openrouterModelHint);

  const deepseekFieldsWrap = document.createElement('div');
  deepseekFieldsWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); padding:var(--space-2); border-radius:var(--radius-input); background:var(--bg-sunken);';
  const deepseekKeyField = createTextField({
    label: 'کلید API DeepSeek (از platform.deepseek.com)',
    placeholder: 'sk-...',
    value: deepseekApiKey,
    type: 'password'
  });
  const deepseekModelField = createSelectField({
    label: 'مدل DeepSeek',
    value: deepseekModel || 'deepseek-chat',
    options: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat (سریع و مناسب برای اکثر کارها - پیش‌فرض)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (استدلال عمیق‌تر، کمی کندتر)' },
    ],
  });
  const deepseekModelHint = document.createElement('div');
  deepseekModelHint.style.cssText = 'font-size:var(--text-caption); color:var(--text-tertiary); line-height:1.6;';
  deepseekModelHint.textContent = 'توجه: DeepSeek از تحلیل تصویر (مثلاً استخراج متن از عکس) پشتیبانی نمی‌کند؛ برای آن قابلیت از Gemini، Groq یا OpenRouter استفاده کنید.';
  deepseekFieldsWrap.append(deepseekKeyField, deepseekModelField, deepseekModelHint);

  function updateProviderFieldsVisibility(provider) {
    groqFieldsWrap.style.display = provider === 'groq' ? 'flex' : 'none';
    openrouterFieldsWrap.style.display = provider === 'openrouter' ? 'flex' : 'none';
    deepseekFieldsWrap.style.display = provider === 'deepseek' ? 'flex' : 'none';
  }
  updateProviderFieldsVisibility(aiProvider);

  const dictationField = createSelectField({
    label: 'روش دیکته صوتی (تبدیل گفتار به متن)',
    value: dictationMethod,
    hint: 'اگر گزینه «مرورگر» در دستگاه شما کار نکرد، حالت «خودکار» را انتخاب کنید. این قابلیت همیشه از کلید Gemini بالا استفاده می‌کند.',
    options: [
      { value: 'auto', label: 'خودکار — ابتدا مرورگر، در صورت خطا هوش مصنوعی (پیشنهادی)' },
      { value: 'native', label: 'فقط تشخیص گفتار مرورگر (بدون نیاز به کلید API)' },
      { value: 'ai', label: 'فقط هوش مصنوعی Gemini (نیاز به کلید API)' },
    ],
  });
  const dictationSelect = dictationField;

  const instructionField = createTextArea({
    label: 'دستورالعمل کلی هوش مصنوعی (System Instruction)',
    placeholder: 'مثلاً: همیشه پاسخ‌ها را به زبان فارسی صمیمانه و ساده بیان کن.',
    value: customInstruction,
    rows: 3
  });
  const buttonsRow = document.createElement('div');
  buttonsRow.style.cssText = 'display:flex; gap:var(--space-2); justify-content:flex-end; margin-top:var(--space-2);';
  const saveAiBtn = createButton({
    label: 'ذخیره تنظیمات هوش مصنوعی',
    icon: 'save',
    variant: 'primary',
    onClick: async () => {
      const providerVal = providerField.value;
      const keyVal = keyField.input.value.trim();
      const modelVal = modelSelect.value;
      const groqKeyVal = groqKeyField.input.value.trim();
      const groqModelVal = groqModelField.input.value.trim() || 'openai/gpt-oss-120b';
      const openrouterKeyVal = openrouterKeyField.input.value.trim();
      const openrouterModelVal = openrouterModelField.input.value.trim() || 'openrouter/free';
      const deepseekKeyVal = deepseekKeyField.input.value.trim();
      const deepseekModelVal = deepseekModelField.value || 'deepseek-chat';
      const instructionVal = instructionField.input.value.trim();

      await db.setSetting('ai_provider', providerVal);
      await db.setSetting('gemini_api_key', keyVal);
      await db.setSetting('gemini_model', modelVal);
      await db.setSetting('groq_api_key', groqKeyVal);
      await db.setSetting('groq_model', groqModelVal);
      await db.setSetting('openrouter_api_key', openrouterKeyVal);
      await db.setSetting('openrouter_model', openrouterModelVal);
      await db.setSetting('deepseek_api_key', deepseekKeyVal);
      await db.setSetting('deepseek_model', deepseekModelVal);
      await db.setSetting('dictation_method', dictationSelect.value);
      await db.setSetting('gemini_system_instruction', instructionVal);

      const activeKey = providerVal === 'groq' ? groqKeyVal
        : providerVal === 'openrouter' ? openrouterKeyVal
        : providerVal === 'deepseek' ? deepseekKeyVal
        : keyVal;
      if (!activeKey) {
        showStatusMessage(aiContainer, 'تنظیمات ذخیره شد. برای استفاده از هوش مصنوعی، وارد کردن کلید API ارائه‌دهنده انتخاب‌شده الزامی است.', 'success');
      } else {
        showStatusMessage(aiContainer, 'تنظیمات هوش مصنوعی با موفقیت ذخیره شد.', 'success');
      }
    }
  });
  const testBtn = createButton({
    label: 'تست اتصال',
    icon: 'bolt',
    variant: 'secondary',
    onClick: async () => {
      testBtn.disabled = true;
      const prevLabel = testBtn.lastChild.textContent;
      testBtn.lastChild.textContent = 'در حال بررسی اتصال...';
      try {
        const providerVal = providerField.value;
        let resData;
        if (providerVal === 'groq') {
          const { chatWithGroq } = await import('../core/groq-client.js');
          resData = await chatWithGroq({
            apiKey: groqKeyField.input.value.trim() || undefined,
            model: groqModelField.input.value.trim() || undefined,
            message: 'پاسخ بده: سلام'
          });
        } else if (providerVal === 'openrouter') {
          const { chatWithOpenRouter } = await import('../core/openrouter-client.js');
          resData = await chatWithOpenRouter({
            apiKey: openrouterKeyField.input.value.trim() || undefined,
            model: openrouterModelField.input.value.trim() || undefined,
            message: 'پاسخ بده: سلام'
          });
        } else if (providerVal === 'deepseek') {
          const { chatWithDeepSeek } = await import('../core/deepseek-client.js');
          resData = await chatWithDeepSeek({
            apiKey: deepseekKeyField.input.value.trim() || undefined,
            model: deepseekModelField.value || undefined,
            message: 'پاسخ بده: سلام'
          });
        } else {
          const { chatWithGemini } = await import('../core/gemini-client.js');
          resData = await chatWithGemini({
            apiKey: keyField.input.value.trim() || undefined,
            model: modelSelect.value,
            message: 'پاسخ بده: سلام'
          });
        }
        showStatusMessage(aiContainer, `اتصال موفق! هوش مصنوعی پاسخ داد: ${resData.text}`, 'success');
      } catch (err) {
        showStatusMessage(aiContainer, `خطا در تست اتصال: ${err.message}`, 'error');
      } finally {
        testBtn.disabled = false;
        testBtn.lastChild.textContent = prevLabel;
      }
    }
  });
  buttonsRow.append(testBtn, saveAiBtn);
  aiContainer.append(connDesc, providerField, geminiFieldsWrap, groqFieldsWrap, openrouterFieldsWrap, deepseekFieldsWrap, dictationField, instructionField, buttonsRow);
  const aiCard = createCard({ title: 'تنظیمات هوش مصنوعی', content: aiContainer });

  const ttsContainer = document.createElement('div');
  ttsContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const speedField = document.createElement('div');
  speedField.className = 'ds-field';
  speedField.innerHTML = `
    <label class="ds-field-label">سرعت تلفظ صوتی: <span id="speed-val" style="color:var(--color-primary); font-weight:800;">${parseFloat(ttsSpeed).toLocaleString('fa-IR')}x</span></label>
    <input type="range" class="ds-field-input" min="0.5" max="2.0" step="0.05" value="${ttsSpeed}" style="direction: ltr; cursor: pointer; height: 8px;">
  `;
  const speedInput = speedField.querySelector('input');
  const speedValText = speedField.querySelector('#speed-val');
  speedInput.addEventListener('input', (e) => {
    speedValText.textContent = `${parseFloat(e.target.value).toLocaleString('fa-IR')}x`;
  });
  const langField = createSelectField({
    label: 'زبان تلفظ صوتی',
    value: ttsLang === 'fa-IR' ? 'en-US' : ttsLang, // fallback if they had Persian saved
    options: [
      { value: 'en-US', label: 'انگلیسی (en-US - لهجه آمریکایی)' },
      { value: 'en-GB', label: 'انگلیسی (en-GB - لهجه بریتانیایی)' },
    ],
  });
  const langSelect = langField;
  const saveTtsBtn = createButton({
    label: 'ذخیره تنظیمات صدا',
    icon: 'volume_up',
    variant: 'primary',
    onClick: async () => {
      await db.setSetting('tts_speed', speedInput.value);
      await db.setSetting('tts_lang', langSelect.value);
      showStatusMessage(ttsContainer, 'تنظیمات صوتی با موفقیت ذخیره شد.', 'success');
      
      const ok = await speak('Voice settings saved.', langSelect.value);
      if (!ok) {
        showStatusMessage(ttsContainer, 'تنظیمات ذخیره شد اما پخش صدای آزمایشی ناموفق بود. اتصال اینترنت را بررسی کنید.', 'error');
      }
    }
  });
  saveTtsBtn.style.alignSelf = 'flex-end';
  ttsContainer.append(speedField, langField, saveTtsBtn);
  const ttsCard = createCard({ title: 'تلفظ صوتی فلش‌کارت‌ها (TTS)', content: ttsContainer });

  aiTabContent.append(aiCard, ttsCard);


  const appearanceTabContent = document.createElement('div');
  appearanceTabContent.style.cssText = 'display:none; flex-direction:column; gap:var(--space-3); width:100%;';

  
  const currentThemeMode = await themeApi.getThemeMode();
  const currentAccent = await themeApi.getAccent();
  const currentFontScale = await themeApi.getFontScale();
  const currentReducedMotion = await themeApi.getReducedMotion();
  const currentContrastMode = await themeApi.getContrastMode();

  function buildSegmented(options, currentValue, onChange) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:6px; background:var(--bg-sunken); border-radius:var(--radius-input); padding:4px; width:100%;';
    const buttons = [];
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; gap:4px; padding:var(--space-2) 4px; border-radius:8px; font-size:12px; font-weight:700; transition:all var(--duration-fast);';
      btn.innerHTML = opt.icon
        ? `<span class="material-symbols-rounded" style="font-size:16px;">${opt.icon}</span><span>${opt.label}</span>`
        : `<span>${opt.label}</span>`;
      const paint = (active) => {
        btn.style.background = active ? 'var(--bg-card)' : 'transparent';
        btn.style.color = active ? 'var(--color-primary)' : 'var(--text-secondary)';
        btn.style.boxShadow = active ? 'var(--shadow-sm)' : 'none';
      };
      paint(opt.value === currentValue);
      btn.addEventListener('click', async () => {
        buttons.forEach((b) => b.paint(false));
        paint(true);
        await onChange(opt.value);
      });
      btn.paint = paint;
      btn.optValue = opt.value;
      buttons.push(btn);
      row.appendChild(btn);
    });

    row.updateValue = (newValue) => {
      buttons.forEach((btn) => {
        btn.paint(btn.optValue === newValue);
      });
    };

    return row;
  }

  const themeModeContainer = document.createElement('div');
  themeModeContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const themeModeDesc = document.createElement('div');
  themeModeDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
  themeModeDesc.textContent = 'می‌توانید همیشه روشن، همیشه تاریک، یا هماهنگ با تنظیمات سیستم دستگاه خود را انتخاب کنید.';
  const themeModeControl = buildSegmented(
    [
      { value: 'light', label: 'روشن', icon: 'light_mode' },
      { value: 'dark', label: 'تاریک', icon: 'dark_mode' },
      { value: 'auto', label: 'خودکار', icon: 'brightness_auto' },
    ],
    currentThemeMode,
    async (mode) => {
      await themeApi.setThemeMode(mode);
      showStatusMessage(themeModeContainer, 'حالت نمایش به‌روزرسانی شد.', 'success');
    }
  );

  const onThemeChanged = (e) => {
    if (!document.contains(themeModeControl)) {
      window.removeEventListener('theme-changed', onThemeChanged);
      return;
    }
    themeModeControl.updateValue(e.detail.mode);
  };
  window.addEventListener('theme-changed', onThemeChanged);

  themeModeContainer.append(themeModeDesc, themeModeControl);
  const themeModeCard = createCard({ title: 'حالت نمایش (روشن / تاریک)', content: themeModeContainer });

  const accentContainer = document.createElement('div');
  accentContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const accentDesc = document.createElement('div');
  accentDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
  accentDesc.textContent = 'رنگ اصلی دکمه‌ها و لینک‌های برنامه را برای هر دو حالت روشن و تاریک انتخاب کنید.';
  const accentGrid = document.createElement('div');
  accentGrid.style.cssText = 'display:grid; grid-template-columns:repeat(6, 1fr); gap:var(--space-2);';
  const accentOptions = [
    { id: 'blue', label: 'آبی', hex: '#2F5FA8' },
    { id: 'violet', label: 'بنفش', hex: '#6E4FCC' },
    { id: 'teal', label: 'فیروزه‌ای', hex: '#1E7F72' },
    { id: 'amber', label: 'کهربایی', hex: '#B4711F' },
    { id: 'rose', label: 'گلبهی', hex: '#B23B5E' },
    { id: 'slate', label: 'دودی', hex: '#3E4A61' },
  ];
  const accentDots = [];
  accentOptions.forEach((opt) => {
    const dotWrap = document.createElement('button');
    dotWrap.type = 'button';
    dotWrap.setAttribute('aria-label', opt.label);
    dotWrap.title = opt.label;
    dotWrap.style.cssText = `aspect-ratio:1; border-radius:50%; background:${opt.hex}; display:flex; align-items:center; justify-content:center; transition:all var(--duration-fast);`;
    const paintDot = (active) => {
      dotWrap.style.border = active ? '3px solid var(--text-primary)' : '3px solid transparent';
      dotWrap.style.outline = active ? `2px solid ${opt.hex}` : 'none';
      dotWrap.style.outlineOffset = '2px';
      dotWrap.innerHTML = active ? '<span class="material-symbols-rounded" style="color:#fff; font-size:16px;">check</span>' : '';
    };
    paintDot(opt.id === currentAccent);
    dotWrap.addEventListener('click', async () => {
      accentDots.forEach((d) => d.paint(false));
      paintDot(true);
      await themeApi.setAccent(opt.id);
      showStatusMessage(accentContainer, `رنگ تاکیدی «${opt.label}» اعمال شد.`, 'success');
    });
    dotWrap.paint = paintDot;
    accentDots.push(dotWrap);
    accentGrid.appendChild(dotWrap);
  });
  accentContainer.append(accentDesc, accentGrid);
  const accentCard = createCard({ title: 'رنگ تاکیدی برنامه', content: accentContainer });

  const currentCustomPalette = await themeApi.getCustomPalette();
  const currentOverrides = await themeApi.getThemeOverrides();
  const paletteContainer = document.createElement('div');
  paletteContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';
  const paletteDesc = document.createElement('div');
  paletteDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); line-height: 1.5;';
  paletteDesc.innerHTML = 'پالت رنگی دلخواه خود را برای کل برنامه انتخاب کنید. با انتخاب هر پالت، تمام رنگ‌های برنامه تغییر خواهند کرد.<br><small>(برای بازگشت به رنگ‌های پیش‌فرض سیستم، گزینه "پیش‌فرض" را انتخاب کنید)</small>';
  
  const paletteGrid = document.createElement('div');
  paletteGrid.style.cssText = 'display:flex; flex-wrap:wrap; gap:16px; justify-content:center; margin-top: 8px;';
  
  const paletteButtons = [];
  
  // Create a default "None" button
  const defaultPaletteBtn = document.createElement('button');
  defaultPaletteBtn.className = 'palette-btn ' + (currentCustomPalette === 'none' ? 'active' : '');
  defaultPaletteBtn.innerHTML = `
    <div style="font-size: 14px; color: var(--text-primary); font-weight: 500;">پیش‌فرض</div>
  `;
  defaultPaletteBtn.style.cssText = `
    background: var(--bg-sunken);
    border: 2px solid ${currentCustomPalette === 'none' ? 'var(--color-primary)' : 'transparent'};
    border-radius: var(--radius-card);
    cursor: pointer;
    padding: 8px 16px;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
  `;
  
  const paintDefaultBtn = (active) => {
    defaultPaletteBtn.classList.toggle('active', active);
    defaultPaletteBtn.style.border = active ? '2px solid var(--color-primary)' : '2px solid transparent';
  };
  defaultPaletteBtn.addEventListener('click', async () => {
    paletteButtons.forEach(b => b.paint(false));
    paintDefaultBtn(true);
    await themeApi.setCustomPalette('none');
    showStatusMessage(paletteContainer, 'پالت رنگی به حالت پیش‌فرض برگشت.', 'success');
  });
  defaultPaletteBtn.paint = paintDefaultBtn;
  paletteButtons.push(defaultPaletteBtn);
  paletteGrid.appendChild(defaultPaletteBtn);

  // Inject CSS for the circles animation if not already injected
  if (!document.getElementById('palette-selector-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'palette-selector-styles';
    styleEl.textContent = `
      .palette-btn {
        background: var(--bg-sunken);
        border: 2px solid transparent;
        border-radius: var(--radius-card);
        cursor: pointer;
        padding: 8px 24px;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        width: 140px;
        height: 50px;
      }
      .palette-btn:hover {
        background: var(--bg-card);
        transform: translateY(-2px);
      }
      .palette-btn.active {
        border-color: var(--color-primary);
        background: var(--bg-card);
      }
      .palette-circles {
        display: flex;
        position: relative;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }
      .palette-circles .circle {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        box-shadow: -2px 0 6px rgba(0,0,0,0.3);
        transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        position: absolute;
      }
      
      .palette-btn:not(.active) .circle:nth-child(1) { transform: translateX(20px); z-index: 1; }
      .palette-btn:not(.active) .circle:nth-child(2) { transform: translateX(10px); z-index: 2; }
      .palette-btn:not(.active) .circle:nth-child(3) { transform: translateX(0); z-index: 3; }
      .palette-btn:not(.active) .circle:nth-child(4) { transform: translateX(-10px); z-index: 4; }
      .palette-btn:not(.active) .circle:nth-child(5) { transform: translateX(-20px); z-index: 5; }

      .palette-btn.active .circle {
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
      .palette-btn.active .circle:nth-child(1) { transform: translateX(40px); z-index: 1; }
      .palette-btn.active .circle:nth-child(2) { transform: translateX(20px); z-index: 2; }
      .palette-btn.active .circle:nth-child(3) { transform: translateX(0); z-index: 3; }
      .palette-btn.active .circle:nth-child(4) { transform: translateX(-20px); z-index: 4; }
      .palette-btn.active .circle:nth-child(5) { transform: translateX(-40px); z-index: 5; }
    `;
    document.head.appendChild(styleEl);
  }

  CUSTOM_PALETTES.forEach((palette) => {
    const btn = document.createElement('button');
    const isActive = currentCustomPalette === palette.id;
    btn.className = 'palette-btn ' + (isActive ? 'active' : '');
    btn.setAttribute('aria-label', palette.name);
    btn.title = palette.name;
    
    // Creating circles
    let circlesHtml = '';
    palette.colors.forEach((color) => {
      circlesHtml += `<div class="circle" style="background: ${color}; border: 1px solid rgba(255,255,255,0.1);"></div>`;
    });
    
    btn.innerHTML = `<div class="palette-circles">${circlesHtml}</div>`;
    
    const paintBtn = (active) => {
      btn.classList.toggle('active', active);
    };
    
    btn.addEventListener('click', async () => {
      paletteButtons.forEach(b => b.paint(false));
      paintBtn(true);
      await themeApi.setCustomPalette(palette.id);
      showStatusMessage(paletteContainer, `پالت «${palette.name}» اعمال شد.`, 'success');
    });
    
    btn.paint = paintBtn;
    paletteButtons.push(btn);
    paletteGrid.appendChild(btn);
  });
  
  const customizationContainer = document.createElement('div');
  customizationContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); margin-top: 16px; border-top: 1px solid var(--border-soft); padding-top: 16px;';
  
  const customDesc = document.createElement('div');
  customDesc.style.cssText = 'font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom: 8px;';
  customDesc.textContent = 'شخصی‌سازی اجزای رنگی (ترکیب پالت‌ها)';
  
  customizationContainer.appendChild(customDesc);

  const selects = {};
  
  THEME_GROUPS.forEach(group => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:var(--space-2);';
    
    const label = document.createElement('div');
    label.style.cssText = 'font-size:14px; color:var(--text-secondary);';
    label.textContent = group.label;
    
    const select = document.createElement('select');
    select.style.cssText = 'padding:4px 8px; border-radius:8px; border:1px solid var(--border-soft); background:var(--bg-sunken); color:var(--text-primary); font-size:13px; outline:none; max-width:160px; text-overflow:ellipsis;';
    
    const optDefault = document.createElement('option');
    optDefault.value = 'default';
    optDefault.textContent = 'پیش‌فرض تم';
    select.appendChild(optDefault);
    
    CUSTOM_PALETTES.forEach(pal => {
      const opt = document.createElement('option');
      opt.value = `palette:${pal.id}`;
      opt.textContent = `پالت: ${pal.name}`;
      select.appendChild(opt);
    });
    
    const optCustom = document.createElement('option');
    optCustom.value = 'custom';
    optCustom.textContent = 'رنگ ثابت دلخواه...';
    select.appendChild(optCustom);
    
    const currentOver = currentOverrides[group.id];
    if (currentOver) {
      if (currentOver.type === 'default') select.value = 'default';
      else if (currentOver.type === 'palette') select.value = `palette:${currentOver.value}`;
      else if (currentOver.type === 'custom') select.value = 'custom';
    } else {
      select.value = 'default';
    }
    
    const customColorInput = document.createElement('input');
    customColorInput.type = 'color';
    customColorInput.style.cssText = 'width:28px; height:28px; padding:0; border:none; border-radius:4px; background:none; cursor:pointer; display:none; flex-shrink:0;';
    
    if (currentOver && currentOver.type === 'custom') {
      customColorInput.value = currentOver.value;
      customColorInput.style.display = 'inline-block';
    }
    
    const controlsWrap = document.createElement('div');
    controlsWrap.style.cssText = 'display:flex; align-items:center; gap:8px;';
    controlsWrap.append(select, customColorInput);
    
    row.append(label, controlsWrap);
    customizationContainer.appendChild(row);
    
    const applyChange = async () => {
      const val = select.value;
      const newOverrides = await themeApi.getThemeOverrides();
      
      if (val === 'default') {
        newOverrides[group.id] = { type: 'default' };
        customColorInput.style.display = 'none';
      } else if (val.startsWith('palette:')) {
        newOverrides[group.id] = { type: 'palette', value: val.split(':')[1] };
        customColorInput.style.display = 'none';
      } else if (val === 'custom') {
        customColorInput.style.display = 'inline-block';
        newOverrides[group.id] = { type: 'custom', value: customColorInput.value };
      }
      
      await themeApi.setThemeOverrides(newOverrides);
    };
    
    select.addEventListener('change', applyChange);
    customColorInput.addEventListener('input', applyChange);
    
    selects[group.id] = { select, customColorInput };
  });

  const resetAllBtn = createButton({
    label: 'بازنشانی ترکیب رنگ‌ها',
    icon: 'refresh',
    variant: 'secondary',
    onClick: async () => {
      await themeApi.setThemeOverrides({});
      for (const group of THEME_GROUPS) {
        selects[group.id].select.value = 'default';
        selects[group.id].customColorInput.style.display = 'none';
      }
      showStatusMessage(customizationContainer, 'ترکیب رنگ‌ها بازنشانی شد.', 'success');
    }
  });
  resetAllBtn.style.marginTop = '8px';
  customizationContainer.appendChild(resetAllBtn);
  
  paletteContainer.append(paletteDesc, paletteGrid, customizationContainer);
  const paletteCard = createCard({ title: 'پالت‌های رنگی اختصاصی', content: paletteContainer });

  const fontSizeContainer = document.createElement('div');
  fontSizeContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const fontSizeDesc = document.createElement('div');
  fontSizeDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
  fontSizeDesc.textContent = 'اندازه متن در سراسر برنامه (فلش‌کارت‌ها، منوها و دکمه‌ها) را متناسب با راحتی چشم خود تنظیم کنید.';
  const fontSizeControl = buildSegmented(
    [
      { value: 'sm', label: 'کوچک' },
      { value: 'md', label: 'متوسط' },
      { value: 'lg', label: 'بزرگ' },
    ],
    currentFontScale,
    async (scale) => {
      await themeApi.setFontScale(scale);
      showStatusMessage(fontSizeContainer, 'اندازه قلم به‌روزرسانی شد.', 'success');
    }
  );
  fontSizeContainer.append(fontSizeDesc, fontSizeControl);
  const fontSizeCard = createCard({ title: 'اندازه قلم', content: fontSizeContainer });

  const motionContainer = document.createElement('div');
  motionContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const motionDesc = document.createElement('div');
  motionDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
  motionDesc.textContent = 'انیمیشن‌های ورق‌زدن کارت، جلوه‌های صفحه و افکت‌های حرکتی برنامه را کنترل کنید.';
  const motionControl = buildSegmented(
    [
      { value: 'system', label: 'پیش‌فرض سیستم' },
      { value: 'on', label: 'کاهش انیمیشن' },
      { value: 'off', label: 'همیشه فعال' },
    ],
    currentReducedMotion,
    async (pref) => {
      await themeApi.setReducedMotion(pref);
      showStatusMessage(motionContainer, 'تنظیمات جلوه‌های حرکتی ذخیره شد.', 'success');
    }
  );
  motionContainer.append(motionDesc, motionControl);
  const motionCard = createCard({ title: 'جلوه‌های حرکتی و انیمیشن', content: motionContainer });

  const contrastContainer = document.createElement('div');
  contrastContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const contrastDesc = document.createElement('div');
  contrastDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
  contrastDesc.textContent = 'امکان تغییر تم به حالت جوهر الکترونیک (کاغذی) با رنگ‌های ملایم و بافت نویزدار برای خوانایی بهتر.';
  const contrastControl = buildSegmented(
    [
      { value: 'none', label: 'عادی' },
      { value: 'high-contrast-light', label: 'کاغذی (طوسی)' },
      { value: 'high-contrast-dark', label: 'تاریک (طوسی)' },
    ],
    currentContrastMode,
    async (pref) => {
      await themeApi.setContrastMode(pref);
      showStatusMessage(contrastContainer, 'تنظیمات کنتراست ذخیره شد.', 'success');
    }
  );
  contrastContainer.append(contrastDesc, contrastControl);
  const contrastCard = createCard({ title: 'فیلتر کنتراست بالا', content: contrastContainer });

  const fontsContainer = document.createElement('div');
  fontsContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';
  const fontsDesc = document.createElement('div');
  fontsDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
  fontsDesc.textContent = 'شما می‌توانید فونت دلخواه خود را (با فرمت‌های ttf, woff, otf) برای بخش‌های مختلف آپلود کنید.';
  
  fontsContainer.append(fontsDesc);

  const fontTargets = [
    { id: 'heading', label: 'عناوین (مانند تیترها و منوها)' },
    { id: 'body', label: 'متن اصلی (توضیحات و محتوای فلش‌کارت‌ها)' },
    { id: 'mono', label: 'اعداد و متن‌های سیستمی (تایمر و غیره)' }
  ];

  fontTargets.forEach(target => {
    const targetRow = document.createElement('div');
    targetRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--bg-sunken); padding:var(--space-2); border-radius:var(--radius-input);';
    
    const label = document.createElement('div');
    label.style.cssText = 'font-weight:600; font-size:var(--text-body); color:var(--text-primary);';
    label.textContent = target.label;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:var(--space-2);';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.ttf,.woff,.woff2,.otf';
    fileInput.style.display = 'none';

    const uploadBtn = createButton({
      label: 'آپلود',
      icon: 'upload',
      variant: 'secondary',
      onClick: () => {
        fileInput.click();
      }
    });
    
    const resetBtn = createButton({
      label: 'حذف',
      icon: 'delete',
      variant: 'text',
      onClick: async () => {
        try {
          await themeApi.resetCustomFont(target.id);
          showStatusMessage(fontsContainer, 'فونت سفارشی حذف شد.', 'success');
        } catch (err) {
          console.error('Failed to delete custom font', err);
          showStatusMessage(fontsContainer, 'حذف فونت سفارشی با خطا مواجه شد.', 'error');
        }
      }
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
         showStatusMessage(fontsContainer, 'حجم فایل فونت نباید بیشتر از 2 مگابایت باشد.', 'error');
         return;
      }

      const reader = new FileReader();
      reader.onload = async (re) => {
        const dataUrl = re.target.result;
        await themeApi.setCustomFont(target.id, dataUrl);
        showStatusMessage(fontsContainer, `فونت جدید برای ${target.label} اعمال شد.`, 'success');
      };
      reader.readAsDataURL(file);
    });

    actions.append(fileInput, uploadBtn, resetBtn);
    targetRow.append(label, actions);
    fontsContainer.append(targetRow);
  });

  const fontsCard = createCard({ title: 'فونت‌های سفارشی', content: fontsContainer });

  appearanceTabContent.append(themeModeCard, accentCard, paletteCard, fontSizeCard, motionCard, contrastCard, fontsCard);


  const systemTabContent = document.createElement('div');
  systemTabContent.style.cssText = 'display:none; flex-direction:column; gap:var(--space-3); width:100%;';

  const backupContainer = document.createElement('div');
  backupContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';
  const backupDesc = document.createElement('div');
  backupDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); line-height:1.6; text-align:right;';
  backupDesc.textContent = 'برای ایمن‌سازی اطلاعات خود، یک نسخه پشتیبان صادر و دانلود کنید. همچنین می‌توانید فایل‌های کپی ذخیره‌شده را بازیابی کنید. اگر دکمه «دانلود فایل» پاسخ نداد، از گزینه «نمایش/کپی متن پشتیبان» استفاده کنید — این روش همیشه کار می‌کند.';
  const backupButtonsRow = document.createElement('div');
  backupButtonsRow.style.cssText = 'display:flex; gap:var(--space-2); flex-wrap:wrap;';
  const exportBtn = createButton({
    label: 'صادرات فایل پشتیبان',
    icon: 'download',
    variant: 'primary',
    onClick: async () => {
      exportBtn.disabled = true;
      try {
        const { exportBackup } = await import('../core/backup.js');
        const backupData = await exportBackup();
        const jsonStr = JSON.stringify(backupData, null, 2);
        const filename = `learning_os_backup_${new Date().toISOString().slice(0,10)}.json`;

        const { saveOrShareFile } = await import('../core/native-file.js');
        const result = await saveOrShareFile({ filename, content: jsonStr, mimeType: 'application/json' });

        showStatusMessage(
          backupContainer,
          result.method === 'share'
            ? 'حالا محل ذخیره فایل پشتیبان (مثلاً دانلودها، درایو یا تلگرام) را انتخاب کنید.'
            : 'دانلود فایل آغاز شد. اگر روی این دستگاه فایلی دانلود نشد، از دکمه «نمایش/کپی متن پشتیبان» استفاده کنید.',
          'success'
        );
      } catch (err) {
        showStatusMessage(backupContainer, `خطا در تهیه پشتیبان: ${err.message}`, 'error');
      } finally {
        exportBtn.disabled = false;
      }
    }
  });

  const copyTextBtn = createButton({
    label: 'نمایش/کپی متن پشتیبان',
    icon: 'content_copy',
    variant: 'secondary',
    onClick: async () => {
      try {
        const { exportBackup } = await import('../core/backup.js');
        const backupData = await exportBackup();
        const jsonStr = JSON.stringify(backupData);

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); text-align:right;';
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:12px; color:var(--text-secondary); line-height:1.6;';
        hint.textContent = 'این متن کامل نسخه پشتیبان شماست. آن را کپی کرده و در جایی امن (مثلاً «پیام‌های ذخیره‌شده» تلگرام یا یک یادداشت) نگه دارید تا در صورت نیاز، همین متن را در بخش «چسباندن متن پشتیبان» وارد کنید.';
        const textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.value = jsonStr;
        textarea.style.cssText = 'width:100%; min-height:160px; direction:ltr; font-family:monospace; font-size:11px; padding:var(--space-2); border-radius:var(--radius-input); border:1.5px solid var(--border-soft); background:var(--bg-card); color:var(--text-primary);';
        wrap.append(hint, textarea);

        openDialog({
          title: 'متن پشتیبان',
          content: wrap,
          actions: [
            { label: 'بستن', variant: 'text' },
            {
              label: 'کپی به کلیپ‌بورد',
              variant: 'primary',
              onClick: async () => {
                try {
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(jsonStr);
                  } else {
                    textarea.removeAttribute('readonly');
                    textarea.focus();
                    textarea.select();
                    document.execCommand('copy');
                    textarea.setAttribute('readonly', 'true');
                  }
                  showStatusMessage(backupContainer, 'متن پشتیبان در کلیپ‌بورد کپی شد.', 'success');
                } catch (copyErr) {
                  showStatusMessage(backupContainer, 'کپی خودکار ممکن نشد؛ لطفاً متن بالا را با انگشت انتخاب و کپی کنید.', 'error');
                }
              }
            }
          ]
        });
      } catch (err) {
        showStatusMessage(backupContainer, `خطا در تهیه پشتیبان: ${err.message}`, 'error');
      }
    }
  });
  const importBackupFlow = async (backup) => {
    const { validateBackup, importBackup } = await import('../core/backup.js');
    const validationError = validateBackup(backup);
    if (validationError) {
      openDialog({
        title: 'خطا در بازیابی اطلاعات',
        content: `فایل/متن انتخابی نامعتبر است: ${validationError}`,
        actions: [{ label: 'متوجه شدم', variant: 'primary' }]
      });
      return;
    }
    openDialog({
      title: 'تایید بارگذاری پشتیبان',
      content: 'آیا مطمئن هستید؟ این عملیات تمام داده‌های فعلی شما را پاک کرده و با اطلاعات این نسخه پشتیبان جایگزین خواهد کرد.',
      actions: [
        { label: 'انصراف', variant: 'text' },
        {
          label: 'بارگذاری و جایگزینی',
          variant: 'primary',
          onClick: async () => {
            try {
              await importBackup(backup);
              openDialog({
                title: 'بازیابی موفقیت‌آمیز',
                content: 'داده‌ها با موفقیت بازنشانی شدند. برای اعمال نهایی تغییرات، برنامه مجدداً بارگذاری می‌شود.',
                actions: [{ label: 'بارگذاری مجدد', variant: 'primary', onClick: () => window.location.reload() }]
              });
            } catch (ex) {
              openDialog({
                title: 'خطا در بازیابی',
                content: `در حین بازیابی اطلاعات خطایی رخ داد: ${ex.message}`,
                actions: [{ label: 'بستن', variant: 'primary' }]
              });
            }
          }
        }
      ]
    });
  };

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const backup = JSON.parse(evt.target.result);
        await importBackupFlow(backup);
      } catch (err) {
        openDialog({
          title: 'خطای خواندن فایل',
          content: 'فرمت فایل انتخابی یک JSON معتبر نمی‌باشد.',
          actions: [{ label: 'متوجه شدم', variant: 'primary' }]
        });
      }
    };
    reader.readAsText(file);
  });
  const importBtn = createButton({
    label: 'وارد کردن فایل پشتیبان',
    icon: 'upload',
    variant: 'secondary',
    onClick: () => fileInput.click()
  });

  const pasteBackupFlow = (rawText) => {
    let backup;
    try {
      backup = JSON.parse(rawText);
    } catch (err) {
      openDialog({
        title: 'خطای خواندن متن',
        content: 'متنی که وارد کردید یک JSON معتبر نیست. لطفاً مطمئن شوید کل متن پشتیبان را بدون کم‌وکاست چسبانده‌اید.',
        actions: [{ label: 'متوجه شدم', variant: 'primary' }]
      });
      return;
    }
    importBackupFlow(backup);
  };
  const pasteTextBtn = createButton({
    label: 'چسباندن متن پشتیبان',
    icon: 'content_paste',
    variant: 'secondary',
    onClick: () => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); text-align:right;';
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:12px; color:var(--text-secondary); line-height:1.6;';
      hint.textContent = 'متن کامل نسخه پشتیبان (که قبلاً از «نمایش/کپی متن پشتیبان» گرفته‌اید) را در کادر زیر بچسبانید.';
      const textarea = document.createElement('textarea');
      textarea.placeholder = '{"categories": [...], "flashcards": [...], ...}';
      textarea.style.cssText = 'width:100%; min-height:160px; direction:ltr; font-family:monospace; font-size:11px; padding:var(--space-2); border-radius:var(--radius-input); border:1.5px solid var(--border-soft); background:var(--bg-card); color:var(--text-primary);';
      wrap.append(hint, textarea);

      openDialog({
        title: 'چسباندن متن پشتیبان',
        content: wrap,
        actions: [
          { label: 'انصراف', variant: 'text' },
          {
            label: 'بررسی و بازیابی',
            variant: 'primary',
            onClick: () => pasteBackupFlow(textarea.value.trim())
          }
        ]
      });
    }
  });
  backupButtonsRow.append(exportBtn, importBtn, copyTextBtn, pasteTextBtn, fileInput);
  backupContainer.append(backupDesc, backupButtonsRow);
  const backupCard = createCard({ title: 'پشتیبان‌گیری و بازگردانی اطلاعات', content: backupContainer });

  const devContainer = document.createElement('div');
  devContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); text-align:right;';
  const statusList = document.createElement('div');
  statusList.style.cssText = 'display:grid; grid-template-columns: repeat(2, 1fr); gap:var(--space-2); margin-bottom:var(--space-2);';
  const createBadge = (lbl, val) => {
    const item = document.createElement('div');
    item.style.cssText = 'background:var(--bg-card); border:1.5px solid var(--border-subtle); padding:var(--space-2); border-radius:var(--radius-input); display:flex; justify-content:space-between; align-items:center; font-size:var(--text-caption);';
    item.innerHTML = `<span style="color:var(--text-secondary);">${lbl}</span><span style="font-weight:700; color:var(--text-primary);">${val.toLocaleString('fa-IR')}</span>`;
    return item;
  };
  statusList.append(
    createBadge('تعداد دسته‌ها', cats.length),
    createBadge('تعداد کل فلش‌کارت‌ها', cards.length),
    createBadge('مرورهای ثبت شده', sessions.length),
    createBadge('نسخه نرم‌افزار', '1.0.0-phase12')
  );
  const devRow = document.createElement('div');
  devRow.style.cssText = 'display:flex; gap:var(--space-2); flex-wrap:wrap; margin-top:var(--space-2); justify-content:flex-end;';
  const resetBtn = createButton({
    label: 'حذف کامل تمام داده‌ها',
    icon: 'delete_forever',
    variant: 'secondary',
    onClick: () => {
      openDialog({
        title: 'هشدار امنیتی بسیار مهم <span class="material-symbols-rounded" style="color:var(--color-danger); font-size:20px; vertical-align:middle;">warning</span>',
        content: 'آیا واقعاً می‌خواهید تمام دسته‌ها، فلش‌کارت‌ها، یادداشت‌ها و تاریخچه‌ی مرورهای خود را برای همیشه پاک کنید؟ این عمل غیرقابل بازگشت است.',
        actions: [
          { label: 'انصراف', variant: 'text' },
          { 
            label: 'پاک‌سازی کل اطلاعات', 
            variant: 'primary', 
            onClick: () => {
              openDialog({
                title: 'تایید نهایی حذف داده‌ها',
                content: 'برای اطمینان کامل و نهایی: آیا کاملاً مطمئنید؟ برنامه ریست خواهد شد.',
                actions: [
                  { label: 'لغو عملیات', variant: 'text' },
                  {
                    label: 'بله، همه چیز پاک شود',
                    variant: 'primary',
                    onClick: async () => {
                      const { wipeAllData } = await import('../core/backup.js');
                      await wipeAllData();
                      await db.setSetting('ai_provider', 'gemini');
                      await db.setSetting('gemini_api_key', '');
                      await db.setSetting('gemini_model', 'gemini-3.5-flash');
                      await db.setSetting('groq_api_key', '');
                      await db.setSetting('groq_model', 'openai/gpt-oss-120b');
                      await db.setSetting('openrouter_api_key', '');
                      await db.setSetting('openrouter_model', 'openrouter/free');
                      await db.setSetting('deepseek_api_key', '');
                      await db.setSetting('deepseek_model', 'deepseek-chat');
                      await db.setSetting('dictation_method', 'auto');
                      await db.setSetting('gemini_system_instruction', '');
                      await db.setSetting('tts_speed', '0.95');
                      await db.setSetting('tts_lang', 'en-US');
                      await db.setSetting('daily_study_goal', '20');
                      await db.setSetting('daily_focus_goal_min', '60');
                      localStorage.removeItem('interval_again');
                      localStorage.removeItem('interval_hard');
                      localStorage.removeItem('interval_good');
                      localStorage.removeItem('interval_easy');
                      window.location.reload();
                    }
                  }
                ]
              });
            } 
          }
        ]
      });
    }
  });
  resetBtn.style.cssText += '; color: var(--color-danger); border-color: var(--color-danger);';
  devRow.append(resetBtn);
  devContainer.append(statusList, devRow);
  const devCard = createCard({ title: 'ابزارهای توسعه و عیب‌یابی دیتابیس', content: devContainer });

  systemTabContent.append(backupCard, devCard);


  const tabButtons = [];
  tabs.forEach((tab, index) => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: var(--space-2) var(--space-3);
      font-size: var(--text-caption);
      font-weight: 700;
      border-radius: var(--radius-card);
      border: none;
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--duration-fast) var(--ease-standard);
    `;
    
    const iconSpan = document.createElement('span');
    if (tab.icon && tab.icon.trim().startsWith('<svg')) {
      iconSpan.className = 'custom-svg-icon';
      iconSpan.style.display = 'inline-flex';
      iconSpan.style.alignItems = 'center';
      iconSpan.style.justifyContent = 'center';
      iconSpan.style.width = '18px';
      iconSpan.style.height = '18px';
      iconSpan.style.verticalAlign = 'middle';
      iconSpan.innerHTML = tab.icon;
    } else {
      iconSpan.className = 'material-symbols-rounded';
      iconSpan.style.fontSize = '18px';
      iconSpan.textContent = tab.icon || '';
    }
    
    const labelSpan = document.createElement('span');
    labelSpan.textContent = tab.label;
    
    btn.append(iconSpan, labelSpan);

    const activateTab = () => {
      tabButtons.forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-secondary)';
      });
      btn.style.background = 'var(--color-primary)';
      btn.style.color = 'var(--text-on-primary)';

      studyTabContent.style.display = tab.id === 'study' ? 'flex' : 'none';
      aiTabContent.style.display = tab.id === 'ai' ? 'flex' : 'none';
      appearanceTabContent.style.display = tab.id === 'appearance' ? 'flex' : 'none';
      systemTabContent.style.display = tab.id === 'system' ? 'flex' : 'none';

      const currentActiveContent = tab.id === 'study' ? studyTabContent :
                                   tab.id === 'ai' ? aiTabContent :
                                   tab.id === 'appearance' ? appearanceTabContent : systemTabContent;
      currentActiveContent.style.opacity = '0';
      currentActiveContent.style.transform = 'translateY(10px)';
      currentActiveContent.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
      
      requestAnimationFrame(() => {
        currentActiveContent.style.opacity = '1';
        currentActiveContent.style.transform = 'translateY(0)';
      });
    };

    btn.addEventListener('click', activateTab);
    tabContainer.appendChild(btn);
    tabButtons.push(btn);

    if (index === 0) {
      btn.style.background = 'var(--color-primary)';
      btn.style.color = 'var(--text-on-primary)';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text-secondary)';
    }
  });

  contentWrap.append(studyTabContent, aiTabContent, appearanceTabContent, systemTabContent);
  wrap.append(tabContainer, contentWrap);
}


export async function renderSearch(container) {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%; max-width:var(--max-content-w); margin:0 auto; padding-bottom:var(--space-4); text-align:right;';
  container.appendChild(wrap);

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); margin-bottom:var(--space-2);';
  
  const headerIcon = document.createElement('span');
  headerIcon.className = 'material-symbols-rounded';
  headerIcon.style.cssText = 'font-size:32px; color:var(--color-primary);';
  headerIcon.textContent = 'manage_search';

  const title = document.createElement('h2');
  title.style.cssText = 'font-size:var(--text-title); font-weight:800; color:var(--text-primary); margin:0;';
  title.textContent = 'جستجوی سراسری سیستم';

  header.append(headerIcon, title);
  wrap.appendChild(header);

  const resultsContainer = document.createElement('div');
  resultsContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%; min-height: 200px;';

  const searchBar = createSearchBar({
    placeholder: 'عنوان دسته، متن فلش‌کارت یا برچسب را جستجو کنید...',
    onSearch: async (val) => {
      await performSearch(val);
    }
  });
  wrap.appendChild(searchBar);
  wrap.appendChild(resultsContainer);

  const inputEl = searchBar.querySelector('input');
  if (inputEl) {
    setTimeout(() => inputEl.focus(), 100);
  }

  renderInitialState();

  function renderInitialState() {
    resultsContainer.innerHTML = '';
    const stateBox = createEmptyState({
      icon: 'search',
      title: 'آماده جستجو...',
      desc: 'عبارت مورد نظر خود را در فیلد بالا بنویسید تا دسته‌ها و فلش‌کارت‌های منطبق با آن بلافاصله نمایش داده شوند.',
    });
    const suggs = document.createElement('div');
    suggs.style.cssText = 'display:flex; gap:var(--space-2); flex-wrap:wrap; justify-content:center; margin-top:var(--space-2);';
    
    const keywords = ['کنکور', 'انگلیسی', 'زیست', 'فرمول', 'عمومی', 'آزمون'];
    keywords.forEach(kw => {
      const btn = createButton({
        label: kw,
        variant: 'secondary',
        onClick: async () => {
          if (inputEl) {
            inputEl.value = kw;
            await performSearch(kw);
          }
        }
      });
      btn.style.cssText += '; border-radius: 20px; font-size:11px; padding: 2px 10px; height: 28px;';
      suggs.appendChild(btn);
    });
    
    stateBox.appendChild(suggs);
    resultsContainer.appendChild(stateBox);
  }

  async function performSearch(val) {
    if (!val || !val.trim()) {
      renderInitialState();
      return;
    }

    resultsContainer.innerHTML = '';
    const spinner = createLoadingInline ? createLoadingInline('در حال جستجو و مطابقت‌دهی...') : document.createElement('div');
    spinner.style.padding = 'var(--space-4) 0';
    spinner.style.textAlign = 'center';
    resultsContainer.appendChild(spinner);

    try {
      const { globalSearch } = await import('../core/search.js');
      const { categories, flashcards } = await globalSearch(val);

      resultsContainer.innerHTML = '';

      if (categories.length === 0 && flashcards.length === 0) {
        resultsContainer.appendChild(
          createEmptyState({
            icon: 'search_off',
            title: 'نتیجه‌ای یافت نشد',
            desc: `هیچ دسته یا فلش‌کارتی متناسب با عبارت «${val}» در دیتابیس یافت نشد.`,
          })
        );
        return;
      }

      if (categories.length > 0) {
        const catSection = document.createElement('div');
        catSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';

        const catTitle = document.createElement('h3');
        catTitle.style.cssText = 'font-size:14px; font-weight:800; color:var(--text-secondary); border-bottom:1.5px solid var(--border-soft); padding-bottom:6px; margin-top:var(--space-2); display:flex; align-items:center;';
        catTitle.innerHTML = `<span class="material-symbols-rounded" style="font-size:18px; color:var(--text-secondary); margin-left:6px;">folder</span> دسته‌های مطالعاتی منطبق <span style="font-size:11px; font-weight:600; color:var(--color-primary); padding:2px 8px; border-radius:10px; background:var(--color-primary-soft); margin-right:6px;">${categories.length.toLocaleString('fa-IR')} دسته</span>`;
        catSection.appendChild(catTitle);

        const catList = document.createElement('div');
        catList.style.cssText = 'display:grid; grid-template-columns:1fr; gap:var(--space-2);';

        for (const cat of categories) {
          const cardsCount = (await flashcardRepository.getByIndex('categoryId', cat.id)).filter(c => !c.deleted).length;
          
          const catCard = createCard({
            title: cat.title,
            desc: cat.description || 'بدون توضیحات',
            onClick: () => router.navigate('category', cat.id)
          });
          catCard.style.borderLeft = `4px solid ${cat.themeColor || '#3D6BFF'}`;
          
          const badge = document.createElement('span');
          badge.style.cssText = 'font-size:10px; font-weight:700; color:var(--text-secondary); background:var(--bg-card); border:1px solid var(--border-soft); padding:2px 8px; border-radius:12px; margin-right:auto;';
          badge.textContent = `${cardsCount.toLocaleString('fa-IR')} کارت`;
          catCard.appendChild(badge);

          catList.appendChild(catCard);
        }

        catSection.appendChild(catList);
        resultsContainer.appendChild(catSection);
      }

      if (flashcards.length > 0) {
        const cardSection = document.createElement('div');
        cardSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); margin-top:var(--space-2);';

        const cardTitle = document.createElement('h3');
        cardTitle.style.cssText = 'font-size:14px; font-weight:800; color:var(--text-secondary); border-bottom:1.5px solid var(--border-soft); padding-bottom:6px; display:flex; align-items:center;';
        cardTitle.innerHTML = `<span class="material-symbols-rounded" style="font-size:18px; color:var(--text-secondary); margin-left:6px;">style</span> فلش‌کارت‌های منطبق <span style="font-size:11px; font-weight:600; color:var(--color-primary); padding:2px 8px; border-radius:10px; background:var(--color-primary-soft); margin-right:6px;">${flashcards.length.toLocaleString('fa-IR')} کارت</span>`;
        cardSection.appendChild(cardTitle);

        const cardList = document.createElement('div');
        cardList.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';

        const cats = await categoryRepository.getAll();
        const categoriesMap = new Map(cats.map(c => [c.id, c]));

        for (const f of flashcards) {
          const frontText = f.frontContent.map(b => b.value).join(' ');
          const backText = f.backContent.map(b => b.value).join(' ');
          
          const cat = categoriesMap.get(f.categoryId);
          const catTitleText = cat ? cat.title : 'بدون دسته';
          const catColor = cat ? cat.themeColor : 'var(--color-primary)';

          const item = document.createElement('div');
          item.className = 'ds-card';
          item.style.cssText = `
            padding: var(--space-3);
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
            border-right: 4px solid ${catColor};
            background: var(--bg-card);
            border-radius: var(--radius-card);
            box-shadow: var(--shadow-sm);
            cursor: pointer;
            transition: transform 0.15s ease, box-shadow 0.15s ease;
          `;
          item.addEventListener('mouseenter', () => {
            item.style.transform = 'translateY(-2px)';
            item.style.boxShadow = 'var(--shadow-md)';
          });
          item.addEventListener('mouseleave', () => {
            item.style.transform = 'translateY(0)';
            item.style.boxShadow = 'var(--shadow-sm)';
          });
          item.addEventListener('click', () => {
            router.navigate('category', f.categoryId);
          });

          const itemHeader = document.createElement('div');
          itemHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';

          const catBadge = document.createElement('span');
          catBadge.style.cssText = `font-size:10px; font-weight:800; color:white; background:${catColor}; padding:2px 8px; border-radius:8px;`;
          catBadge.textContent = catTitleText;

          const tagsRow = document.createElement('div');
          tagsRow.style.cssText = 'display:flex; gap:4px;';
          (f.tags || []).forEach(tag => {
            const tagBadge = document.createElement('span');
            tagBadge.style.cssText = 'font-size:9px; font-weight:700; color:var(--text-secondary); background:var(--bg-card); border:1px solid var(--border-soft); padding:1px 6px; border-radius:6px;';
            tagBadge.textContent = `#${tag}`;
            tagsRow.appendChild(tagBadge);
          });

          itemHeader.append(catBadge, tagsRow);

          const frontVal = document.createElement('div');
          frontVal.style.cssText = 'font-size:13px; font-weight:700; color:var(--text-primary); margin-top:4px;';
          frontVal.textContent = `سوال: ${frontText}`;

          const backVal = document.createElement('div');
          backVal.style.cssText = 'font-size:12px; color:var(--text-secondary);';
          backVal.textContent = `پاسخ: ${backText}`;

          item.append(itemHeader, frontVal, backVal);
          cardList.appendChild(item);
        }

        cardSection.appendChild(cardList);
        resultsContainer.appendChild(cardSection);
      }

    } catch (e) {
      console.error(e);
      resultsContainer.innerHTML = '';
      resultsContainer.appendChild(
        createErrorState({
          message: `مشکلی در پردازش جستجو پیش آمد: ${e.message}`,
          onRetry: () => performSearch(val),
        })
      );
    }
  }
}
