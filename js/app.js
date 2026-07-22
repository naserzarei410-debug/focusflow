
import './core/icon-system.js';
import { db } from './core/db.js';
import { theme } from './core/theme.js';
import { router } from './core/router.js';
import { notifications } from './core/notifications.js';
import { renderHome, renderAI, renderStats, renderSettings, renderSearch } from './features/pages.js';
import { renderLibrary } from './features/library.js';
import { renderCategoryWorkspace } from './features/category.js';

import { renderStudySession } from './features/study-session.js';
import { renderPracticeSession } from './features/practice-session.js';
import { renderExamSession } from './features/exam-session.js';
import { renderPomodoro } from './features/pomodoro.js';

async function bootstrap() {
  await db.getDb();
  await theme.initTheme();

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
      // Offline shell still works without a service worker; this is a
      // progressive enhancement, not a hard requirement for Phase 1.
    });
  }

  // Schedule (or refresh) the "review due" reminder. This is a no-op on the
  // web/dev server and only does anything inside the native Android app.
  notifications.scheduleNextReviewReminder();
}

bootstrap();
