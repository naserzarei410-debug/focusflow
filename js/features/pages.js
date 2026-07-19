import { initInteractiveInterval } from './interval-plot.js';
import * as d3 from 'd3';

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

  let cleanText = text.replace(/```json/gi, '').replace(/```/gi, '').trim();
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
import { theme as themeApi } from '../core/theme.js';

import {
  createButton, createCard, openDialog, openBottomSheet, showToast,
  createTextField, createTextArea, createSearchBar, createSkeletonList,
  createProgressBar, createProgressRing, createLoadingInline,
  createErrorState, createEmptyState, renderFractionsInText, createSelectField,
  renderMathSegment,
} from '../core/ui.js';
import { db } from '../core/db.js';
import { getStudyQueues, calculateStreak } from '../core/study.js';
import { categoryRepository, flashcardRepository, studySessionRepository, reviewHistoryRepository, aiConversationRepository } from '../core/repositories.js';
import { router } from '../core/router.js';
import { createAiConversationModel, createFlashcardModel, createCategoryModel } from '../core/models.js';

export async function renderHome(container) {
  // Show standard skeleton while fetching async data
  container.innerHTML = '';
  const skeleton = createSkeletonList(3);
  container.appendChild(skeleton);

  const categories = await categoryRepository.getAll();
  const queues = await getStudyQueues(); // Global queues
  const streak = await calculateStreak();

  const todayStr = new Date().toISOString().split('T')[0];
  const sessions = await studySessionRepository.getAll();
  const todaySessions = sessions.filter(s => s.date === todayStr);
  const reviewedToday = todaySessions.reduce((acc, curr) => acc + (curr.cardsReviewed || 0), 0);

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-3);width:100%;max-width:var(--max-content-w);margin:0 auto;';
  container.appendChild(wrap);

  // 1. Study Streak Widget (if active)
  if (streak.currentStreak > 0) {
    const streakWidget = document.createElement('div');
    streakWidget.style.cssText = `
      background: var(--color-accent-soft);
      border: 1px solid var(--color-accent);
      padding: var(--space-3);
      border-radius: var(--radius-card);
      display: flex;
      align-items: center;
      gap: var(--space-3);
      color: var(--color-accent);
      font-weight: 700;
      box-shadow: var(--shadow-sm);
    `;
    streakWidget.innerHTML = `
      <div style="font-size:32px; animation: flamePulse 2s infinite ease-in-out; display:flex; align-items:center; justify-content:center;">
        <span class="material-symbols-rounded" style="font-size:36px; color:var(--color-accent);">local_fire_department</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:2px; text-align:right;">
        <span style="font-size:var(--text-body); font-weight:800;">استمرار شما در یادگیری تحسین‌برانگیز است!</span>
        <span style="font-size:var(--text-caption); font-weight:600; opacity:0.9;">${streak.currentStreak.toLocaleString('fa-IR')} روز مطالعه متوالی. هدف روزانه را حفظ کنید!</span>
      </div>
    `;
    wrap.appendChild(streakWidget);
  }

  // 1.5 Daily Study Goal Progress Widget
  if (categories.length > 0) {
    const dailyGoalStr = await db.getSetting('daily_study_goal', '20');
    const dailyGoal = parseInt(dailyGoalStr, 10) || 20;
    const goalProgress = Math.min(100, Math.floor((reviewedToday / dailyGoal) * 100));

    const goalCard = document.createElement('div');
    goalCard.className = 'ds-card';
    goalCard.style.cssText = `
      background: var(--bg-card);
      border: 1px solid var(--border-soft);
      padding: var(--space-3);
      border-radius: var(--radius-card);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      box-shadow: var(--shadow-sm);
    `;
    
    const goalHeader = document.createElement('div');
    goalHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
    
    const goalTitle = document.createElement('span');
    goalTitle.style.cssText = 'font-family:var(--font-heading); font-size:18px; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:var(--space-1);';
    goalTitle.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px; color:var(--color-primary);">track_changes</span> هدف روزانه مطالعه';
    
    const goalStats = document.createElement('span');
    goalStats.style.cssText = 'font-size:12px; font-weight:600; color:var(--text-secondary);';
    goalStats.innerHTML = `${reviewedToday.toLocaleString('fa-IR')} از ${dailyGoal.toLocaleString('fa-IR')} کارت`;
    
    goalHeader.append(goalTitle, goalStats);
    
    const pBar = createProgressBar(goalProgress);
    
    const goalFooter = document.createElement('div');
    goalFooter.style.cssText = 'font-size:12px; color:var(--text-secondary); text-align:right;';
    if (reviewedToday >= dailyGoal) {
      goalFooter.style.cssText = 'font-size:12px; color:var(--text-secondary); text-align:right; display:flex; align-items:center; gap:var(--space-1);';
      goalFooter.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px; color:#10B981;">celebration</span> <span style="color:#10B981; font-weight:700;">هدف امروز انجام شد! کار خود را عالی انجام دادید.</span>';
    } else {
      goalFooter.textContent = `فقط ${(dailyGoal - reviewedToday).toLocaleString('fa-IR')} کارت دیگر برای تکمیل هدف امروز باقی مانده است.`;
    }
    
    goalCard.append(goalHeader, pBar, goalFooter);
    wrap.appendChild(goalCard);
  }

  // 1.6 Pomodoro Focus Timer entry point — always shown, even for brand-new
  // users with no categories yet, since it doesn't depend on flashcard data.
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
    sub.textContent = 'بدون حواس‌پرتی تمرکز کنید';

    infoBox.append(title, sub);
    leftSide.append(iconBox, infoBox);

    const chevron = document.createElement('span');
    chevron.className = 'material-symbols-rounded';
    chevron.style.color = 'var(--text-tertiary)';
    chevron.textContent = 'chevron_left';

    pomodoroCard.append(leftSide, chevron);
    wrap.appendChild(pomodoroCard);
  }

  // 2. Main FSRS Smart Review Action Card
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

    // Right Column: Text & CTA & Live Badges
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
    description.textContent = 'امروز زمان تثبیت آموخته‌ها فرا رسیده است. فلش‌کارت‌های خود را طبق برنامه‌ریزی هوشمندانه مطالعه کنید تا به حافظه بلندمدت سپرده شوند.';

    // Mini literal badges row
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

    // Left Column: Compact Dynamic Circular Progress Ring
    const visualCol = document.createElement('div');
    visualCol.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 6px;
      max-width: 150px;
      width: 100%;
      margin: 0 auto;
    `;

    const totalToday = reviewedToday + totalDue + totalNew;
    const progressPercent = totalToday > 0 ? Math.round((reviewedToday / totalToday) * 100) : 100;

    const ringWrapper = document.createElement('div');
    ringWrapper.style.cssText = `
      position: relative;
      width: 86px;
      height: 86px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform var(--duration-fast) var(--ease-standard);
    `;
    ringWrapper.addEventListener('mouseenter', () => {
      ringWrapper.style.transform = 'scale(1.05)';
    });
    ringWrapper.addEventListener('mouseleave', () => {
      ringWrapper.style.transform = 'none';
    });

    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('width', '86');
    svg.setAttribute('height', '86');
    svg.style.cssText = 'transform: rotate(-90deg); width: 86px; height: 86px;';

    const track = document.createElementNS(svgNamespace, 'circle');
    track.setAttribute('cx', '43');
    track.setAttribute('cy', '43');
    track.setAttribute('r', '37');
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'var(--border-soft)');
    track.setAttribute('stroke-width', '6');
    svg.appendChild(track);

    const fill = document.createElementNS(svgNamespace, 'circle');
    fill.setAttribute('cx', '43');
    fill.setAttribute('cy', '43');
    fill.setAttribute('r', '37');
    fill.setAttribute('fill', 'none');
    const ringColor = progressPercent === 100 ? 'var(--color-success)' : 'var(--color-primary)';
    fill.setAttribute('stroke', ringColor);
    fill.setAttribute('stroke-width', '6');
    fill.setAttribute('stroke-linecap', 'round');

    const circumference = 2 * Math.PI * 37; // ≈ 232.47
    fill.setAttribute('stroke-dasharray', circumference.toString());
    fill.setAttribute('stroke-dashoffset', circumference.toString());
    fill.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)';
    svg.appendChild(fill);

    ringWrapper.appendChild(svg);

    setTimeout(() => {
      const offset = circumference - (progressPercent / 100) * circumference;
      fill.setAttribute('stroke-dashoffset', offset.toString());
    }, 50);

    const centerText = document.createElement('div');
    centerText.style.cssText = `
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    `;
    if (progressPercent === 100) {
      centerText.innerHTML = `
        <span class="material-symbols-rounded" style="font-size: 24px; color: var(--color-success); font-weight: 900;">check</span>
      `;
    } else {
      centerText.innerHTML = `
        <span style="font-family: var(--font-mono); font-size: 16px; font-weight: 800; color: var(--text-primary);">${progressPercent.toLocaleString('fa-IR')}٪</span>
      `;
    }
    ringWrapper.appendChild(centerText);

    const captionLabel = document.createElement('span');
    captionLabel.style.cssText = `
      font-size: 10px;
      font-weight: 700;
      color: var(--text-tertiary);
    `;
    captionLabel.textContent = 'پیشرفت مطالعه امروز';

    visualCol.append(ringWrapper, captionLabel);

    mainActionRow.append(infoCol, visualCol);
    wrap.appendChild(mainActionRow);
  } else if (categories.length > 0) {
    // All up to date
    const upToDateCard = document.createElement('div');
    upToDateCard.className = 'ds-card';
    upToDateCard.style.cssText = 'background:var(--bg-card); border:1.5px solid var(--border-subtle); padding:var(--space-4); text-align:center; display:flex; flex-direction:column; align-items:center; gap:var(--space-2);';
    
    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.style.cssText = 'font-size:48px; color:var(--color-success);';
    icon.textContent = 'emoji_events';

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:var(--text-section); font-weight:800; color:var(--text-primary); margin:0;';
    title.textContent = 'کارت‌های شما کاملاً به‌روز هستند!';

    const sub = document.createElement('p');
    sub.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); margin:0;';
    sub.textContent = 'کار فوق‌العاده‌ای انجام دادید. الگوریتم FSRS زمان مرور بعدی را اعلام خواهد کرد.';

    upToDateCard.append(icon, title, sub);
    wrap.appendChild(upToDateCard);
  } else {
    // No categories yet, show friendly initial empty state
    wrap.appendChild(
      createEmptyState({
        icon: 'auto_awesome',
        title: 'هنوز چیزی برای مطالعه نیست',
        desc: 'وقتی اولین دسته و فلش‌کارت را در کتابخانه بسازید، برنامه‌ی امروز، پیشرفت روزانه و پیشنهادهای هوش مصنوعی همین‌جا نمایش داده می‌شوند.',
        action: createButton({
          label: 'ساخت اولین دسته در کتابخانه',
          icon: 'library_books',
          onClick: () => router.navigate('library')
        })
      })
    );
    return;
  }

  // 3. Active / Recent Categories List
  if (categories.length > 0) {
    const header = document.createElement('h3');
    header.style.cssText = 'font-size:var(--text-section); font-weight:800; color:var(--text-primary); margin-top:var(--space-3); margin-bottom:var(--space-2); text-align:right;';
    header.textContent = 'دسته‌های فعال شما';
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

  // 4. Global Quick-Add Button (FAB) (Point 7)
  const globalFab = document.createElement('button');
  globalFab.className = 'fab';
  globalFab.setAttribute('aria-label', 'افزودن سریع');
  globalFab.innerHTML = '<span class="material-symbols-rounded">add</span>';
  globalFab.addEventListener('click', () => openQuickAddSheet());
  container.appendChild(globalFab);
}

// Global Quick-Add Sheet and PDF/Manual flows
async function openQuickAddSheet() {
  const categories = await categoryRepository.getAll();

  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const options = [
    { icon: 'description', label: 'تولید کارت از فایل PDF (با هوش مصنوعی)', action: () => startPdfEngineFlow(categories) },
    { icon: 'edit_note', label: 'ایجاد فلش‌کارت دستی', action: () => openManualCardDialog(categories) },
    { icon: 'photo_camera', label: 'ساخت فلش‌کارت با عکس‌برداری (OCR)', action: () => openOcrFlow(categories) },
    { icon: 'create_new_folder', label: 'ایجاد دسته جدید', action: () => openNewCategoryDialog() }
  ];

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'card card-interactive';
    btn.style.cssText = 'display:flex; align-items:center; gap:var(--space-3); padding:var(--space-3); width:100%; border-radius:var(--radius-card); text-align:right; font-weight:700;';
    btn.innerHTML = `
      <span class="material-symbols-rounded" style="color:var(--color-primary); font-size:24px;">${opt.icon}</span>
      <span style="font-size:var(--text-body); color:var(--text-primary);">${opt.label}</span>
    `;
    btn.addEventListener('click', () => {
      overlay.remove(); // close bottom sheet
      opt.action();
    });
    content.appendChild(btn);
  });

  const overlay = openBottomSheet({
    title: 'افزودن سریع (Quick Add)',
    content
  });
}

// PDF Flashcard generator flow (Point 1 - PDF Engine)
async function startPdfEngineFlow(categories) {
  if (categories.length === 0) {
    openDialog({
      title: 'دسته یافت نشد',
      content: 'لطفاً ابتدا یک دسته جدید ایجاد کنید تا بتوان فلش‌کارت‌ها را به آن اضافه کرد.',
      actions: [
        { label: 'ایجاد دسته جدید', variant: 'primary', onClick: () => openNewCategoryDialog() },
        { label: 'انصراف', variant: 'secondary' }
      ]
    });
    return;
  }

  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const selectLabel = document.createElement('label');
  selectLabel.className = 'input-label';
  selectLabel.textContent = 'انتخاب دسته هدف:';
  
  const select = document.createElement('select');
  select.className = 'text-input';
  select.style.cssText = 'margin-bottom: var(--space-2);';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.title;
    select.appendChild(opt);
  });

  const uploadBox = document.createElement('div');
  uploadBox.style.cssText = 'border: 2px dashed var(--border-strong); border-radius: var(--radius-card); padding: var(--space-5); text-align: center; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: var(--space-2); background: var(--bg-primary); transition: background var(--duration-fast);';
  uploadBox.innerHTML = `
    <span class="material-symbols-rounded" style="font-size: 48px; color: var(--color-primary);">cloud_upload</span>
    <span style="font-size: 14px; font-weight: 700; color: var(--text-primary);">انتخاب فایل PDF یا رها کردن آن اینجا</span>
    <span style="font-size: 12px; color: var(--text-secondary);">حداکثر حجم ۱۰ مگابایت</span>
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf';
  fileInput.style.display = 'none';
  uploadBox.appendChild(fileInput);

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
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelected();
    }
  });

  fileInput.addEventListener('change', () => {
    handleFileSelected();
  });

  content.append(selectLabel, select, uploadBox);

  const dialogOverlay = openDialog({
    title: 'تولید کارت از فایل PDF',
    content,
    actions: [
      { label: 'انصراف', variant: 'secondary' }
    ]
  });

  async function handleFileSelected() {
    const file = fileInput.files[0];
    if (!file) return;

    dialogOverlay.remove();

    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'overlay';
    loadingOverlay.style.zIndex = '2000';
    loadingOverlay.innerHTML = `
      <div class="dialog-content" style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-3);">
        <div class="spinner" style="width: 48px; height: 48px;"></div>
        <h3 id="pdf-loading-text" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">در حال استخراج متن از PDF...</h3>
        <p style="font-size: 13px; color: var(--text-secondary);">این فرآیند به صورت ۱۰۰٪ محلی در مرورگر شما انجام می‌شود.</p>
      </div>
    `;
    document.body.appendChild(loadingOverlay);

    try {
      const { extractTextFromPdf } = await import('../core/pdf-utils.js');
      const extracted = await extractTextFromPdf(file);
      
      const loadingTextEl = document.getElementById('pdf-loading-text');
      if (loadingTextEl) {
        loadingTextEl.textContent = 'در حال تحلیل متن با هوش مصنوعی و تولید فلش‌کارت...';
      }

      const selectedCatId = select.value;
      const category = categories.find(c => c.id === selectedCatId);
      const textToAnalyze = extracted.text.slice(0, 12000);

      
      const apiKey = await db.getSetting('gemini_api_key', '');
      const preferredModel = await db.getSetting('gemini_model', '');

      const { generateCardsWithGemini } = await import('../core/gemini-client.js');
      const data = await generateCardsWithGemini({
        apiKey: apiKey || undefined,
        model: preferredModel || undefined,
        text: textToAnalyze,
        categoryTitle: category ? category.title : 'عمومی'
      });

      loadingOverlay.remove();

      let cards = extractJsonArray(data.text);

      if (!cards || cards.length === 0) {
        throw new Error('هیچ فلش‌کارتی یافت نشد.');
      }

      openApprovalDialog(cards, selectedCatId);

    } catch (err) {
      loadingOverlay.remove();
      console.error(err);
      openDialog({
        title: 'خطا در فرآیند',
        content: err.message || 'مشکلی رخ داد. لطفاً اتصال اینترنت خود را بررسی کرده و مجدداً تلاش کنید.',
        actions: [
          { label: 'تلاش مجدد', variant: 'primary', onClick: () => startPdfEngineFlow(categories) },
          { label: 'بستن', variant: 'secondary' }
        ]
      });
    }
  }
}

// Preview and approve generated flashcards
function openApprovalDialog(initialCards, categoryId) {
  let cards = [...initialCards];

  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); max-height: 50vh; overflow-y: auto; padding-right: 4px;';

  function renderCardList() {
    content.innerHTML = '';
    if (cards.length === 0) {
      content.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:var(--space-4);">هیچ کارتی برای تایید باقی نمانده است.</p>';
      return;
    }

    cards.forEach((card, index) => {
      const cardContainer = document.createElement('div');
      cardContainer.className = 'card';
      cardContainer.style.cssText = 'padding:var(--space-3); position:relative; display:flex; flex-direction:column; gap:var(--space-2); border-color: var(--border-strong);';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn';
      deleteBtn.style.cssText = 'position:absolute; left:var(--space-2); top:var(--space-2); width:32px; height:32px;';
      deleteBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px; color:var(--text-primary);">delete</span>';
      deleteBtn.addEventListener('click', () => {
        cards.splice(index, 1);
        renderCardList();
      });
      cardContainer.appendChild(deleteBtn);

      const numLabel = document.createElement('span');
      numLabel.style.cssText = 'font-size:12px; font-weight:700; color:var(--color-primary);';
      numLabel.textContent = `کارت ${(index + 1).toLocaleString('fa-IR')}`;
      cardContainer.appendChild(numLabel);

      const frontGroup = document.createElement('div');
      frontGroup.className = 'input-wrapper';
      const frontLabel = document.createElement('span');
      frontLabel.className = 'input-label';
      frontLabel.textContent = 'روی کارت:';
      const frontInput = document.createElement('input');
      frontInput.className = 'text-input';
      frontInput.value = card.front || card.question || '';
      frontInput.addEventListener('input', (e) => {
        cards[index].front = e.target.value;
      });
      frontGroup.append(frontLabel, frontInput);

      const backGroup = document.createElement('div');
      backGroup.className = 'input-wrapper';
      const backLabel = document.createElement('span');
      backLabel.className = 'input-label';
      backLabel.textContent = 'پشت کارت:';
      const backInput = document.createElement('textarea');
      backInput.className = 'text-area';
      backInput.rows = 2;
      backInput.value = card.back || card.answer || '';
      backInput.addEventListener('input', (e) => {
        cards[index].back = e.target.value;
      });
      backGroup.append(backLabel, backInput);

      cardContainer.append(frontGroup, backGroup);
      content.appendChild(cardContainer);
    });
  }

  renderCardList();

  openDialog({
    title: 'پیش‌نویس کارت‌های تولید شده',
    content,
    actions: [
      { label: 'لغو', variant: 'secondary' },
      {
        label: 'ذخیره همه کارت‌های تایید شده',
        variant: 'primary',
        onClick: async () => {
          if (cards.length === 0) return;

          for (const card of cards) {
            const frontText = card.front || card.question || '';
            const backText = card.back || card.answer || '';
            if (!frontText.trim()) continue;

            const newCard = createFlashcardModel({
              categoryId,
              frontContent: [{ type: 'text', value: frontText.trim() }],
              backContent: [{ type: 'text', value: backText.trim() }],
              source: 'ai_pdf',
              aiGenerated: true
            });
            await flashcardRepository.create(newCard);
          }

          const cardsInCat = await flashcardRepository.getByIndex('categoryId', categoryId);
          const activeCount = cardsInCat.filter((c) => !c.deleted).length;
          await categoryRepository.update(categoryId, { totalCards: activeCount });

          openDialog({
            title: 'موفقیت‌آمیز',
            content: `${cards.length.toLocaleString('fa-IR')} فلش‌کارت با موفقیت به دسته اضافه شد.`,
            actions: [{ label: 'تأیید', variant: 'primary', onClick: () => {
              const currentHash = window.location.hash || '';
              if (currentHash.includes(`#category/${categoryId}`)) {
                router.navigate('library');
                setTimeout(() => router.navigate(`category`, categoryId), 50);
              } else {
                router.navigate('home');
              }
            }}]
          });
        }
      }
    ]
  });
}

// Manual Flashcard creator dialog
async function openManualCardDialog(categories) {
  if (categories.length === 0) {
    openDialog({
      title: 'دسته یافت نشد',
      content: 'لطفاً ابتدا یک دسته جدید ایجاد کنید.',
      actions: [
        { label: 'ایجاد دسته جدید', variant: 'primary', onClick: () => openNewCategoryDialog() },
        { label: 'انصراف', variant: 'secondary' }
      ]
    });
    return;
  }

  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const selectLabel = document.createElement('label');
  selectLabel.className = 'input-label';
  selectLabel.textContent = 'انتخاب دسته:';
  const select = document.createElement('select');
  select.className = 'text-input';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.title;
    select.appendChild(opt);
  });

  const frontGroup = document.createElement('div');
  frontGroup.className = 'input-wrapper';
  const frontLabel = document.createElement('span');
  frontLabel.className = 'input-label';
  frontLabel.textContent = 'روی کارت (پرسش):';
  const frontInput = document.createElement('input');
  frontInput.className = 'text-input';
  frontGroup.append(frontLabel, frontInput);

  const backGroup = document.createElement('div');
  backGroup.className = 'input-wrapper';
  const backLabel = document.createElement('span');
  backLabel.className = 'input-label';
  backLabel.textContent = 'پشت کارت (پاسخ):';
  const backInput = document.createElement('textarea');
  backInput.className = 'text-area';
  backInput.rows = 3;
  backGroup.append(backLabel, backInput);

  content.append(selectLabel, select, frontGroup, backGroup);

  openDialog({
    title: 'ایجاد فلش‌کارت دستی',
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
          if (!front || !back) return;

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

// Category creator dialog
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
    title: 'ایجاد دسته جدید',
    content,
    actions: [
      { label: 'انصراف', variant: 'secondary' },
      {
        label: 'ایجاد دسته',
        variant: 'primary',
        onClick: async () => {
          const title = titleInput.value.trim();
          if (!title) return;
          const newCat = createCategoryModel({
            title,
            description: descInput.value.trim(),
            themeColor: selectedColor
          });
          await categoryRepository.create(newCat);
          openDialog({
            title: 'دسته ایجاد شد',
            content: `دسته "${title}" با موفقیت ایجاد شد.`,
            actions: [{ label: 'تأیید', variant: 'primary', onClick: () => router.navigate('library') }]
          });
        }
      }
    ]
  });
}

// OCR system flow using client-side Tesseract.js (Point 2)
async function openOcrFlow(categories) {
  if (!categories || categories.length === 0) {
    openDialog({
      title: 'دسته یافت نشد',
      content: 'لطفاً ابتدا یک دسته جدید ایجاد کنید تا بتوان فلش‌کارت‌ها را به آن اضافه کرد.',
      actions: [
        { label: 'ایجاد دسته جدید', variant: 'primary', onClick: () => openNewCategoryDialog() },
        { label: 'انصراف', variant: 'secondary' }
      ]
    });
    return;
  }

  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

  const selectLabel = document.createElement('label');
  selectLabel.className = 'input-label';
  selectLabel.textContent = 'انتخاب دسته هدف:';
  
  const select = document.createElement('select');
  select.className = 'text-input';
  select.style.cssText = 'margin-bottom: var(--space-2);';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.title;
    select.appendChild(opt);
  });

  const uploadBox = document.createElement('div');
  uploadBox.style.cssText = 'border: 2px dashed var(--border-strong); border-radius: var(--radius-card); padding: var(--space-5); text-align: center; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: var(--space-2); background: var(--bg-primary); transition: background var(--duration-fast);';
  uploadBox.innerHTML = `
    <span class="material-symbols-rounded" style="font-size: 48px; color: var(--color-primary);">photo_camera</span>
    <span style="font-size: 14px; font-weight: 700; color: var(--text-primary);">عکس‌برداری یا انتخاب تصویر (OCR)</span>
    <span style="font-size: 12px; color: var(--text-secondary);">تصویر شامل متون فارسی یا انگلیسی</span>
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  uploadBox.appendChild(fileInput);

  const cameraInput = document.createElement('input');
  cameraInput.type = 'file';
  cameraInput.accept = 'image/*';
  cameraInput.setAttribute('capture', 'environment');
  cameraInput.style.display = 'none';
  uploadBox.appendChild(cameraInput);

  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'display:flex; gap:var(--space-2); justify-content:center; width:100%; margin-top:var(--space-2);';
  
  const cameraBtn = document.createElement('button');
  cameraBtn.className = 'btn btn-primary';
  cameraBtn.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; gap:var(--space-1);';
  cameraBtn.innerHTML = '<span class="material-symbols-rounded">photo_camera</span> گرفتن عکس';
  cameraBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cameraInput.click();
  });

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn btn-secondary';
  uploadBtn.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; gap:var(--space-1);';
  uploadBtn.innerHTML = '<span class="material-symbols-rounded">image</span> انتخاب فایل';
  uploadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  btnContainer.append(cameraBtn, uploadBtn);
  uploadBox.appendChild(btnContainer);

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
    if (e.dataTransfer.files.length > 0) {
      handleOcrFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleOcrFileSelected(fileInput.files[0]);
    }
  });

  cameraInput.addEventListener('change', () => {
    if (cameraInput.files.length > 0) {
      handleOcrFileSelected(cameraInput.files[0]);
    }
  });

  content.append(selectLabel, select, uploadBox);

  const dialogOverlay = openDialog({
    title: 'استخراج متن از تصویر (OCR)',
    content,
    actions: [
      { label: 'انصراف', variant: 'secondary' }
    ]
  });

  async function handleOcrFileSelected(file) {
    if (!file) return;

    dialogOverlay.remove();

    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'overlay';
    loadingOverlay.style.zIndex = '2000';
    loadingOverlay.innerHTML = `
      <div class="dialog-content" style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-3);">
        <div class="spinner" style="width: 48px; height: 48px;"></div>
        <h3 id="ocr-loading-text" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">در حال راه‌اندازی سیستم OCR...</h3>
        <p style="font-size: 13px; color: var(--text-secondary);">این فرآیند به صورت کاملاً محلی در مرورگر شما انجام می‌شود.</p>
      </div>
    `;
    document.body.appendChild(loadingOverlay);

    try {
      const { performOcr } = await import('../core/ocr-utils.js');
      const extractedText = await performOcr(file, (progress) => {
        const loadingTextEl = document.getElementById('ocr-loading-text');
        if (loadingTextEl) {
          loadingTextEl.textContent = `در حال خواندن و تحلیل متن تصویر (${progress}٪)...`;
        }
      });

      loadingOverlay.remove();
      openOcrPreviewDialog(extractedText, select.value, categories);

    } catch (err) {
      loadingOverlay.remove();
      console.error(err);
      openDialog({
        title: 'خطا در OCR',
        content: err.message || 'مشکلی در پردازش تصویر پیش آمد. لطفاً تصویر واضح‌تری انتخاب کنید.',
        actions: [
          { label: 'تلاش مجدد', variant: 'primary', onClick: () => openOcrFlow(categories) },
          { label: 'بستن', variant: 'secondary' }
        ]
      });
    }
  }
}

// Dialog to preview extracted text and create cards (manual or AI-powered)
function openOcrPreviewDialog(extractedText, categoryId, categories) {
  const content = document.createElement('div');
  content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%;';

  const label = document.createElement('span');
  label.className = 'input-label';
  label.textContent = 'متن استخراج‌شده (می‌توانید آن را ویرایش یا تکمیل کنید):';

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
        label: 'تولید کارت با هوش مصنوعی (Gemini)',
        variant: 'primary',
        onClick: async () => {
          const text = textarea.value.trim();
          if (!text) return;

          const loadingOverlay = document.createElement('div');
          loadingOverlay.className = 'overlay';
          loadingOverlay.style.zIndex = '2000';
          loadingOverlay.innerHTML = `
            <div class="dialog-content" style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-3);">
              <div class="spinner" style="width: 48px; height: 48px;"></div>
              <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary);">در حال تولید کارت هوشمند از متن...</h3>
            </div>
          `;
          document.body.appendChild(loadingOverlay);

          try {
            const category = categories.find(c => c.id === categoryId);
            
            
            const apiKey = await db.getSetting('gemini_api_key', '');
            const preferredModel = await db.getSetting('gemini_model', '');

            const { generateCardsWithGemini } = await import('../core/gemini-client.js');
            const data = await generateCardsWithGemini({
              apiKey: apiKey || undefined,
              model: preferredModel || undefined,
              text: text,
              categoryTitle: category ? category.title : 'عمومی'
            });

            loadingOverlay.remove();

            const cards = extractJsonArray(data.text);
            if (!cards || cards.length === 0) {
              throw new Error('هیچ فلش‌کارتی یافت نشد.');
            }

            openApprovalDialog(cards, categoryId);

          } catch (err) {
            loadingOverlay.remove();
            console.error(err);
            openDialog({
              title: 'خطا',
              content: err.message || 'مشکلی در ارتباط با هوش مصنوعی پیش آمد.',
              actions: [{ label: 'متوجه شدم', variant: 'primary' }]
            });
          }
        }
      },
      {
        label: 'ذخیره مستقیم دستی',
        variant: 'secondary',
        onClick: async () => {
          const text = textarea.value.trim();
          if (!text) return;

          const manualContent = document.createElement('div');
          manualContent.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';

          const frontGroup = document.createElement('div');
          frontGroup.className = 'input-wrapper';
          const frontLabel = document.createElement('span');
          frontLabel.className = 'input-label';
          frontLabel.textContent = 'روی کارت (پرسش):';
          const frontInput = document.createElement('input');
          frontInput.className = 'text-input';
          frontGroup.append(frontLabel, frontInput);

          const backGroup = document.createElement('div');
          backGroup.className = 'input-wrapper';
          const backLabel = document.createElement('span');
          backLabel.className = 'input-label';
          backLabel.textContent = 'پشت کارت (پاسخ):';
          const backInput = document.createElement('textarea');
          backInput.className = 'text-area';
          backInput.rows = 4;
          backInput.value = text;
          backGroup.append(backLabel, backInput);

          manualContent.append(frontGroup, backGroup);

          openDialog({
            title: 'ساخت فلش‌کارت دستی از OCR',
            content: manualContent,
            actions: [
              { label: 'انصراف', variant: 'secondary' },
              {
                label: 'ذخیره کارت',
                variant: 'primary',
                onClick: async () => {
                  const frontText = frontInput.value.trim();
                  if (!frontText) return;

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
                    content: 'کارت جدید شما با موفقیت ذخیره شد.',
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
  return `شما یک دستیار هوشمند و استاد آموزشی دلسوز به زبان فارسی هستید که به کاربر در یادگیری و تسلط بر موضوعات کمک می‌کند.
موضوع مطالعه فعلی کاربر: "${categoryTitle || 'عمومی'}" ${categoryDesc ? `(توضیحات: ${categoryDesc})` : ''} است.

وظایف شما:
۱. به سوالات کاربر دقیق، روان و به زبان فارسی پاسخ دهید. از بکار بردن اصطلاحات بیجا خودداری کنید و به زبان ساده توضیح دهید.
۲. اگر کاربر از شما خواست فلش‌کارت بسازید (یا دکمه مربوطه را زد)، بر اساس مفاهیم گفتگو، بین ۱ تا ۵ فلش‌کارت باکیفیت و کلیدی تولید کنید.
۳. در صورتی که کاربر درخواست تولید فلش‌کارت داشت، علاوه بر توضیحات معمولی، حتماً فلش‌کارت‌ها را در انتهای پاسخ خود به این فرمت دقیق JSON قرار دهید تا سیستم بتواند آن‌ها را به طور تعاملی به دسته او اضافه کند:
[FLASHCARDS_JSON]
[
  {
    "front": "پرسش روی کارت (مثلا: پایتخت فرانسه چیست؟)",
    "back": "پاسخ پشت کارت (مثلا: پاریس)"
  }
]
[/FLASHCARDS_JSON]

نکته بسیار مهم: حتماً بخش JSON بین دو تگ [FLASHCARDS_JSON] و [/FLASHCARDS_JSON] باشد و فرمت معتبر JSON داشته باشد.

