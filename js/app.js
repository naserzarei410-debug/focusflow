
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
import { renderPomodoro } from './features/pomodoro.js';
import { renderCalculator } from './features/calculator.js';
import { initTts } from './core/tts.js';
import { initNotifications } from './core/notifications.js';

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
