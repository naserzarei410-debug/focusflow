
import 'katex/dist/katex.min.css';
import './core/icon-system.js';
import { db } from './core/db.js';
import { theme } from './core/theme.js';
import { refreshIconState } from './core/icon-switcher.js';
import { router } from './core/router.js';
import { renderHome, renderAI, renderStats, renderSettings, renderSearch } from './features/pages.js';
import { renderLibrary } from './features/library.js';
import { renderCategoryWorkspace } from './features/category.js';

import { renderStudySession } from './features/study-session.js';
import { renderPracticeSession } from './features/practice-session.js';
import { renderExamSession } from './features/exam-session.js';
import { renderPomodoro, setOnFocusCompleted } from './features/pomodoro.js';
import { renderCalculator } from './features/calculator.js';
import { renderStudyPlanner } from './features/study-planner.js';
import { addMinutesToSubjectToday, getSubjectsSorted } from './core/planner-data.js';
import { openDialog, showToast } from './core/ui.js';
import { initTts } from './core/tts.js';
import { initNotifications } from './core/notifications.js';
import { consumeQuickStartOnLaunch, listenForQuickStartNudges } from './core/quick-start.js';

async function bootstrap() {
  await db.getDb();
  await theme.initTheme();
  initTts(); // warm native TTS plugin early (fire-and-forget)
  initNotifications(); // local notifications channels + reschedule
  refreshIconState(); // foreground fallback for the daily background icon check; fire-and-forget

  router.registerRoute('home', renderHome);
  router.registerRoute('library', renderLibrary);
  router.registerRoute('ai', renderAI);
  router.registerRoute('stats', renderStats);
  router.registerRoute('settings', renderSettings);
  router.registerRoute('search', renderSearch);
  router.registerRoute('category', renderCategoryWorkspace);
  router.registerRoute('study', renderStudySession);
  router.registerRoute('practice', renderPracticeSession);
  router.registerRoute('exam', renderExamSession);
  router.registerRoute('pomodoro', renderPomodoro);
  router.registerRoute('calculator', renderCalculator);
  router.registerRoute('planner', renderStudyPlanner);

  // "2-minute mode" home screen widget: catches both a fresh app launch
  // from the widget (below) and the widget being tapped again while the
  // app was already open in the background (the listener).
  listenForQuickStartNudges();
  const cameFromQuickStartWidget = await consumeQuickStartOnLaunch();
  if (cameFromQuickStartWidget && !window.location.hash) {
    window.location.hash = 'study';
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => router.navigate(btn.dataset.route));
  });

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => theme.toggleTheme());
  }

  const searchBtn = document.getElementById('search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => router.navigate('search'));
  }

  const calcBtn = document.getElementById('calculator-btn') || document.getElementById('calculator-fab');
  if (calcBtn) {
    calcBtn.addEventListener('click', () => router.navigate('calculator'));
  }

  const plannerBtn = document.getElementById('planner-btn');
  if (plannerBtn) {
    plannerBtn.addEventListener('click', () => router.navigate('planner'));
  }

  // When a live (foreground) Pomodoro focus session that was linked to a
  // planner subject finishes, offer to log that time in the Weekly Planner.
  setOnFocusCompleted(async (subjectId, minutes) => {
    try {
      const subjects = await getSubjectsSorted();
      const subject = subjects.find((s) => s.id === subjectId);
      const subjectTitle = subject ? subject.title : 'این درس';
      openDialog({
        title: 'افزودن به برنامهٔ هفتگی؟',
        content: `${minutes.toLocaleString('fa-IR')} دقیقه تمرکز روی «${subjectTitle}» را به جدول برنامه‌ریزی هفتگی (امروز) اضافه کنم؟`,
        actions: [
          { label: 'نه، فعلاً نه', variant: 'secondary' },
          {
            label: 'بله، اضافه کن',
            variant: 'primary',
            onClick: async () => {
              await addMinutesToSubjectToday(subjectId, minutes);
              showToast(`${minutes.toLocaleString('fa-IR')} دقیقه به «${subjectTitle}» اضافه شد`, 'success');
            },
          },
        ],
      });
    } catch (e) {
      console.error('Pomodoro-to-planner hand-off failed', e);
    }
  });

  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => router.goBack());
  }

  router.initRouter();

  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
  }

  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.classList.remove('hidden');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
    });
  }

}

bootstrap();