نکته مهم درباره فرمول‌های ریاضی داخل front و back فلش‌کارت‌ها: هر عبارت ریاضی (کسر، توان، ریشه، مجموعه، بازه، نامعادله و...) را همیشه با علامت دلار احاطه کن — برای فرمول داخل متن یک $ در ابتدا و یک $ در انتها (مثلاً $n(A \\cup B) = n(A) + n(B) - n(A \\cap B)$) و از دستورات استاندارد LaTeX مثل \\frac{}{}, ^{}, _{}, \\sqrt{}, \\cup, \\cap, \\in, \\leq, \\geq, \\infty, \\alpha و مشابه آن استفاده کن. بازه‌های عددی مثل [a, b) را به شکل معمولی و فقط داخل $...$ بنویس.

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
در بلاک‌های physics توضیحات اضافه ننویسید.`;
};

export async function renderAI(container) {
  container.innerHTML = '';
  
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; height:calc(100vh - 140px); width:100%; max-width:var(--max-content-w); margin:0 auto; gap:var(--space-2); box-sizing:border-box; min-width:0; position:relative;';
  container.appendChild(wrap);

  // --- Sidebar Overlay ---
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:998; background:rgba(0,0,0,0.5); opacity:0; pointer-events:none; transition:opacity 0.3s ease;';
  document.body.appendChild(overlay);

  // --- Sidebar Drawer ---
  const sidebar = document.createElement('div');
  sidebar.style.cssText = 'position:fixed; top:0; bottom:0; left:0; width:300px; max-width:80vw; z-index:999; background:color-mix(in srgb, var(--bg-card) 85%, transparent); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); transform:translateX(-100%); transition:transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 4px 0 24px rgba(0,0,0,0.1); display:flex; flex-direction:column; padding:var(--space-3); gap:var(--space-3);';
  
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

  // Disconnect sidebar on unmount
  const originalAppend = container.appendChild;
  container.appendChild = function(node) {
     return originalAppend.call(this, node);
  };
  const cleanup = () => {
     if (document.body.contains(sidebar)) document.body.removeChild(sidebar);
     if (document.body.contains(overlay)) document.body.removeChild(overlay);
  };
  // We can just rely on router clearing the container, but since we attached to body:
  const mo = new MutationObserver(() => {
     if (!document.body.contains(container) || !container.contains(wrap)) {
        cleanup();
        mo.disconnect();
     }
  });
  mo.observe(document.body, {childList: true, subtree: true});

  // Hook up global menu button
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
    convs.sort((a,b) => b.updatedAt - a.updatedAt);
    
    for (const conv of convs) {
      const item = document.createElement('div');
      item.style.cssText = 'padding:var(--space-2); border-radius:var(--radius-card); background:var(--bg-secondary); cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background 0.2s; position:relative;';
      
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = 'flex:1; min-width:0;';
      
      const catText = conv.categoryId ? ((await categoryRepository.getById(conv.categoryId))?.title || 'نامشخص') : 'عمومی';
      const titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-weight:700; font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
      titleEl.textContent = `${catText}: ${conv.topic || 'چت'}`;
      
      const dateEl = document.createElement('div');
      dateEl.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-top:2px;';
      dateEl.textContent = new Date(conv.updatedAt || conv.createdAt).toLocaleDateString('fa-IR');
      
      contentDiv.append(titleEl, dateEl);
      item.appendChild(contentDiv);
      
      // Long press for delete
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

  // Removed topBar implementation

  // Chat conversation list
  const chatList = document.createElement('div');
  chatList.style.cssText = 'flex-grow:1; overflow-y:auto; padding:var(--space-2) 0; display:flex; flex-direction:column; gap:var(--space-3);';
  wrap.appendChild(chatList);


  // Attachment file input (hidden)
  const fileSelector = document.createElement('input');
  fileSelector.type = 'file';
  fileSelector.multiple = true;
  fileSelector.accept = 'image/*,application/pdf,text/*,audio/*';
  fileSelector.style.display = 'none';
  wrap.appendChild(fileSelector);

  // Active attachment list container
  const attachmentListContainer = document.createElement('div');
  attachmentListContainer.style.cssText = 'display:flex; flex-wrap:wrap; gap:var(--space-2); width:100%; box-sizing:border-box;';
  wrap.appendChild(attachmentListContainer);

  // Footer text area input
  const inputContainer = document.createElement('div');
  inputContainer.style.cssText = 'display:flex; align-items:flex-end; gap:var(--space-2); padding:var(--space-1) var(--space-1); background: color-mix(in srgb, var(--bg-card) 60%, transparent); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1.5px solid var(--border-soft); border-radius: 28px; box-shadow: 0 8px 32px rgba(0,0,0,0.06); width:100%; box-sizing:border-box; min-width:0; margin-top: auto; margin-bottom: var(--space-2);';

  const attachBtn = createButton({
    label: '',
    icon: 'add',
    variant: 'text',
    onClick: () => fileSelector.click()
  });
  attachBtn.style.cssText += '; width:40px; height:40px; border-radius:20px; display:flex; align-items:center; justify-content:center; padding:0; flex-shrink:0; color:var(--text-secondary); margin-bottom: 2px; margin-right: 4px; transition: background 0.2s, color 0.2s;';
  
  attachBtn.addEventListener('mouseenter', () => { attachBtn.style.background = 'var(--bg-sunken)'; attachBtn.style.color = 'var(--color-primary)'; });
  attachBtn.addEventListener('mouseleave', () => { attachBtn.style.background = 'transparent'; attachBtn.style.color = 'var(--text-secondary)'; });

  const inputField = createTextArea({
    placeholder: 'پیام خود را بنویسید...',
    rows: 1
  });
  inputField.style.cssText += '; flex-grow:1; min-width:0; margin-bottom:2px;';
  inputField.input.style.cssText = 'width: 100%; box-sizing: border-box; resize: none; min-height: 40px; height: 40px; padding: 9px 8px; overflow-y: hidden; max-height: 150px; line-height: 1.5; border: none; background-color: transparent; color: var(--text-primary); font-family: inherit; font-size: 15px; outline: none; box-shadow: none;';

  // Set up auto-resizing
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
  inputField.input.addEventListener('input', adjustInputHeight);

  const sendBtn = createButton({
    label: '',
    icon: 'arrow_upward',
    variant: 'primary',
    onClick: () => handleSend()
  });
  sendBtn.style.cssText += '; width:40px; height:40px; border-radius:20px; display:flex; align-items:center; justify-content:center; padding:0; flex-shrink:0; margin-bottom: 2px; margin-left: 4px; box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 30%, transparent);';

  inputContainer.append(attachBtn, inputField, sendBtn);
  wrap.appendChild(inputContainer);

  // Local state
  let currentCategoryId = 'general';
  let activeConversation = null;
  let selectedAttachments = [];

  // Helper to format bytes
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Update attachments chips UI
  function updateAttachmentsUI() {
    attachmentListContainer.innerHTML = '';
    if (selectedAttachments.length === 0) {
      attachmentListContainer.style.padding = '0';
      return;
    }
    attachmentListContainer.style.padding = 'var(--space-2) 0';

    selectedAttachments.forEach((file, idx) => {
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); background:var(--color-primary-soft); border:1px solid var(--border-subtle); padding:var(--space-1) var(--space-2); border-radius:16px; font-size:11px; max-width:200px; color:var(--text-primary); transition:all 0.2s; position:relative;';

      const preview = document.createElement('div');
      preview.style.cssText = 'width:24px; height:24px; border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:var(--bg-card);';
      if (file.mimeType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = file.dataUrl;
        img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
        preview.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'material-symbols-rounded';
        icon.style.cssText = 'font-size:16px; color:var(--color-primary);';
        if (file.mimeType === 'application/pdf') {
          icon.textContent = 'picture_as_pdf';
        } else if (file.mimeType.startsWith('audio/')) {
          icon.textContent = 'audio_file';
        } else {
          icon.textContent = 'description';
        }
        preview.appendChild(icon);
      }

      const nameLabel = document.createElement('span');
      nameLabel.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-grow:1; direction:ltr; text-align:right; font-weight:600;';
      nameLabel.textContent = file.name;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'material-symbols-rounded';
      removeBtn.textContent = 'close';
      removeBtn.style.cssText = 'font-size:14px; border:none; background:transparent; color:var(--text-secondary); cursor:pointer; padding:2px; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:background 0.2s;';
      removeBtn.addEventListener('mouseenter', () => {
        removeBtn.style.background = 'var(--color-danger-soft)';
        removeBtn.style.color = 'var(--color-danger)';
      });
      removeBtn.addEventListener('mouseleave', () => {
        removeBtn.style.background = 'transparent';
        removeBtn.style.color = 'var(--text-secondary)';
      });
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedAttachments.splice(idx, 1);
        updateAttachmentsUI();
      });

      chip.append(preview, nameLabel, removeBtn);
      attachmentListContainer.appendChild(chip);
    });
  }

  // Handle files selected
  fileSelector.addEventListener('change', async () => {
    const files = Array.from(fileSelector.files);
    fileSelector.value = '';

    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        openDialog({
          title: 'حجم فایل بسیار زیاد است',
          body: `فایل "${file.name}" بزرگتر از حد مجاز (۲۰ مگابایت) است.`,
          actions: [{ label: 'متوجه شدم', variant: 'primary' }]
        });
        continue;
      }

      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const base64Data = dataUrl.split(',')[1];
        selectedAttachments.push({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          data: base64Data,
          dataUrl: dataUrl
        });
      } catch (err) {
        console.error('Error reading file:', err);
      }
    }
    updateAttachmentsUI();
  });

  // Handle enter key on input field (Send on Enter, New line on Shift+Enter - Desktop only)
  inputField.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.matchMedia('(max-width: 768px)').matches;
      if (!isMobile) {
        e.preventDefault();
        handleSend();
      }
    }
  });

  // Initial prompt setup
  await loadConversation();

  async function loadConversation() {
    chatList.innerHTML = '';
    
    // We already have activeConversation set when selecting from sidebar.
    // If we're just loading the page for the first time, activeConversation is null,
    // so we just show the greeting. We do NOT auto-load the latest chat for the category anymore.
    
    if (!activeConversation) {
      renderGreeting();
    } else {
      for (const msg of activeConversation.messages) {
        renderMessage(msg.sender, msg.text, msg.attachments);
      }
      chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });
    }
  }

  function renderGreeting() {
    chatList.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex; flex-direction:column; flex:1; align-items:center; justify-content:center; padding:var(--space-4); animation: slideUp 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; opacity: 0; gap: var(--space-4);';
    
    const animContainer = document.createElement('div');
    animContainer.style.cssText = 'display:flex; align-items:center; justify-content:center; margin-bottom:var(--space-2);';
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

    inputField.input.value = '';
    inputField.input.focus();
    adjustInputHeight();

    // Clear welcome greeting if first message
    if (!activeConversation) {
      chatList.innerHTML = '';
    }

    const msgAttachments = [...selectedAttachments];
    selectedAttachments = [];
    updateAttachmentsUI();

    // Render User message
    renderMessage('user', text, msgAttachments);
    chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });

    // Save user message to IndexedDB
    const dbCatId = currentCategoryId === 'general' ? null : currentCategoryId;
    let isFirstMessage = false;
    if (!activeConversation) {
      isFirstMessage = true;
      activeConversation = createAiConversationModel({
        categoryId: dbCatId,
        messages: []
      });
      await aiConversationRepository.create(activeConversation);
    }
    activeConversation.messages.push({
      sender: 'user',
      text,
      attachments: msgAttachments,
      timestamp: new Date().toISOString()
    });
    await aiConversationRepository.update(activeConversation.id, { messages: activeConversation.messages });

    if (isFirstMessage) {
      setTimeout(async () => {
        try {
          const { callGeminiAPI } = await import('../core/gemini-client.js');
          const apiKey = await settingsRepository.getSetting('gemini_api_key', '');
          const modelName = await settingsRepository.getSetting('gemini_model', '');
          const topicResp = await callGeminiAPI([
            {role: 'user', parts: [{text: `موضوع این مکالمه را در حداکثر ۴ کلمه بیان کن. فقط کلمات موضوع را بنویس بدون هیچ توضیح اضافه‌ای: "${text}"`}]}
          ], { model: modelName || 'gemini-2.5-flash' }, apiKey);
          if (topicResp) {
            const topicText = topicResp.candidates[0].content.parts[0].text.trim();
            activeConversation.topic = topicText.replace(/['"]/g, '');
            await aiConversationRepository.update(activeConversation.id, { topic: activeConversation.topic });
          }
        } catch(e) {
          console.error('Topic extraction failed', e);
        }
      }, 0);
    }

    // Render Loading indicator for assistant
    const loadBubble = renderLoadingBubble();
    chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });

    // Call API
    try {
      const activeCat = dbCatId ? await categoryRepository.getById(dbCatId) : null;
      
      const apiKey = await db.getSetting('gemini_api_key', '');
      const preferredModel = await db.getSetting('gemini_model', '');
      const customInstruction = await db.getSetting('gemini_system_instruction', '');

      let systemInstruction = getSystemInstruction(activeCat ? activeCat.title : null, activeCat ? activeCat.description : null);
      if (customInstruction) {
        systemInstruction = customInstruction + "\n\n" + systemInstruction;
      }

      const { chatWithGemini } = await import('../core/gemini-client.js');
      const resData = await chatWithGemini({
        apiKey: apiKey || undefined,
        model: preferredModel || undefined,
        message: text,
        history: activeConversation.messages.slice(0, -1),
        systemInstruction,
        attachments: msgAttachments
      });

      loadBubble.remove();

      // Render Gemini response
      renderMessage('ai', resData.text);
      chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });

      // Save assistant message to IndexedDB
      activeConversation.messages.push({ sender: 'ai', text: resData.text, timestamp: new Date().toISOString() });
      await aiConversationRepository.update(activeConversation.id, { messages: activeConversation.messages });

    } catch (err) {
      console.error(err);
      loadBubble.remove();
      renderMessage('system_error', err.message || 'مشکلی در اتصال به دستیار هوشمند به وجود آمد.');
      chatList.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });
    }
  }

  function renderLoadingBubble() {
    const bubble = document.createElement('div');
    bubble.style.cssText = 'align-self:flex-start; background:var(--bg-card); border:1px solid var(--border-subtle); padding:var(--space-3); border-radius:16px 16px 16px 4px; display:flex; align-items:center; gap:var(--space-2); max-width:80%;';
    
    const text = document.createElement('span');
    text.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); font-weight:700;';
    text.textContent = 'درحال نوشتن پاسخ…';

    const spinner = createLoadingInline();
    bubble.append(spinner, text);
    chatList.appendChild(bubble);
    return bubble;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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

    // Normalize exponent representations to X2 and X1
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
          if (key === 'title') {
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
    const cards = parent.querySelectorAll('.interactive-plot-card');
    cards.forEach((card) => {
      const specStr = card.getAttribute('data-spec') || card.getAttribute('data-equation');
      const spec = parsePlotSpec(specStr);

      const eqDisplay = card.querySelector('.eq-display');
      if (eqDisplay) {
        let displayHtml = '';
        if (spec.equations.length === 1) {
          const eq = spec.equations[0];
          const rawEq = eq.raw || '';
          const cleanRaw = rawEq.toLowerCase().startsWith('y=') ? rawEq : 'y = ' + rawEq;
          displayHtml = `<span style="color: ${eq.color}; font-weight: 800;">${escapeHtml(cleanRaw)}</span>`;
        } else if (spec.equations.length > 1) {
          displayHtml = spec.equations.map(eq => {
            const rawEq = eq.raw || '';
            const cleanRaw = rawEq.toLowerCase().startsWith('y=') ? rawEq : 'y = ' + rawEq;
            return `<span style="color: ${eq.color}; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: 800; border: 1px solid var(--border-soft); margin-left: 4px;">${escapeHtml(cleanRaw)}</span>`;
          }).join('');
        } else {
          displayHtml = '<span style="color: var(--text-secondary); font-size: 12px;">بدون معادله</span>';
        }
        eqDisplay.innerHTML = displayHtml;
      }

      const adjusterPanel = card.querySelector('.plot-adjuster-panel');
      if (adjusterPanel && spec.equations.length > 1) {
        adjusterPanel.style.display = 'none';
      }
      
      const svg = card.querySelector('.plot-svg');
      const gridLinesG = svg.querySelector('.grid-lines');
      const majorGridLinesG = svg.querySelector('.major-grid-lines');
      const ticksG = svg.querySelector('.axis-ticks');
      const plotsPathsG = svg.querySelector('.plots-paths');
      const plotsPointsG = svg.querySelector('.plots-points');
      
      const hoverTrackerX = svg.querySelector('.hover-tracker-x');
      const hoverTrackerY = svg.querySelector('.hover-tracker-y');
      const hoverDot = svg.querySelector('.hover-dot');
      const hoverCoords = card.querySelector('.hover-coords');
      const svgContainer = card.querySelector('.svg-container');

      const zoomInBtn = card.querySelector('.zoom-in-btn');
      const zoomOutBtn = card.querySelector('.zoom-out-btn');

      const coeffAValSpan = card.querySelector('.coeff-a-value');
      const slopeValSpan = card.querySelector('.slope-value');
      const interceptValSpan = card.querySelector('.intercept-value');
      
      const coeffADn = card.querySelector('.coeff-a-dn-btn');
      const coeffAUp = card.querySelector('.coeff-a-up-btn');
      const slopeDn = card.querySelector('.slope-dn-btn');
      const slopeUp = card.querySelector('.slope-up-btn');
      const interceptDn = card.querySelector('.intercept-dn-btn');
      const interceptUp = card.querySelector('.intercept-up-btn');

      let zoom = 1.0;
      
      let a = 0, b = 0, c = 0;
      if (spec.equations.length === 1) {
        a = spec.equations[0].a;
        b = spec.equations[0].b;
        c = spec.equations[0].c;
      }

      function draw() {
        const pixelsPerUnit = 15 * zoom;
        const maxVisibleUnit = Math.ceil(150 / pixelsPerUnit);
        let stepUnit = 1;
        if (zoom < 0.4) stepUnit = 5;
        else if (zoom < 0.8) stepUnit = 2;
        else if (zoom > 2.2) stepUnit = 0.5;

        let gridLinesHtml = '';
        let majorGridLinesHtml = '';
        let ticksHtml = '';

        for (let i = -maxVisibleUnit; i <= maxVisibleUnit; i += stepUnit) {
          if (i === 0) continue;
          const pos = i * pixelsPerUnit;
          gridLinesHtml += `<line x1="${pos}" y1="-150" x2="${pos}" y2="150" />`;
          gridLinesHtml += `<line x1="-150" y1="${pos}" x2="150" y2="${pos}" />`;

          const isMajor = (stepUnit === 0.5 && Number.isInteger(i)) || 
                          (stepUnit === 1 && i % 2 === 0) || 
                          (stepUnit === 2 && i % 4 === 0) || 
                          (stepUnit === 5 && i % 10 === 0);

          if (isMajor) {
            majorGridLinesHtml += `<line x1="${pos}" y1="-150" x2="${pos}" y2="150" />`;
            majorGridLinesHtml += `<line x1="-150" y1="${pos}" x2="150" y2="${pos}" />`;
            ticksHtml += `<text x="${pos}" y="12" style="font-weight:700;">${i}</text>`;
            ticksHtml += `<text x="-12" y="${-pos}" style="font-weight:700;">${i}</text>`;
          } else {
            ticksHtml += `<text x="${pos}" y="10" font-size="8">${i}</text>`;
            ticksHtml += `<text x="-10" y="${-pos}" font-size="8">${i}</text>`;
          }
        }
        gridLinesG.innerHTML = gridLinesHtml;
        majorGridLinesG.innerHTML = majorGridLinesHtml;
        ticksG.innerHTML = ticksHtml;

        let equationsToDraw = spec.equations;
        if (spec.equations.length === 1 && coeffAValSpan) {
          equationsToDraw = [{
            a: a,
            b: b,
            c: c,
            color: spec.equations[0].color
          }];
          if (coeffAValSpan) coeffAValSpan.textContent = a.toFixed(1).replace('.0', '');
          if (slopeValSpan) slopeValSpan.textContent = b.toFixed(1).replace('.0', '');
          if (interceptValSpan) interceptValSpan.textContent = c.toFixed(1).replace('.0', '');
        }

        let pathsHtml = '';
        equationsToDraw.forEach((eq) => {
          let pathD = '';
          const step = 0.2 / zoom;
          let isFirst = true;
          for (let xVal = -maxVisibleUnit - 1; xVal <= maxVisibleUnit + 1; xVal += step) {
            const yVal = eq.a * xVal * xVal + eq.b * xVal + eq.c;
            const svgX = xVal * pixelsPerUnit;
            const svgY = -yVal * pixelsPerUnit;
            if (svgX < -160 || svgX > 160 || svgY < -160 || svgY > 160) {
              isFirst = true;
              continue;
            }
            if (isFirst) {
              pathD += `M ${svgX} ${svgY}`;
              isFirst = false;
            } else {
              pathD += ` L ${svgX} ${svgY}`;
            }
          }
          if (pathD) {
            pathsHtml += `<path d="${pathD}" stroke="${eq.color}" stroke-width="3" stroke-linecap="round" fill="none" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.15));" />`;
          }
        });
        if (plotsPathsG) {
          plotsPathsG.innerHTML = pathsHtml;
        }

        let pointsHtml = '';
        spec.points.forEach((pt) => {
          const svgX = pt.x * pixelsPerUnit;
          const svgY = -pt.y * pixelsPerUnit;
          if (svgX >= -150 && svgX <= 150 && svgY >= -150 && svgY <= 150) {
            pointsHtml += `
              <g class="plot-point-g" style="cursor: pointer;">
                <circle cx="${svgX}" cy="${svgY}" r="5" fill="${pt.color}" stroke="#FFFFFF" stroke-width="1.5" style="filter: drop-shadow(0 0 4px ${pt.color});" />
                <text x="${svgX + 8}" y="${svgY - 4}" fill="${pt.color}" font-size="10" font-weight="800" text-anchor="start">${escapeHtml(pt.label)} (${pt.x}, ${pt.y})</text>
              </g>
            `;
          }
        });
        if (plotsPointsG) {
          plotsPointsG.innerHTML = pointsHtml;
        }
      }

      if (coeffADn) coeffADn.addEventListener('click', () => { a -= 0.5; draw(); });
      if (coeffAUp) coeffAUp.addEventListener('click', () => { a += 0.5; draw(); });
      if (slopeDn) slopeDn.addEventListener('click', () => { b -= 0.5; draw(); });
      if (slopeUp) slopeUp.addEventListener('click', () => { b += 0.5; draw(); });
      if (interceptDn) interceptDn.addEventListener('click', () => { c -= 1; draw(); });
      if (interceptUp) interceptUp.addEventListener('click', () => { c += 1; draw(); });

      if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
          zoom = Math.min(5.0, zoom * 1.25);
          draw();
        });
      }
      if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
          zoom = Math.max(0.2, zoom / 1.25);
          draw();
        });
      }

      let initialPinchDistance = null;
      let initialZoom = 1.0;

      function getTouchDistance(e) {
        if (e.touches.length < 2) return 0;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      svgContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          initialPinchDistance = getTouchDistance(e);
          initialZoom = zoom;
          e.preventDefault();
        }
      }, { passive: false });

      svgContainer.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDistance !== null) {
          e.preventDefault();
          const currentDistance = getTouchDistance(e);
          if (currentDistance > 0) {
            const ratio = currentDistance / initialPinchDistance;
            zoom = Math.max(0.2, Math.min(5.0, initialZoom * ratio));
            draw();
          }
        } else if (e.touches.length === 1) {
          handleHover(e.touches[0]);
        }
      }, { passive: false });

      svgContainer.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
          initialPinchDistance = null;
        }
        if (e.touches.length === 0) {
          hideHover();
        }
      });

      svgContainer.addEventListener('mousemove', handleHover);
      svgContainer.addEventListener('mouseleave', hideHover);

      function handleHover(e) {
        const rect = svgContainer.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;

        const svgX = (clientX / rect.width) * 300 - 150;
        const pixelsPerUnit = 15 * zoom;
        const mathX = svgX / pixelsPerUnit;

        const maxVisibleUnit = 150 / pixelsPerUnit;
        if (mathX < -maxVisibleUnit || mathX > maxVisibleUnit) {
          hideHover();
          return;
        }

        let mathY = 0;
        let activeColor = 'var(--color-primary)';
        if (spec.equations.length > 0) {
          const firstEq = (spec.equations.length === 1 && coeffAValSpan) ? { a, b, c } : spec.equations[0];
          mathY = firstEq.a * mathX * mathX + firstEq.b * mathX + firstEq.c;
          activeColor = spec.equations[0].color || activeColor;
        }
        const svgY = -mathY * pixelsPerUnit;

        if (svgY < -150 || svgY > 150) {
          hideHover();
          return;
        }

        hoverTrackerX.setAttribute('x1', svgX);
        hoverTrackerX.setAttribute('x2', svgX);
        hoverTrackerX.setAttribute('stroke', activeColor);
        hoverTrackerX.style.display = 'block';

        hoverTrackerY.setAttribute('y1', svgY);
        hoverTrackerY.setAttribute('y2', svgY);
        hoverTrackerY.setAttribute('stroke', activeColor);
        hoverTrackerY.style.display = 'block';

        hoverDot.setAttribute('cx', svgX);
        hoverDot.setAttribute('cy', svgY);
        hoverDot.setAttribute('fill', activeColor);
        hoverDot.style.display = 'block';

        hoverCoords.style.opacity = '1';
        hoverCoords.textContent = `(x: ${mathX.toFixed(1).replace('.0', '')}, y: ${mathY.toFixed(1).replace('.0', '')})`;
      }

      function hideHover() {
        hoverTrackerX.style.display = 'none';
        hoverTrackerY.style.display = 'none';
        hoverDot.style.display = 'none';
        hoverCoords.style.opacity = '0';
      }

      draw();
    });
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

  function evaluateSetExpression(expr, hasA, hasB, hasC = false, hasD = false) {
    try {
      let clean = expr.toLowerCase().trim();
      // 1. Complement after closing parenthesis: (x)' or (x)c
      // Loop to handle nested parenthesis from inside out
      let prev = '';
      while (clean !== prev) {
        prev = clean;
        clean = clean.replace(/\(([^()]+)\)['’c]/gi, '!($1)');
      }
      // 2. Complement after variable: a' or ac
      clean = clean.replace(/\b([a-d])['’c]/gi, '!$1');
      // 3. Subtraction operator: X - Y
      clean = clean.replace(/\s*-\s*([a-d]|\()/gi, ' && !$1');
      // 4. Union operators (u, ∪, +, or, |)
      clean = clean.replace(/[∪u+|]|\bor\b/gi, ' || ');
      // 5. Intersection operators (n, ∩, *, and, &)
      clean = clean.replace(/[∩n*&]|\band\b/gi, ' && ');
      // 6. Map variables to actual boolean values
      clean = clean.replace(/\ba\b/gi, hasA ? 'true' : 'false');
      clean = clean.replace(/\bb\b/gi, hasB ? 'true' : 'false');
      clean = clean.replace(/\bc\b/gi, hasC ? 'true' : 'false');
      clean = clean.replace(/\bd\b/gi, hasD ? 'true' : 'false');
      
      // Safely evaluate containing only boolean operators and literals
      if (/^[truefals!&|()\s]+$/.test(clean)) {
        return Function(`"use strict"; return (${clean});`)();
      }
      return false;
    } catch (e) {
      console.error('Error evaluating set expression:', expr, e);
      return false;
    }
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
        if (key === 'title') {
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
      const [keyPart, ...valParts] = line.split(':');
      const key = keyPart.trim();
      const val = valParts.join(':').trim();
      
      if (key === 'title') {
        spec.title = val;
      } else if (key === 'node') {
        const parts = val.split('|').map(s => s.trim());
        if (parts.length >= 2) {
          const id = parts[0];
          const parent = parts[1] === 'root' || parts[1] === '' ? null : parts[1];
          spec.nodes.push({ id, parent });
        } else if (parts.length === 1) {
          spec.nodes.push({ id: parts[0], parent: null });
        }
      }
    }
    return spec;
  }

  function downloadSvgAsPng(svgElement, filename) {
    const svgClone = svgElement.cloneNode(true);
    
    // Replace CSS variables with computed values
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
    
    img.onload = () => {
      ctx.fillStyle = bgCard;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, width * scale, height * scale);
      URL.revokeObjectURL(url);
      
      const a = document.createElement('a');
      a.download = `${filename}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = url;
  }

  function initMindmaps(parent) {
    const cards = parent.querySelectorAll('.interactive-mindmap-card');
    cards.forEach(card => {
      const specStr = card.getAttribute('data-spec');
      const spec = parseMindmapSpec(specStr);
      
      card.style.cursor = 'pointer';
      card.style.transition = 'transform 0.2s, box-shadow 0.2s';
      card.onmouseenter = () => {
        card.style.transform = 'translateY(-2px)';
        card.style.boxShadow = '0 6px 16px rgba(0,0,0,0.06)';
      };
      card.onmouseleave = () => {
        card.style.transform = 'none';
        card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.03)';
      };
      
      const titleEl = card.querySelector('.mindmap-title-display');
      if (titleEl) titleEl.textContent = spec.title;
      
      const container = card.querySelector('.mindmap-svg-container');
      if (!container) return;
      container.innerHTML = '';
      
      if (spec.nodes.length === 0) return;
      
      // For width, we take the offsetWidth of the card, but fallback to 320
      const width = card.offsetWidth > 0 ? card.offsetWidth - 32 : 320; 
      const dx = 35; // vertical spacing between nodes
      const dy = Math.min(width / 3, 120); // horizontal spacing
      
      // Ensure there's only one root
      let rootNodes = spec.nodes.filter(n => !n.parent);
      if (rootNodes.length === 0) {
         spec.nodes[0].parent = null;
      } else if (rootNodes.length > 1) {
         spec.nodes.push({ id: 'VirtualRoot', parent: null });
         rootNodes.forEach(n => n.parent = 'VirtualRoot');
      }
      
      try {
        const root = d3.stratify()
            .id(d => d.id)
            .parentId(d => d.parent)
            (spec.nodes);
        
        const tree = d3.tree().nodeSize([dx, dy]);
        tree(root);
        
        let x0 = Infinity;
        let x1 = -x0;
        let y1 = -Infinity;
        root.each(d => {
          if (d.x > x1) x1 = d.x;
          if (d.x < x0) x0 = d.x;
          if (d.y > y1) y1 = d.y;
        });
        
        const height = x1 - x0 + dx * 2;
        const treeWidth = y1 + dy;
        const finalWidth = Math.max(width, treeWidth);
        
        const svg = d3.select(container).append('svg')
            .attr('width', finalWidth)
            .attr('height', height)
            .attr('viewBox', `${-dx},${x0 - dx},${finalWidth},${height}`)
            .attr('style', 'max-width: 100%; height: auto; font-family: var(--font-mono); direction: ltr;');
            
        // Links
        svg.append('g')
            .attr('fill', 'none')
            .attr('stroke', 'var(--border-strong)')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 2)
          .selectAll()
          .data(root.links())
          .join('path')
            .attr('d', d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x));
                
        const node = svg.append('g')
            .attr('stroke-linejoin', 'round')
            .attr('stroke-width', 3)
          .selectAll()
          .data(root.descendants())
          .join('g')
            .attr('transform', d => `translate(${d.y},${d.x})`);
            
        node.append('circle')
            .attr('fill', d => d.children ? 'var(--color-primary)' : 'var(--bg-card)')
            .attr('stroke', 'var(--color-primary)')
            .attr('stroke-width', 2)
            .attr('r', 5);
            
        node.append('text')
            .attr('dy', '0.31em')
            .attr('x', d => d.children ? -8 : 8)
            .attr('text-anchor', d => d.children ? 'end' : 'start')
            .attr('fill', 'var(--text-primary)')
            .attr('font-weight', d => d.children ? 800 : 600)
            .attr('font-size', '13')
            .text(d => d.data.id === 'VirtualRoot' ? '' : toPersianDigits(d.data.id))
          .clone(true).lower()
            .attr('stroke', 'var(--bg-card)')
            .attr('stroke-width', 4);
            
        card.addEventListener('click', () => {
          const clonedSvg = container.querySelector('svg').cloneNode(true);
          clonedSvg.style.width = '100%';
          clonedSvg.style.height = '100%';
          clonedSvg.style.maxWidth = 'none';
          
          const wrapper = document.createElement('div');
          wrapper.style.cssText = 'width: 100%; height: 60vh; overflow: auto; display: flex; justify-content: center; align-items: center; background: var(--bg-sunken); border-radius: 8px; border: 1px solid var(--border-subtle); padding: var(--space-3); box-sizing: border-box;';
          wrapper.appendChild(clonedSvg);
          
          openDialog({
            title: spec.title,
            content: wrapper,
            actions: [
              { label: 'بستن', variant: 'secondary' },
              { 
                label: 'دانلود تصویر', 
                variant: 'primary', 
                icon: 'download',
                keepOpen: true,
                onClick: () => downloadSvgAsPng(container.querySelector('svg'), spec.title)
              }
            ]
          });
        });

      } catch (e) {
        console.error('Mindmap error', e);
        container.innerHTML = '<div style="padding:16px; color:var(--color-danger); text-align:center;">خطا در رسم نمودار: ارتباطات گره‌ها نامعتبر است.</div>';
      }
    });
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

  function initPhysicsSimulations(parent) {
    const cards = parent.querySelectorAll('.interactive-physics-card');
    cards.forEach(card => {
      const specStr = card.getAttribute('data-spec');
      const spec = parsePhysicsSpec(specStr);
      
      card.style.cursor = 'pointer';
      card.style.transition = 'transform 0.2s, box-shadow 0.2s';
      card.onmouseenter = () => {
        card.style.transform = 'translateY(-2px)';
        card.style.boxShadow = '0 6px 16px rgba(0,0,0,0.06)';
      };
      card.onmouseleave = () => {
        card.style.transform = 'none';
        card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.03)';
      };

      const titleEl = card.querySelector('.physics-title-display');
      if (titleEl) titleEl.textContent = spec.title;
      
      const container = card.querySelector('.physics-svg-container');
      if (!container) return;
      container.innerHTML = '';
      
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 400 300");
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.display = "block";
      container.appendChild(svg);
      
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      svg.appendChild(g);
      
      if (spec.type === 'projectile') {
        const theta = spec.angle * Math.PI / 180;
        const v0 = spec.v0 || 10;
        const gAcc = spec.g || 9.8;
        const h0 = spec.h0 || 0;
        
        // Calculate max values
        const tMax = (v0 * Math.sin(theta) + Math.sqrt(Math.pow(v0 * Math.sin(theta), 2) + 2 * gAcc * h0)) / gAcc;
        const xMax = v0 * Math.cos(theta) * tMax;
        const yMax = h0 + Math.pow(v0 * Math.sin(theta), 2) / (2 * gAcc);
        
        // Scale to fit
        const pad = 30;
        const drawW = 400 - 2 * pad;
        const drawH = 300 - 2 * pad;
        
        // We want origin at bottom left
        const scaleX = xMax > 0 ? drawW / xMax : 1;
        const scaleY = yMax > 0 ? drawH / (yMax * 1.2) : 1;
        const scale = Math.min(scaleX, scaleY);
        
        // Draw Axes
        const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
        xAxis.setAttribute("x1", pad);
        xAxis.setAttribute("y1", 300 - pad);
        xAxis.setAttribute("x2", 400 - pad);
        xAxis.setAttribute("y2", 300 - pad);
        xAxis.setAttribute("stroke", "var(--border-strong)");
        xAxis.setAttribute("stroke-width", "2");
        g.appendChild(xAxis);
        
        const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
        yAxis.setAttribute("x1", pad);
        yAxis.setAttribute("y1", pad);
        yAxis.setAttribute("x2", pad);
        yAxis.setAttribute("y2", 300 - pad);
        yAxis.setAttribute("stroke", "var(--border-strong)");
        yAxis.setAttribute("stroke-width", "2");
        g.appendChild(yAxis);
        
        // Draw Trajectory path
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        let d = `M ${pad} ${300 - pad - h0 * scale}`;
        const steps = 100;
        for (let i = 1; i <= steps; i++) {
          const t = (i / steps) * tMax;
          const x = v0 * Math.cos(theta) * t;
          const y = h0 + v0 * Math.sin(theta) * t - 0.5 * gAcc * t * t;
          d += ` L ${pad + x * scale} ${300 - pad - y * scale}`;
        }
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "var(--border-strong)");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-dasharray", "5,5");
        g.appendChild(path);
        
        // Draw ball
        const ball = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ball.setAttribute("r", "8");
        ball.setAttribute("fill", "var(--color-primary)");
        g.appendChild(ball);
        
        let startT = performance.now();
        const duration = 2000; // ms
        
        function animateProjectile(time) {
          let elapsed = time - startT;
          if (elapsed > duration) elapsed = duration;
          const progress = elapsed / duration;
          const currentT = progress * tMax;
          
          const x = v0 * Math.cos(theta) * currentT;
          let y = h0 + v0 * Math.sin(theta) * currentT - 0.5 * gAcc * currentT * currentT;
          if (y < 0) y = 0; // stop at floor
          
          ball.setAttribute("cx", pad + x * scale);
          ball.setAttribute("cy", 300 - pad - y * scale);
          
          if (elapsed < duration) {
            requestAnimationFrame(animateProjectile);
          } else {
            // Loop animation
            setTimeout(() => {
              startT = performance.now();
              requestAnimationFrame(animateProjectile);
            }, 1000);
          }
        }
        requestAnimationFrame(animateProjectile);
        
        // Render info
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>برد افقی: ${toPersianDigits(xMax.toFixed(2))} m</div>
                            <div>ارتفاع بیشینه: ${toPersianDigits(yMax.toFixed(2))} m</div>
                            <div>زمان پرواز: ${toPersianDigits(tMax.toFixed(2))} s</div>`;
        }
        
      } else if (spec.type === 'forces') {
        const cx = 200;
        const cy = 150;
        const theta = (spec.angle || 0) * Math.PI / 180;
        
        // Draw inclined plane
        const planeW = 300;
        const p1x = cx - (planeW/2) * Math.cos(theta);
        const p1y = cy + (planeW/2) * Math.sin(theta);
        const p2x = cx + (planeW/2) * Math.cos(theta);
        const p2y = cy - (planeW/2) * Math.sin(theta);
        
        const plane = document.createElementNS("http://www.w3.org/2000/svg", "line");
        plane.setAttribute("x1", p1x);
        plane.setAttribute("y1", p1y + 20); // slightly below
        plane.setAttribute("x2", p2x);
        plane.setAttribute("y2", p2y + 20);
        plane.setAttribute("stroke", "var(--border-strong)");
        plane.setAttribute("stroke-width", "4");
        g.appendChild(plane);
        
        // Draw ground if inclined
        if (theta > 0) {
           const ground = document.createElementNS("http://www.w3.org/2000/svg", "line");
           ground.setAttribute("x1", 50);
           ground.setAttribute("y1", p1y + 20);
           ground.setAttribute("x2", p2x);
           ground.setAttribute("y2", p1y + 20);
           ground.setAttribute("stroke", "var(--border-subtle)");
           ground.setAttribute("stroke-width", "2");
           ground.setAttribute("stroke-dasharray", "4,4");
           g.appendChild(ground);
        }
        
        // Draw box
        const bw = 50;
        const bh = 50;
        const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        box.setAttribute("width", bw);
        box.setAttribute("height", bh);
        box.setAttribute("x", -bw/2);
        box.setAttribute("y", -bh/2 - bh/2 + 20); // resting on plane
        box.setAttribute("fill", "var(--color-primary-variant)");
        box.setAttribute("stroke", "var(--color-primary)");
        box.setAttribute("stroke-width", "2");
        
        const boxG = document.createElementNS("http://www.w3.org/2000/svg", "g");
        boxG.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${-spec.angle})`);
        boxG.appendChild(box);
        g.appendChild(boxG);
        
        // Vector helper
        function drawVector(name, ox, oy, dx, dy, color) {
          const v = document.createElementNS("http://www.w3.org/2000/svg", "line");
          v.setAttribute("x1", ox);
          v.setAttribute("y1", oy);
          v.setAttribute("x2", ox + dx);
          v.setAttribute("y2", oy + dy);
          v.setAttribute("stroke", color);
          v.setAttribute("stroke-width", "3");
          v.setAttribute("marker-end", `url(#arrow-${color.replace(/[^a-z0-9]/gi,'')})`);
          g.appendChild(v);
          
          const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
          label.setAttribute("x", ox + dx + (dx>0?5:-15));
          label.setAttribute("y", oy + dy + (dy>0?15:-5));
          label.setAttribute("fill", color);
          label.setAttribute("font-size", "12");
          label.setAttribute("font-family", "var(--font-mono)");
          label.setAttribute("font-weight", "bold");
          label.textContent = name;
          g.appendChild(label);
        }
        
        // Define markers
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        svg.appendChild(defs);
        const colors = new Set(["var(--color-danger)", "var(--color-success)", "var(--color-warning)", "var(--text-primary)", "blue", "red", "green", "orange", "purple", ...spec.forces.map(f=>f.color)]);
        
        colors.forEach(c => {
          const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
          const id = `arrow-${c.replace(/[^a-z0-9]/gi,'')}`;
          marker.setAttribute("id", id);
          marker.setAttribute("viewBox", "0 0 10 10");
          marker.setAttribute("refX", "9");
          marker.setAttribute("refY", "5");
          marker.setAttribute("markerWidth", "6");
          marker.setAttribute("markerHeight", "6");
          marker.setAttribute("orient", "auto-start-reverse");
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
          path.setAttribute("fill", c);
          marker.appendChild(path);
          defs.appendChild(marker);
        });
        
        const mass = spec.mass || 10;
        const w = mass * 9.8;
        const wx = w * Math.sin(theta);
        const wy = w * Math.cos(theta);
        const normal = wy;
        
        // Base forces calculation to find friction
        let fNetX = -wx; // down the plane is negative x in local coords? Wait.
        // Let's define x positive up the plane.
        // weight x is down the plane.
        // external forces...
        
        let sumF_x = -wx;
        let sumF_y = -wy; // gravity
        
        spec.forces.forEach(f => {
          const fRad = f.angle * Math.PI / 180;
          // angle relative to horizontal ground? Prompt says "نسبت به سطح افق"
          // Let's assume angle is relative to horizontal.
          const relAngle = fRad - theta;
          sumF_x += f.mag * Math.cos(relAngle);
          sumF_y += f.mag * Math.sin(relAngle);
        });
        
        const N = Math.max(0, -sumF_y);
        const frictionMax = (spec.mu || 0) * N;
        
        let friction = 0;
        if (Math.abs(sumF_x) <= frictionMax) {
          friction = -sumF_x;
        } else {
          friction = -Math.sign(sumF_x) * frictionMax;
        }
        
        const finalNetForce = sumF_x + friction;
        const accel = finalNetForce / mass;
        
        // Draw forces from center of box (cx, cy)
        // Weight
        drawVector("W", cx, cy, 0, 60, "var(--text-primary)");
        // Normal
        drawVector("N", cx, cy, -60 * Math.sin(theta), -60 * Math.cos(theta), "var(--color-success)");
        
        // Friction
        if (Math.abs(friction) > 0.1) {
          const dir = friction > 0 ? 1 : -1;
          const fx = dir * 40 * Math.cos(theta);
          const fy = -dir * 40 * Math.sin(theta);
          drawVector("f", cx, cy, fx, fy, "var(--color-warning)");
        }
        
        // External forces
        spec.forces.forEach(f => {
          const fRad = f.angle * Math.PI / 180;
          drawVector(f.name, cx, cy, 50 * Math.cos(fRad), -50 * Math.sin(fRad), f.color);
        });
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>نیروی عمود بر سطح (N): ${toPersianDigits(N.toFixed(2))} N</div>
                            <div>نیروی اصطکاک: ${toPersianDigits(Math.abs(friction).toFixed(2))} N</div>
                            <div>نیروی برآیند: ${toPersianDigits(Math.abs(finalNetForce).toFixed(2))} N</div>
                            <div>شتاب: ${toPersianDigits(Math.abs(accel).toFixed(2))} m/s²</div>`;
        }
      } else if (spec.type === 'pendulum') {
        const length = spec.length || 2;
        const initAngle = (spec.angle || 30) * Math.PI / 180;
        const gAcc = spec.g || 9.8;
        
        // frequency
        const omega = Math.sqrt(gAcc / length);
        
        const cx = 200;
        const cy = 50;
        const scale = 150 / Math.max(1, length); // pixels per meter
        
        const ceiling = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ceiling.setAttribute("x1", cx - 50);
        ceiling.setAttribute("y1", cy);
        ceiling.setAttribute("x2", cx + 50);
        ceiling.setAttribute("y2", cy);
        ceiling.setAttribute("stroke", "var(--border-strong)");
        ceiling.setAttribute("stroke-width", "4");
        g.appendChild(ceiling);
        
        const string = document.createElementNS("http://www.w3.org/2000/svg", "line");
        string.setAttribute("x1", cx);
        string.setAttribute("y1", cy);
        string.setAttribute("stroke", "var(--text-secondary)");
        string.setAttribute("stroke-width", "2");
        g.appendChild(string);
        
        const bob = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        bob.setAttribute("r", "12");
        bob.setAttribute("fill", "var(--color-primary)");
        g.appendChild(bob);
        
        let startT = performance.now();
        
        function animatePendulum(time) {
          const t = (time - startT) / 1000;
          const currentAngle = initAngle * Math.cos(omega * t);
          
          const bx = cx + length * scale * Math.sin(currentAngle);
          const by = cy + length * scale * Math.cos(currentAngle);
          
          string.setAttribute("x2", bx);
          string.setAttribute("y2", by);
          bob.setAttribute("cx", bx);
          bob.setAttribute("cy", by);
          
          if (document.body.contains(svg)) {
            requestAnimationFrame(animatePendulum);
          }
        }
        requestAnimationFrame(animatePendulum);
        
        const T = 2 * Math.PI / omega;
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>طول آونگ: ${toPersianDigits(length.toFixed(2))} m</div>
                            <div>دوره تناوب (T): ${toPersianDigits(T.toFixed(2))} s</div>
                            <div>بسامد زاویه‌ای (ω): ${toPersianDigits(omega.toFixed(2))} rad/s</div>`;
        }
      } else if (spec.type === 'spring') {
        const mass = spec.mass || 1;
        const k = spec.k || 10;
        const x0 = spec.x0 || 0.5;
        
        const omega = Math.sqrt(k / mass);
        
        const cx = 50; // wall
        const cy = 150;
        const restLength = 150;
        const scale = 100; // pixels per meter
        
        const wall = document.createElementNS("http://www.w3.org/2000/svg", "line");
        wall.setAttribute("x1", cx);
        wall.setAttribute("y1", cy - 50);
        wall.setAttribute("x2", cx);
        wall.setAttribute("y2", cy + 50);
        wall.setAttribute("stroke", "var(--border-strong)");
        wall.setAttribute("stroke-width", "6");
        g.appendChild(wall);
        
        const floor = document.createElementNS("http://www.w3.org/2000/svg", "line");
        floor.setAttribute("x1", cx);
        floor.setAttribute("y1", cy + 30);
        floor.setAttribute("x2", 350);
        floor.setAttribute("y2", cy + 30);
        floor.setAttribute("stroke", "var(--border-subtle)");
        floor.setAttribute("stroke-width", "2");
        g.appendChild(floor);
        
        const springPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        springPath.setAttribute("fill", "none");
        springPath.setAttribute("stroke", "var(--text-secondary)");
        springPath.setAttribute("stroke-width", "2");
        g.appendChild(springPath);
        
        const block = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        block.setAttribute("width", "40");
        block.setAttribute("height", "40");
        block.setAttribute("y", cy - 10);
        block.setAttribute("fill", "var(--color-primary-variant)");
        block.setAttribute("stroke", "var(--color-primary)");
        block.setAttribute("stroke-width", "2");
        g.appendChild(block);
        
        let startT = performance.now();
        
        function animateSpring(time) {
          const t = (time - startT) / 1000;
          const currentX = x0 * Math.cos(omega * t);
          const blockX = cx + restLength + currentX * scale;
          
          block.setAttribute("x", blockX);
          
          // Draw spring coil
          const numCoils = 10;
          const coilW = (blockX - cx) / numCoils;
          let d = `M ${cx} ${cy} `;
          for (let i = 0; i < numCoils; i++) {
            d += `L ${cx + i * coilW + coilW * 0.25} ${cy - 10} `;
            d += `L ${cx + i * coilW + coilW * 0.75} ${cy + 10} `;
            d += `L ${cx + (i + 1) * coilW} ${cy} `;
          }
          springPath.setAttribute("d", d);
          
          if (document.body.contains(svg)) {
            requestAnimationFrame(animateSpring);
          }
        }
        requestAnimationFrame(animateSpring);
        
        const T = 2 * Math.PI / omega;
        const maxV = x0 * omega;
        const maxA = x0 * omega * omega;
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>دوره تناوب (T): ${toPersianDigits(T.toFixed(2))} s</div>
                            <div>بیشینه سرعت: ${toPersianDigits(maxV.toFixed(2))} m/s</div>
                            <div>بیشینه شتاب: ${toPersianDigits(maxA.toFixed(2))} m/s²</div>`;
        }
      } else if (spec.type === 'collision') {
        const m1 = spec.m1 || 1;
        const v1_init = spec.v1 || 2;
        const m2 = spec.m2 || 1;
        const v2_init = spec.v2 || -2;
        const isElastic = spec.elastic !== false;

        // Elastic collision: momentum AND kinetic energy conserved (two formulas below).
        // Perfectly inelastic collision: objects stick together and move with one
        // common final velocity (momentum conserved, kinetic energy is not).
        let v1_final, v2_final;
        if (isElastic) {
          v1_final = ((m1 - m2) * v1_init + 2 * m2 * v2_init) / (m1 + m2);
          v2_final = ((m2 - m1) * v2_init + 2 * m1 * v1_init) / (m1 + m2);
        } else {
          const vCommon = (m1 * v1_init + m2 * v2_init) / (m1 + m2);
          v1_final = vCommon;
          v2_final = vCommon;
        }
        
        const cy = 150;
        const floor = document.createElementNS("http://www.w3.org/2000/svg", "line");
        floor.setAttribute("x1", 20);
        floor.setAttribute("y1", cy + 20);
        floor.setAttribute("x2", 380);
        floor.setAttribute("y2", cy + 20);
        floor.setAttribute("stroke", "var(--border-strong)");
        floor.setAttribute("stroke-width", "2");
        g.appendChild(floor);
        
        const r1 = Math.max(10, Math.min(30, 10 + Math.sqrt(m1) * 5));
        const r2 = Math.max(10, Math.min(30, 10 + Math.sqrt(m2) * 5));
        
        const b1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        b1.setAttribute("r", r1);
        b1.setAttribute("cy", cy + 20 - r1);
        b1.setAttribute("fill", "var(--color-primary)");
        g.appendChild(b1);
        
        const l1 = document.createElementNS("http://www.w3.org/2000/svg", "text");
        l1.setAttribute("y", cy + 20 - r1 + 4);
        l1.setAttribute("text-anchor", "middle");
        l1.setAttribute("fill", "white");
        l1.setAttribute("font-size", "12");
        l1.textContent = "m1";
        g.appendChild(l1);
        
        const b2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        b2.setAttribute("r", r2);
        b2.setAttribute("cy", cy + 20 - r2);
        b2.setAttribute("fill", "var(--color-danger)");
        g.appendChild(b2);
        
        const l2 = document.createElementNS("http://www.w3.org/2000/svg", "text");
        l2.setAttribute("y", cy + 20 - r2 + 4);
        l2.setAttribute("text-anchor", "middle");
        l2.setAttribute("fill", "white");
        l2.setAttribute("font-size", "12");
        l2.textContent = "m2";
        g.appendChild(l2);
        
        let startT = performance.now();
        const scale = 30; // px per m/s
        
        function animateCollision(time) {
          let t = (time - startT) / 1000;
          if (t > 4) {
            startT = performance.now();
            t = 0;
          }
          
          let x1, x2;
          const tCol = 2;
          
          if (t < tCol) {
            x1 = 200 - r1 - (tCol - t) * v1_init * scale;
            x2 = 200 + r2 - (tCol - t) * v2_init * scale;
          } else {
            x1 = 200 - r1 + (t - tCol) * v1_final * scale;
            x2 = 200 + r2 + (t - tCol) * v2_final * scale;
          }
          
          b1.setAttribute("cx", x1);
          l1.setAttribute("x", x1);
          b2.setAttribute("cx", x2);
          l2.setAttribute("x", x2);
          
          if (document.body.contains(svg)) {
            requestAnimationFrame(animateCollision);
          }
        }
        requestAnimationFrame(animateCollision);
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>نوع برخورد: ${isElastic ? 'کشسان' : 'کاملاً نچسبان (غیرکشسان)'}</div>
                            <div>سرعت نهایی m1: ${toPersianDigits(v1_final.toFixed(2))} m/s</div>
                            <div>سرعت نهایی m2: ${toPersianDigits(v2_final.toFixed(2))} m/s</div>`;
        }
      } else if (spec.type === 'kinematics1d') {
        const v0 = spec.v0 || 0;
        const a = spec.a || 0;
        const x0 = spec.x0 || 0;

        // Pick a display duration: use the given `t`, or estimate a window
        // that shows meaningful motion when not provided.
        let duration = spec.t;
        if (!duration || duration <= 0) {
          duration = Math.abs(a) > 0.01 ? Math.max(2, Math.abs(v0 / a) * 1.5) : 4;
        }

        const posAt = (t) => x0 + v0 * t + 0.5 * a * t * t;
        // Sample the path to find the extreme x positions for scaling.
        let minX = posAt(0), maxX = posAt(0);
        const samples = 60;
        for (let i = 1; i <= samples; i++) {
          const x = posAt((i / samples) * duration);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        if (maxX - minX < 0.5) { maxX += 0.5; minX -= 0.5; }

        const railY = 150;
        const padX = 40;
        const trackW = 400 - 2 * padX;
        const scale = trackW / (maxX - minX);
        const toPx = (x) => padX + (x - minX) * scale;

        const rail = document.createElementNS("http://www.w3.org/2000/svg", "line");
        rail.setAttribute("x1", padX);
        rail.setAttribute("y1", railY);
        rail.setAttribute("x2", 400 - padX);
        rail.setAttribute("y2", railY);
        rail.setAttribute("stroke", "var(--border-strong)");
        rail.setAttribute("stroke-width", "3");
        g.appendChild(rail);

        // Tick marks every meter along the visible range for a sense of scale.
        for (let x = Math.ceil(minX); x <= Math.floor(maxX); x++) {
          const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
          tick.setAttribute("x1", toPx(x));
          tick.setAttribute("y1", railY - 6);
          tick.setAttribute("x2", toPx(x));
          tick.setAttribute("y2", railY + 6);
          tick.setAttribute("stroke", "var(--border-subtle)");
          tick.setAttribute("stroke-width", "1");
          g.appendChild(tick);
        }

        const car = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        car.setAttribute("r", "10");
        car.setAttribute("cy", railY - 10);
        car.setAttribute("fill", "var(--color-primary)");
        g.appendChild(car);

        let startT = performance.now();
        function animateKinematics(time) {
          let t = (time - startT) / 1000;
          if (t > duration) {
            startT = performance.now();
            t = 0;
          }
          car.setAttribute("cx", toPx(posAt(t)));
          if (document.body.contains(svg)) {
            requestAnimationFrame(animateKinematics);
          }
        }
        requestAnimationFrame(animateKinematics);

        const vFinal = v0 + a * duration;
        const displacement = posAt(duration) - posAt(0);
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>جابجایی: ${toPersianDigits(displacement.toFixed(2))} m</div>
                            <div>سرعت نهایی: ${toPersianDigits(vFinal.toFixed(2))} m/s</div>
                            <div>شتاب: ${toPersianDigits(a.toFixed(2))} m/s²</div>`;
        }
      } else if (spec.type === 'circular') {
        const radius = spec.radius || 2;
        const period = spec.period || 4;
        const omega = 2 * Math.PI / period;
        const v = omega * radius;
        const ac = omega * omega * radius;

        const cx = 200, cy = 150;
        const scale = Math.min(100, 110 / radius);

        const orbit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        orbit.setAttribute("cx", cx);
        orbit.setAttribute("cy", cy);
        orbit.setAttribute("r", radius * scale);
        orbit.setAttribute("fill", "none");
        orbit.setAttribute("stroke", "var(--border-subtle)");
        orbit.setAttribute("stroke-width", "2");
        orbit.setAttribute("stroke-dasharray", "4,4");
        g.appendChild(orbit);

        const center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        center.setAttribute("cx", cx);
        center.setAttribute("cy", cy);
        center.setAttribute("r", "3");
        center.setAttribute("fill", "var(--text-secondary)");
        g.appendChild(center);

        const radiusLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        radiusLine.setAttribute("x1", cx);
        radiusLine.setAttribute("y1", cy);
        radiusLine.setAttribute("stroke", "var(--border-strong)");
        radiusLine.setAttribute("stroke-width", "1.5");
        g.appendChild(radiusLine);

        const velLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        velLine.setAttribute("stroke", "var(--color-success)");
        velLine.setAttribute("stroke-width", "2.5");
        g.appendChild(velLine);

        const ball = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ball.setAttribute("r", "9");
        ball.setAttribute("fill", "var(--color-primary)");
        g.appendChild(ball);

        let startT = performance.now();
        function animateCircular(time) {
          const t = (time - startT) / 1000;
          const theta = omega * t;
          const bx = cx + radius * scale * Math.cos(theta);
          const by = cy + radius * scale * Math.sin(theta);

          radiusLine.setAttribute("x2", bx);
          radiusLine.setAttribute("y2", by);

          // Velocity vector is tangent to the circle (perpendicular to the radius).
          const tx = -Math.sin(theta), ty = Math.cos(theta);
          velLine.setAttribute("x1", bx);
          velLine.setAttribute("y1", by);
          velLine.setAttribute("x2", bx + tx * 30);
          velLine.setAttribute("y2", by + ty * 30);

          ball.setAttribute("cx", bx);
          ball.setAttribute("cy", by);

          if (document.body.contains(svg)) {
            requestAnimationFrame(animateCircular);
          }
        }
        requestAnimationFrame(animateCircular);

        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>سرعت خطی (v): ${toPersianDigits(v.toFixed(2))} m/s</div>
                            <div>سرعت زاویه‌ای (ω): ${toPersianDigits(omega.toFixed(2))} rad/s</div>
                            <div>شتاب مرکزگرا (aᶜ): ${toPersianDigits(ac.toFixed(2))} m/s²</div>`;
        }
      } else if (spec.type === 'wave') {
        const amplitude = spec.amplitude || 0.5;
        const wavelength = spec.wavelength || 4;
        const frequency = spec.frequency || 1;
        const period = 1 / frequency;
        const v = wavelength * frequency;

        const padX = 30;
        const midY = 150;
        const ampPx = 60;
        const scaleX = (400 - 2 * padX) / (wavelength * 2); // show two full wavelengths

        const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
        axis.setAttribute("x1", padX);
        axis.setAttribute("y1", midY);
        axis.setAttribute("x2", 400 - padX);
        axis.setAttribute("y2", midY);
        axis.setAttribute("stroke", "var(--border-subtle)");
        axis.setAttribute("stroke-width", "1");
        axis.setAttribute("stroke-dasharray", "3,3");
        g.appendChild(axis);

        const wavePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        wavePath.setAttribute("fill", "none");
        wavePath.setAttribute("stroke", "var(--color-primary)");
        wavePath.setAttribute("stroke-width", "2.5");
        g.appendChild(wavePath);

        // A single marked particle on the string, to visualize transverse
        // (up/down) motion versus the wave's own left-to-right propagation.
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        marker.setAttribute("r", "6");
        marker.setAttribute("fill", "var(--color-danger)");
        marker.setAttribute("cx", padX + (wavelength * 0.5) * scaleX);
        g.appendChild(marker);

        let startT = performance.now();
        function displacementAt(x, t) {
          // y = A sin(2π(x/λ - t/T)) — standard transverse traveling wave.
          return ampPx * Math.sin(2 * Math.PI * (x / wavelength - t / period));
        }
        function animateWave(time) {
          const t = (time - startT) / 1000;
          const steps = 100;
          let d = '';
          for (let i = 0; i <= steps; i++) {
            const x = (i / steps) * wavelength * 2;
            const y = displacementAt(x, t);
            d += (i === 0 ? 'M ' : 'L ') + (padX + x * scaleX) + ' ' + (midY - y) + ' ';
          }
          wavePath.setAttribute("d", d);

          const mx = wavelength * 0.5;
          marker.setAttribute("cy", midY - displacementAt(mx, t));

          if (document.body.contains(svg)) {
            requestAnimationFrame(animateWave);
          }
        }
        requestAnimationFrame(animateWave);

        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>سرعت انتشار موج (v): ${toPersianDigits(v.toFixed(2))} m/s</div>
                            <div>دوره تناوب (T): ${toPersianDigits(period.toFixed(2))} s</div>
                            <div>طول موج (λ): ${toPersianDigits(wavelength.toFixed(2))} m</div>`;
        }
      } else if (spec.type === 'circuit') {
        const voltage = spec.voltage || 12;
        const resistors = (spec.resistors && spec.resistors.length) ? spec.resistors : [10, 20];
        const rTotal = resistors.reduce((a, b) => a + b, 0);
        const current = rTotal > 0 ? voltage / rTotal : 0;

        const left = 60, right = 340, top = 70, bottom = 220;

        // Circuit rectangle (wires)
        const wire = document.createElementNS("http://www.w3.org/2000/svg", "path");
        wire.setAttribute("d", `M ${left} ${bottom} L ${left} ${top} L ${right} ${top} L ${right} ${bottom} L ${left} ${bottom}`);
        wire.setAttribute("fill", "none");
        wire.setAttribute("stroke", "var(--text-secondary)");
        wire.setAttribute("stroke-width", "2.5");
        g.appendChild(wire);

        // Battery symbol on the left wire (long line = +, short line = -)
        const battMidY = (top + bottom) / 2;
        [[-8, 14, 4], [8, 8, 2.5]].forEach(([dy, len]) => {
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", left - len / 2);
          line.setAttribute("y1", battMidY + dy);
          line.setAttribute("x2", left + len / 2);
          line.setAttribute("y2", battMidY + dy);
          line.setAttribute("stroke", "var(--text-primary)");
          line.setAttribute("stroke-width", "3");
          g.appendChild(line);
        });
        const battLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        battLabel.setAttribute("x", left - 28);
        battLabel.setAttribute("y", battMidY + 4);
        battLabel.setAttribute("font-size", "11");
        battLabel.setAttribute("fill", "var(--text-primary)");
        battLabel.setAttribute("font-weight", "700");
        battLabel.textContent = `${toPersianDigits(voltage.toFixed(1))}V`;
        g.appendChild(battLabel);

        // Resistors drawn as zigzags evenly spaced along the top wire.
        const n = resistors.length;
        const segW = (right - left) / (n + 1);
        resistors.forEach((r, i) => {
          const cxr = left + segW * (i + 1);
          const zw = Math.min(40, segW * 0.7);
          const zig = document.createElementNS("http://www.w3.org/2000/svg", "path");
          let d = `M ${cxr - zw / 2} ${top}`;
          const teeth = 4;
          for (let k = 0; k < teeth; k++) {
            const x = cxr - zw / 2 + (zw / teeth) * (k + 0.5);
            const y = top + (k % 2 === 0 ? -8 : 8);
            d += ` L ${x} ${y}`;
          }
          d += ` L ${cxr + zw / 2} ${top}`;
          zig.setAttribute("d", d);
          zig.setAttribute("fill", "none");
          zig.setAttribute("stroke", "var(--color-warning)");
          zig.setAttribute("stroke-width", "2.5");
          g.appendChild(zig);

          const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
          label.setAttribute("x", cxr);
          label.setAttribute("y", top - 14);
          label.setAttribute("font-size", "11");
          label.setAttribute("text-anchor", "middle");
          label.setAttribute("fill", "var(--text-secondary)");
          label.textContent = `R${i + 1}=${toPersianDigits(r.toFixed(0))}Ω`;
          g.appendChild(label);
        });

        // Animated dots representing current flow around the loop; their
        // speed scales with the computed current so a bigger current
        // visibly flows faster.
        const perimeter = 2 * (right - left) + 2 * (bottom - top);
        const dotCount = 6;
        const dots = [];
        for (let i = 0; i < dotCount; i++) {
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("r", "4");
          dot.setAttribute("fill", "var(--color-primary)");
          g.appendChild(dot);
          dots.push(dot);
        }

        function pointOnLoop(dist) {
          let d = ((dist % perimeter) + perimeter) % perimeter;
          const wTop = right - left, hSide = bottom - top;
          if (d < wTop) return { x: left + d, y: top };
          d -= wTop;
          if (d < hSide) return { x: right, y: top + d };
          d -= hSide;
          if (d < wTop) return { x: right - d, y: bottom };
          d -= wTop;
          return { x: left, y: bottom - d };
        }

        let startT = performance.now();
        const speed = 20 * Math.min(4, Math.max(0.3, current)); // px/s, clamped for visibility
        function animateCircuit(time) {
          const t = (time - startT) / 1000;
          dots.forEach((dot, i) => {
            const p = pointOnLoop(t * speed + (perimeter / dotCount) * i);
            dot.setAttribute("cx", p.x);
            dot.setAttribute("cy", p.y);
          });
          if (document.body.contains(svg)) {
            requestAnimationFrame(animateCircuit);
          }
        }
        requestAnimationFrame(animateCircuit);

        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>مقاومت معادل: ${toPersianDigits(rTotal.toFixed(1))} Ω</div>
                            <div>جریان مدار: ${toPersianDigits(current.toFixed(2))} A</div>
                            <div>توان کل: ${toPersianDigits((voltage * current).toFixed(2))} W</div>`;
        }
      } else if (spec.type === 'optics') {
        const element = spec.element || 'convex_lens';
        const f = spec.f || 10;
        const doDist = spec.do || 20;
        const ho = spec.ho || 2;
        const isMirror = element.indexOf('mirror') !== -1;
        const isConverging = element === 'convex_lens' || element === 'concave_mirror';

        // Thin lens / mirror equation (sign convention: converging elements
        // have positive f). 1/f = 1/do + 1/di
        const signedF = isConverging ? Math.abs(f) : -Math.abs(f);
        const di = (signedF * doDist) / (doDist - signedF);
        const m = -di / doDist; // magnification (negative = inverted)
        const hi = m * ho;

        const axisY = 150;
        const originX = 200;
        const scale = 4; // px per cm

        const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
        axis.setAttribute("x1", 20);
        axis.setAttribute("y1", axisY);
        axis.setAttribute("x2", 380);
        axis.setAttribute("y2", axisY);
        axis.setAttribute("stroke", "var(--border-subtle)");
        axis.setAttribute("stroke-width", "1");
        g.appendChild(axis);

        // Optical element symbol at the origin.
        if (isMirror) {
          const mirror = document.createElementNS("http://www.w3.org/2000/svg", "path");
          const curve = isConverging ? -18 : 18;
          mirror.setAttribute("d", `M ${originX} ${axisY - 70} Q ${originX + curve} ${axisY} ${originX} ${axisY + 70}`);
          mirror.setAttribute("fill", "none");
          mirror.setAttribute("stroke", "var(--text-primary)");
          mirror.setAttribute("stroke-width", "3");
          g.appendChild(mirror);
        } else {
          const lens = document.createElementNS("http://www.w3.org/2000/svg", "path");
          const bulge = isConverging ? 14 : -14;
          lens.setAttribute("d", `M ${originX} ${axisY - 70} Q ${originX + bulge} ${axisY} ${originX} ${axisY + 70} Q ${originX - bulge} ${axisY} ${originX} ${axisY - 70}`);
          lens.setAttribute("fill", "rgba(61,107,255,0.08)");
          lens.setAttribute("stroke", "var(--color-primary)");
          lens.setAttribute("stroke-width", "2");
          g.appendChild(lens);
        }

        // Focal points, marked on both sides of the element.
        [-1, 1].forEach((side) => {
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("cx", originX + side * Math.abs(f) * scale);
          dot.setAttribute("cy", axisY);
          dot.setAttribute("r", "3");
          dot.setAttribute("fill", "var(--text-secondary)");
          g.appendChild(dot);
        });

        function drawArrow(x, topY, color, dashed) {
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", x);
          line.setAttribute("y1", axisY);
          line.setAttribute("x2", x);
          line.setAttribute("y2", topY);
          line.setAttribute("stroke", color);
          line.setAttribute("stroke-width", "2.5");
          if (dashed) line.setAttribute("stroke-dasharray", "4,3");
          g.appendChild(line);
          const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
          const dir = topY < axisY ? -1 : 1;
          head.setAttribute("d", `M ${x - 5} ${topY + dir * 8} L ${x} ${topY} L ${x + 5} ${topY + dir * 8}`);
          head.setAttribute("fill", "none");
          head.setAttribute("stroke", color);
          head.setAttribute("stroke-width", "2.5");
          g.appendChild(head);
        }

        // Object: placed on the incoming-light side (left of the element).
        const objX = originX - doDist * scale;
        drawArrow(objX, axisY - ho * scale * 6, 'var(--color-primary)', false);

        // Image: real images form on the opposite side from the object for
        // lenses (di > 0 = same side as outgoing light); for mirrors a
        // positive di means the image is in front (same side as object).
        const imgX = isMirror ? originX + Math.sign(di) * -1 * Math.abs(di) * scale : originX + Math.sign(di) * Math.abs(di) * scale;
        const isReal = isMirror ? di > 0 : di > 0;
        drawArrow(imgX, axisY - hi * scale * 6, 'var(--color-danger)', !isReal);

        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.innerHTML = `<div>فاصله تصویر (dᵢ): ${toPersianDigits(di.toFixed(2))} cm</div>
                            <div>بزرگ‌نمایی (m): ${toPersianDigits(m.toFixed(2))}</div>
                            <div>نوع تصویر: ${isReal ? 'حقیقی' : 'مجازی'} و ${m < 0 ? 'وارونه' : 'راست'}</div>`;
        }
      } else if (spec.type === 'gas_laws') {
        let T = spec.T || 300;
        let V = spec.V || 10;
        let n = spec.n || 1;
        const R = 0.0821;

        const pad = 20;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;

        // Container / Cylinder
        const cylinder = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        cylinder.setAttribute("x", pad);
        cylinder.setAttribute("y", pad);
        cylinder.setAttribute("width", w);
        cylinder.setAttribute("height", h);
        cylinder.setAttribute("fill", "var(--bg-card)");
        cylinder.setAttribute("stroke", "var(--border-strong)");
        cylinder.setAttribute("stroke-width", "3");
        g.appendChild(cylinder);

        const rod = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        g.appendChild(rod);

        const piston = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        g.appendChild(piston);

        let particles = [];
        let pistonY = 0;

        function updateState() {
          const P = (n * R * T) / V;
          const minV = 1;
          const maxV = 20;
          const ratio = Math.min(Math.max((V - minV) / (maxV - minV), 0.1), 1);
          pistonY = pad + h * (1 - ratio);

          // Update Piston UI
          piston.setAttribute("x", pad);
          piston.setAttribute("y", pistonY);
          piston.setAttribute("width", w);
          piston.setAttribute("height", 8);
          piston.setAttribute("fill", "var(--text-secondary)");
          piston.setAttribute("rx", 2);

          rod.setAttribute("x", pad + w / 2 - 4);
          rod.setAttribute("y", pad);
          rod.setAttribute("width", 8);
          rod.setAttribute("height", pistonY - pad);
          rod.setAttribute("fill", "var(--text-tertiary)");

          // Manage Particles
          const numParticles = Math.min(Math.floor(n * 20), 100);
          const speed = Math.sqrt(T) * 0.2;

          if (particles.length < numParticles) {
            for (let i = particles.length; i < numParticles; i++) {
              const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              const px = pad + 10 + Math.random() * (w - 20);
              const py = pistonY + 10 + Math.random() * (pad + h - pistonY - 20);
              circle.setAttribute("cx", px);
              circle.setAttribute("cy", py);
              circle.setAttribute("r", 3);
              circle.setAttribute("fill", "var(--color-primary)");
              g.appendChild(circle);

              particles.push({
                el: circle,
                x: px,
                y: py,
                vx: (Math.random() - 0.5) * speed,
                vy: (Math.random() - 0.5) * speed
              });
            }
          } else if (particles.length > numParticles) {
            const removed = particles.splice(numParticles);
            removed.forEach(p => g.removeChild(p.el));
          }

          // Update speeds if T changed
          particles.forEach(p => {
            const currentSpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 0.001;
            p.vx = (p.vx / currentSpeed) * speed;
            p.vy = (p.vy / currentSpeed) * speed;
          });

          return P;
        }

        let currentP = updateState();

        function animateGas() {
          particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < pad + 3) { p.x = pad + 3; p.vx *= -1; }
            if (p.x > pad + w - 3) { p.x = pad + w - 3; p.vx *= -1; }
            if (p.y < pistonY + 8 + 3) { p.y = pistonY + 8 + 3; p.vy *= -1; }
            if (p.y > pad + h - 3) { p.y = pad + h - 3; p.vy *= -1; }

            p.el.setAttribute("cx", p.x);
            p.el.setAttribute("cy", p.y);
          });
          requestAnimationFrame(animateGas);
        }
        requestAnimationFrame(animateGas);

        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;';
          info.appendChild(stats);

          const renderStats = () => {
            stats.innerHTML = `<span>فشار: ${toPersianDigits(currentP.toFixed(2))} atm</span>
                               <span>دما: ${toPersianDigits(T.toFixed(0))} K</span>
                               <span>حجم: ${toPersianDigits(V.toFixed(1))} L</span>`;
          };
          renderStats();

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '40px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            input.addEventListener('input', e => {
              onChange(parseFloat(e.target.value));
              currentP = updateState();
              renderStats();
            });
            row.appendChild(lbl);
            row.appendChild(input);
            controls.appendChild(row);
          };

          createSlider('دما', 100, 1000, 10, T, v => T = v);
          createSlider('حجم', 2, 20, 0.5, V, v => V = v);
          createSlider('مول', 0.1, 5, 0.1, n, v => n = v);

          info.appendChild(controls);
        }
      } else if (spec.type === 'buoyancy') {
        let rho_f = spec.rho_f || 1000;
        let rho_s = spec.rho_s || 800;
        let v_obj = spec.v_obj || 0.001; // 1 liter
        const g_accel = 9.8;

        const pad = 20;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        // Container
        const containerRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        containerRect.setAttribute("x", pad);
        containerRect.setAttribute("y", pad);
        containerRect.setAttribute("width", w);
        containerRect.setAttribute("height", h);
        containerRect.setAttribute("fill", "transparent");
        containerRect.setAttribute("stroke", "var(--border-strong)");
        containerRect.setAttribute("stroke-width", "4");
        containerRect.setAttribute("rx", "10");
        g.appendChild(containerRect);

        // Water level (let's say it's filled to 2/3)
        const waterLevelY = pad + h / 3;
        const waterHeight = h * 2 / 3;

        const water = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        water.setAttribute("x", pad + 2);
        water.setAttribute("y", waterLevelY);
        water.setAttribute("width", w - 4);
        water.setAttribute("height", waterHeight - 2);
        water.setAttribute("fill", "var(--color-primary-soft)");
        water.setAttribute("opacity", "0.5");
        g.appendChild(water);
        
        // Object
        let objSize = Math.cbrt(v_obj) * 500;
        const objRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        objRect.setAttribute("width", objSize);
        objRect.setAttribute("height", objSize);
        objRect.setAttribute("fill", "var(--color-warning)");
        objRect.setAttribute("stroke", "var(--color-warning-dark)");
        objRect.setAttribute("stroke-width", "2");
        objRect.setAttribute("rx", "5");
        g.appendChild(objRect);

        let targetY = 0;
        let currentY = pad + 10;
        let v_sub = 0;
        let F_b = 0;
        let W_app = 0;
        
        function updateBuoyancy() {
          objSize = Math.cbrt(v_obj) * 500;
          objRect.setAttribute("width", objSize);
          objRect.setAttribute("height", objSize);

          const W = rho_s * v_obj * g_accel; // True weight
          let subRatio = rho_s / rho_f; // How much of it is submerged (if floating)
          
          if (subRatio >= 1) {
            // Sinks
            v_sub = v_obj;
            F_b = rho_f * v_sub * g_accel;
            W_app = W - F_b;
            targetY = pad + h - objSize - 2; // Bottom of container
          } else {
            // Floats
            v_sub = subRatio * v_obj;
            F_b = W;
            W_app = 0;
            // Align the submerged part with water level
            targetY = waterLevelY - (objSize * (1 - subRatio));
          }
          
          return { v_sub, F_b, W_app };
        }
        
        let statsData = updateBuoyancy();
        
        function animateBuoyancy() {
          // Simple smoothing
          currentY += (targetY - currentY) * 0.1;
          objRect.setAttribute("x", pad + w / 2 - objSize / 2);
          objRect.setAttribute("y", currentY);
          requestAnimationFrame(animateBuoyancy);
        }
        requestAnimationFrame(animateBuoyancy);

        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;';
          info.appendChild(stats);

          const renderStats = () => {
            const statusStr = rho_s > rho_f ? 'غرق می‌شود' : (rho_s === rho_f ? 'غوطه‌ور' : 'شناور');
            stats.innerHTML = `<div style="width:50%; margin-bottom:4px;">حجم فرورفته: ${toPersianDigits(statsData.v_sub.toFixed(4))} m³</div>
                               <div style="width:50%; margin-bottom:4px;">نیروی شناوری: ${toPersianDigits(statsData.F_b.toFixed(1))} N</div>
                               <div style="width:50%;">وزن ظاهری: ${toPersianDigits(statsData.W_app.toFixed(1))} N</div>
                               <div style="width:50%; font-weight:800; color:var(--color-primary);">وضعیت: ${statusStr}</div>`;
          };
          renderStats();

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '70px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            const valDisplay = document.createElement('span');
            valDisplay.style.width = '40px';
            valDisplay.style.textAlign = 'left';
            valDisplay.textContent = val;

            input.addEventListener('input', e => {
              const newVal = parseFloat(e.target.value);
              valDisplay.textContent = newVal;
              onChange(newVal);
              statsData = updateBuoyancy();
              renderStats();
            });
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(valDisplay);
            controls.appendChild(row);
          };

          createSlider('چگالی مایع', 500, 2000, 50, rho_f, v => rho_f = v);
          createSlider('چگالی جسم', 100, 3000, 50, rho_s, v => rho_s = v);
          createSlider('حجم کل', 0.001, 0.010, 0.001, v_obj, v => v_obj = v);

          info.appendChild(controls);
        }
      } else if (spec.type === 'electric_field') {
        const initialCharges = spec.charges && spec.charges.length > 0 ? spec.charges : [1, -1];
        const w = 400;
        const h = 300;
        
        let charges = initialCharges.map((q, i) => ({
          q: q,
          x: w / 2 + (i - (initialCharges.length - 1) / 2) * 100,
          y: h / 2
        }));

        // Vector Field Grid
        const gridX = 20;
        const gridY = 15;
        const stepX = w / gridX;
        const stepY = h / gridY;
        const vectors = [];
        
        const vectorGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(vectorGroup);
        
        for (let ix = 0; ix <= gridX; ix++) {
          for (let iy = 0; iy <= gridY; iy++) {
            const x = ix * stepX;
            const y = iy * stepY;
            const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
            line.setAttribute("stroke", "var(--text-tertiary)");
            line.setAttribute("stroke-width", "1");
            line.setAttribute("opacity", "0.6");
            line.setAttribute("fill", "none");
            vectorGroup.appendChild(line);
            vectors.push({ x, y, el: line });
          }
        }
        
        const chargeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(chargeGroup);
        
        let activeCharge = null;
        
        function renderCharges() {
          chargeGroup.innerHTML = '';
          charges.forEach((c) => {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", c.x);
            circle.setAttribute("cy", c.y);
            circle.setAttribute("r", 12);
            circle.setAttribute("fill", c.q > 0 ? "var(--color-danger)" : "var(--color-primary)");
            circle.setAttribute("cursor", "grab");
            
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", c.x);
            text.setAttribute("y", c.y + 4);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("fill", "#fff");
            text.setAttribute("font-size", "12px");
            text.setAttribute("font-weight", "bold");
            text.setAttribute("pointer-events", "none");
            text.textContent = c.q > 0 ? '+' : (c.q < 0 ? '-' : '0');
            
            circle.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              e.stopPropagation();
              activeCharge = c;
              circle.setAttribute("cursor", "grabbing");
            });
            
            chargeGroup.appendChild(circle);
            chargeGroup.appendChild(text);
          });
          
          updateField();
        }
        
        function updateField() {
          vectors.forEach(v => {
            let Ex = 0;
            let Ey = 0;
            charges.forEach(c => {
              const dx = v.x - c.x;
              const dy = v.y - c.y;
              const r2 = dx * dx + dy * dy;
              if (r2 < 40) return; // avoid singularity
              const r = Math.sqrt(r2);
              const E = c.q / r2; 
              Ex += E * (dx / r);
              Ey += E * (dy / r);
            });
            const mag = Math.sqrt(Ex * Ex + Ey * Ey);
            if (mag === 0) {
              v.el.setAttribute("d", "");
              return;
            }
            
            // Visual scale for electric field vectors
            const len = Math.min(16, mag * 40000); 
            const dirX = Ex / mag;
            const dirY = Ey / mag;
            
            const endX = v.x + dirX * len;
            const endY = v.y + dirY * len;
            
            const headX1 = endX - dirX * 3 - dirY * 2;
            const headY1 = endY - dirY * 3 + dirX * 2;
            const headX2 = endX - dirX * 3 + dirY * 2;
            const headY2 = endY - dirY * 3 - dirX * 2;
            
            v.el.setAttribute("d", `M ${v.x} ${v.y} L ${endX} ${endY} M ${endX} ${endY} L ${headX1} ${headY1} M ${endX} ${endY} L ${headX2} ${headY2}`);
            
            const intensity = Math.min(1, mag * 10000);
            v.el.setAttribute("opacity", 0.15 + 0.85 * intensity);
          });

          // Draw force vectors on charges
          charges.forEach(c => {
            let Ex = 0, Ey = 0;
            charges.forEach(other => {
              if (c === other) return;
              const dx = c.x - other.x;
              const dy = c.y - other.y;
              const r2 = dx * dx + dy * dy;
              if (r2 < 100) return; // limit huge forces
              const r = Math.sqrt(r2);
              const E = other.q / r2;
              Ex += E * (dx / r);
              Ey += E * (dy / r);
            });
            const Fx = c.q * Ex;
            const Fy = c.q * Ey;
            
            const fMag = Math.sqrt(Fx * Fx + Fy * Fy);
            if (fMag > 0.00001) {
              const fScale = 150000; 
              let len = fMag * fScale;
              if (len > 40) len = 40;
              const dirX = Fx / fMag;
              const dirY = Fy / fMag;
              
              const startX = c.x + dirX * 14;
              const startY = c.y + dirY * 14;
              const endX = startX + dirX * len;
              const endY = startY + dirY * len;
              
              const headX1 = endX - dirX * 5 - dirY * 3;
              const headY1 = endY - dirY * 5 + dirX * 3;
              const headX2 = endX - dirX * 5 + dirY * 3;
              const headY2 = endY - dirY * 5 - dirX * 3;
              
              const forcePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
              forcePath.setAttribute("d", `M ${startX} ${startY} L ${endX} ${endY} M ${endX} ${endY} L ${headX1} ${headY1} M ${endX} ${endY} L ${headX2} ${headY2}`);
              forcePath.setAttribute("stroke", "var(--text-primary)");
              forcePath.setAttribute("stroke-width", "2");
              forcePath.setAttribute("fill", "none");
              forcePath.setAttribute("pointer-events", "none");
              chargeGroup.appendChild(forcePath);
            }
          });
        }
        
        svg.addEventListener('pointermove', (e) => {
          if (!activeCharge) return;
          const rect = svg.getBoundingClientRect();
          const scaleX = 400 / rect.width;
          const scaleY = 300 / rect.height;
          activeCharge.x = (e.clientX - rect.left) * scaleX;
          activeCharge.y = (e.clientY - rect.top) * scaleY;
          renderCharges();
        });
        
        svg.addEventListener('pointerup', () => { activeCharge = null; renderCharges(); });
        svg.addEventListener('pointerleave', () => { activeCharge = null; renderCharges(); });
        
        renderCharges();
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;">
                              <span>تعداد بارها: <span id="charge-count">${charges.length}</span></span>
                              <div style="display:flex; gap:4px;">
                                <button id="add-pos-btn" style="padding:4px 8px; border-radius:4px; border:none; background:var(--color-danger); color:#fff; cursor:pointer; font-size:12px; font-weight:700;">+ مثبت</button>
                                <button id="add-neg-btn" style="padding:4px 8px; border-radius:4px; border:none; background:var(--color-primary); color:#fff; cursor:pointer; font-size:12px; font-weight:700;">+ منفی</button>
                                <button id="clear-btn" style="padding:4px 8px; border-radius:4px; border:none; background:var(--bg-secondary); color:var(--text-primary); cursor:pointer; font-size:12px; font-weight:700; border: 1px solid var(--border-subtle);">حذف همه</button>
                              </div>
                            </div>
                            <div style="font-size:11px; margin-top:8px; opacity:0.8;">بارهای روی صفحه را بکشید (Drag & Drop) تا تغییرات میدان و نیروی بین آن‌ها (بردارهای مشکی) را مشاهده کنید. برای حذف یک بار، روی آن دابل‌کلیک کنید.</div>`;
          
          info.querySelector('#add-pos-btn').addEventListener('click', () => {
            charges.push({ q: 1, x: 200 + (Math.random() - 0.5) * 50, y: 150 + (Math.random() - 0.5) * 50 });
            renderCharges();
            info.querySelector('#charge-count').textContent = charges.length;
          });
          info.querySelector('#add-neg-btn').addEventListener('click', () => {
            charges.push({ q: -1, x: 200 + (Math.random() - 0.5) * 50, y: 150 + (Math.random() - 0.5) * 50 });
            renderCharges();
            info.querySelector('#charge-count').textContent = charges.length;
          });
          info.querySelector('#clear-btn').addEventListener('click', () => {
            charges = [];
            renderCharges();
            info.querySelector('#charge-count').textContent = charges.length;
          });

          // Add double click listener to circles for removal
          chargeGroup.addEventListener('dblclick', (e) => {
            if (e.target.tagName === 'circle') {
              const cx = parseFloat(e.target.getAttribute('cx'));
              const cy = parseFloat(e.target.getAttribute('cy'));
              charges = charges.filter(c => Math.abs(c.x - cx) > 1 || Math.abs(c.y - cy) > 1);
              renderCharges();
              info.querySelector('#charge-count').textContent = charges.length;
            }
          });
        }
      } else if (spec.type === 'capacitor') {
        let A = spec.area || 0.05; // 0.01 to 0.1
        let d = spec.distance || 5; // 1 to 20 mm
        let k = spec.dielectric || 1; // 1 to 10
        let V = spec.voltage || 12; // -24 to 24

        const e0 = 8.854; // pF/m

        const pad = 30;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        // Dielectric
        const dielectricRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        g.appendChild(dielectricRect);
        
        // Field lines group
        const fieldGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(fieldGroup);

        // Plates
        const topPlate = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const bottomPlate = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        g.appendChild(topPlate);
        g.appendChild(bottomPlate);

        // Wires
        const topWire = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const bottomWire = document.createElementNS("http://www.w3.org/2000/svg", "path");
        topWire.setAttribute("stroke", "var(--text-secondary)");
        bottomWire.setAttribute("stroke", "var(--text-secondary)");
        topWire.setAttribute("stroke-width", "2");
        bottomWire.setAttribute("stroke-width", "2");
        topWire.setAttribute("fill", "none");
        bottomWire.setAttribute("fill", "none");
        g.appendChild(topWire);
        g.appendChild(bottomWire);
        
        // Battery
        const battery = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(battery);
        
        let C, Q, E, U;

        function updateCapacitor() {
          // Calculations
          // C in pF
          C = k * e0 * (A / (d * 1e-3));
          Q = C * V; // pC
          E = (V / (d * 1e-3)); // V/m
          U = 0.5 * C * V * V; // pJ

          // Visuals
          const max_A = 0.1;
          const plateWidth = 50 + (A / max_A) * 200; // 50 to 250
          const distPx = d * 4; // 4 to 80
          
          const plateHeight = 8;
          const centerX = pad + w / 2;
          const centerY = pad + h / 2;
          
          const topY = centerY - distPx / 2 - plateHeight;
          const bottomY = centerY + distPx / 2;

          // Update Plates
          const getPlateColor = (voltage) => {
            if (Math.abs(voltage) < 0.1) return "var(--text-tertiary)";
            return voltage > 0 ? "var(--color-danger)" : "var(--color-primary)";
          };

          topPlate.setAttribute("x", centerX - plateWidth / 2);
          topPlate.setAttribute("y", topY);
          topPlate.setAttribute("width", plateWidth);
          topPlate.setAttribute("height", plateHeight);
          topPlate.setAttribute("fill", getPlateColor(V));
          topPlate.setAttribute("rx", "2");

          bottomPlate.setAttribute("x", centerX - plateWidth / 2);
          bottomPlate.setAttribute("y", bottomY);
          bottomPlate.setAttribute("width", plateWidth);
          bottomPlate.setAttribute("height", plateHeight);
          bottomPlate.setAttribute("fill", getPlateColor(-V));
          bottomPlate.setAttribute("rx", "2");
          
          // Dielectric
          dielectricRect.setAttribute("x", centerX - plateWidth / 2);
          dielectricRect.setAttribute("y", topY + plateHeight);
          dielectricRect.setAttribute("width", plateWidth);
          dielectricRect.setAttribute("height", distPx);
          dielectricRect.setAttribute("fill", "var(--color-warning)");
          dielectricRect.setAttribute("opacity", k > 1 ? (0.1 + (k - 1) * 0.05).toString() : "0");
          
          // Wires
          topWire.setAttribute("d", `M ${centerX - plateWidth/2} ${topY + plateHeight/2} L ${pad} ${topY + plateHeight/2} L ${pad} ${centerY}`);
          bottomWire.setAttribute("d", `M ${centerX + plateWidth/2} ${bottomY + plateHeight/2} L ${pad + w} ${bottomY + plateHeight/2} L ${pad + w} ${centerY} L ${pad} ${centerY}`);
          
          // Battery icon at (pad, centerY)
          battery.innerHTML = '';
          const batW = 20;
          const batH = 40;
          const batX = pad - batW/2;
          const batY = centerY - batH/2;
          
          const batBody = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          batBody.setAttribute("x", batX);
          batBody.setAttribute("y", batY);
          batBody.setAttribute("width", batW);
          batBody.setAttribute("height", batH);
          batBody.setAttribute("fill", "var(--bg-card)");
          batBody.setAttribute("stroke", "var(--text-primary)");
          batBody.setAttribute("stroke-width", "2");
          batBody.setAttribute("rx", "3");
          battery.appendChild(batBody);
          
          const batV = document.createElementNS("http://www.w3.org/2000/svg", "text");
          batV.setAttribute("x", pad);
          batV.setAttribute("y", centerY + 4);
          batV.setAttribute("text-anchor", "middle");
          batV.setAttribute("fill", "var(--text-primary)");
          batV.setAttribute("font-size", "10px");
          batV.setAttribute("font-weight", "bold");
          batV.textContent = V + "V";
          battery.appendChild(batV);

          // Field lines
          fieldGroup.innerHTML = '';
          if (Math.abs(V) > 0.1) {
            const numLines = Math.min(20, Math.max(3, Math.floor((Math.abs(V) / 24) * 10 + (plateWidth / 250) * 10)));
            const step = plateWidth / (numLines + 1);
            const isDown = V > 0;
            
            for (let i = 1; i <= numLines; i++) {
              const lx = centerX - plateWidth / 2 + i * step;
              const y1 = topY + plateHeight;
              const y2 = bottomY;
              
              const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
              line.setAttribute("x1", lx);
              line.setAttribute("y1", y1);
              line.setAttribute("x2", lx);
              line.setAttribute("y2", y2);
              line.setAttribute("stroke", "var(--text-secondary)");
              line.setAttribute("stroke-width", "1");
              line.setAttribute("opacity", "0.5");
              fieldGroup.appendChild(line);
              
              // Arrowhead
              const arrowY = (y1 + y2) / 2;
              const dir = isDown ? 1 : -1;
              const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
              arrow.setAttribute("d", `M ${lx - 3} ${arrowY - dir*3} L ${lx} ${arrowY + dir*4} L ${lx + 3} ${arrowY - dir*3}`);
              arrow.setAttribute("stroke", "var(--text-secondary)");
              arrow.setAttribute("stroke-width", "1");
              arrow.setAttribute("fill", "none");
              arrow.setAttribute("opacity", "0.5");
              fieldGroup.appendChild(arrow);
            }
          }
        }
        
        updateCapacitor();
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; line-height: 1.8;';
          info.appendChild(stats);

          const renderStats = () => {
            stats.innerHTML = `<div style="width:50%;">ظرفیت (C): ${toPersianDigits(C.toFixed(2))} pF</div>
                               <div style="width:50%;">بار (Q): ${toPersianDigits(Math.abs(Q).toFixed(1))} pC</div>
                               <div style="width:50%;">میدان (E): ${toPersianDigits(Math.abs(E).toFixed(0))} V/m</div>
                               <div style="width:50%;">انرژی (U): ${toPersianDigits(U.toFixed(1))} pJ</div>`;
          };
          renderStats();

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '70px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            const valDisplay = document.createElement('span');
            valDisplay.style.width = '40px';
            valDisplay.style.textAlign = 'left';
            valDisplay.textContent = val;

            input.addEventListener('input', e => {
              const newVal = parseFloat(e.target.value);
              valDisplay.textContent = newVal;
              onChange(newVal);
              updateCapacitor();
              renderStats();
            });
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(valDisplay);
            controls.appendChild(row);
          };

          createSlider('مساحت (m²)', 0.01, 0.1, 0.01, A, v => A = v);
          createSlider('فاصله (mm)', 1, 20, 1, d, v => d = v);
          createSlider('دی‌الکتریک', 1, 10, 0.5, k, v => k = v);
          createSlider('ولتاژ (V)', -24, 24, 1, V, v => V = v);

          info.appendChild(controls);
        }
      } else if (spec.type === 'magnetic_field' || spec.type === 'lorentz') {
        let m = spec.mass || 1; // 1e-6 kg (just a unit for sim)
        let q = (spec.q !== undefined) ? spec.q : 1; // 1e-6 C
        let v = (spec.v !== undefined) ? spec.v : 50; // m/s
        let B = (spec.B !== undefined) ? spec.B : 1; // Tesla
        
        const pad = 20;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        const bFieldStartX = pad + w / 3;
        const bFieldWidth = w * 2 / 3;
        
        // B-field background
        const bRegion = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bRegion.setAttribute("x", bFieldStartX);
        bRegion.setAttribute("y", pad);
        bRegion.setAttribute("width", bFieldWidth);
        bRegion.setAttribute("height", h);
        bRegion.setAttribute("fill", "var(--color-primary-soft)");
        bRegion.setAttribute("opacity", "0.2");
        g.appendChild(bRegion);
        
        // Draw B-field vectors (X or dots)
        const bVectorGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(bVectorGroup);
        
        function updateBFieldVisuals() {
          bVectorGroup.innerHTML = '';
          if (Math.abs(B) < 0.01) return;
          
          const cols = 8;
          const rows = 6;
          const stepX = bFieldWidth / cols;
          const stepY = h / rows;
          
          for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
              const cx = bFieldStartX + stepX / 2 + i * stepX;
              const cy = pad + stepY / 2 + j * stepY;
              
              const isIntoPage = B > 0;
              
              if (isIntoPage) {
                // Draw X
                const size = 4;
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", `M ${cx - size} ${cy - size} L ${cx + size} ${cy + size} M ${cx - size} ${cy + size} L ${cx + size} ${cy - size}`);
                path.setAttribute("stroke", "var(--text-secondary)");
                path.setAttribute("stroke-width", "1.5");
                path.setAttribute("opacity", "0.6");
                bVectorGroup.appendChild(path);
              } else {
                // Draw Dot
                const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                circle.setAttribute("cx", cx);
                circle.setAttribute("cy", cy);
                circle.setAttribute("r", 2);
                circle.setAttribute("fill", "var(--text-secondary)");
                circle.setAttribute("opacity", "0.6");
                
                const outer = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                outer.setAttribute("cx", cx);
                outer.setAttribute("cy", cy);
                outer.setAttribute("r", 5);
                outer.setAttribute("stroke", "var(--text-secondary)");
                outer.setAttribute("stroke-width", "1");
                outer.setAttribute("fill", "none");
                outer.setAttribute("opacity", "0.6");
                
                bVectorGroup.appendChild(circle);
                bVectorGroup.appendChild(outer);
              }
            }
          }
        }
        
        // Path trace
        const pathLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pathLine.setAttribute("fill", "none");
        pathLine.setAttribute("stroke", "var(--color-danger)");
        pathLine.setAttribute("stroke-width", "2");
        pathLine.setAttribute("stroke-dasharray", "4,4");
        g.appendChild(pathLine);
        
        // Particle
        const particle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        particle.setAttribute("r", 5);
        particle.setAttribute("fill", "var(--color-danger)");
        g.appendChild(particle);
        
        let startX = pad + 10;
        let startY = pad + h / 2;
        let px = startX, py = startY;
        let vx = v, vy = 0;
        let pathStr = `M ${px} ${py}`;
        
        let simTime = performance.now();
        let running = true;
        let r_calc = 0;
        
        function resetSim() {
          px = startX;
          py = startY;
          vx = v;
          vy = 0;
          pathStr = `M ${px} ${py}`;
          pathLine.setAttribute("d", pathStr);
          particle.setAttribute("fill", q > 0 ? "var(--color-danger)" : (q < 0 ? "var(--color-primary)" : "var(--text-secondary)"));
          pathLine.setAttribute("stroke", q > 0 ? "var(--color-danger)" : (q < 0 ? "var(--color-primary)" : "var(--text-secondary)"));
          
          if (Math.abs(B * q) > 0.001) {
            r_calc = (m * Math.abs(v)) / Math.abs(q * B);
          } else {
            r_calc = Infinity;
          }
          
          updateBFieldVisuals();
          simTime = performance.now();
        }
        
        function animateLorentz() {
          if (!document.body.contains(svg)) return; // Stop if removed
          
          const now = performance.now();
          const dt = Math.min((now - simTime) / 1000, 0.05); // cap dt
          simTime = now;
          
          const steps = 10; // sub-steps for precision
          const sdt = dt / steps;
          
          for (let i = 0; i < steps; i++) {
            // Apply force if inside B-field
            if (px >= bFieldStartX && px <= bFieldStartX + bFieldWidth && py >= pad && py <= pad + h) {
              // F = q * (v x B). B is in Z. 
              // v = (vx, vy, 0), B = (0, 0, B)
              // v x B = (vy * B, -vx * B, 0)
              const Fx = q * vy * B;
              const Fy = q * (-vx) * B;
              
              const ax = Fx / m;
              const ay = Fy / m;
              
              vx += ax * sdt;
              vy += ay * sdt;
            }
            
            px += vx * sdt;
            py += vy * sdt;
            
            // Wall collisions just to keep it in frame optionally, or just let it fly
            if (px < pad || px > pad + w || py < pad || py > pad + h) {
              // Out of bounds, reset after a short delay maybe?
              // Let's just wrap or stop. Let's bounce just so it stays visible
              if (px < pad) { px = pad; vx *= -1; }
              if (px > pad + w) { px = pad + w; vx *= -1; }
              if (py < pad) { py = pad; vy *= -1; }
              if (py > pad + h) { py = pad + h; vy *= -1; }
            }
          }
          
          pathStr += ` L ${px} ${py}`;
          // Keep path relatively short if bouncing around forever
          if (pathStr.length > 5000) {
             const parts = pathStr.split(' L ');
             parts.splice(1, 10); // remove some old segments
             pathStr = parts.join(' L ');
          }
          
          pathLine.setAttribute("d", pathStr);
          particle.setAttribute("cx", px);
          particle.setAttribute("cy", py);
          
          requestAnimationFrame(animateLorentz);
        }
        
        resetSim();
        requestAnimationFrame(animateLorentz);
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; line-height: 1.8;';
          info.appendChild(stats);

          const renderStats = () => {
            const dir = (q * B > 0) ? 'بالا (پادساعتگرد)' : (q * B < 0 ? 'پایین (ساعتگرد)' : 'بدون انحراف');
            stats.innerHTML = `<div style="width:50%;">شعاع دوران (r): ${r_calc === Infinity ? '∞' : toPersianDigits(r_calc.toFixed(1))}</div>
                               <div style="width:50%;">جهت انحراف: <span style="font-weight:bold; color:var(--text-primary);">${dir}</span></div>
                               <div style="width:100%; font-size:10px; margin-top:4px;">میدان راست: B>0 درون‌سو (×)، B<0 برون‌سو (•)</div>`;
          };

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '70px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            const valDisplay = document.createElement('span');
            valDisplay.style.width = '40px';
            valDisplay.style.textAlign = 'left';
            valDisplay.textContent = val;

            input.addEventListener('input', e => {
              const newVal = parseFloat(e.target.value);
              valDisplay.textContent = newVal;
              onChange(newVal);
              resetSim();
              renderStats();
            });
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(valDisplay);
            controls.appendChild(row);
          };

          createSlider('بار (q)', -5, 5, 1, q, val => q = val);
          createSlider('سرعت (v)', 10, 150, 10, v, val => v = val);
          createSlider('میدان (B)', -5, 5, 0.5, B, val => B = val);
          createSlider('جرم (m)', 0.5, 5, 0.5, m, val => m = val);

          info.appendChild(controls);
          renderStats();
        }
      } else if (spec.type === 'faraday') {
        let N_turns = spec.turns || 5;
        let isReversed = spec.reversed_poles || false; // false = N on right, true = S on right
        
        const pad = 20;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        const coilCenterX = pad + w * 0.6;
        const coilCenterY = pad + h / 2;
        const coilRadius = 40;
        
        // Ammeter and coil path
        const circuit = document.createElementNS("http://www.w3.org/2000/svg", "path");
        circuit.setAttribute("d", `M ${coilCenterX - 40} ${coilCenterY - coilRadius} L ${coilCenterX - 40} ${pad} L ${coilCenterX + 40} ${pad} L ${coilCenterX + 40} ${coilCenterY - coilRadius}`);
        circuit.setAttribute("stroke", "var(--text-secondary)");
        circuit.setAttribute("stroke-width", "2");
        circuit.setAttribute("fill", "none");
        g.appendChild(circuit);
        
        const ammeterCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ammeterCircle.setAttribute("cx", coilCenterX);
        ammeterCircle.setAttribute("cy", pad);
        ammeterCircle.setAttribute("r", 20);
        ammeterCircle.setAttribute("fill", "var(--bg-card)");
        ammeterCircle.setAttribute("stroke", "var(--text-primary)");
        ammeterCircle.setAttribute("stroke-width", "2");
        g.appendChild(ammeterCircle);
        
        const ammeterNeedle = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ammeterNeedle.setAttribute("x1", coilCenterX);
        ammeterNeedle.setAttribute("y1", pad + 15);
        ammeterNeedle.setAttribute("stroke", "var(--color-danger)");
        ammeterNeedle.setAttribute("stroke-width", "2");
        g.appendChild(ammeterNeedle);

        // ammeter label
        const A_text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        A_text.setAttribute("x", coilCenterX);
        A_text.setAttribute("y", pad - 2);
        A_text.setAttribute("fill", "var(--text-primary)");
        A_text.setAttribute("text-anchor", "middle");
        A_text.setAttribute("font-size", "10px");
        A_text.setAttribute("font-weight", "bold");
        A_text.textContent = "A";
        g.appendChild(A_text);
        
        const coilGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(coilGroup);
        
        function drawCoil() {
           coilGroup.innerHTML = '';
           for(let i=0; i<N_turns; i++) {
              const x = coilCenterX - 40 + (80 / Math.max(1, N_turns - 1)) * i;
              const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
              ellipse.setAttribute("cx", x);
              ellipse.setAttribute("cy", coilCenterY);
              ellipse.setAttribute("rx", 15);
              ellipse.setAttribute("ry", coilRadius);
              ellipse.setAttribute("fill", "none");
              ellipse.setAttribute("stroke", "var(--color-warning)");
              ellipse.setAttribute("stroke-width", "3");
              coilGroup.appendChild(ellipse);
           }
        }
        
        // Magnet
        const magnetW = 80;
        const magnetH = 30;
        let magX = pad + 40;
        let magY = coilCenterY;
        
        const magnetGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        magnetGroup.setAttribute("cursor", "grab");
        g.appendChild(magnetGroup);
        
        const magLeft = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const magRight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const magLeftText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const magRightText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        
        magnetGroup.appendChild(magLeft);
        magnetGroup.appendChild(magRight);
        magnetGroup.appendChild(magLeftText);
        magnetGroup.appendChild(magRightText);
        
        let isDragging = false;
        let lastMagX = magX;
        let lastTime = performance.now();
        let flux = 0;
        let emf = 0;
        
        function updateMagnet() {
           magLeft.setAttribute("x", magX - magnetW/2);
           magLeft.setAttribute("y", magY - magnetH/2);
           magLeft.setAttribute("width", magnetW/2);
           magLeft.setAttribute("height", magnetH);
           magLeft.setAttribute("fill", isReversed ? "var(--color-primary)" : "var(--color-danger)");
           
           magRight.setAttribute("x", magX);
           magRight.setAttribute("y", magY - magnetH/2);
           magRight.setAttribute("width", magnetW/2);
           magRight.setAttribute("height", magnetH);
           magRight.setAttribute("fill", isReversed ? "var(--color-danger)" : "var(--color-primary)");
           
           magLeftText.setAttribute("x", magX - magnetW/4);
           magLeftText.setAttribute("y", magY + 5);
           magLeftText.setAttribute("fill", "#fff");
           magLeftText.setAttribute("text-anchor", "middle");
           magLeftText.setAttribute("font-weight", "bold");
           magLeftText.textContent = isReversed ? "S" : "N";
           
           magRightText.setAttribute("x", magX + magnetW/4);
           magRightText.setAttribute("y", magY + 5);
           magRightText.setAttribute("fill", "#fff");
           magRightText.setAttribute("text-anchor", "middle");
           magRightText.setAttribute("font-weight", "bold");
           magRightText.textContent = isReversed ? "N" : "S";
           
           const poleX = magX + magnetW/2;
           const dist = (coilCenterX - poleX); // distance in x
           
           // A simple model for flux based on distance
           // Phi ~ 1 / (dist^2 + C)
           // We'll give it a sign depending on N or S
           const sign = isReversed ? -1 : 1;
           const currentFlux = sign * (5000 / (dist * dist + 1000)); 
           
           const now = performance.now();
           const dt = Math.max(1, now - lastTime);
           
           // EMF = - N * dPhi/dt
           const dFlux = currentFlux - flux;
           let instantEmf = - N_turns * (dFlux / dt) * 100;
           
           emf = emf * 0.7 + instantEmf * 0.3; // smoothing
           flux = currentFlux;
           lastTime = now;
        }
        
        function drawNeedle() {
           const maxDisplay = 100;
           const clampedEmf = Math.max(-maxDisplay, Math.min(maxDisplay, emf));
           const angle = (clampedEmf / maxDisplay) * 45; // -45 to 45 degrees
           
           const rad = (angle - 90) * Math.PI / 180;
           const nx = coilCenterX + 15 * Math.cos(rad);
           const ny = pad + 15 + 15 * Math.sin(rad);
           
           ammeterNeedle.setAttribute("x2", nx);
           ammeterNeedle.setAttribute("y2", ny);
        }
        
        function animLoop() {
           if (!document.body.contains(svg)) return;
           if (!isDragging) {
              const now = performance.now();
              lastTime = now;
              emf = emf * 0.9; // decay
           }
           drawNeedle();
           // Update Stats panel
           if (infoStatsUpdate) infoStatsUpdate();
           
           requestAnimationFrame(animLoop);
        }
        
        magnetGroup.addEventListener("pointerdown", (e) => {
           isDragging = true;
           magnetGroup.setAttribute("cursor", "grabbing");
           svg.setPointerCapture(e.pointerId);
           e.stopPropagation();
        });
        
        svg.addEventListener("pointermove", (e) => {
           if (!isDragging) return;
           const rect = svg.getBoundingClientRect();
           const scaleX = w / (rect.width - 2*pad);
           // Try to get x coordinate in svg space
           const pt = svg.createSVGPoint();
           pt.x = e.clientX;
           pt.y = e.clientY;
           const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
           magX = Math.max(pad + magnetW/2, Math.min(pad + w - magnetW/2, svgP.x));
           updateMagnet();
        });
        
        svg.addEventListener("pointerup", (e) => {
           if(isDragging) {
             isDragging = false;
             magnetGroup.setAttribute("cursor", "grab");
             svg.releasePointerCapture(e.pointerId);
           }
        });
        svg.addEventListener("pointerleave", () => {
           if(isDragging) {
             isDragging = false;
             magnetGroup.setAttribute("cursor", "grab");
           }
        });
        
        drawCoil();
        updateMagnet();
        requestAnimationFrame(animLoop);
        
        let infoStatsUpdate = null;
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; line-height: 1.8; font-size:12px;';
          info.appendChild(stats);

          infoStatsUpdate = () => {
            const currentDir = emf > 1 ? 'ساعتگرد' : (emf < -1 ? 'پادساعتگرد' : 'صفر');
            stats.innerHTML = `<div style="width:50%;">شار (Φ): ${toPersianDigits(Math.abs(flux).toFixed(2))}</div>
                               <div style="width:50%;">نیرو محرکه (ε): ${toPersianDigits(Math.abs(emf).toFixed(1))}</div>
                               <div style="width:100%; margin-top:4px;">جهت جریان القایی: <span style="font-weight:bold;">${currentDir}</span></div>`;
          };
          infoStatsUpdate();

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '70px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            const valDisplay = document.createElement('span');
            valDisplay.style.width = '20px';
            valDisplay.style.textAlign = 'left';
            valDisplay.textContent = val;

            input.addEventListener('input', e => {
              const newVal = parseFloat(e.target.value);
              valDisplay.textContent = newVal;
              onChange(newVal);
            });
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(valDisplay);
            controls.appendChild(row);
          };

          createSlider('دور سیم‌پیچ (N)', 1, 20, 1, N_turns, val => {
            N_turns = val;
            drawCoil();
          });
          
          const toggleRow = document.createElement('div');
          toggleRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-top:8px;';
          const toggleBtn = document.createElement('button');
          toggleBtn.style.cssText = 'padding:4px 8px; border-radius:4px; border:none; background:var(--bg-secondary); color:var(--text-primary); cursor:pointer; font-size:12px; font-weight:700; border: 1px solid var(--border-subtle); width:100%;';
          toggleBtn.textContent = isReversed ? 'قطب سمت سیم‌پیچ: S' : 'قطب سمت سیم‌پیچ: N';
          toggleBtn.addEventListener('click', () => {
             isReversed = !isReversed;
             toggleBtn.textContent = isReversed ? 'قطب سمت سیم‌پیچ: S' : 'قطب سمت سیم‌پیچ: N';
             updateMagnet();
          });
          toggleRow.appendChild(toggleBtn);
          controls.appendChild(toggleRow);

          info.appendChild(controls);
        }
      } else if (spec.type === 'incline_friction') {
        let theta = spec.angle || 0; // degrees
        let m = spec.mass || 10; // kg
        let mu_s = (spec.mu_s !== undefined) ? spec.mu_s : 0.5;
        let mu_k = (spec.mu_k !== undefined) ? spec.mu_k : 0.3;
        
        const g_accel = 9.8;
        const pad = 20;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        const originX = pad + 20;
        const originY = h + pad - 20; // Bottom-left pivot
        
        const rampGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(rampGroup);
        
        const baseLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        baseLine.setAttribute("stroke", "var(--text-secondary)");
        baseLine.setAttribute("stroke-width", "2");
        baseLine.setAttribute("stroke-dasharray", "4,4");
        rampGroup.appendChild(baseLine);
        
        const rampLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        rampLine.setAttribute("stroke", "var(--text-primary)");
        rampLine.setAttribute("stroke-width", "4");
        rampLine.setAttribute("stroke-linecap", "round");
        rampGroup.appendChild(rampLine);
        
        const block = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        block.setAttribute("fill", "var(--color-warning)");
        block.setAttribute("stroke", "var(--text-primary)");
        block.setAttribute("stroke-width", "2");
        block.setAttribute("rx", "2");
        rampGroup.appendChild(block);
        
        const vectorsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        rampGroup.appendChild(vectorsGroup);
        
        let Fn = 0, f = 0, a = 0;
        let isSliding = false;
        let blockX = 0; // relative to origin on the ramp
        let blockV = 0;
        
        const rampLength = w - 40;
        const blockW = 40;
        const blockH = 30;
        
        function updatePhysics() {
          const rad = theta * Math.PI / 180;
          const Fg = m * g_accel;
          const Fg_x = Fg * Math.sin(rad);
          Fn = Fg * Math.cos(rad);
          
          const max_fs = mu_s * Fn;
          
          if (!isSliding) {
            if (Fg_x > max_fs) {
              isSliding = true;
            } else {
              f = Fg_x;
              a = 0;
            }
          }
          
          if (isSliding) {
            f = mu_k * Fn;
            a = (Fg_x - f) / m;
            if (a < 0 && blockV <= 0) { // Should not slide up unless pushed
              isSliding = false;
              blockV = 0;
              f = Fg_x;
              a = 0;
            }
          }
        }
        
        function drawVectors(bx, by, rad) {
           vectorsGroup.innerHTML = '';
           
           const makeArrow = (x1, y1, x2, y2, color) => {
              if (Math.abs(x1-x2) < 0.1 && Math.abs(y1-y2) < 0.1) return;
              const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
              line.setAttribute("x1", x1); line.setAttribute("y1", y1);
              line.setAttribute("x2", x2); line.setAttribute("y2", y2);
              line.setAttribute("stroke", color); line.setAttribute("stroke-width", "2");
              
              const angle = Math.atan2(y2 - y1, x2 - x1);
              const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
              head.setAttribute("d", `M ${x2} ${y2} L ${x2 - 8 * Math.cos(angle - Math.PI/6)} ${y2 - 8 * Math.sin(angle - Math.PI/6)} L ${x2 - 8 * Math.cos(angle + Math.PI/6)} ${y2 - 8 * Math.sin(angle + Math.PI/6)} Z`);
              head.setAttribute("fill", color);
              
              vectorsGroup.appendChild(line);
              vectorsGroup.appendChild(head);
           };
           
           const cx = bx + blockW/2;
           const cy = by - blockH/2;
           
           const Fg = m * g_accel;
           const Fg_scale = Fg * 0.5;
           
           // Gravity (straight down)
           makeArrow(cx, cy, cx, cy + Fg_scale, "var(--text-secondary)");
           
           // Normal force (perpendicular up)
           const Fn_scale = Fn * 0.5;
           makeArrow(cx, cy, cx - Fn_scale * Math.sin(rad), cy - Fn_scale * Math.cos(rad), "var(--color-primary)");
           
           // Friction (up the incline)
           const f_scale = f * 0.5;
           makeArrow(cx, cy, cx - f_scale * Math.cos(rad), cy + f_scale * Math.sin(rad), "var(--color-danger)");
        }
        
        let lastTime = performance.now();
        
        function animLoop() {
          if (!document.body.contains(svg)) return;
          const now = performance.now();
          const dt = Math.min((now - lastTime) / 1000, 0.05);
          lastTime = now;
          
          updatePhysics();
          
          if (isSliding) {
            blockV += a * dt * 100; // scale for visual speed
            blockX += blockV * dt;
          }
          
          if (blockX > rampLength - blockW) {
            blockX = rampLength - blockW;
            blockV = 0;
            isSliding = false;
          }
          if (blockX < 0) {
             blockX = 0;
             blockV = 0;
             if(a <= 0) isSliding = false;
          }
          
          const rad = theta * Math.PI / 180;
          
          baseLine.setAttribute("x1", originX);
          baseLine.setAttribute("y1", originY);
          baseLine.setAttribute("x2", originX + rampLength);
          baseLine.setAttribute("y2", originY);
          
          const endX = originX + rampLength * Math.cos(rad);
          const endY = originY - rampLength * Math.sin(rad);
          
          rampLine.setAttribute("x1", originX);
          rampLine.setAttribute("y1", originY);
          rampLine.setAttribute("x2", endX);
          rampLine.setAttribute("y2", endY);
          
          // Position block
          // distance from top
          const distFromTop = rampLength - blockW - blockX; 
          const bx = originX + distFromTop * Math.cos(rad);
          const by = originY - distFromTop * Math.sin(rad);
          
          block.setAttribute("x", 0);
          block.setAttribute("y", -blockH);
          block.setAttribute("width", blockW);
          block.setAttribute("height", blockH);
          block.setAttribute("transform", `translate(${bx}, ${by}) rotate(${-theta})`);
          
          drawVectors(bx, by, rad);
          
          if (infoStatsUpdate) infoStatsUpdate();
          
          requestAnimationFrame(animLoop);
        }
        
        requestAnimationFrame(animLoop);
        
        let infoStatsUpdate = null;
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; line-height: 1.8; font-size:12px;';
          info.appendChild(stats);

          infoStatsUpdate = () => {
            stats.innerHTML = `<div style="width:50%;">نیروی عمودی (F_N): ${toPersianDigits(Fn.toFixed(1))} N</div>
                               <div style="width:50%;">اصطکاک (f): ${toPersianDigits(f.toFixed(1))} N</div>
                               <div style="width:50%;">شتاب (a): ${toPersianDigits(a.toFixed(2))} m/s²</div>
                               <div style="width:50%;">وضعیت: <span style="font-weight:bold; color:${isSliding ? 'var(--color-danger)' : 'var(--text-primary)'};">${isSliding ? 'در حال لغزش' : 'ایستاده'}</span></div>`;
          };

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '70px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            const valDisplay = document.createElement('span');
            valDisplay.style.width = '30px';
            valDisplay.style.textAlign = 'left';
            valDisplay.textContent = val;

            input.addEventListener('input', e => {
              const newVal = parseFloat(e.target.value);
              valDisplay.textContent = newVal;
              onChange(newVal);
            });
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(valDisplay);
            controls.appendChild(row);
          };

          createSlider('زاویه (θ)', 0, 80, 1, theta, val => theta = val);
          createSlider('جرم (m)', 1, 50, 1, m, val => m = val);
          createSlider('ضریب µs', 0.1, 1.0, 0.05, mu_s, val => mu_s = val);
          createSlider('ضریب µk', 0.05, 0.9, 0.05, mu_k, val => mu_k = Math.min(val, mu_s));
          
          const resetBtn = document.createElement('button');
          resetBtn.style.cssText = 'padding:4px 8px; border-radius:4px; border:none; background:var(--bg-secondary); color:var(--text-primary); cursor:pointer; font-size:12px; font-weight:700; border: 1px solid var(--border-subtle); margin-top: 8px;';
          resetBtn.textContent = 'بازنشانی موقعیت';
          resetBtn.addEventListener('click', () => {
             blockX = 0;
             blockV = 0;
             isSliding = false;
          });
          controls.appendChild(resetBtn);

          info.appendChild(controls);
        }
      } else if (spec.type === 'doppler') {
        let v_s = spec.v_s || 0; // source velocity (-340 to 340 m/s)
        let v_o = spec.v_o || 0; // observer velocity (-340 to 340 m/s)
        let f = spec.frequency || 500; // Hz
        const v_sound = 340; // m/s
        
        const pad = 20;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        let cx = pad + w / 2;
        const cy = pad + h / 2;
        
        const wavesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(wavesGroup);
        
        const source = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        source.setAttribute("r", 6);
        source.setAttribute("fill", "var(--color-danger)");
        g.appendChild(source);
        
        const observer = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        observer.setAttribute("width", 10);
        observer.setAttribute("height", 10);
        observer.setAttribute("fill", "var(--color-primary)");
        observer.setAttribute("rx", "2");
        g.appendChild(observer);
        
        let waves = []; // { x, y, r, t0 }
        let f_prime = f;
        
        let simTime = 0;
        let lastTime = performance.now();
        let sx = cx - w/4;
        let ox = cx + w/4;
        
        // Let's have the source emit a wave periodically
        // Real frequency is too high, so we scale it for visualization
        // Visual frequency f_vis ~ proportional to f
        let lastEmitTime = 0;
        
        function getFPrime() {
           // f' = f * (v ± v_o) / (v ∓ v_s)
           // Positive direction is from source to observer (rightwards)
           // If v_o > 0, observer moves away from source (in our sim, right is away) if source is on left
           // Actually, standard formula: 
           // f' = f * (v + v_o) / (v - v_s) where v_o is velocity TOWARDS source, v_s is velocity TOWARDS observer.
           // In our 1D sim: right is positive.
           // Source is on left, observer on right.
           // Source moving right (v_s > 0) means towards observer.
           // Observer moving right (v_o > 0) means away from source.
           // So formula for this setup:
           // f' = f * (v_sound - v_o) / (v_sound - v_s)
           let denom = v_sound - v_s;
           if (denom === 0) denom = 0.01;
           return f * (v_sound - v_o) / denom;
        }
        
        function animLoop() {
           if (!document.body.contains(svg)) return;
           const now = performance.now();
           const dt = Math.min((now - lastTime) / 1000, 0.05); // sim time in seconds
           lastTime = now;
           simTime += dt;
           
           // update positions
           // wrap around or bounce
           sx += (v_s * 50 / v_sound) * dt; // visual speed scale
           ox += (v_o * 50 / v_sound) * dt;
           
           if (sx > pad + w) sx = pad;
           if (sx < pad) sx = pad + w;
           
           if (ox > pad + w) ox = pad;
           if (ox < pad) ox = pad + w;
           
           source.setAttribute("cx", sx);
           source.setAttribute("cy", cy);
           
           observer.setAttribute("x", ox - 5);
           observer.setAttribute("y", cy - 5);
           
           // Emit waves
           const visualPeriod = 1 / (f / 100); // scaled period for visualization
           if (simTime - lastEmitTime > visualPeriod) {
              waves.push({ x: sx, y: cy, t0: simTime });
              lastEmitTime = simTime;
           }
           
           // Update waves
           wavesGroup.innerHTML = '';
           const visualSoundSpeed = 50; // pixels per second
           
           // We filter out waves that are too big
           waves = waves.filter(w => (simTime - w.t0) * visualSoundSpeed < 200);
           
           for (let w of waves) {
              const r = (simTime - w.t0) * visualSoundSpeed;
              const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              circle.setAttribute("cx", w.x);
              circle.setAttribute("cy", w.y);
              circle.setAttribute("r", r);
              circle.setAttribute("fill", "none");
              circle.setAttribute("stroke", "var(--text-secondary)");
              circle.setAttribute("stroke-width", "1");
              circle.setAttribute("opacity", Math.max(0, 1 - r/200).toString());
              wavesGroup.appendChild(circle);
           }
           
           f_prime = getFPrime();
           if (infoStatsUpdate) infoStatsUpdate();
           
           requestAnimationFrame(animLoop);
        }
        
        requestAnimationFrame(animLoop);
        
        let infoStatsUpdate = null;
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; line-height: 1.8; font-size:12px;';
          info.appendChild(stats);

          infoStatsUpdate = () => {
            const sonicBoom = v_s >= v_sound;
            stats.innerHTML = `<div style="width:100%;">فرکانس منبع (f): ${toPersianDigits(f.toFixed(0))} Hz</div>
                               <div style="width:100%;">فرکانس دریافتی (f'): <span style="font-weight:bold; color:var(--color-primary);">${sonicBoom ? 'دیوار صوتی (Sonic Boom)' : toPersianDigits(Math.max(0, f_prime).toFixed(0)) + ' Hz'}</span></div>`;
          };
          infoStatsUpdate();

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '100px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            const valDisplay = document.createElement('span');
            valDisplay.style.width = '30px';
            valDisplay.style.textAlign = 'left';
            valDisplay.textContent = val;

            input.addEventListener('input', e => {
              const newVal = parseFloat(e.target.value);
              valDisplay.textContent = newVal;
              onChange(newVal);
            });
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(valDisplay);
            controls.appendChild(row);
          };

          createSlider('سرعت چشمه (v_s)', -300, 340, 10, v_s, val => v_s = val);
          createSlider('سرعت ناظر (v_o)', -300, 300, 10, v_o, val => v_o = val);
          createSlider('فرکانس (f)', 100, 1000, 50, f, val => f = val);

          info.appendChild(controls);
        }
      } else if (spec.type === 'photoelectric') {
        let lambda = spec.wavelength || 400; // nm
        let intensity = spec.intensity || 50; // 0 to 100
        let W0 = spec.work_function || 2.0; // eV
        let V = spec.voltage || 0; // -5 to 5 V (negative means stopping potential direction in typical setup, let's say V is the voltage of right plate relative to left plate)
        
        // If V < 0, it repels electrons.
        
        const pad = 20;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        const plateW = 20;
        const plateH = 120;
        const leftPlateX = pad + 60;
        const rightPlateX = pad + w - 60;
        const plateY = pad + (h - plateH)/2;
        
        // Draw Circuit
        const circuitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        circuitPath.setAttribute("d", `M ${leftPlateX} ${plateY+plateH} L ${leftPlateX} ${pad+h-10} L ${pad+w/2 - 20} ${pad+h-10} M ${pad+w/2 + 20} ${pad+h-10} L ${rightPlateX+plateW} ${pad+h-10} L ${rightPlateX+plateW} ${plateY+plateH}`);
        circuitPath.setAttribute("stroke", "var(--text-secondary)");
        circuitPath.setAttribute("stroke-width", "2");
        circuitPath.setAttribute("fill", "none");
        g.appendChild(circuitPath);
        
        // Battery and Ammeter
        const battery = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(battery);
        function updateBattery() {
           battery.innerHTML = '';
           // Ammeter
           const ammeter = document.createElementNS("http://www.w3.org/2000/svg", "circle");
           ammeter.setAttribute("cx", rightPlateX + plateW);
           ammeter.setAttribute("cy", pad+h-10);
           ammeter.setAttribute("r", 12);
           ammeter.setAttribute("fill", "var(--bg-card)");
           ammeter.setAttribute("stroke", "var(--text-primary)");
           ammeter.setAttribute("stroke-width", "2");
           battery.appendChild(ammeter);
           
           const aText = document.createElementNS("http://www.w3.org/2000/svg", "text");
           aText.setAttribute("x", rightPlateX + plateW);
           aText.setAttribute("y", pad+h-6);
           aText.setAttribute("text-anchor", "middle");
           aText.setAttribute("fill", "var(--text-primary)");
           aText.setAttribute("font-size", "10px");
           aText.setAttribute("font-weight", "bold");
           aText.textContent = "A";
           battery.appendChild(aText);
           
           // Battery Symbol
           const bx = pad+w/2;
           const by = pad+h-10;
           const bLong = document.createElementNS("http://www.w3.org/2000/svg", "line");
           const bShort = document.createElementNS("http://www.w3.org/2000/svg", "line");
           
           // V > 0 means right plate is positive, left is negative
           // Long line is positive
           if (V >= 0) {
              bShort.setAttribute("x1", bx - 10); bShort.setAttribute("x2", bx - 10);
              bShort.setAttribute("y1", by - 10); bShort.setAttribute("y2", by + 10);
              bLong.setAttribute("x1", bx + 10); bLong.setAttribute("x2", bx + 10);
              bLong.setAttribute("y1", by - 15); bLong.setAttribute("y2", by + 15);
           } else {
              bLong.setAttribute("x1", bx - 10); bLong.setAttribute("x2", bx - 10);
              bLong.setAttribute("y1", by - 15); bLong.setAttribute("y2", by + 15);
              bShort.setAttribute("x1", bx + 10); bShort.setAttribute("x2", bx + 10);
              bShort.setAttribute("y1", by - 10); bShort.setAttribute("y2", by + 10);
           }
           bLong.setAttribute("stroke", "var(--text-primary)"); bLong.setAttribute("stroke-width", "2");
           bShort.setAttribute("stroke", "var(--text-primary)"); bShort.setAttribute("stroke-width", "4");
           battery.appendChild(bLong);
           battery.appendChild(bShort);
           
           const wireConn = document.createElementNS("http://www.w3.org/2000/svg", "line");
           wireConn.setAttribute("x1", bx - 10); wireConn.setAttribute("x2", bx + 10);
           wireConn.setAttribute("y1", by); wireConn.setAttribute("y2", by);
           wireConn.setAttribute("stroke", "var(--text-secondary)");
           wireConn.setAttribute("stroke-width", "2");
           battery.appendChild(wireConn);
        }
        
        // Plates
        const leftPlate = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        leftPlate.setAttribute("x", leftPlateX - plateW);
        leftPlate.setAttribute("y", plateY);
        leftPlate.setAttribute("width", plateW);
        leftPlate.setAttribute("height", plateH);
        leftPlate.setAttribute("fill", "var(--text-tertiary)");
        g.appendChild(leftPlate);
        
        const rightPlate = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rightPlate.setAttribute("x", rightPlateX);
        rightPlate.setAttribute("y", plateY);
        rightPlate.setAttribute("width", plateW);
        rightPlate.setAttribute("height", plateH);
        rightPlate.setAttribute("fill", "var(--text-secondary)");
        g.appendChild(rightPlate);
        
        // Light Beam
        const lightPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        lightPath.setAttribute("fill", "none");
        lightPath.setAttribute("stroke-width", "3");
        g.appendChild(lightPath);
        
        // Photons and Electrons Group
        const particlesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(particlesGroup);
        
        let electrons = [];
        let E_photon = 0;
        let K_max = 0;
        let current = 0;
        
        function wavelengthToColor(wl) {
           if (wl < 380) return "#8a2be2"; // UV to purple
           if (wl < 450) return "#0000ff";
           if (wl < 495) return "#00ffff";
           if (wl < 570) return "#00ff00";
           if (wl < 590) return "#ffff00";
           if (wl < 620) return "#ffa500";
           if (wl <= 750) return "#ff0000";
           return "#8b0000"; // IR
        }
        
        function updatePhysics() {
           E_photon = 1240 / lambda;
           K_max = E_photon - W0;
           
           // Visual Light Beam
           const color = wavelengthToColor(lambda);
           lightPath.setAttribute("stroke", color);
           lightPath.setAttribute("opacity", (intensity / 100).toString());
           
           const numWaves = 5;
           let d = '';
           for(let i=0; i<numWaves; i++) {
              const yStart = plateY + 10 + (plateH - 20) * (i / (numWaves-1 || 1));
              d += `M ${pad} ${yStart - 30} L ${leftPlateX - plateW} ${yStart} `;
           }
           lightPath.setAttribute("d", d);
           updateBattery();
        }
        
        let lastTime = performance.now();
        let emitTimer = 0;
        
        function animLoop() {
           if (!document.body.contains(svg)) return;
           const now = performance.now();
           const dt = Math.min((now - lastTime) / 1000, 0.05);
           lastTime = now;
           
           updatePhysics();
           
           // Emit electrons
           emitTimer += dt;
           const emitRate = intensity * 0.5; // per second
           if (K_max > 0 && emitRate > 0) {
              if (emitTimer > 1 / emitRate) {
                 emitTimer = 0;
                 // Random kinetic energy between 0 and K_max
                 const K = Math.random() * K_max;
                 // Initial velocity proportional to sqrt(K)
                 const vx = 20 + Math.sqrt(K) * 50; 
                 // Random slight angle
                 const vy = (Math.random() - 0.5) * 20;
                 
                 const yPos = plateY + 10 + Math.random() * (plateH - 20);
                 electrons.push({ x: leftPlateX, y: yPos, vx, vy, K_initial: K, active: true });
              }
           }
           
           // Update electrons
           let reachedCount = 0;
           for (let e of electrons) {
              if (!e.active) continue;
              
              // Acceleration due to E field (V / distance)
              // E is uniform between plates. distance = rightPlateX - leftPlateX
              // Force on electron: F = -e * E = -e * (-V / d) = e * V / d
              // If V > 0, force is positive (to the right, accelerates).
              // If V < 0, force is negative (to the left, decelerates).
              // Acceleration is proportional to Force.
              const ax = (V * 100); 
              
              e.vx += ax * dt;
              e.x += e.vx * dt;
              e.y += e.vy * dt;
              
              // If hits right plate
              if (e.x >= rightPlateX) {
                 e.active = false;
                 reachedCount++;
              }
              
              // If turns back and hits left plate
              if (e.x <= leftPlateX && e.vx < 0) {
                 e.active = false;
              }
              
              // Out of bounds Y
              if (e.y < pad || e.y > pad+h) {
                 e.active = false;
              }
           }
           
           // Remove inactive
           electrons = electrons.filter(e => e.active);
           
           // Draw electrons
           particlesGroup.innerHTML = '';
           for (let e of electrons) {
              const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              el.setAttribute("cx", e.x);
              el.setAttribute("cy", e.y);
              el.setAttribute("r", 3);
              el.setAttribute("fill", "var(--color-primary)");
              particlesGroup.appendChild(el);
           }
           
           // Current calculation (smoothed)
           // Reached electrons contribute to current
           const instantCurrent = (reachedCount / dt) * 0.1; // arbitrary scale
           current = current * 0.9 + instantCurrent * 0.1;
           if (K_max <= 0) current = 0; // exactly 0 if no emission
           
           if (infoStatsUpdate) infoStatsUpdate();
           
           requestAnimationFrame(animLoop);
        }
        
        requestAnimationFrame(animLoop);
        
        let infoStatsUpdate = null;
        
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; line-height: 1.8; font-size:12px;';
          info.appendChild(stats);

          infoStatsUpdate = () => {
            const Vs = K_max > 0 ? -K_max : 0;
            stats.innerHTML = `<div style="width:50%;">انرژی فوتون (E): ${toPersianDigits(E_photon.toFixed(2))} eV</div>
                               <div style="width:50%;">انرژی جنبشی بیشینه (K_max): ${toPersianDigits(Math.max(0, K_max).toFixed(2))} eV</div>
                               <div style="width:50%;">ولتاژ متوقف‌کننده (V_s): ${toPersianDigits(Vs.toFixed(2))} V</div>
                               <div style="width:50%;">جریان نسبی: ${toPersianDigits(current.toFixed(1))} mA</div>`;
          };

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '80px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            const valDisplay = document.createElement('span');
            valDisplay.style.width = '30px';
            valDisplay.style.textAlign = 'left';
            valDisplay.textContent = val;

            input.addEventListener('input', e => {
              const newVal = parseFloat(e.target.value);
              valDisplay.textContent = newVal;
              onChange(newVal);
            });
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(valDisplay);
            controls.appendChild(row);
          };

          createSlider('طول موج (nm)', 100, 800, 10, lambda, val => lambda = val);
          createSlider('شدت نور (%)', 0, 100, 5, intensity, val => intensity = val);
          createSlider('تابع کار (eV)', 1.0, 5.0, 0.1, W0, val => W0 = val);
          createSlider('ولتاژ (V)', -5, 5, 0.1, V, val => V = val);

          info.appendChild(controls);
        }
      } else if (spec.type === 'u_tube') {
        let leftType = spec.left_type || 'open';
        let rhoBase = spec.rho_base || 1000;
        let rhoRight = spec.rho_right || spec.rho_add || 800;
        let hRight = spec.h_right || spec.h_add || 15;
        let rhoLeft = spec.rho_left || 1000;
        let hLeft = spec.h_left || 0;
        let pGas = spec.p_gas || 103; // kPa
        
        const pad = 20;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        const tubeW = 30;
        const w2 = tubeW/2;
        const lx = pad + w/2 - 60;
        const rx = pad + w/2 + 60;
        const bottomY = pad + h - 10;
        const topY = pad + 70;
        
        const pxPerCm = 3;
        
        let leftLevel = 0, rightLevel = 0, interfaceLevel = 0;
        let dh_cm = 0;
        
        const liquidGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(liquidGroup);
        
        const glassGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(glassGroup);
        
        const uiGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(uiGroup);
        
        // Liquids
        const baseColor = leftType === 'gas' ? "var(--color-primary-soft)" : "#4285F4";
        const addColor = "#F4B400";
        
        const baseBottom = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const baseLeft = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const baseRight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const addedRight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const addedLeft = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        
        baseBottom.setAttribute("x", lx - w2 + 2);
        baseBottom.setAttribute("y", bottomY - tubeW + 2);
        baseBottom.setAttribute("width", rx - lx + 2*w2 - 4);
        baseBottom.setAttribute("height", tubeW - 4);
        baseBottom.setAttribute("fill", baseColor);
        
        baseLeft.setAttribute("x", lx - w2 + 2);
        baseLeft.setAttribute("width", 2*w2 - 4);
        baseLeft.setAttribute("fill", baseColor);
        
        baseRight.setAttribute("x", rx - w2 + 2);
        baseRight.setAttribute("width", 2*w2 - 4);
        baseRight.setAttribute("fill", baseColor);
        
        addedRight.setAttribute("x", rx - w2 + 2);
        addedRight.setAttribute("width", 2*w2 - 4);
        addedRight.setAttribute("fill", addColor);
        
        addedLeft.setAttribute("x", lx - w2 + 2);
        addedLeft.setAttribute("width", 2*w2 - 4);
        addedLeft.setAttribute("fill", "#34A853");
        
        liquidGroup.appendChild(baseBottom);
        liquidGroup.appendChild(baseLeft);
        liquidGroup.appendChild(baseRight);
        if (leftType !== 'gas') {
           liquidGroup.appendChild(addedRight);
           liquidGroup.appendChild(addedLeft);
        }
        
        // Glass
        const glassOuter = document.createElementNS("http://www.w3.org/2000/svg", "path");
        glassOuter.setAttribute("d", `M ${lx - w2} ${topY} L ${lx - w2} ${bottomY} L ${rx + w2} ${bottomY} L ${rx + w2} ${topY}`);
        glassOuter.setAttribute("fill", "none");
        glassOuter.setAttribute("stroke", "var(--text-primary)");
        glassOuter.setAttribute("stroke-width", "3");
        glassOuter.setAttribute("stroke-linejoin", "round");
        glassGroup.appendChild(glassOuter);
        
        const glassInner = document.createElementNS("http://www.w3.org/2000/svg", "path");
        glassInner.setAttribute("d", `M ${lx + w2} ${topY} L ${lx + w2} ${bottomY - tubeW} L ${rx - w2} ${bottomY - tubeW} L ${rx - w2} ${topY}`);
        glassInner.setAttribute("fill", "none");
        glassInner.setAttribute("stroke", "var(--text-primary)");
        glassInner.setAttribute("stroke-width", "3");
        glassInner.setAttribute("stroke-linejoin", "round");
        glassGroup.appendChild(glassInner);
        
        if (leftType === 'gas') {
           const gBoxW = 80;
           const gBoxH = 60;
           const gBoxX = lx - gBoxW/2;
           const gBoxY = topY - gBoxH; 
           
           const gasBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
           gasBox.setAttribute("x", gBoxX);
           gasBox.setAttribute("y", gBoxY);
           gasBox.setAttribute("width", gBoxW);
           gasBox.setAttribute("height", gBoxH);
           gasBox.setAttribute("rx", "10");
           gasBox.setAttribute("fill", "var(--bg-card)");
           gasBox.setAttribute("stroke", "var(--text-primary)");
           gasBox.setAttribute("stroke-width", "3");
           glassGroup.appendChild(gasBox);
           
           for (let i=0; i<30; i++) {
               const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
               dot.setAttribute("cx", gBoxX + 5 + Math.random()*(gBoxW-10));
               dot.setAttribute("cy", gBoxY + 5 + Math.random()*(gBoxH-10));
               dot.setAttribute("r", 1.5);
               dot.setAttribute("fill", "var(--text-secondary)");
               glassGroup.appendChild(dot);
           }
           
           const gt = document.createElementNS("http://www.w3.org/2000/svg", "text");
           gt.setAttribute("x", gBoxX + gBoxW/2);
           gt.setAttribute("y", gBoxY + gBoxH/2 + 5);
           gt.setAttribute("text-anchor", "middle");
           gt.setAttribute("fill", "var(--text-primary)");
           gt.setAttribute("font-weight", "bold");
           gt.textContent = "گاز";
           glassGroup.appendChild(gt);
           
           const cover = document.createElementNS("http://www.w3.org/2000/svg", "rect");
           cover.setAttribute("x", lx - w2 + 2);
           cover.setAttribute("y", topY - 2);
           cover.setAttribute("width", 2*w2 - 4);
           cover.setAttribute("height", 4);
           cover.setAttribute("fill", "var(--bg-card)");
           glassGroup.appendChild(cover);
        }
        
        const dashLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        dashLine.setAttribute("stroke", "var(--text-primary)");
        dashLine.setAttribute("stroke-dasharray", "4,4");
        dashLine.setAttribute("stroke-width", "1");
        uiGroup.appendChild(dashLine);
        
        const levelLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        levelLabel.setAttribute("fill", "var(--text-secondary)");
        levelLabel.setAttribute("font-size", "10px");
        uiGroup.appendChild(levelLabel);
        
        function updatePhysics() {
           const totalL = 40; 
           let h_base_left = 0;
           let h_base_right = 0;

           if (leftType === 'gas') {
              const dp = (pGas - 101.325) * 1000;
              const dh_m = dp / (rhoBase * 9.8);
              dh_cm = dh_m * 100;
              
              rightLevel = (totalL + dh_cm) / 2;
              leftLevel = totalL - rightLevel;
              h_base_right = rightLevel;
              h_base_left = leftLevel;
              interfaceLevel = leftLevel; 
           } else {
              const dh_base = (rhoRight * hRight - rhoLeft * hLeft) / rhoBase;
              h_base_left = (totalL + dh_base) / 2;
              h_base_right = (totalL - dh_base) / 2;
              
              leftLevel = h_base_left + hLeft;
              rightLevel = h_base_right + hRight;
           }
           
           const clamp = (v) => Math.max(0, Math.min(60, v));
           const vl = clamp(leftLevel);
           const vr = clamp(rightLevel);
           const vbl = clamp(h_base_left);
           const vbr = clamp(h_base_right);
           
           baseLeft.setAttribute("y", bottomY - tubeW - vbl * pxPerCm);
           baseLeft.setAttribute("height", vbl * pxPerCm);
           
           baseRight.setAttribute("y", bottomY - tubeW - vbr * pxPerCm);
           baseRight.setAttribute("height", vbr * pxPerCm);
           
           let lowestLevel = Math.min(vbl, vbr);
           
           const intY = bottomY - tubeW - lowestLevel * pxPerCm;
           dashLine.setAttribute("x1", lx - w2 - 20);
           dashLine.setAttribute("x2", rx + w2 + 20);
           dashLine.setAttribute("y1", intY);
           dashLine.setAttribute("y2", intY);
           
           levelLabel.setAttribute("x", rx + w2 + 25);
           levelLabel.setAttribute("y", intY + 4);
           levelLabel.textContent = "خط تراز";
           
           if (leftType !== 'gas') {
              addedRight.setAttribute("y", bottomY - tubeW - vr * pxPerCm);
              addedRight.setAttribute("height", (vr - vbr) * pxPerCm);
              
              addedLeft.setAttribute("y", bottomY - tubeW - vl * pxPerCm);
              addedLeft.setAttribute("height", (vl - vbl) * pxPerCm);
           }
        }
        
        updatePhysics();
        
        let infoStatsUpdate = null;
        const info = card.querySelector('.physics-info-panel');
        if (info) {
          info.addEventListener('click', e => e.stopPropagation());
          info.addEventListener('pointerdown', e => e.stopPropagation());
          info.style.flexDirection = 'column';
          info.innerHTML = '';

          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; line-height: 1.8; font-size:12px;';
          info.appendChild(stats);

          infoStatsUpdate = () => {
            if (leftType === 'gas') {
               const diff = Math.abs(rightLevel - leftLevel);
               stats.innerHTML = `<div style="width:100%;">اختلاف ارتفاع (Δh): ${toPersianDigits(diff.toFixed(1))} cm</div>
                                  <div style="width:100%;">فشار گاز: ${toPersianDigits(pGas.toFixed(2))} kPa (P₀ = 101.325)</div>`;
            } else {
               const minLevel = Math.min(leftLevel - hLeft, rightLevel - hRight);
               const hl = leftLevel - hLeft - minLevel;
               const hr = rightLevel - hRight - minLevel;
               stats.innerHTML = `<div style="width:100%;">پایه راست تا خط تراز: ${toPersianDigits(hr.toFixed(1))} cm</div>
                                  <div style="width:100%;">پایه چپ تا خط تراز: ${toPersianDigits(hl.toFixed(1))} cm</div>`;
            }
          };
          infoStatsUpdate();

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:12px;';

          const createSlider = (label, min, max, step, val, onChange) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.width = '120px';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = val;
            input.style.flex = '1';
            
            const valDisplay = document.createElement('span');
            valDisplay.style.width = '40px';
            valDisplay.style.textAlign = 'left';
            valDisplay.textContent = val;

            input.addEventListener('input', e => {
              const newVal = parseFloat(e.target.value);
              valDisplay.textContent = newVal;
              onChange(newVal);
              updatePhysics();
              infoStatsUpdate();
            });
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(valDisplay);
            controls.appendChild(row);
          };

          if (leftType === 'gas') {
             createSlider('فشار گاز (kPa)', 90, 115, 0.1, pGas, val => pGas = val);
             createSlider('چگالی پایه', 500, 13600, 100, rhoBase, val => rhoBase = val);
          } else {
             createSlider('چگالی پایه', 500, 13600, 100, rhoBase, val => rhoBase = val);
             createSlider('چگالی راست', 400, 13600, 100, rhoRight, val => rhoRight = val);
             createSlider('ارتفاع راست (cm)', 0, 40, 1, hRight, val => hRight = val);
             createSlider('چگالی چپ', 400, 13600, 100, rhoLeft, val => rhoLeft = val);
             createSlider('ارتفاع چپ (cm)', 0, 40, 1, hLeft, val => hLeft = val);
          }

          info.appendChild(controls);
        }
      } else if (spec.type === 'manometer_tanks') {
        const p_a = spec.p_a || '0.12MPa';
        const h1 = spec.h1 || 'h';
        const h2 = spec.h2 || '11 cm';
        const liq1 = spec.liq1 || 'آب';
        const liq2 = spec.liq2 || 'آب';
        const text_a = spec.text_a || 'مخزن گاز A';
        const text_b = spec.text_b || 'مخزن گاز B';

        const svgStr = `<defs>
        <pattern id="dotPink" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#ffe6f0"/>
            <circle cx="3" cy="3" r="1.5" fill="#f48fb1"/>
            <circle cx="9" cy="9" r="1.5" fill="#f48fb1"/>
        </pattern>
        <pattern id="dotGreen" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#e8f5e9"/>
            <circle cx="3" cy="3" r="1.5" fill="#81c784"/>
            <circle cx="9" cy="9" r="1.5" fill="#81c784"/>
        </pattern>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3e2723" />
        </marker>
    </defs>

    <g transform="translate(40, 50)">
        <rect x="0" y="0" width="150" height="260" fill="url(#dotPink)" stroke="#3e2723" stroke-width="3"/>
        <text x="75" y="60" text-anchor="middle" font-size="20" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" font-weight="bold" direction="rtl">${text_a}</text>
        <text x="75" y="180" text-anchor="middle" font-size="20" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" font-weight="bold" direction="rtl">${p_a}</text>

        <rect x="150" y="0" width="200" height="260" fill="url(#dotGreen)" stroke="#3e2723" stroke-width="3"/>
        <text x="220" y="60" text-anchor="middle" font-size="20" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" font-weight="bold" direction="rtl">${text_b}</text>

        <path d="M 170 180 L 190 180 L 190 220 A 30 30 0 0 0 250 220 L 250 140 L 230 140 L 230 220 A 10 10 0 0 1 170 220 Z" fill="#03a9f4"/>
        <path d="M 150 90 L 160 90 A 30 30 0 0 1 190 120 L 190 220 A 30 30 0 0 0 250 220 L 250 70 M 230 70 L 230 220 A 10 10 0 0 1 170 220 L 170 120 A 10 10 0 0 0 160 110 L 150 110" fill="none" stroke="#3e2723" stroke-width="3"/>
        
        <line x1="150" y1="91.5" x2="150" y2="108.5" stroke="#ffe6f0" stroke-width="4"/>

        <path d="M 370 190 L 390 190 L 390 220 A 30 30 0 0 0 450 220 L 450 80 L 430 80 L 430 220 A 10 10 0 0 1 370 220 Z" fill="#03a9f4"/>
        <path d="M 350 90 L 360 90 A 30 30 0 0 1 390 120 L 390 220 A 30 30 0 0 0 450 220 L 450 40 M 430 40 L 430 220 A 10 10 0 0 1 370 220 L 370 120 A 10 10 0 0 0 360 110 L 350 110" fill="none" stroke="#3e2723" stroke-width="3"/>
        
        <line x1="350" y1="91.5" x2="350" y2="108.5" stroke="#e8f5e9" stroke-width="4"/>

        <line x1="160" y1="180" x2="225" y2="180" stroke="#3e2723" stroke-width="1.5" stroke-dasharray="6,4"/>
        <line x1="360" y1="190" x2="425" y2="190" stroke="#3e2723" stroke-width="1.5" stroke-dasharray="6,4"/>
        <line x1="425" y1="80" x2="475" y2="80" stroke="#3e2723" stroke-width="1.5" stroke-dasharray="6,4"/>

        <line x1="210" y1="145" x2="210" y2="175" stroke="#3e2723" stroke-width="2" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <text x="220" y="165" font-size="16" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">${h1}</text>

        <line x1="465" y1="85" x2="465" y2="185" stroke="#3e2723" stroke-width="2" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <g transform="translate(485, 135) rotate(90)">
            <text x="0" y="0" text-anchor="middle" font-size="18" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">${h2}</text>
        </g>

        <text x="260" y="240" font-size="18" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">${liq1}</text>
        <line x1="250" y1="235" x2="235" y2="225" stroke="#3e2723" stroke-width="1.5"/>

        <text x="460" y="240" font-size="18" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">${liq2}</text>
        <line x1="450" y1="235" x2="435" y2="225" stroke="#3e2723" stroke-width="1.5"/>

        <text x="440" y="25" text-anchor="middle" font-size="18" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">هوای محیط</text>
        <line x1="440" y1="30" x2="440" y2="40" stroke="#3e2723" stroke-width="1.5"/>

    </g>`;
        g.innerHTML = svgStr;
      } else if (spec.type === 'tube_system') {
        const arms = spec.arms || [];
        const connections = spec.connections || [];
        const liquids = spec.liquids || [];
        const labels = spec.labels || [];
        const dashedLines = spec.lines || [];
        
        const pad = 30;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        const pipeH = 20;
        const gap = 40;
        
        // Calculate X positions
        if (arms.length === 0) return;
        let totalW = 0;
        arms.forEach((arm, i) => {
           if (!arm) return;
           if(arm) totalW += (arm.w || 20) || 20;
           if (i < arms.length - 1) totalW += gap;
        });
        
        let startX = pad + (w - totalW) / 2;
        let cx = [];
        let curX = startX;
        arms.forEach(arm => {
           if (!arm) return;
           cx.push(curX + (arm ? ((arm.w || 20) || 20) : 20) / 2);
           curX += (arm ? ((arm.w || 20) || 20) : 20) + gap;
        });
        
        const bottomY = pad + h - 20;
        const pxPerCm = spec.px_per_cm || 2.5;
        
        const liqGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const glassGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const uiGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(liqGroup);
        g.appendChild(glassGroup);
        g.appendChild(uiGroup);
        
        // Draw Liquids
        liquids.forEach(liq => {
           const color = liq.color || '#4285F4';
           if (liq.arm !== undefined && arms[liq.arm]) {
              const arm = arms[liq.arm];
              const c = cx[liq.arm];
              const h1 = (liq.h1 || 0) * pxPerCm;
              const h2 = (liq.h2 || 0) * pxPerCm;
              const yBottom = bottomY - h1;
              const yTop = bottomY - h2;
              
              const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
              rect.setAttribute("x", c - (arm.w || 20)/2 + 2);
              rect.setAttribute("y", yTop);
              rect.setAttribute("width", (arm.w || 20) - 4);
              rect.setAttribute("height", Math.max(0, yBottom - yTop));
              rect.setAttribute("fill", color);
              liqGroup.appendChild(rect);
           } else if (liq.conn) {
              const [a1, a2] = liq.conn;
              const type = liq.type || 'bottom';
              if (arms[a1] && arms[a2]) {
                  if (type === 'bottom') {
                     const x1 = cx[a1] + (arms[a1] ? arms[a1].w || 20 : 20)/2;
                     const x2 = cx[a2] - (arms[a2] ? arms[a2].w || 20 : 20)/2;
                     const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                     rect.setAttribute("x", x1 - 2);
                     rect.setAttribute("y", bottomY - pipeH + 2);
                     rect.setAttribute("width", Math.max(0, x2 - x1 + 4));
                     rect.setAttribute("height", pipeH - 4);
                     rect.setAttribute("fill", color);
                     liqGroup.appendChild(rect);
                  } else if (type === 'top') {
                     const y1 = bottomY - arms[a1].h;
                     const y2 = bottomY - arms[a2].h;
                     const topY = Math.max(y1, y2);
                     const x1 = cx[a1] + (arms[a1] ? arms[a1].w || 20 : 20)/2;
                     const x2 = cx[a2] - (arms[a2] ? arms[a2].w || 20 : 20)/2;
                     const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                     rect.setAttribute("x", x1 - 2); 
                     rect.setAttribute("y", topY + 2);
                     rect.setAttribute("width", Math.max(0, x2 - x1 + 4));
                     rect.setAttribute("height", pipeH - 4);
                     rect.setAttribute("fill", color);
                     liqGroup.appendChild(rect);
                  }
              }
           }
        });
        
        // Draw Glass Lines
        const lines = [];
        arms.forEach((arm, i) => {
           if (!arm) return;
           const x = cx[i];
           const w = (arm.w || 20);
           const topY = bottomY - (arm.h || 40);
           
           let leftBreaks = [];
           let rightBreaks = [];
           
           connections.forEach(c => {
              if (c.from === i || c.to === i) {
                 const other = c.from === i ? c.to : c.from;
                 if (!arms[other]) return;
                 const isRight = other > i;
                 
                 if (c.type === 'bottom') {
                    const by1 = bottomY - pipeH;
                    const by2 = bottomY;
                    if (isRight) rightBreaks.push([by1, by2]);
                    else leftBreaks.push([by1, by2]);
                    
                    if (c.from === i) {
                       const startX = x + w/2;
                       const endX = cx[c.to] - (arms[c.to] ? arms[c.to].w || 20 : 20)/2;
                       lines.push({x1: startX, y1: by1, x2: endX, y2: by1});
                       lines.push({x1: startX, y1: by2, x2: endX, y2: by2});
                    }
                 } else if (c.type === 'top') {
                    const ty1 = Math.max(topY, bottomY - arms[other].h);
                    const ty2 = ty1 + pipeH;
                    if (isRight) rightBreaks.push([ty1, ty2]);
                    else leftBreaks.push([ty1, ty2]);
                    
                    if (c.from === i) {
                       const startX = x + w/2;
                       const endX = cx[c.to] - (arms[c.to] ? arms[c.to].w || 20 : 20)/2;
                       lines.push({x1: startX, y1: ty1, x2: endX, y2: ty1});
                       lines.push({x1: startX, y1: ty2, x2: endX, y2: ty2});
                    }
                 }
              }
           });
           
           leftBreaks.sort((a,b) => a[0] - b[0]);
           let curY = topY;
           leftBreaks.forEach(brk => {
              if (brk[0] > curY) lines.push({x1: x - w/2, y1: curY, x2: x - w/2, y2: brk[0]});
              curY = Math.max(curY, brk[1]);
           });
           if (curY < bottomY) lines.push({x1: x - w/2, y1: curY, x2: x - w/2, y2: bottomY});
           
           rightBreaks.sort((a,b) => a[0] - b[0]);
           curY = topY;
           rightBreaks.forEach(brk => {
              if (brk[0] > curY) lines.push({x1: x + w/2, y1: curY, x2: x + w/2, y2: brk[0]});
              curY = Math.max(curY, brk[1]);
           });
           if (curY < bottomY) lines.push({x1: x + w/2, y1: curY, x2: x + w/2, y2: bottomY});
           
           lines.push({x1: x - w/2, y1: bottomY, x2: x + w/2, y2: bottomY});
           
           if (arm.type === 'closed') {
              lines.push({x1: x - w/2, y1: topY, x2: x + w/2, y2: topY});
           }
           
           if (arm.type === 'gas') {
               const gBoxW = (arm.w || 20) + 40;
               const gBoxH = 60;
               const gBoxX = x - gBoxW/2;
               const gBoxY = topY - gBoxH; 
               
               const gasBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
               gasBox.setAttribute("x", gBoxX);
               gasBox.setAttribute("y", gBoxY);
               gasBox.setAttribute("width", gBoxW);
               gasBox.setAttribute("height", gBoxH);
               gasBox.setAttribute("rx", "10");
               gasBox.setAttribute("fill", "var(--bg-card)");
               gasBox.setAttribute("stroke", "var(--text-primary)");
               gasBox.setAttribute("stroke-width", "3");
               glassGroup.appendChild(gasBox);
               
               for (let j=0; j<30; j++) {
                   const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                   dot.setAttribute("cx", gBoxX + 5 + Math.random()*(gBoxW-10));
                   dot.setAttribute("cy", gBoxY + 5 + Math.random()*(gBoxH-10));
                   dot.setAttribute("r", 1.5);
                   dot.setAttribute("fill", "var(--text-secondary)");
                   glassGroup.appendChild(dot);
               }
               
               const gt = document.createElementNS("http://www.w3.org/2000/svg", "text");
               gt.setAttribute("x", gBoxX + gBoxW/2);
               gt.setAttribute("y", gBoxY + gBoxH/2 + 5);
               gt.setAttribute("text-anchor", "middle");
               gt.setAttribute("fill", "var(--text-primary)");
               gt.setAttribute("font-weight", "bold");
               gt.textContent = arm.gas_text || "گاز";
               glassGroup.appendChild(gt);
               
               const cover = document.createElementNS("http://www.w3.org/2000/svg", "line");
               cover.setAttribute("x1", x - w/2 + 2);
               cover.setAttribute("y1", topY);
               cover.setAttribute("x2", x + w/2 - 2);
               cover.setAttribute("y2", topY);
               cover.setAttribute("stroke", "var(--bg-card)");
               cover.setAttribute("stroke-width", "5");
               glassGroup.appendChild(cover);
           }
        });
        
        lines.forEach(l => {
           const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
           line.setAttribute("x1", l.x1);
           line.setAttribute("y1", l.y1);
           line.setAttribute("x2", l.x2);
           line.setAttribute("y2", l.y2);
           line.setAttribute("stroke", "var(--text-primary)");
           line.setAttribute("stroke-width", "3");
           line.setAttribute("stroke-linecap", "round");
           glassGroup.appendChild(line);
        });
        
        // Draw Labels
        labels.forEach(lbl => {
            const arm = arms[lbl.arm];
            if (!arm) return;
            const c = cx[lbl.arm];
            const y1 = bottomY - (lbl.h1 || 0) * pxPerCm;
            const y2 = bottomY - (lbl.h2 || 0) * pxPerCm;
            const isLeft = lbl.pos === 'left';
            const x = isLeft ? c - (arm.w || 20)/2 - 15 : c + (arm.w || 20)/2 + 15;
            
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x); line.setAttribute("x2", x);
            line.setAttribute("y1", y1); line.setAttribute("y2", y2);
            line.setAttribute("stroke", "var(--text-secondary)");
            line.setAttribute("stroke-width", "1");
            
            const a1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            a1.setAttribute("d", `M ${x-2} ${y1+4} L ${x} ${y1} L ${x+2} ${y1+4}`);
            a1.setAttribute("fill", "none");
            a1.setAttribute("stroke", "var(--text-secondary)");
            
            const a2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            a2.setAttribute("d", `M ${x-2} ${y2-4} L ${x} ${y2} L ${x+2} ${y2-4}`);
            a2.setAttribute("fill", "none");
            a2.setAttribute("stroke", "var(--text-secondary)");
            
            const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
            const tx = isLeft ? x - 4 : x + 4;
            txt.setAttribute("x", tx);
            txt.setAttribute("y", (y1+y2)/2 + 4);
            txt.setAttribute("text-anchor", isLeft ? "end" : "start");
            txt.setAttribute("fill", "var(--text-primary)");
            txt.setAttribute("font-size", "10px");
            txt.textContent = lbl.text;
            
            uiGroup.appendChild(line);
            uiGroup.appendChild(a1);
            uiGroup.appendChild(a2);
            uiGroup.appendChild(txt);
        });
        
        // Draw Dashed Lines
        dashedLines.forEach(dl => {
            const y = bottomY - (dl.h || 0) * pxPerCm;
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", cx[0] - (arms[0] ? arms[0].w || 20 : 20)/2 - 20);
            line.setAttribute("x2", cx[cx.length-1] + (arms[arms.length-1] ? arms[arms.length-1].w || 20 : 20)/2 + 20);
            line.setAttribute("y1", y);
            line.setAttribute("y2", y);
            line.setAttribute("stroke", "var(--text-primary)");
            line.setAttribute("stroke-dasharray", "4,4");
            line.setAttribute("stroke-width", "1");
            uiGroup.appendChild(line);
        });
      }
      card.addEventListener('click', () => {
        const clonedSvg = container.querySelector('svg').cloneNode(true);
        clonedSvg.style.width = '100%';
        clonedSvg.style.height = '100%';
        clonedSvg.style.maxWidth = 'none';
        
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width: 100%; height: 60vh; overflow: auto; display: flex; justify-content: center; align-items: center; background: var(--bg-sunken); border-radius: 8px; border: 1px solid var(--border-subtle); padding: var(--space-3); box-sizing: border-box;';
        wrapper.appendChild(clonedSvg);
        
        openDialog({
          title: spec.title,
          content: wrapper,
          actions: [
            { label: 'بستن', variant: 'secondary' },
            { 
              label: 'دانلود تصویر', 
              variant: 'primary', 
              icon: 'download',
              keepOpen: true,
              onClick: () => downloadSvgAsPng(container.querySelector('svg'), spec.title)
            }
          ]
        });
      });
    });
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
    const cards = parent.querySelectorAll('.interactive-geometry-card');
    cards.forEach(card => {
      const specStr = card.getAttribute('data-spec');
      const spec = parseGeometrySpec(specStr);
      
      const titleEl = card.querySelector('.geometry-title-display');
      if (titleEl) titleEl.textContent = spec.title;
      
      const svg = card.querySelector('.geometry-svg');
      const infoPanel = card.querySelector('.geometry-info-panel');
      
      if (!svg) return;
      svg.innerHTML = '';
      
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const ptNames = Object.keys(spec.points);
      if (ptNames.length === 0) return;
      
      ptNames.forEach(name => {
        const pt = spec.points[name];
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      });
      
      const padding = 40;
      const width = 320;
      const height = 240;
      
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      
      const scaleX = (width - padding * 2) / rangeX;
      const scaleY = (height - padding * 2) / rangeY;
      const scale = Math.min(scaleX, scaleY);
      
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      
      const getSvgCoords = (pt) => ({
        x: width/2 + (pt.x - cx) * scale,
        y: height/2 - (pt.y - cy) * scale
      });
      
      if (ptNames.length >= 3) {
        let pointsArr = [];
        if (spec.sides.length > 0) {
           let current = spec.sides[0].p1;
           pointsArr.push(current);
           let remaining = [...spec.sides];
           while(remaining.length > 0) {
             let idx = remaining.findIndex(s => s.p1 === current || s.p2 === current);
             if (idx === -1) break;
             let s = remaining.splice(idx, 1)[0];
             let next = s.p1 === current ? s.p2 : s.p1;
             if (!pointsArr.includes(next)) {
               pointsArr.push(next);
             }
             current = next;
           }
        } else {
           pointsArr = ptNames;
        }
        
        const pathData = pointsArr.map((name, i) => {
          const pt = getSvgCoords(spec.points[name]);
          return (i === 0 ? 'M' : 'L') + ` ${pt.x} ${pt.y}`;
        }).join(' ') + ' Z';
        
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', pathData);
        pathEl.setAttribute('fill', 'rgba(61, 107, 255, 0.1)');
        pathEl.setAttribute('stroke', 'none');
        if (spec.area) {
          pathEl.style.cursor = 'pointer';
          pathEl.addEventListener('click', () => {
            infoPanel.innerHTML = `<strong>مساحت:</strong> ` + renderMarkdownAndMath(`$${spec.area}$`);
          });
        }
        svg.appendChild(pathEl);
      }
      
      spec.sides.forEach(side => {
        const p1 = getSvgCoords(spec.points[side.p1]);
        const p2 = getSvgCoords(spec.points[side.p2]);
        
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', p1.x);
        line.setAttribute('y1', p1.y);
        line.setAttribute('x2', p2.x);
        line.setAttribute('y2', p2.y);
        line.setAttribute('stroke', 'var(--color-primary)');
        line.setAttribute('stroke-width', '3');
        line.style.cursor = 'pointer';
        line.style.transition = 'all 0.2s';
        
        const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hitLine.setAttribute('x1', p1.x);
        hitLine.setAttribute('y1', p1.y);
        hitLine.setAttribute('x2', p2.x);
        hitLine.setAttribute('y2', p2.y);
        hitLine.setAttribute('stroke', 'transparent');
        hitLine.setAttribute('stroke-width', '20');
        hitLine.style.cursor = 'pointer';
        
        const showInfo = () => {
          line.setAttribute('stroke-width', '5');
          line.setAttribute('stroke', '#ff0055');
          infoPanel.innerHTML = `<strong>طول ضلع ${side.p1}${side.p2}:</strong> ` + renderMarkdownAndMath(`$${side.formula}$`);
        };
        const hideInfo = () => {
          line.setAttribute('stroke-width', '3');
          line.setAttribute('stroke', 'var(--color-primary)');
        };
        
        hitLine.addEventListener('mouseenter', showInfo);
        hitLine.addEventListener('mouseleave', hideInfo);
        hitLine.addEventListener('click', showInfo);
        
        svg.appendChild(line);
        svg.appendChild(hitLine);
        
        const cxMid = (p1.x + p2.x)/2;
        const cyMid = (p1.y + p2.y)/2;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', cxMid);
        text.setAttribute('y', cyMid - 8);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '12');
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', 'var(--text-secondary)');
        text.textContent = toPersianDigits(side.label);
        svg.appendChild(text);
      });
      
      ptNames.forEach(name => {
        const pt = getSvgCoords(spec.points[name]);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', pt.x);
        circle.setAttribute('cy', pt.y);
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', 'var(--bg-card)');
        circle.setAttribute('stroke', 'var(--color-primary)');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', pt.x);
        text.setAttribute('y', pt.y - 12);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '14');
        text.setAttribute('font-weight', '800');
        text.setAttribute('fill', 'var(--text-primary)');
        text.textContent = name;
        svg.appendChild(text);
      });
      
      spec.angles.forEach(angle => {
        const pt = getSvgCoords(spec.points[angle.p]);
        
        const hitCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hitCircle.setAttribute('cx', pt.x);
        hitCircle.setAttribute('cy', pt.y);
        hitCircle.setAttribute('r', '25');
        hitCircle.setAttribute('fill', 'rgba(255, 165, 0, 0.0)');
        hitCircle.style.cursor = 'pointer';
        hitCircle.style.transition = 'all 0.2s';
        
        const showInfo = () => {
          hitCircle.setAttribute('fill', 'rgba(255, 165, 0, 0.3)');
          infoPanel.innerHTML = `<strong>زاویه ${angle.p}:</strong> ` + renderMarkdownAndMath(`$${angle.formula}$`);
        };
        const hideInfo = () => {
          hitCircle.setAttribute('fill', 'rgba(255, 165, 0, 0.0)');
        };
        
        hitCircle.addEventListener('mouseenter', showInfo);
        hitCircle.addEventListener('mouseleave', hideInfo);
        hitCircle.addEventListener('click', showInfo);
        svg.appendChild(hitCircle);
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', pt.x + 18);
        text.setAttribute('y', pt.y + 18);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', '#ff9900');
        text.textContent = toPersianDigits(angle.label);
        svg.appendChild(text);
      });
    });
  }

  function initVennDiagrams(parent) {
    const cards = parent.querySelectorAll('.interactive-venn-card');
    cards.forEach((card) => {
      const specStr = card.getAttribute('data-spec');
      const spec = parseVennSpec(specStr);
      const isFourSets = (spec.label_D && spec.label_D.trim() !== '') || spec.elements_D.length > 0;
      const isThreeSets = !isFourSets && ((spec.label_C && spec.label_C.trim() !== '') || spec.elements_C.length > 0);
      
      const svg = card.querySelector('.venn-svg');
      const hoverInfo = card.querySelector('.hover-info');
      const resultDisplay = card.querySelector('.result-display');
      const resultTitle = card.querySelector('.result-title');
      const resultDesc = card.querySelector('.result-desc');
      const resultSet = card.querySelector('.result-set');
      
      // Regions
      const rURect = svg.querySelector('.U-rect');
      
      // Shaded state
      const shaded = isFourSets ? {
        A_only: false,
        B_only: false,
        C_only: false,
        D_only: false,
        AB_only: false,
        AC_only: false,
        AD_only: false,
        BC_only: false,
        BD_only: false,
        CD_only: false,
        ABC_only: false,
        ABD_only: false,
        ACD_only: false,
        BCD_only: false,
        ABCD: false,
        U_only: false
      } : isThreeSets ? {
        A_only: false,
        B_only: false,
        C_only: false,
        AB_only: false,
        AC_only: false,
        BC_only: false,
        ABC: false,
        U_only: false
      } : {
        A_only: false,
        B_only: false,
        intersection: false,
        U_only: false
      };

      // Populate elements spatially
      const renderElementsInGroup = (group, elements, centerX, centerY, scaleX = 1, scaleY = 1) => {
        if (!group) return;
        group.innerHTML = '';
        const K = elements.length;
        elements.forEach((el, i) => {
          let cx = centerX;
          let cy = centerY;
          if (K > 1) {
            const angle = (i * 2 * Math.PI) / K;
            const radius = K > 3 ? 18 : 10;
            cx = centerX + radius * Math.cos(angle) * scaleX;
            cy = centerY + radius * Math.sin(angle) * scaleY;
          }
          const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          textNode.setAttribute('x', cx.toString());
          textNode.setAttribute('y', cy.toString());
          textNode.setAttribute('dominant-baseline', 'middle');
          textNode.setAttribute('font-size', '9');
          textNode.setAttribute('font-weight', '800');
          textNode.setAttribute('fill', 'var(--text-secondary)');
          textNode.setAttribute('text-anchor', 'middle');
          textNode.textContent = toPersianDigits(el);
          group.appendChild(textNode);
        });
      };

      const gA = svg.querySelector('.elements-A-group');
      const gB = svg.querySelector('.elements-B-group');
      const gU = svg.querySelector('.elements-U-group');

      if (isFourSets) {
        const gC = svg.querySelector('.elements-C-group');
        const gD = svg.querySelector('.elements-D-group');
        const gAB = svg.querySelector('.elements-AB-group');
        const gAC = svg.querySelector('.elements-AC-group');
        const gAD = svg.querySelector('.elements-AD-group');
        const gBC = svg.querySelector('.elements-BC-group');
        const gBD = svg.querySelector('.elements-BD-group');
        const gCD = svg.querySelector('.elements-CD-group');
        const gABC = svg.querySelector('.elements-ABC-group');
        const gABD = svg.querySelector('.elements-ABD-group');
        const gACD = svg.querySelector('.elements-ACD-group');
        const gBCD = svg.querySelector('.elements-BCD-group');
        const gABCD = svg.querySelector('.elements-ABCD-group');

        if (spec.layout === 'disjoint') {
          renderElementsInGroup(gA, spec.elements_A, 70, 75);
          renderElementsInGroup(gB, spec.elements_B, 150, 75);
          renderElementsInGroup(gC, spec.elements_C, 230, 75);
          renderElementsInGroup(gD, spec.elements_D, 150, 145);
        } else if (spec.layout === 'subset') {
          renderElementsInGroup(gA, spec.elements_A, 150, 35);
          renderElementsInGroup(gB, spec.elements_B, 150, 60);
          renderElementsInGroup(gC, spec.elements_C, 150, 90);
          renderElementsInGroup(gD, spec.elements_D, 150, 110);
        } else { // overlapping
          renderElementsInGroup(gA, spec.elements_A, 80, 60);
          renderElementsInGroup(gB, spec.elements_B, 220, 60);
          renderElementsInGroup(gC, spec.elements_C, 80, 170);
          renderElementsInGroup(gD, spec.elements_D, 220, 170);
          
          renderElementsInGroup(gAB, spec.elements_AB, 150, 60);
          renderElementsInGroup(gAC, spec.elements_AC, 80, 115);
          renderElementsInGroup(gAD, spec.elements_AD, 135, 100);
          renderElementsInGroup(gBC, spec.elements_BC, 165, 100);
          renderElementsInGroup(gBD, spec.elements_BD, 220, 115);
          renderElementsInGroup(gCD, spec.elements_CD, 150, 170);
          
          renderElementsInGroup(gABC, spec.elements_ABC, 125, 105);
          renderElementsInGroup(gABD, spec.elements_ABD, 150, 85);
          renderElementsInGroup(gACD, spec.elements_ACD, 125, 125);
          renderElementsInGroup(gBCD, spec.elements_BCD, 175, 125);
          
          renderElementsInGroup(gABCD, spec.elements_ABCD, 150, 115);
        }
      } else if (isThreeSets) {
        const gC = svg.querySelector('.elements-C-group');
        const gAB = svg.querySelector('.elements-AB-group');
        const gAC = svg.querySelector('.elements-AC-group');
        const gBC = svg.querySelector('.elements-BC-group');
        const gABC = svg.querySelector('.elements-ABC-group');

        renderElementsInGroup(gA, spec.elements_A, 85, 80);
        renderElementsInGroup(gB, spec.elements_B, 215, 80);
        renderElementsInGroup(gC, spec.elements_C, 150, 160);
        renderElementsInGroup(gAB, spec.elements_AB, 150, 75);
        renderElementsInGroup(gAC, spec.elements_AC, 115, 125);
        renderElementsInGroup(gBC, spec.elements_BC, 185, 125);
        renderElementsInGroup(gABC, spec.elements_ABC, 150, 105);
      } else {
        const gIntersect = svg.querySelector('.elements-intersection-group');
        renderElementsInGroup(gA, spec.elements_A, 85, 100);
        renderElementsInGroup(gB, spec.elements_B, 215, 100);
        renderElementsInGroup(gIntersect, spec.elements_intersection, 150, 100, 0.5, 1.4);
      }
      
      // Render U elements in corners of the rectangle
      if (gU) {
        gU.innerHTML = '';
        spec.elements_U.forEach((el, i) => {
          const positions = isFourSets ? [
            { x: 45, y: 205 },
            { x: 255, y: 205 },
            { x: 45, y: 45 },
            { x: 255, y: 45 }
          ] : isThreeSets ? [
            { x: 45, y: 175 },
            { x: 255, y: 175 },
            { x: 45, y: 55 },
            { x: 255, y: 55 }
          ] : [
            { x: 45, y: 155 },
            { x: 255, y: 155 },
            { x: 45, y: 55 },
            { x: 255, y: 55 }
          ];
          const pos = positions[i % positions.length];
          const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          textNode.setAttribute('x', pos.x.toString());
          textNode.setAttribute('y', pos.y.toString());
          textNode.setAttribute('dominant-baseline', 'middle');
          textNode.setAttribute('font-size', '9');
          textNode.setAttribute('font-weight', '800');
          textNode.setAttribute('fill', 'var(--text-secondary)');
          textNode.setAttribute('text-anchor', 'middle');
          textNode.textContent = toPersianDigits(el);
          gU.appendChild(textNode);
        });
      }

      const updateShading = () => {
        if (isFourSets) {
          const rAPath = svg.querySelector('.A-path');
          const rBPath = svg.querySelector('.B-path');
          const rCPath = svg.querySelector('.C-path');
          const rDPath = svg.querySelector('.D-path');
          const rABPath = svg.querySelector('.AB-path');
          const rACPath = svg.querySelector('.AC-path');
          const rADPath = svg.querySelector('.AD-path');
          const rBCPath = svg.querySelector('.BC-path');
          const rBDPath = svg.querySelector('.BD-path');
          const rCDPath = svg.querySelector('.CD-path');
          const rABCPath = svg.querySelector('.ABC_only-path');
          const rABDPath = svg.querySelector('.ABD_only-path');
          const rACDPath = svg.querySelector('.ACD_only-path');
          const rBCDPath = svg.querySelector('.BCD_only-path');
          const rABCDPath = svg.querySelector('.ABCD-path');

          rURect.setAttribute('fill', shaded.U_only ? 'rgba(239, 68, 68, 0.12)' : 'transparent');
          if (rAPath) rAPath.setAttribute('fill', shaded.A_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rBPath) rBPath.setAttribute('fill', shaded.B_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rCPath) rCPath.setAttribute('fill', shaded.C_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rDPath) rDPath.setAttribute('fill', shaded.D_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rABPath) rABPath.setAttribute('fill', shaded.AB_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rACPath) rACPath.setAttribute('fill', shaded.AC_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rADPath) rADPath.setAttribute('fill', shaded.AD_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rBCPath) rBCPath.setAttribute('fill', shaded.BC_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rBDPath) rBDPath.setAttribute('fill', shaded.BD_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rCDPath) rCDPath.setAttribute('fill', shaded.CD_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rABCPath) rABCPath.setAttribute('fill', shaded.ABC_only ? 'rgba(61, 107, 255, 0.40)' : 'var(--bg-sunken)');
          if (rABDPath) rABDPath.setAttribute('fill', shaded.ABD_only ? 'rgba(61, 107, 255, 0.40)' : 'var(--bg-sunken)');
          if (rACDPath) rACDPath.setAttribute('fill', shaded.ACD_only ? 'rgba(61, 107, 255, 0.40)' : 'var(--bg-sunken)');
          if (rBCDPath) rBCDPath.setAttribute('fill', shaded.BCD_only ? 'rgba(61, 107, 255, 0.40)' : 'var(--bg-sunken)');
          if (rABCDPath) rABCDPath.setAttribute('fill', shaded.ABCD ? 'rgba(61, 107, 255, 0.45)' : 'var(--bg-sunken)');
        } else if (isThreeSets) {
          const rAPath = svg.querySelector('.A-path');
          const rBPath = svg.querySelector('.B-path');
          const rCPath = svg.querySelector('.C-path');
          const rABPath = svg.querySelector('.AB-path');
          const rACPath = svg.querySelector('.AC-path');
          const rBCPath = svg.querySelector('.BC-path');
          const rABCPath = svg.querySelector('.ABC-path');

          rURect.setAttribute('fill', shaded.U_only ? 'rgba(239, 68, 68, 0.12)' : 'transparent');
          if (rAPath) rAPath.setAttribute('fill', shaded.A_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rBPath) rBPath.setAttribute('fill', shaded.B_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rCPath) rCPath.setAttribute('fill', shaded.C_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rABPath) rABPath.setAttribute('fill', shaded.AB_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rACPath) rACPath.setAttribute('fill', shaded.AC_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rBCPath) rBCPath.setAttribute('fill', shaded.BC_only ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
          if (rABCPath) rABCPath.setAttribute('fill', shaded.ABC ? 'rgba(61, 107, 255, 0.45)' : 'var(--bg-sunken)');
        } else {
          const rAPath = svg.querySelector('.A-path');
          const rBPath = svg.querySelector('.B-path');
          const rIntersectionPath = svg.querySelector('.intersection-path');

          rURect.setAttribute('fill', shaded.U_only ? 'rgba(239, 68, 68, 0.12)' : 'transparent');
          if (rAPath) rAPath.setAttribute('fill', shaded.A_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rBPath) rBPath.setAttribute('fill', shaded.B_only ? 'rgba(61, 107, 255, 0.25)' : 'var(--bg-sunken)');
          if (rIntersectionPath) rIntersectionPath.setAttribute('fill', shaded.intersection ? 'rgba(61, 107, 255, 0.35)' : 'var(--bg-sunken)');
        }
      };

      // Set initial shading based on spec
      const initialShade = spec.shade ? spec.shade.toLowerCase().trim() : 'none';
      if (initialShade !== 'none') {
        const parts = initialShade.split(',').map(s => s.trim()).filter(Boolean);
        
        // Check if all parts are simple region codes or presets
        const validRegionKeys = isFourSets ? [
          'a_only', 'b_only', 'c_only', 'd_only',
          'ab_only', 'ac_only', 'ad_only', 'bc_only', 'bd_only', 'cd_only',
          'abc_only', 'abd_only', 'acd_only', 'bcd_only', 'abcd', 'u_only'
        ] : isThreeSets ? [
          'a_only', 'b_only', 'c_only', 'ab_only', 'ac_only', 'bc_only', 'abc', 'u_only'
        ] : [
          'a_only', 'b_only', 'intersection', 'u_only'
        ];
        
        const presets = [
          'a_all', 'b_all', 'c_all', 'd_all',
          'union', 'union_abc', 'union_abcd',
          'intersection', 'intersection_abc', 'intersection_abcd'
        ];
        
        const allPartsValid = parts.every(p => validRegionKeys.includes(p) || presets.includes(p));
        
        if (allPartsValid) {
          parts.forEach((p) => {
            if (isFourSets) {
              if (p === 'a_only') shaded.A_only = true;
              else if (p === 'b_only') shaded.B_only = true;
              else if (p === 'c_only') shaded.C_only = true;
              else if (p === 'd_only') shaded.D_only = true;
              else if (p === 'ab_only') shaded.AB_only = true;
              else if (p === 'ac_only') shaded.AC_only = true;
              else if (p === 'ad_only') shaded.AD_only = true;
              else if (p === 'bc_only') shaded.BC_only = true;
              else if (p === 'bd_only') shaded.BD_only = true;
              else if (p === 'cd_only') shaded.CD_only = true;
              else if (p === 'abc_only') shaded.ABC_only = true;
              else if (p === 'abd_only') shaded.ABD_only = true;
              else if (p === 'acd_only') shaded.ACD_only = true;
              else if (p === 'bcd_only') shaded.BCD_only = true;
              else if (p === 'abcd') shaded.ABCD = true;
              else if (p === 'u_only') shaded.U_only = true;
              else if (p === 'intersection' || p === 'intersection_abcd') shaded.ABCD = true;
              else if (p === 'a_all') {
                shaded.A_only = shaded.AB_only = shaded.AC_only = shaded.AD_only = shaded.ABC_only = shaded.ABD_only = shaded.ACD_only = shaded.ABCD = true;
              } else if (p === 'b_all') {
                shaded.B_only = shaded.AB_only = shaded.BC_only = shaded.BD_only = shaded.ABC_only = shaded.ABD_only = shaded.BCD_only = shaded.ABCD = true;
              } else if (p === 'c_all') {
                shaded.C_only = shaded.AC_only = shaded.BC_only = shaded.CD_only = shaded.ABC_only = shaded.ACD_only = shaded.BCD_only = shaded.ABCD = true;
              } else if (p === 'd_all') {
                shaded.D_only = shaded.AD_only = shaded.BD_only = shaded.CD_only = shaded.ABD_only = shaded.ACD_only = shaded.BCD_only = shaded.ABCD = true;
              } else if (p === 'union' || p === 'union_abcd') {
                Object.keys(shaded).forEach(k => { if (k !== 'U_only') shaded[k] = true; });
              }
            } else if (isThreeSets) {
              if (p === 'a_only') shaded.A_only = true;
              else if (p === 'b_only') shaded.B_only = true;
              else if (p === 'c_only') shaded.C_only = true;
              else if (p === 'ab_only') shaded.AB_only = true;
              else if (p === 'ac_only') shaded.AC_only = true;
              else if (p === 'bc_only') shaded.BC_only = true;
              else if (p === 'abc') shaded.ABC = true;
              else if (p === 'u_only') shaded.U_only = true;
              else if (p === 'intersection' || p === 'intersection_abc') shaded.ABC = true;
              else if (p === 'a_all') {
                shaded.A_only = shaded.AB_only = shaded.AC_only = shaded.ABC = true;
              } else if (p === 'b_all') {
                shaded.B_only = shaded.AB_only = shaded.BC_only = shaded.ABC = true;
              } else if (p === 'c_all') {
                shaded.C_only = shaded.AC_only = shaded.BC_only = shaded.ABC = true;
              } else if (p === 'union' || p === 'union_abc') {
                shaded.A_only = shaded.B_only = shaded.C_only = shaded.AB_only = shaded.AC_only = shaded.BC_only = shaded.ABC = true;
              }
            } else {
              if (p === 'a_only') shaded.A_only = true;
              else if (p === 'b_only') shaded.B_only = true;
              else if (p === 'intersection') shaded.intersection = true;
              else if (p === 'u_only') shaded.U_only = true;
              else if (p === 'a_all') {
                shaded.A_only = shaded.intersection = true;
              } else if (p === 'b_all') {
                shaded.B_only = shaded.intersection = true;
              } else if (p === 'union') {
                shaded.A_only = shaded.B_only = shaded.intersection = true;
              }
            }
          });
        } else {
          // Parse as a mathematical set expression! E.g. (A-B)'
          const expr = initialShade;
          if (isFourSets) {
            shaded.A_only = evaluateSetExpression(expr, true, false, false, false);
            shaded.B_only = evaluateSetExpression(expr, false, true, false, false);
            shaded.C_only = evaluateSetExpression(expr, false, false, true, false);
            shaded.D_only = evaluateSetExpression(expr, false, false, false, true);
            shaded.AB_only = evaluateSetExpression(expr, true, true, false, false);
            shaded.AC_only = evaluateSetExpression(expr, true, false, true, false);
            shaded.AD_only = evaluateSetExpression(expr, true, false, false, true);
            shaded.BC_only = evaluateSetExpression(expr, false, true, true, false);
            shaded.BD_only = evaluateSetExpression(expr, false, true, false, true);
            shaded.CD_only = evaluateSetExpression(expr, false, false, true, true);
            shaded.ABC_only = evaluateSetExpression(expr, true, true, true, false);
            shaded.ABD_only = evaluateSetExpression(expr, true, true, false, true);
            shaded.ACD_only = evaluateSetExpression(expr, true, false, true, true);
            shaded.BCD_only = evaluateSetExpression(expr, false, true, true, true);
            shaded.ABCD = evaluateSetExpression(expr, true, true, true, true);
            shaded.U_only = evaluateSetExpression(expr, false, false, false, false);
          } else if (isThreeSets) {
            shaded.A_only = evaluateSetExpression(expr, true, false, false);
            shaded.B_only = evaluateSetExpression(expr, false, true, false);
            shaded.C_only = evaluateSetExpression(expr, false, false, true);
            shaded.AB_only = evaluateSetExpression(expr, true, true, false);
            shaded.AC_only = evaluateSetExpression(expr, true, false, true);
            shaded.BC_only = evaluateSetExpression(expr, false, true, true);
            shaded.ABC = evaluateSetExpression(expr, true, true, true);
            shaded.U_only = evaluateSetExpression(expr, false, false, false);
          } else {
            shaded.A_only = evaluateSetExpression(expr, true, false);
            shaded.B_only = evaluateSetExpression(expr, false, true);
            shaded.intersection = evaluateSetExpression(expr, true, true);
            shaded.U_only = evaluateSetExpression(expr, false, false);
          }
        }
      }
      updateShading();

      // Mouse enter/leave tooltips for regions
      const regionNames = isFourSets ? {
        A_only: `بخش اختصاصی ${spec.label_A} (فاقد اشتراک)`,
        B_only: `بخش اختصاصی ${spec.label_B} (فاقد اشتراک)`,
        C_only: `بخش اختصاصی ${spec.label_C} (فاقد اشتراک)`,
        D_only: `بخش اختصاصی ${spec.label_D} (فاقد اشتراک)`,
        AB_only: `اشتراک دو مجموعه ${spec.label_A} و ${spec.label_B} بدون C و D`,
        AC_only: `اشتراک دو مجموعه ${spec.label_A} و ${spec.label_C} بدون B و D`,
        AD_only: `اشتراک دو مجموعه ${spec.label_A} و ${spec.label_D} بدون B و C`,
        BC_only: `اشتراک دو مجموعه ${spec.label_B} و ${spec.label_C} بدون A و D`,
        BD_only: `اشتراک دو مجموعه ${spec.label_B} و ${spec.label_D} بدون A و C`,
        CD_only: `اشتراک دو مجموعه ${spec.label_C} و ${spec.label_D} بدون A و B`,
        ABC_only: `اشتراک سه مجموعه ${spec.label_A} و ${spec.label_B} و ${spec.label_C} بدون D`,
        ABD_only: `اشتراک سه مجموعه ${spec.label_A} و ${spec.label_B} و ${spec.label_D} بدون C`,
        ACD_only: `اشتراک سه مجموعه ${spec.label_A} و ${spec.label_C} و ${spec.label_D} بدون B`,
        BCD_only: `اشتراک سه مجموعه ${spec.label_B} و ${spec.label_C} و ${spec.label_D} بدون A`,
        ABCD: `اشتراک هر چهار مجموعه (${spec.label_A} ∩ ${spec.label_B} ∩ ${spec.label_C} ∩ ${spec.label_D})`,
        U_only: `خارج از مجموعه‌ها در مجموعه مرجع U`
      } : isThreeSets ? {
        A_only: `بخش اختصاصی ${spec.label_A} (فاقد اشتراک)`,
        B_only: `بخش اختصاصی ${spec.label_B} (فاقد اشتراک)`,
        C_only: `بخش اختصاصی ${spec.label_C} (فاقد اشتراک)`,
        AB_only: `اشتراک دو مجموعه ${spec.label_A} و ${spec.label_B} بدون ${spec.label_C}`,
        AC_only: `اشتراک دو مجموعه ${spec.label_A} و ${spec.label_C} بدون ${spec.label_B}`,
        BC_only: `اشتراک دو مجموعه ${spec.label_B} و ${spec.label_C} بدون ${spec.label_A}`,
        ABC: `اشتراک هر سه مجموعه (${spec.label_A} ∩ ${spec.label_B} ∩ ${spec.label_C})`,
        U_only: `خارج از مجموعه‌ها در مجموعه مرجع U`
      } : {
        A_only: `بخش اختصاصی ${spec.label_A} (A - B)`,
        B_only: `بخش اختصاصی ${spec.label_B} (B - A)`,
        intersection: `اشتراک دو مجموعه (${spec.label_A} ∩ ${spec.label_B})`,
        U_only: `مجموعه مرجع خارج از مجموعه‌ها (U - A - B)`
      };

      const regionElements = isFourSets ? {
        A_only: spec.elements_A,
        B_only: spec.elements_B,
        C_only: spec.elements_C,
        D_only: spec.elements_D,
        AB_only: spec.elements_AB,
        AC_only: spec.elements_AC,
        AD_only: spec.elements_AD,
        BC_only: spec.elements_BC,
        BD_only: spec.elements_BD,
        CD_only: spec.elements_CD,
        ABC_only: spec.elements_ABC,
        ABD_only: spec.elements_ABD,
        ACD_only: spec.elements_ACD,
        BCD_only: spec.elements_BCD,
        ABCD: spec.elements_ABCD,
        U_only: spec.elements_U
      } : isThreeSets ? {
        A_only: spec.elements_A,
        B_only: spec.elements_B,
        C_only: spec.elements_C,
        AB_only: spec.elements_AB,
        AC_only: spec.elements_AC,
        BC_only: spec.elements_BC,
        ABC: spec.elements_ABC,
        U_only: spec.elements_U
      } : {
        A_only: spec.elements_A,
        B_only: spec.elements_B,
        intersection: spec.elements_intersection,
        U_only: spec.elements_U
      };

      card.querySelectorAll('.venn-region').forEach((reg) => {
        const regId = reg.getAttribute('data-region');
        
        reg.addEventListener('mouseenter', () => {
          hoverInfo.style.opacity = '1';
          const els = regionElements[regId] || [];
          const elsStr = els.length > 0 ? `{${els.join(', ')}}` : 'تهی ∅';
          hoverInfo.innerHTML = `${regionNames[regId]} <span style="margin-right:8px; opacity:0.8; font-family:var(--font-mono);">${toPersianDigits(elsStr)}</span>`;
        });

        reg.addEventListener('mouseleave', () => {
          hoverInfo.style.opacity = '0';
        });

        reg.addEventListener('click', () => {
          shaded[regId] = !shaded[regId];
          updateShading();
          updateActiveButtonHighlight();
          showCustomSelectionResult();
        });
      });

      // Operation Buttons
      const opBtns = card.querySelectorAll('.venn-op-btn');
      
      const updateActiveButtonHighlight = (activeOp = null) => {
        opBtns.forEach((btn) => {
          const btnOp = btn.getAttribute('data-op');
          if (btnOp === activeOp) {
            btn.style.background = 'var(--color-primary)';
            btn.style.color = '#FFFFFF';
            btn.style.borderColor = 'var(--color-primary)';
          } else if (btnOp === 'clear') {
            btn.style.background = 'var(--color-danger-soft)';
            btn.style.color = 'var(--color-danger)';
            btn.style.borderColor = 'var(--color-danger)';
          } else {
            btn.style.background = 'var(--bg-card)';
            btn.style.color = 'var(--text-primary)';
            btn.style.borderColor = 'var(--border-soft)';
          }
        });
      };

      const showResultPanel = (title, desc, elementsList) => {
        resultDisplay.style.display = 'flex';
        resultTitle.textContent = title;
        resultDesc.textContent = desc;
        
        const setStr = elementsList.length > 0 ? `{ ${elementsList.join(', ')} }` : '∅ (مجموعه تهی)';
        resultSet.textContent = toPersianDigits(setStr);
      };

      const showCustomSelectionResult = () => {
        const activeRegions = [];
        Object.keys(shaded).forEach((k) => {
          if (shaded[k]) activeRegions.push(k);
        });

        if (activeRegions.length === 0) {
          resultDisplay.style.display = 'none';
          return;
        }

        let activeElements = [];
        activeRegions.forEach((reg) => {
          const els = regionElements[reg] || [];
          activeElements = activeElements.concat(els);
        });
        activeElements = [...new Set(activeElements)];

        let title = 'محدوده انتخاب شده:';
        let desc = 'رنگ‌آمیزی سفارشی کاربر.';

        if (isFourSets) {
          if (shaded.A_only && shaded.AB_only && shaded.AC_only && shaded.AD_only && shaded.ABC_only && shaded.ABD_only && shaded.ACD_only && shaded.ABCD && !shaded.B_only && !shaded.C_only && !shaded.D_only && !shaded.BC_only && !shaded.BD_only && !shaded.CD_only && !shaded.BCD_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_A}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_A} قرار دارند.`;
          } else if (shaded.B_only && shaded.AB_only && shaded.BC_only && shaded.BD_only && shaded.ABC_only && shaded.ABD_only && shaded.BCD_only && shaded.ABCD && !shaded.A_only && !shaded.C_only && !shaded.D_only && !shaded.AC_only && !shaded.AD_only && !shaded.CD_only && !shaded.ACD_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_B}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_B} قرار دارند.`;
          } else if (shaded.C_only && shaded.AC_only && shaded.BC_only && shaded.CD_only && shaded.ABC_only && shaded.ACD_only && shaded.BCD_only && shaded.ABCD && !shaded.A_only && !shaded.B_only && !shaded.D_only && !shaded.AB_only && !shaded.AD_only && !shaded.BD_only && !shaded.ABD_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_C}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_C} قرار دارند.`;
          } else if (shaded.D_only && shaded.AD_only && shaded.BD_only && shaded.CD_only && shaded.ABD_only && shaded.ACD_only && shaded.BCD_only && shaded.ABCD && !shaded.A_only && !shaded.B_only && !shaded.C_only && !shaded.AB_only && !shaded.AC_only && !shaded.BC_only && !shaded.ABC_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_D}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_D} قرار دارند.`;
          }
        } else if (isThreeSets) {
          // 3 sets simple subsets
          if (shaded.A_only && shaded.AB_only && shaded.AC_only && shaded.ABC && !shaded.B_only && !shaded.C_only && !shaded.BC_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_A}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_A} قرار دارند.`;
          } else if (shaded.B_only && shaded.AB_only && shaded.BC_only && shaded.ABC && !shaded.A_only && !shaded.C_only && !shaded.AC_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_B}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_B} قرار دارند.`;
          } else if (shaded.C_only && shaded.AC_only && shaded.BC_only && shaded.ABC && !shaded.A_only && !shaded.B_only && !shaded.AB_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_C}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_C} قرار دارند.`;
          }
        } else {
          if (shaded.A_only && shaded.intersection && !shaded.B_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_A}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_A} قرار دارند.`;
          } else if (shaded.B_only && shaded.intersection && !shaded.A_only && !shaded.U_only) {
            title = `مجموعه ${spec.label_B}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_B} قرار دارند.`;
          } else if (shaded.A_only && !shaded.intersection && !shaded.B_only && !shaded.U_only) {
            title = `${spec.label_A} - ${spec.label_B}`;
            desc = `اعضایی که فقط در مجموعه ${spec.label_A} هستند ولی در مجموعه ${spec.label_B} نیستند (تفاضل).`;
          } else if (shaded.B_only && !shaded.intersection && !shaded.A_only && !shaded.U_only) {
            title = `${spec.label_B} - ${spec.label_A}`;
            desc = `اعضایی که فقط در مجموعه ${spec.label_B} هستند ولی در مجموعه ${spec.label_A} نیستند (تفاضل).`;
          } else if (!shaded.A_only && shaded.intersection && !shaded.B_only && !shaded.U_only) {
            title = `${spec.label_A} ∩ ${spec.label_B}`;
            desc = `اعضای مشترک بین مجموعه ${spec.label_A} و مجموعه ${spec.label_B} (اشتراک).`;
          } else if (shaded.A_only && shaded.intersection && shaded.B_only && !shaded.U_only) {
            title = `${spec.label_A} ∪ ${spec.label_B}`;
            desc = `تمام اعضایی که در مجموعه ${spec.label_A} یا مجموعه ${spec.label_B} قرار دارند (اجتماع).`;
          } else if (!shaded.A_only && !shaded.intersection && !shaded.B_only && shaded.U_only) {
            title = `(${spec.label_A} ∪ ${spec.label_B})'`;
            desc = `متمم اجتماع دو مجموعه. اعضایی که نه در مجموعه ${spec.label_A} هستند و نه در مجموعه ${spec.label_B}.`;
          }
        }

        showResultPanel(title, desc, activeElements);
      };

      opBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const op = btn.getAttribute('data-op');
          
          // Clear all first
          Object.keys(shaded).forEach((k) => {
            shaded[k] = false;
          });

          if (op === 'clear') {
            updateShading();
            updateActiveButtonHighlight();
            resultDisplay.style.display = 'none';
            return;
          }

          updateActiveButtonHighlight(op);

          if (isFourSets) {
            if (op === 'A_only') {
              shaded.A_only = true;
              showResultPanel(`${spec.label_A} - (${spec.label_B} ∪ ${spec.label_C} ∪ ${spec.label_D})`, `اعضایی که فقط در مجموعه ${spec.label_A} قرار دارند و با هیچ مجموعه دیگری مشترک نیستند.`, spec.elements_A);
            } else if (op === 'B_only') {
              shaded.B_only = true;
              showResultPanel(`${spec.label_B} - (${spec.label_A} ∪ ${spec.label_C} ∪ ${spec.label_D})`, `اعضایی که فقط در مجموعه ${spec.label_B} قرار دارند و با هیچ مجموعه دیگری مشترک نیستند.`, spec.elements_B);
            } else if (op === 'C_only') {
              shaded.C_only = true;
              showResultPanel(`${spec.label_C} - (${spec.label_A} ∪ ${spec.label_B} ∪ ${spec.label_D})`, `اعضایی که فقط در مجموعه ${spec.label_C} قرار دارند و با هیچ مجموعه دیگری مشترک نیستند.`, spec.elements_C);
            } else if (op === 'D_only') {
              shaded.D_only = true;
              showResultPanel(`${spec.label_D} - (${spec.label_A} ∪ ${spec.label_B} ∪ ${spec.label_C})`, `اعضایی که فقط در مجموعه ${spec.label_D} قرار دارند و با هیچ مجموعه دیگری مشترک نیستند.`, spec.elements_D);
            } else if (op === 'A') {
              shaded.A_only = true; shaded.AB_only = true; shaded.AC_only = true; shaded.AD_only = true; shaded.ABC_only = true; shaded.ABD_only = true; shaded.ACD_only = true; shaded.ABCD = true;
              const aElements = [...new Set([
                ...spec.elements_A, ...spec.elements_AB, ...spec.elements_AC, ...spec.elements_AD,
                ...spec.elements_ABC, ...spec.elements_ABD, ...spec.elements_ACD, ...spec.elements_ABCD
              ])];
              showResultPanel(`مجموعه ${spec.label_A}`, `تمام اعضایی که در مجموعه ${spec.label_A} قرار گرفته‌اند.`, aElements);
            } else if (op === 'B') {
              shaded.B_only = true; shaded.AB_only = true; shaded.BC_only = true; shaded.BD_only = true; shaded.ABC_only = true; shaded.ABD_only = true; shaded.BCD_only = true; shaded.ABCD = true;
              const bElements = [...new Set([
                ...spec.elements_B, ...spec.elements_AB, ...spec.elements_BC, ...spec.elements_BD,
                ...spec.elements_ABC, ...spec.elements_ABD, ...spec.elements_BCD, ...spec.elements_ABCD
              ])];
              showResultPanel(`مجموعه ${spec.label_B}`, `تمام اعضایی که در مجموعه ${spec.label_B} قرار گرفته‌اند.`, bElements);
            } else if (op === 'C') {
              shaded.C_only = true; shaded.AC_only = true; shaded.BC_only = true; shaded.CD_only = true; shaded.ABC_only = true; shaded.ACD_only = true; shaded.BCD_only = true; shaded.ABCD = true;
              const cElements = [...new Set([
                ...spec.elements_C, ...spec.elements_AC, ...spec.elements_BC, ...spec.elements_CD,
                ...spec.elements_ABC, ...spec.elements_ACD, ...spec.elements_BCD, ...spec.elements_ABCD
              ])];
              showResultPanel(`مجموعه ${spec.label_C}`, `تمام اعضایی که در مجموعه ${spec.label_C} قرار گرفته‌اند.`, cElements);
            } else if (op === 'D') {
              shaded.D_only = true; shaded.AD_only = true; shaded.BD_only = true; shaded.CD_only = true; shaded.ABD_only = true; shaded.ACD_only = true; shaded.BCD_only = true; shaded.ABCD = true;
              const dElements = [...new Set([
                ...spec.elements_D, ...spec.elements_AD, ...spec.elements_BD, ...spec.elements_CD,
                ...spec.elements_ABD, ...spec.elements_ACD, ...spec.elements_BCD, ...spec.elements_ABCD
              ])];
              showResultPanel(`مجموعه ${spec.label_D}`, `تمام اعضایی که در مجموعه ${spec.label_D} قرار گرفته‌اند.`, dElements);
            }
          } else if (isThreeSets) {
            if (op === 'A_only') {
              shaded.A_only = true;
              showResultPanel(`${spec.label_A} - (${spec.label_B} ∪ ${spec.label_C})`, `اعضایی که فقط در مجموعه ${spec.label_A} قرار دارند و با هیچ مجموعه دیگری مشترک نیستند.`, spec.elements_A);
            } else if (op === 'B_only') {
              shaded.B_only = true;
              showResultPanel(`${spec.label_B} - (${spec.label_A} ∪ ${spec.label_C})`, `اعضایی که فقط در مجموعه ${spec.label_B} قرار دارند و با هیچ مجموعه دیگری مشترک نیستند.`, spec.elements_B);
            } else if (op === 'C_only') {
              shaded.C_only = true;
              showResultPanel(`${spec.label_C} - (${spec.label_A} ∪ ${spec.label_B})`, `اعضایی که فقط در مجموعه ${spec.label_C} قرار دارند و با هیچ مجموعه دیگری مشترک نیستند.`, spec.elements_C);
            } else if (op === 'intersection_abc') {
              shaded.ABC = true;
              showResultPanel(`${spec.label_A} ∩ ${spec.label_B} ∩ ${spec.label_C}`, `اشتراک هر سه مجموعه: اعضایی که در همزمان در هر سه مجموعه حضور دارند.`, spec.elements_ABC);
            } else if (op === 'union_abc') {
              shaded.A_only = true;
              shaded.B_only = true;
              shaded.C_only = true;
              shaded.AB_only = true;
              shaded.AC_only = true;
              shaded.BC_only = true;
              shaded.ABC = true;
              const unionElements = [...new Set([
                ...spec.elements_A, ...spec.elements_B, ...spec.elements_C,
                ...spec.elements_AB, ...spec.elements_AC, ...spec.elements_BC,
                ...spec.elements_ABC
              ])];
              showResultPanel(`${spec.label_A} ∪ ${spec.label_B} ∪ ${spec.label_C}`, `اجتماع هر سه مجموعه: تمام اعضایی که در حداقل یکی از این سه مجموعه حضور دارند.`, unionElements);
            } else if (op === 'U_only') {
              shaded.U_only = true;
              showResultPanel(`(${spec.label_A} ∪ ${spec.label_B} ∪ ${spec.label_C})'`, `متمم اجتماع سه مجموعه: اعضایی که در هیچ‌کدام از مجموعه‌ها نیستند و متعلق به مجموعه مرجع U هستند.`, spec.elements_U);
            } else if (op === 'A_all') {
              shaded.A_only = true;
              shaded.AB_only = true;
              shaded.AC_only = true;
              shaded.ABC = true;
              const aElements = [...new Set([...spec.elements_A, ...spec.elements_AB, ...spec.elements_AC, ...spec.elements_ABC])];
              showResultPanel(`مجموعه ${spec.label_A}`, `تمام اعضایی که در مجموعه ${spec.label_A} قرار گرفته‌اند (شامل تمام بخش‌های اشتراک آن).`, aElements);
            } else if (op === 'B_all') {
              shaded.B_only = true;
              shaded.AB_only = true;
              shaded.BC_only = true;
              shaded.ABC = true;
              const bElements = [...new Set([...spec.elements_B, ...spec.elements_AB, ...spec.elements_BC, ...spec.elements_ABC])];
              showResultPanel(`مجموعه ${spec.label_B}`, `تمام اعضایی که در مجموعه ${spec.label_B} قرار گرفته‌اند (شامل تمام بخش‌های اشتراک آن).`, bElements);
            } else if (op === 'C_all') {
              shaded.C_only = true;
              shaded.AC_only = true;
              shaded.BC_only = true;
              shaded.ABC = true;
              const cElements = [...new Set([...spec.elements_C, ...spec.elements_AC, ...spec.elements_BC, ...spec.elements_ABC])];
              showResultPanel(`مجموعه ${spec.label_C}`, `تمام اعضایی که در مجموعه ${spec.label_C} قرار گرفته‌اند (شامل تمام بخش‌های اشتراک آن).`, cElements);
            }
          } else {
            if (op === 'A_only') {
              shaded.A_only = true;
              showResultPanel(`${spec.label_A} - ${spec.label_B}`, `تفاضل مجموعه ${spec.label_A} از ${spec.label_B}: اعضایی که فقط در مجموعه ${spec.label_A} هستند.`, spec.elements_A);
            } else if (op === 'B_only') {
              shaded.B_only = true;
              showResultPanel(`${spec.label_B} - ${spec.label_A}`, `تفاضل مجموعه ${spec.label_B} از ${spec.label_A}: اعضایی که فقط در مجموعه ${spec.label_B} هستند.`, spec.elements_B);
            } else if (op === 'intersection') {
              shaded.intersection = true;
              showResultPanel(`${spec.label_A} ∩ ${spec.label_B}`, `اشتراک دو مجموعه ${spec.label_A} و ${spec.label_B}: اعضای مشترک بین هر دو مجموعه.`, spec.elements_intersection);
            } else if (op === 'union') {
              shaded.A_only = true;
              shaded.B_only = true;
              shaded.intersection = true;
              const unionElements = [...new Set([...spec.elements_A, ...spec.elements_intersection, ...spec.elements_B])];
              showResultPanel(`${spec.label_A} ∪ ${spec.label_B}`, `اجتماع دو مجموعه ${spec.label_A} و ${spec.label_B}: تمام اعضایی که در حداقل یکی از این دو مجموعه حضور دارند.`, unionElements);
            } else if (op === 'U_only') {
              shaded.U_only = true;
              showResultPanel(`(${spec.label_A} ∪ ${spec.label_B})'`, `متمم اجتماع دو مجموعه: اعضایی که خارج از دو مجموعه قرار گرفته‌اند و متعلق به مجموعه مرجع U هستند.`, spec.elements_U);
            } else if (op === 'A_all') {
              shaded.A_only = true;
              shaded.intersection = true;
              const aElements = [...new Set([...spec.elements_A, ...spec.elements_intersection])];
              showResultPanel(`مجموعه ${spec.label_A}`, `تمام اعضایی که در مجموعه ${spec.label_A} قرار گرفته‌اند (شامل اعضای مشترک).`, aElements);
            } else if (op === 'B_all') {
              shaded.B_only = true;
              shaded.intersection = true;
              const bElements = [...new Set([...spec.elements_B, ...spec.elements_intersection])];
              showResultPanel(`مجموعه ${spec.label_B}`, `تمام اعضایی که در مجموعه ${spec.label_B} قرار گرفته‌اند (شامل اعضای مشترک).`, bElements);
            }
          }

          updateShading();
        });
      });

      if (initialShade !== 'none') {
        updateActiveButtonHighlight(initialShade);
        showCustomSelectionResult();
      }
    });
  }

  function initIntervalPlots(parent) {
    const cards = parent.querySelectorAll('.interactive-interval-card');
    cards.forEach((card) => {
        initInteractiveInterval(card);
    });
  }

  // parseFractionTree / getFractionHeight / renderFractionTree /
  // replaceLatexSymbols used to be duplicated here with their own
  // (older, fraction-only) implementation. They now delegate to the
  // single shared renderMathSegment() in js/core/ui.js, so the AI chat
  // view and the flashcard viewer always render LaTeX identically and
  // stay in sync automatically.
  function replaceLatexSymbols(mathText) {
    return renderMathSegment(mathText);
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
    const intervalPlots = [];
    const geometryPlots = [];
    const mindmapPlots = [];
    const physicsPlots = [];

    let html = text;

    // Protect code blocks first
    html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
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
      if (lang === 'physics') {
        const placeholder = `PHYSICSPLOTPLACEHOLDER${physicsPlots.length}`;
        physicsPlots.push(code.trim());
        return placeholder;
      }
      const placeholder = `CODEBLOCKPLACEHOLDER${codeBlocks.length}`;
      codeBlocks.push(`<pre class="code-block" style="background:var(--bg-sunken); border:1px solid var(--border-soft); border-radius:12px; padding:var(--space-3); font-family:var(--font-mono); font-size:var(--text-caption); direction:ltr; text-align:left; overflow-x:auto; margin:var(--space-2) 0; box-shadow:inset 0 1px 3px rgba(0,0,0,0.05);"><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`);
      return placeholder;
    });

    // Protect block math: $$ math $$
    html = html.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (match, math) => {
      const cleanMath = replaceLatexSymbols(math.trim());
      const placeholder = `MATHBLOCKPLACEHOLDER${mathBlocks.length}`;
      mathBlocks.push(`<div class="math-block" style="text-align:center; padding:var(--space-2) var(--space-3); margin:var(--space-2) 0; background:var(--bg-sunken); border:1px solid var(--border-subtle); border-radius:10px; font-style:italic; font-family:var(--font-mono); font-size:15px; direction:ltr; display:block; overflow-x:auto; box-shadow:inset 0 1px 2px rgba(0,0,0,0.02);">${cleanMath}</div>`);
      return placeholder;
    });

    // Protect inline math: $ math $
    html = html.replace(/\$\s*([^$]+?)\s*\$/g, (match, math) => {
      const cleanMath = replaceLatexSymbols(math.trim());
      const placeholder = `MATHINLINEPLACEHOLDER${mathInlines.length}`;
      mathInlines.push(`<span class="math-inline" style="font-family:var(--font-mono); font-style:italic; background:var(--bg-sunken); padding:2px 6px; border-radius:6px; font-weight:700; color:var(--color-primary); font-size:0.95em; direction:ltr; display:inline-block; border:1px solid var(--border-subtle);">${cleanMath}</span>`);
      return placeholder;
    });

    // Escape remaining HTML
    html = escapeHtml(html);

    // Process line-by-line
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

      // Check for Horizontal Rule
      if (trimmed === '---') {
        closeLists(resultLines);
        resultLines.push('<hr style="border:0; border-top:1.5px dashed var(--border-subtle); margin:var(--space-3) 0; width:100%;">');
        continue;
      }

      // Check for headings
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

      // Check for blockquote
      const quoteMatch = line.match(/^>\s*(.*)$/);
      if (quoteMatch) {
        closeLists(resultLines);
        resultLines.push(`<blockquote style="border-right:3px solid var(--color-primary); background:var(--bg-sunken); padding:var(--space-2) var(--space-3); margin:var(--space-2) 0; border-radius:0 8px 8px 0; color:var(--text-secondary); font-style:italic; line-height:1.6;">${quoteMatch[1].trim()}</blockquote>`);
        continue;
      }

      // Check for Unordered List Item
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

      // Check for Ordered List Item
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

      // Regular line
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

    // Bold formatting
    finalHtml = finalHtml.replace(/\*\*([\s\S]*?)\*\*/g, '<strong style="font-weight:800; color:var(--text-primary);">$1</strong>');
    // Italic formatting
    finalHtml = finalHtml.replace(/\*([\s\S]*?)\*/g, '<em style="font-style:italic;">$1</em>');
    finalHtml = finalHtml.replace(/_([\s\S]*?)_/g, '<em style="font-style:italic;">$1</em>');
    // Inline code formatting
    finalHtml = finalHtml.replace(/`([^`]+)`/g, '<code style="background:var(--bg-sunken); border:1.5px solid var(--border-soft); padding:2px 6px; border-radius:6px; font-family:var(--font-mono); font-size:0.9em; color:var(--color-primary); font-weight:600; direction:ltr; display:inline-block;">$1</code>');

    // Restore block math and inline math before rendering fractions
    for (let i = 0; i < mathBlocks.length; i++) {
      finalHtml = finalHtml.replace(`MATHBLOCKPLACEHOLDER${i}`, mathBlocks[i]);
    }
    for (let i = 0; i < mathInlines.length; i++) {
      finalHtml = finalHtml.replace(`MATHINLINEPLACEHOLDER${i}`, mathInlines[i]);
    }

    // Render fractions and parse latex for text, math blocks, and math inlines
    finalHtml = renderFractionsInText(finalHtml);

    // Restore protected code blocks (we do this AFTER renderFractionsInText so { } braces aren't stripped from code)
    for (let i = 0; i < codeBlocks.length; i++) {
      finalHtml = finalHtml.replace(`CODEBLOCKPLACEHOLDER${i}`, codeBlocks[i]);
    }

    for (let i = 0; i < mathPlots.length; i++) {
      const eqStr = mathPlots[i];
      const plotCardHtml = `
        <div class="interactive-plot-card" data-equation="${escapeHtml(eqStr)}" style="
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
              <span class="material-symbols-rounded" style="color: var(--color-primary);">show_chart</span>
              <span>نمودار تعاملی ریاضی</span>
            </div>
            <div class="eq-display" style="font-family: var(--font-mono); direction: ltr; font-weight: 700; color: var(--text-primary); font-size: 14px; background: var(--bg-sunken); padding: 4px 10px; border-radius: 8px; border: 1px solid var(--border-subtle);">
              y = ${escapeHtml(eqStr)}
            </div>
          </div>
          
          <div class="svg-container" style="position: relative; width: 100%; aspect-ratio: 1; max-width: 280px; margin: var(--space-2) auto; background: var(--bg-sunken); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden; touch-action: none;">
            <svg viewBox="-150 -150 300 300" style="width: 100%; height: 100%; display: block;" class="plot-svg">
              <g class="grid-lines" stroke="var(--border-subtle)" stroke-width="0.5" stroke-dasharray="2,3"></g>
              <g class="major-grid-lines" stroke="var(--border-subtle)" stroke-width="1"></g>
              <line x1="-150" y1="0" x2="150" y2="0" stroke="var(--text-secondary)" stroke-width="1.5" />
              <line x1="0" y1="-150" x2="0" y2="150" stroke="var(--text-secondary)" stroke-width="1.5" />
              <polygon points="146,-4 150,0 146,4" fill="var(--text-secondary)" />
              <polygon points="-4,-146 0,-150 4,-146" fill="var(--text-secondary)" />
              <g class="axis-ticks" fill="var(--text-secondary)" font-size="10" font-family="var(--font-mono)" text-anchor="middle" dominant-baseline="middle"></g>
              <g class="plots-paths"></g>
              <g class="plots-points"></g>
              <line class="hover-tracker-x" x1="0" y1="-150" x2="0" y2="150" stroke="var(--color-primary)" stroke-width="1" stroke-dasharray="4,4" style="display: none;" />
              <line class="hover-tracker-y" x1="-150" y1="0" x2="150" y2="0" stroke="var(--color-primary)" stroke-width="1" stroke-dasharray="4,4" style="display: none;" />
              <circle class="hover-dot" r="6" fill="var(--color-primary)" stroke="#FFFFFF" stroke-width="2" style="display: none; filter: drop-shadow(0 0 4px var(--color-primary));" />
            </svg>
            <div class="hover-coords" style="position: absolute; bottom: 8px; right: 8px; background: rgba(0, 0, 0, 0.75); color: #FFFFFF; font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 6px; direction: ltr; pointer-events: none; opacity: 0; transition: opacity 0.15s;">
              (x: 0, y: 0)
            </div>
            <div style="position: absolute; top: 8px; left: 8px; display: flex; flex-direction: column; gap: 4px;">
              <button class="zoom-in-btn" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-card); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;">+</button>
              <button class="zoom-out-btn" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-card); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;">-</button>
            </div>
          </div>
          
          <div class="plot-adjuster-panel" style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding: 0 4px;">
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: var(--text-caption);">
              <span style="color: var(--text-secondary); font-weight: 700;">ضریب درجه دوم (a):</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <button class="adjust-btn coeff-a-dn-btn" style="width: 28px; height: 28px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; transition: background 0.2s;">-</button>
                <span class="coeff-a-value" style="font-family: var(--font-mono); font-weight: 800; color: var(--color-primary); min-width: 32px; text-align: center;">0</span>
                <button class="adjust-btn coeff-a-up-btn" style="width: 28px; height: 28px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; transition: background 0.2s;">+</button>
              </div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: var(--text-caption);">
              <span style="color: var(--text-secondary); font-weight: 700;">ضریب درجه اول (b):</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <button class="adjust-btn slope-dn-btn" style="width: 28px; height: 28px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; transition: background 0.2s;">-</button>
                <span class="slope-value" style="font-family: var(--font-mono); font-weight: 800; color: var(--color-primary); min-width: 32px; text-align: center;">1</span>
                <button class="adjust-btn slope-up-btn" style="width: 28px; height: 28px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; transition: background 0.2s;">+</button>
              </div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: var(--text-caption);">
              <span style="color: var(--text-secondary); font-weight: 700;">عدد ثابت (c):</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <button class="adjust-btn intercept-dn-btn" style="width: 28px; height: 28px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; transition: background 0.2s;">-</button>
                <span class="intercept-value" style="font-family: var(--font-mono); font-weight: 800; color: var(--color-primary); min-width: 32px; text-align: center;">1</span>
                <button class="adjust-btn intercept-up-btn" style="width: 28px; height: 28px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; transition: background 0.2s;">+</button>
              </div>
            </div>
          </div>
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

    return finalHtml;
  }

  function renderMessage(sender, text, attachments = null) {
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

    const bubble = document.createElement('div');
    bubble.style.animation = 'slideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
    
    // Make sure slideUp animation exists
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
      }
    } else if (sender === 'system_error') {
      bubble.style.cssText = 'align-self:center; background:var(--color-danger-soft); border:1px solid var(--color-danger); color:var(--color-danger); padding:var(--space-3) var(--space-4); border-radius:12px; max-width:90%; font-size:var(--text-caption); text-align:center; font-weight:700;';
      bubble.textContent = cleanText;
    } else {
      bubble.style.cssText = 'align-self:flex-start; background:color-mix(in srgb, var(--bg-card) 60%, transparent); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.2); padding:var(--space-4); border-radius:24px 24px 24px 4px; max-width:85%; line-height:1.8; font-size:var(--text-body); color:var(--text-primary); box-shadow:0 8px 32px rgba(0,0,0,0.06); word-break: break-word; min-width:0; margin-bottom:var(--space-2);';
      
      const textNode = document.createElement('div');
      textNode.style.cssText = 'word-break:break-word; overflow-wrap:break-word; width:100%;';
      textNode.innerHTML = renderMarkdownAndMath(cleanText);
      bubble.appendChild(textNode);

      if (suggestedCards && Array.isArray(suggestedCards) && suggestedCards.length > 0) {
        const cardsWrap = document.createElement('div');
        cardsWrap.style.cssText = 'margin-top:var(--space-3); border-top:1.5px dashed var(--border-subtle); padding-top:var(--space-3); display:flex; flex-direction:column; gap:var(--space-2); width:100%; box-sizing:border-box; min-width:0;';
        
        const title = document.createElement('div');
        title.style.cssText = 'font-size:11px; font-weight:800; color:var(--color-primary); display:flex; align-items:center; gap:4px;';
        title.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">style</span> فلش‌کارت‌های پیشنهادی هوش مصنوعی:';
        cardsWrap.appendChild(title);

        suggestedCards.forEach((c) => {
          if (!c.front || !c.back) return;
          const cardBox = document.createElement('div');
          cardBox.style.cssText = 'background:rgba(61, 107, 255, 0.04); border:1px solid var(--color-primary-soft); border-radius:var(--radius-input); padding:var(--space-2); display:flex; justify-content:space-between; align-items:center; gap:var(--space-2); min-width:0;';
          
          const cardContent = document.createElement('div');
          cardContent.style.cssText = 'display:flex; flex-direction:column; gap:2px; text-align:right; flex-grow:1; font-size:11px; min-width:0; word-break:break-word; overflow-wrap:break-word;';
          
          const qText = document.createElement('div');
          qText.style.cssText = 'font-weight:700; color:var(--text-primary); word-break:break-word; overflow-wrap:break-word;';
          qText.innerHTML = `روی کارت: ${renderFractionsInText(escapeHtml(c.front))}`;
          
          const aText = document.createElement('div');
          aText.style.cssText = 'color:var(--text-secondary); word-break:break-word; overflow-wrap:break-word;';
          aText.innerHTML = `پشت کارت: ${renderFractionsInText(escapeHtml(c.back))}`;
          
          cardContent.append(qText, aText);

          const addBtn = createButton({
            label: 'افزودن',
            icon: 'add_circle',
            variant: 'secondary',
            onClick: async () => {
              if (currentCategoryId === 'general') {
                openDialog({
                  title: 'موضوع مشخص نیست!',
                  body: 'برای افزودن فلش‌کارت به کتابخانه، ابتدا باید از نوار بالای صفحه یک موضوع مطالعه (دسته) انتخاب کنید.',
                  actions: [{ label: 'تایید', variant: 'primary' }]
                });
                return;
              }
              
              const flashcard = createFlashcardModel({
                categoryId: currentCategoryId,
                frontContent: [{ type: 'text', value: c.front }],
                backContent: [{ type: 'text', value: c.back }],
                source: 'ai',
                aiGenerated: true
              });
              await flashcardRepository.create(flashcard);

              const categoryCards = await flashcardRepository.getByIndex('categoryId', currentCategoryId);
              const activeCount = categoryCards.filter((card) => !card.deleted).length;
              await categoryRepository.update(currentCategoryId, { totalCards: activeCount });

              // addBtn's children are [icon span, label span] — only the
              // label should change; overwriting the icon span's textContent
              // replaced the "add_circle" ligature with raw Persian text,
              // which the icon font rendered as broken, oversized glyphs.
              addBtn.disabled = true;
              addBtn.firstChild.textContent = 'check_circle';
              addBtn.lastChild.textContent = 'افزوده شد';
              addBtn.style.cssText += '; background:var(--color-success-soft); border-color:var(--color-success); color:var(--color-success); cursor:default; opacity:1;';
            }
          });
          addBtn.style.cssText += '; border-radius: 12px; font-size: 10px; height: 26px; padding: 2px 8px; flex-shrink: 0;';
          
          cardBox.append(cardContent, addBtn);
          cardsWrap.appendChild(cardBox);
        });

        bubble.appendChild(cardsWrap);
      }
    }

    chatList.appendChild(bubble);
    initInteractivePlots(bubble);
    initInteractiveGeometry(bubble);
    initVennDiagrams(bubble);
    initIntervalPlots(bubble);
    initMindmaps(bubble);
    initPhysicsSimulations(bubble);
  }
}

export async function renderStats(container) {
  // Show standard skeleton while fetching stats data
  container.innerHTML = '';
  const skeleton = createSkeletonList(3);
  container.appendChild(skeleton);

  const sessions = await studySessionRepository.getAll();
  const logs = await reviewHistoryRepository.getAll();
  const streak = await calculateStreak();

  container.innerHTML = '';

  if (sessions.length === 0) {
    container.appendChild(
      createEmptyState({
        icon: 'insights',
        title: 'هنوز آماری ثبت نشده',
        desc: 'زمان مطالعه، تعداد مرور، دقت پاسخ‌ها و روند پیشرفت شما بعد از اولین جلسه مرور در این بخش نمایش داده می‌شود.',
        action: createButton({
          label: 'شروع اولین مرور',
          icon: 'play_arrow',
          onClick: () => router.navigate('home'),
        })
      })
    );
    return;
  }

  // Calculate stats values
  const totalSessions = sessions.length;
  const totalReviews = sessions.reduce((acc, s) => acc + (s.cardsReviewed || 0), 0);

  // "دقت پاسخ‌دهی" (answer accuracy) only makes sense for sessions where the
  // user actually answered right/wrong questions — practice ("تمرین") and
  // exam ("آزمون") sessions. Plain FSRS review sessions (study tab) count a
  // card as "correct" whenever the user didn't tap "دوباره", which isn't a
  // real right/wrong answer, so they're excluded from this percentage.
  const scoredSessions = sessions.filter((s) => s.isPracticeSession || s.isExamSession);
  const totalScoredQuestions = scoredSessions.reduce((acc, s) => acc + (s.cardsReviewed || 0), 0);
  const totalCorrect = scoredSessions.reduce((acc, s) => acc + (s.correctAnswers || 0), 0);
  const globalAccuracy = totalScoredQuestions > 0 ? Math.round((totalCorrect / totalScoredQuestions) * 100) : null;
  
  const totalTimeSec = sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
  const totalTimeMin = Math.round(totalTimeSec / 60);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%; max-width:var(--max-content-w); margin:0 auto;';
  container.appendChild(wrap);

  // Stats Grid Panel
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

  // Streak Details card
  const streakCard = document.createElement('div');
  streakCard.className = 'ds-card';
  streakCard.style.cssText = 'padding:var(--space-3); display:flex; flex-direction:column; gap:var(--space-2); text-align:right;';
  
  const streakHeader = document.createElement('div');
  streakHeader.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); font-weight:800; font-size:var(--text-body); color:var(--color-accent);';
  streakHeader.innerHTML = '<span class="material-symbols-rounded">local_fire_department</span><span>آمار روندهای مطالعه روزانه</span>';
  
  const streakGrid = document.createElement('div');
  streakGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3); margin-top:4px;';
  
  const currentStreakCol = document.createElement('div');
  currentStreakCol.style.cssText = 'background:var(--color-accent-soft); padding:var(--space-2); border-radius:8px; display:flex; flex-direction:column; align-items:center;';
  currentStreakCol.innerHTML = `<span style="font-size:var(--text-title); font-weight:800; color:var(--color-accent);">${streak.currentStreak.toLocaleString('fa-IR')}</span>
    <span style="font-size:10px; color:var(--color-accent); margin-top:2px;">روند متوالی فعلی</span>`;

  const longestStreakCol = document.createElement('div');
  longestStreakCol.style.cssText = 'background:var(--color-accent-soft); padding:var(--space-2); border-radius:8px; display:flex; flex-direction:column; align-items:center;';
  longestStreakCol.innerHTML = `<span style="font-size:var(--text-title); font-weight:800; color:var(--color-accent);">${streak.longestStreak.toLocaleString('fa-IR')}</span>
    <span style="font-size:10px; color:var(--color-accent); margin-top:2px;">بهترین روند تاریخی</span>`;

  streakGrid.append(currentStreakCol, longestStreakCol);
  streakCard.append(streakHeader, streakGrid);
  wrap.appendChild(streakCard);

  // ── Study Calendar Heatmap ──────────────────────────────────────────
  // Aggregate cards-reviewed-per-day from the sessions already fetched
  // above, then render a GitHub-style contribution grid (RTL: today sits
  // on the right and is visible without scrolling; older weeks are
  // revealed by scrolling left, matching natural Persian reading order).
  {
    const dailyGoalStr = await db.getSetting('daily_study_goal', '20');
    const dailyGoal = parseInt(dailyGoalStr, 10) || 20;

    const dailyCounts = new Map();
    sessions.forEach((s) => {
      if (!s.date) return;
      dailyCounts.set(s.date, (dailyCounts.get(s.date) || 0) + (s.cardsReviewed || 0));
    });

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
    // Align the grid's start to the Saturday on/before (today - (NUM_WEEKS*7 - 1) days),
    // then extend by however many days that shift added so "today" is always
    // guaranteed to fall inside the last generated week (rather than being
    // cut off by up to 6 days once the start gets rounded back to a Saturday).
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - (NUM_WEEKS * 7 - 1));
    rangeStart.setDate(rangeStart.getDate() - rowIndexOf(rangeStart));
    const totalDaysSpan = Math.round((today - rangeStart) / 86400000) + 1;
    const weeksToRender = Math.ceil(totalDaysSpan / 7);

    // Build weeks oldest→newest, each an array of 7 {date, count} cells.
    const weeks = [];
    let cursor = new Date(rangeStart);
    for (let w = 0; w < weeksToRender; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const inRange = cursor >= rangeStart && cursor <= today;
        week.push({
          date: new Date(cursor),
          count: inRange ? (dailyCounts.get(toDateStr(cursor)) || 0) : null, // null = outside range, render blank
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }

    const activeDaysInRange = weeks.flat().filter((c) => c.count !== null && c.count > 0).length;
    const totalDaysInRange = weeks.flat().filter((c) => c.count !== null).length;

    const levelOf = (count) => {
      if (!count) return 0;
      const ratio = count / dailyGoal;
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
    heatmapSubtitle.textContent = `${activeDaysInRange.toLocaleString('fa-IR')} روز از ${totalDaysInRange.toLocaleString('fa-IR')} روز اخیر مطالعه کرده‌اید`;

    // Row of [day labels][scrollable weeks grid]
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

    // Newest week first in DOM so it lands in the first (rightmost, in
    // RTL) auto-placed column and is visible without scrolling.
    for (let w = weeks.length - 1; w >= 0; w--) {
      weeks[w].forEach((cell) => {
        const box = document.createElement('div');
        if (cell.count === null) {
          box.style.cssText = `width:${CELL}px; height:${CELL}px; border-radius:3px; visibility:hidden;`;
        } else {
          const level = levelOf(cell.count);
          const dateLabel = cell.date.toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' });
          box.title = cell.count > 0 ? `${dateLabel} — ${cell.count.toLocaleString('fa-IR')} مرور` : dateLabel;
          box.style.cssText = `width:${CELL}px; height:${CELL}px; border-radius:3px; ${levelStyle(level)}`;
        }
        grid.appendChild(box);
      });
    }

    scrollArea.appendChild(grid);
    heatmapRow.append(labelsCol, scrollArea);

    // Legend
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

  // Recent Sessions Logs List
  const listHeader = document.createElement('h3');
  listHeader.style.cssText = 'font-size:var(--text-section); font-weight:800; color:var(--text-primary); margin-top:var(--space-2); margin-bottom:var(--space-2); text-align:right;';
  listHeader.textContent = 'تاریخچه جلسات اخیر';
  wrap.appendChild(listHeader);

  const sessionsContainer = document.createElement('div');
  sessionsContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  wrap.appendChild(sessionsContainer);

  // Sort sessions: newest first, display up to 10
  const sortedSessions = [...sessions].sort((a, b) => new Date(b.startTime) - new Date(a.startTime)).slice(0, 10);

  sortedSessions.forEach(s => {
    const sessCard = document.createElement('div');
    sessCard.className = 'ds-card';
    sessCard.style.cssText = 'padding:var(--space-3); display:flex; justify-content:space-between; align-items:center; gap:var(--space-2);';

    const textCol = document.createElement('div');
    textCol.style.cssText = 'display:flex; flex-direction:column; gap:2px; text-align:right;';

    const date = new Date(s.startTime);
    const dateStr = date.toLocaleDateString('fa-IR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    const title = document.createElement('span');
    title.style.cssText = 'font-weight:700; color:var(--text-primary); font-size:var(--text-body);';
    title.textContent = `${dateStr} ساعت ${timeStr}`;

    const durationMin = Math.ceil(s.duration / 60);
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
    icon.style.cssText = 'color:var(--color-success); font-size:24px;';
    icon.textContent = 'check_circle';

    sessCard.append(textCol, icon);
    sessionsContainer.appendChild(sessCard);
  });
}

export async function renderSettings(container) {
  // Clear first and show a quick inline loading
  container.innerHTML = '';
  const loading = createLoadingInline ? createLoadingInline('در حال بارگذاری تنظیمات...') : document.createElement('div');
  loading.style.padding = 'var(--space-4) 0';
  loading.style.textAlign = 'center';
  container.appendChild(loading);

  // Load DB settings
  
  const apiKey = await db.getSetting('gemini_api_key', '');
  const preferredModel = await db.getSetting('gemini_model', 'gemini-3.5-flash');
  const dictationMethod = await db.getSetting('dictation_method', 'auto');
  const customInstruction = await db.getSetting('gemini_system_instruction', '');
  const ttsSpeed = await db.getSetting('tts_speed', '0.95');
  const ttsLang = await db.getSetting('tts_lang', 'fa-IR');
  const dailyGoal = await db.getSetting('daily_study_goal', '20');

  // Load customizable learning intervals from localStorage
  const intervalAgain = localStorage.getItem('interval_again') || '1';
  const intervalHard = localStorage.getItem('interval_hard') || '2';
  const intervalGood = localStorage.getItem('interval_good') || '4';
  const intervalEasy = localStorage.getItem('interval_easy') || '8';

  // Count db records
  const cats = await categoryRepository.getAll();
  const cards = await flashcardRepository.getAll();
  const sessions = await studySessionRepository.getAll();

  // Clear loading
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

  // Helper to show modern status toast message inside containers
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
    } else {
      msg.style.background = 'rgba(239, 68, 68, 0.1)';
      msg.style.color = '#EF4444';
      msg.style.border = '1px solid rgba(239, 68, 68, 0.2)';
      msg.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">error</span>' + text;
    }
    msgContainer.appendChild(msg);
    setTimeout(() => { if (msg.parentNode) msg.remove(); }, 5000);
  }

  // Define tab headers and click handling
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

  // --- TAB 1: STUDY & INTERVALS ---
  const studyTabContent = document.createElement('div');
  studyTabContent.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); width:100%;';

  // Goals Settings Card
  const goalContainer = document.createElement('div');
  goalContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const goalField = createTextField({
    label: 'هدف روزانه مرور (تعداد کارت)',
    placeholder: 'مثلاً ۲۰',
    value: dailyGoal,
    type: 'number'
  });
  const saveGoalBtn = createButton({
    label: 'ذخیره هدف مطالعه',
    icon: 'done',
    variant: 'primary',
    onClick: async () => {
      const val = parseInt(goalField.input.value.trim());
      if (isNaN(val) || val <= 0) {
        showStatusMessage(goalContainer, 'لطفاً یک عدد بزرگتر از صفر وارد کنید.', 'error');
        return;
      }
      await db.setSetting('daily_study_goal', val.toString());
      showStatusMessage(goalContainer, 'هدف مطالعه روزانه با موفقیت ذخیره شد.', 'success');
    }
  });
  saveGoalBtn.style.alignSelf = 'flex-end';
  goalContainer.append(goalField, saveGoalBtn);
  const goalCard = createCard({ title: 'برنامه‌ریزی و اهداف روزانه', content: goalContainer });

  // Custom FSRS Intervals Card
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

  studyTabContent.append(goalCard, intervalsCard);


  // --- TAB 2: AI & VOICE ---
  const aiTabContent = document.createElement('div');
  aiTabContent.style.cssText = 'display:none; flex-direction:column; gap:var(--space-3); width:100%;';

  // AI Card
  const aiContainer = document.createElement('div');
  aiContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
  const connDesc = document.createElement('div');
  connDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); line-height:1.6; text-align:right;';
  connDesc.textContent = 'این اپلیکیشن کاملاً محلی است و بدون هیچ سروری کار می‌کند؛ درخواست‌های هوش مصنوعی مستقیماً از دستگاه شما به Google Gemini ارسال می‌شوند. برای استفاده، یک کلید API رایگان از Google AI Studio دریافت کرده و در زیر وارد کنید.';
  const keyField = createTextField({
    label: 'کلید API اختصاصی Gemini (از Google AI Studio)',
    placeholder: 'AIzaSy...',
    value: apiKey,
    type: 'password'
  });
  const modelField = createSelectField({
    label: 'مدل پیش‌فرض هوش مصنوعی',
    value: preferredModel,
    options: [
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (هوشمند و بسیار سریع - پیش‌فرض)' },
      { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (بسیار سریع و سبک)' },
      { value: 'gemini-flash-latest', label: 'Gemini Flash Latest (جدیدترین نسخه Flash)' },
    ],
  });
  const modelSelect = modelField;

  // Voice dictation method: the mic button on Practice/Exam short-answer
  // questions can use the browser's own (free, offline-capable) speech
  // recognition, AI transcription via Gemini, or automatically try native
  // first and fall back to AI if it's unavailable/fails - important once
  // the app is packaged into an APK, where native speech recognition may
  // not work inside the WebView. See js/core/dictation.js.
  const dictationField = createSelectField({
    label: 'روش دیکته صوتی (تبدیل گفتار به متن)',
    value: dictationMethod,
    hint: 'در صورت تبدیل برنامه به APK، اگر گزینه «مرورگر» کار نکرد، حالت «خودکار» را انتخاب کنید تا هوش مصنوعی جایگزین آن شود.',
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
      const keyVal = keyField.input.value.trim();
      const modelVal = modelSelect.value;
      const instructionVal = instructionField.input.value.trim();

      await db.setSetting('gemini_api_key', keyVal);
      await db.setSetting('gemini_model', modelVal);
      await db.setSetting('dictation_method', dictationSelect.value);
      await db.setSetting('gemini_system_instruction', instructionVal);
      
      if (!keyVal) {
        showStatusMessage(aiContainer, 'تنظیمات ذخیره شد. از کلید سیستم/سرور استفاده خواهد شد.', 'success');
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
        const keyVal = keyField.input.value.trim();
        const modelVal = modelSelect.value;
        const { chatWithGemini } = await import('../core/gemini-client.js');
        const resData = await chatWithGemini({
          apiKey: keyVal || undefined,
          model: modelVal,
          message: 'پاسخ بده: سلام'
        });
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
  aiContainer.append(connDesc, keyField, modelField, dictationField, instructionField, buttonsRow);
  const aiCard = createCard({ title: 'تنظیمات هوش مصنوعی (Gemini)', content: aiContainer });

  // TTS Card
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


  // --- TAB 3: APPEARANCE ---
  const appearanceTabContent = document.createElement('div');
  appearanceTabContent.style.cssText = 'display:none; flex-direction:column; gap:var(--space-3); width:100%;';

  
  const currentThemeMode = await themeApi.getThemeMode();
  const currentAccent = await themeApi.getAccent();
  const currentFontScale = await themeApi.getFontScale();
  const currentReducedMotion = await themeApi.getReducedMotion();

  // Small reusable segmented control (used by all 3 pref rows below)
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

  // 1. Theme mode: light / dark / follows system
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

  // Sync state between the top-bar toggle and this tab
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

  // 2. Accent color picker
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

  // 3. Font size scale
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

  // 4. Motion / animation preference
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

  appearanceTabContent.append(themeModeCard, accentCard, fontSizeCard, motionCard);


  // --- TAB 4: SYSTEM & BACKUP ---
  const systemTabContent = document.createElement('div');
  systemTabContent.style.cssText = 'display:none; flex-direction:column; gap:var(--space-3); width:100%;';

  // Backup Card
  const backupContainer = document.createElement('div');
  backupContainer.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';
  const backupDesc = document.createElement('div');
  backupDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); line-height:1.6; text-align:right;';
  backupDesc.textContent = 'برای ایمن‌سازی اطلاعات خود، یک نسخه پشتیبان صادر و دانلود کنید. همچنین می‌توانید فایل‌های کپی ذخیره‌شده را در دیتابیس بارگذاری کنید. اگر دکمه‌ی «دانلود فایل» در نسخه‌ی نصب‌شده (APK) پاسخ نداد — که در برخی مبدل‌های HTML به APK پیش می‌آید، چون آن‌ها مدیریت دانلود فایل را پیاده‌سازی نکرده‌اند — از گزینه‌ی «نمایش/کپی متن پشتیبان» استفاده کنید؛ این روش به هیچ قابلیت خاصی از دستگاه نیاز ندارد و همیشه کار می‌کند.';
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
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `learning_os_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showStatusMessage(backupContainer, 'دانلود فایل آغاز شد. اگر روی این دستگاه (بخصوص در نسخه‌ی نصب‌شده APK) هیچ فایلی دانلود نشد، از دکمه‌ی «نمایش/کپی متن پشتیبان» به‌جای این گزینه استفاده کنید.', 'success');
      } catch (err) {
        showStatusMessage(backupContainer, `خطا در تهیه پشتیبان: ${err.message}`, 'error');
      } finally {
        exportBtn.disabled = false;
      }
    }
  });

  // Guaranteed-to-work fallback for APK builds whose WebView wrapper
  // doesn't implement a download handler for <a download> / blob: URLs
  // (a very common gap in generic "HTML to APK" tools). Copies the
  // backup as plain text via the Clipboard API instead of a file
  // download, so the user can paste it anywhere (Notes app, Telegram
  // "Saved Messages", email to self, etc.) as their backup.
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

  // Text-based counterpart to importBtn, for the same reason as
  // copyTextBtn above: some APK WebView wrappers never open the native
  // file picker for <input type="file"> because the host app doesn't
  // implement onShowFileChooser. Pasting text needs no native picker
  // at all, so it always works.
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

  // Diagnostics & Developer Card
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
                      await db.setSetting('gemini_api_key', '');
                      await db.setSetting('gemini_model', 'gemini-3.5-flash');
                      await db.setSetting('dictation_method', 'auto');
                      await db.setSetting('gemini_system_instruction', '');
                      await db.setSetting('tts_speed', '0.95');
                      await db.setSetting('tts_lang', 'fa-IR');
                      await db.setSetting('daily_study_goal', '20');
                      // BUGFIX: the custom FSRS learning-interval prefs
                      // (interval_again/hard/good/easy) live in
                      // localStorage, not IndexedDB, so a "wipe everything"
                      // used to silently leave them behind after this
                      // reset - the user would see empty data but their
                      // old intervals still applied.
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


  // Render the Tab Header items
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
    
    // Icon Setup
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
      // Reset all buttons
      tabButtons.forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-secondary)';
      });
      // Set active style
      btn.style.background = 'var(--color-primary)';
      btn.style.color = 'var(--text-on-primary)';

      // Show / hide content with animations
      studyTabContent.style.display = tab.id === 'study' ? 'flex' : 'none';
      aiTabContent.style.display = tab.id === 'ai' ? 'flex' : 'none';
      appearanceTabContent.style.display = tab.id === 'appearance' ? 'flex' : 'none';
      systemTabContent.style.display = tab.id === 'system' ? 'flex' : 'none';

      // Animation effect
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

    // Default activate first tab
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

  // 1. Header with title and descriptive icon
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

  // 2. Search container & results container
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

  // Focus input automatically
  const inputEl = searchBar.querySelector('input');
  if (inputEl) {
    setTimeout(() => inputEl.focus(), 100);
  }

  // Initial state rendering
  renderInitialState();

  function renderInitialState() {
    resultsContainer.innerHTML = '';
    const stateBox = createEmptyState({
      icon: 'search',
      title: 'آماده جستجو...',
      desc: 'عبارت مورد نظر خود را در فیلد بالا بنویسید تا دسته‌ها و فلش‌کارت‌های منطبق با آن بلافاصله نمایش داده شوند.',
    });
    // Add quick tag suggestions or popular search keywords
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

      // 1. Render Categories matching
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

      // 2. Render Flashcards matching
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
