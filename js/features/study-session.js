

import { createButton, createCard, createEmptyState, openDialog, createProgressBar, escapeHtml, escapeAttr, renderFractionsInText, showToast } from '../core/ui.js';
import { getStudyQueues, StudySession, calculateStreak } from '../core/study.js';
import { Rating, State, schedule } from '../core/fsrs.js';
import { speak, isSpeechSupported } from '../core/tts.js';
import { router } from '../core/router.js';
import { categoryRepository, flashcardRepository } from '../core/repositories.js';
import { notifications } from '../core/notifications.js';
import { openAiExplanationBottomSheet } from './ai-explanation.js';

export async function renderStudySession(container, categoryId = null, forceAll = false) {
  // Start loading screen
  container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;color:var(--text-secondary);">
    <div class="spinner" style="margin-bottom:12px;"></div>
    <span>در حال آماده‌سازی جلسه مرور…</span>
  </div>`;

  const category = categoryId ? await categoryRepository.getById(categoryId) : null;
  if (categoryId && !category) {
    container.innerHTML = '';
    container.appendChild(
      createEmptyState({
        icon: 'error_outline',
        title: 'دسته یافت نشد',
        desc: 'دسته مورد نظر برای مطالعه یافت نشد.',
        action: createButton({ label: 'بازگشت به کتابخانه', onClick: () => router.navigate('library') })
      })
    );
    return;
  }

  // Retrieve FSRS study queues
  const queues = await getStudyQueues(categoryId);
  
  // Combine queues for this study session
  // Priority: Due cards -> Learning/relearning cards -> New cards
  let sessionCards = [...queues.due, ...queues.learning, ...queues.new];

  // "Review again" mode: once everything is up to date per FSRS scheduling,
  // the user can still choose to go through every active card again for
  // extra practice, ignoring the due dates.
  if (forceAll) {
    const allCards = categoryId
      ? await flashcardRepository.getByIndex('categoryId', categoryId)
      : await flashcardRepository.getAll();
    sessionCards = allCards.filter((c) => !c.deleted).sort(() => 0.5 - Math.random());
  }

  if (sessionCards.length === 0) {
    container.innerHTML = '';

    let hasAnyCards = false;
    if (!forceAll) {
      const allCards = categoryId
        ? await flashcardRepository.getByIndex('categoryId', categoryId)
        : await flashcardRepository.getAll();
      hasAnyCards = allCards.some((c) => !c.deleted);
    }

    const actionsWrap = document.createElement('div');
    actionsWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); width:100%; max-width:280px;';

    if (hasAnyCards) {
      actionsWrap.appendChild(createButton({
        label: 'مرور دوباره کارت‌ها',
        icon: 'refresh',
        variant: 'secondary',
        onClick: () => renderStudySession(container, categoryId, true)
      }));
    }
    actionsWrap.appendChild(createButton({
      label: 'بازگشت به کتابخانه',
      onClick: () => router.navigate(categoryId ? 'category' : 'library', categoryId)
    }));

    container.appendChild(
      createEmptyState({
        icon: 'verified_user',
        title: 'همه کارت‌ها مرور شده‌اند!',
        desc: category 
          ? `فلش‌کارت‌های دسته‌ی «${category.title}» کاملاً به‌روز هستند. طبق الگوریتم FSRS فعلاً نیازی به مرور نیست.`
          : 'همه فلش‌کارت‌های فعال شما کاملاً به‌روز هستند! برای مرور کارت‌های جدید، کارت جدید بسازید.',
        action: actionsWrap
      })
    );
    return;
  }

  // Initialize Study Session State
  const session = new StudySession(categoryId);
  let currentIndex = 0;
  let isFlipped = false;
  let isProcessingRating = false;
  let startTime = Date.now();

  // Dynamic status updates
  router.setTitle(category ? `مرور: ${category.title}` : 'مرور روزانه');

  // Build View layout
  container.innerHTML = '';

  const mainContainer = document.createElement('div');
  mainContainer.style.cssText = 'width:100%;max-width:var(--max-content-w);margin:0 auto;display:flex;flex-direction:column;gap:var(--space-3);';
  container.appendChild(mainContainer);

  // 1. Progress Bar Header
  const progressHeader = document.createElement('div');
  progressHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-2);font-size:var(--text-caption);color:var(--text-secondary);';
  
  const progressText = document.createElement('span');
  progressText.style.fontWeight = '600';
  
  const queueStats = document.createElement('span');
  queueStats.style.cssText = 'font-family:var(--font-mono);direction:ltr;display:flex;gap:var(--space-2);';
  queueStats.innerHTML = forceAll
    ? `<span style="color:var(--color-primary); display:inline-flex; align-items:center; gap:4px;"><span class="material-symbols-rounded" style="font-size:16px;">replay</span>حالت مرور دوباره (آزاد)</span>`
    : `<span style="color:var(--color-primary)">${queues.due.length} مرور</span> · <span style="color:var(--color-warning)">${queues.learning.length} یادگیری</span> · <span style="color:var(--color-accent)">${queues.new.length} جدید</span>`;

  progressHeader.append(progressText, queueStats);
  
  const progressBarContainer = document.createElement('div');
  progressBarContainer.style.marginBottom = 'var(--space-3)';

  mainContainer.append(progressHeader, progressBarContainer);

  // 2. Active Card Area
  const cardStage = document.createElement('div');
  cardStage.style.cssText = 'width:100%;perspective:1200px;margin-bottom:var(--space-2);';
  mainContainer.appendChild(cardStage);

  // 2.5. Dedicated Utility Action Row (Outside 3D card to prevent any tap target interference)
  const utilityActionRow = document.createElement('div');
  utilityActionRow.style.cssText = 'display:flex;gap:var(--space-3);margin-bottom:var(--space-3);width:100%;justify-content:center;align-items:center;';
  mainContainer.appendChild(utilityActionRow);

  // 3. Control Actions Area
  const controlsArea = document.createElement('div');
  controlsArea.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-3);align-items:center;';
  mainContainer.appendChild(controlsArea);

  // Render the current active card
  renderCurrentCard();

  function renderCurrentCard() {
    isFlipped = false;
    cardStage.innerHTML = '';
    controlsArea.innerHTML = '';
    utilityActionRow.innerHTML = '';

    const currentCard = sessionCards[currentIndex];
    
    // Update progress details
    const percentage = Math.round((currentIndex / sessionCards.length) * 100);
    progressText.textContent = `کارت ${(currentIndex + 1).toLocaleString('fa-IR')} از ${sessionCards.length.toLocaleString('fa-IR')}`;
    progressBarContainer.innerHTML = '';
    progressBarContainer.appendChild(createProgressBar(percentage));

    // Calculate FSRS preview intervals for each rating
    const intervals = getFSRSIntervals(currentCard);

    // Build Flippable Card HTML
    const flipCard = document.createElement('div');
    flipCard.className = 'flip-card';
    flipCard.style.width = '100%';
    
    const innerCard = document.createElement('div');
    innerCard.className = 'flip-card-inner';
    flipCard.appendChild(innerCard);

    // Front Face
    const frontFace = document.createElement('div');
    frontFace.className = 'flip-face';
    frontFace.style.cssText = 'text-align:center;';
    frontFace.innerHTML = renderFaceContent(currentCard.frontContent, currentCard.frontImage);
    
    // Back Face
    const backFace = document.createElement('div');
    backFace.className = 'flip-face flip-face-back';
    backFace.style.cssText = 'text-align:center;';
    backFace.innerHTML = renderFaceContent(currentCard.backContent, currentCard.backImage);

    innerCard.append(frontFace, backFace);
    cardStage.appendChild(flipCard);

    // Tap card to flip gesture
    flipCard.addEventListener('click', flipTheCard);

    // Create stable utility buttons outside of the 3D transformed containers
    const aiExplainBtn = document.createElement('button');
    aiExplainBtn.className = 'icon-btn';
    aiExplainBtn.setAttribute('aria-label', 'توضیح با هوش مصنوعی');
    aiExplainBtn.style.cssText = 'width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--bg-card); border: 1.5px solid var(--border-soft); color: var(--color-primary); cursor: pointer; transition: transform var(--duration-fast), background-color var(--duration-fast);';
    aiExplainBtn.innerHTML = '<span class="material-symbols-rounded">psychology</span>';
    aiExplainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const frontText = textOf(currentCard.frontContent);
      const backText = textOf(currentCard.backContent);
      openAiExplanationBottomSheet(frontText, backText);
    });
    aiExplainBtn.addEventListener('mouseenter', () => { aiExplainBtn.style.transform = 'scale(1.08)'; aiExplainBtn.style.backgroundColor = 'var(--bg-card-hover)'; });
    aiExplainBtn.addEventListener('mouseleave', () => { aiExplainBtn.style.transform = 'scale(1.0)'; aiExplainBtn.style.backgroundColor = 'var(--bg-card)'; });

    const speakerBtn = document.createElement('button');
    speakerBtn.className = 'icon-btn';
    speakerBtn.setAttribute('aria-label', 'تلفظ با صدا');
    speakerBtn.style.cssText = 'width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--bg-card); border: 1.5px solid var(--border-soft); color: var(--color-primary); cursor: pointer; transition: transform var(--duration-fast), background-color var(--duration-fast);';
    speakerBtn.innerHTML = '<span class="material-symbols-rounded">volume_up</span>';
    speakerBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const textToSpeak = isFlipped ? textOf(currentCard.backContent) : textOf(currentCard.frontContent);
      const ok = await speak(textToSpeak);
      if (!ok) {
        showToast('پخش صدا انجام نشد. اتصال اینترنت را بررسی کنید یا از تنظیمات، کلید Gemini را وارد کنید.', 'error');
      }
    });

    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = 'icon-btn';
    bookmarkBtn.setAttribute('aria-label', currentCard.bookmark ? 'حذف نشانه' : 'نشانه گذاری');
    bookmarkBtn.style.cssText = 'width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--bg-card); border: 1.5px solid var(--border-soft); color: var(--text-secondary); cursor: pointer; transition: transform var(--duration-fast), background-color var(--duration-fast);';
    bookmarkBtn.innerHTML = `<span class="material-symbols-rounded bookmark-icon" style="font-variation-settings:'FILL' ${currentCard.bookmark ? 1 : 0}">bookmark</span>`;
    bookmarkBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      currentCard.bookmark = !currentCard.bookmark;
      bookmarkBtn.querySelector('.bookmark-icon').style.fontVariationSettings = `'FILL' ${currentCard.bookmark ? 1 : 0}`;
      await flashcardRepository.update(currentCard.id, { bookmark: currentCard.bookmark });
    });

    // Hover feedback animations
    speakerBtn.addEventListener('mouseenter', () => { speakerBtn.style.transform = 'scale(1.08)'; speakerBtn.style.backgroundColor = 'var(--bg-card-hover)'; });
    speakerBtn.addEventListener('mouseleave', () => { speakerBtn.style.transform = 'scale(1.0)'; speakerBtn.style.backgroundColor = 'var(--bg-card)'; });
    bookmarkBtn.addEventListener('mouseenter', () => { bookmarkBtn.style.transform = 'scale(1.08)'; bookmarkBtn.style.backgroundColor = 'var(--bg-card-hover)'; });
    bookmarkBtn.addEventListener('mouseleave', () => { bookmarkBtn.style.transform = 'scale(1.0)'; bookmarkBtn.style.backgroundColor = 'var(--bg-card)'; });

    utilityActionRow.append(aiExplainBtn, speakerBtn, bookmarkBtn);

    // Setup first view controls: Show Answer button
    const showAnswerBtn = createButton({
      label: 'مشاهده پاسخ',
      icon: 'visibility',
      variant: 'primary',
      onClick: flipTheCard
    });
    showAnswerBtn.style.width = '100%';
    showAnswerBtn.style.height = '54px';
    controlsArea.appendChild(showAnswerBtn);

    function flipTheCard() {
      if (isFlipped) {
        isFlipped = false;
        flipCard.classList.remove('flipped');
        controlsArea.innerHTML = '';
        controlsArea.appendChild(showAnswerBtn);
      } else {
        isFlipped = true;
        flipCard.classList.add('flipped');
        showFSRSButtons();
      }
    }

    // Displays the FSRS Spaced Repetition rating buttons in an elegant drawer slide-up
    function showFSRSButtons() {
      controlsArea.innerHTML = '';

      const drawer = document.createElement('div');
      drawer.className = 'drawer-slide-up';
      drawer.style.cssText = 'width:100%; display:flex; flex-direction:column; gap:var(--space-2); background:var(--bg-card); border:1px solid var(--border-soft); border-radius:var(--radius-card); padding:var(--space-3); box-shadow:0 -4px 20px rgba(0,0,0,0.05);';

      const drawerHandle = document.createElement('div');
      drawerHandle.style.cssText = 'width:40px; height:4px; background:var(--border-strong); border-radius:2px; margin:0 auto var(--space-2) auto; opacity:0.6;';
      drawer.appendChild(drawerHandle);

      const ratingGrid = document.createElement('div');
      ratingGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4, 1fr);gap:var(--space-2);width:100%;';
      drawer.appendChild(ratingGrid);
      controlsArea.appendChild(drawer);

      const ratingConfigs = [
        { label: 'دوباره', rating: Rating.Again, color: 'var(--color-danger)', bg: 'var(--color-danger-soft)', desc: 'فراموشی' },
        { label: 'سخت', rating: Rating.Hard, color: 'var(--color-warning)', bg: 'var(--color-warning-soft)', desc: 'تلاش زیاد' },
        { label: 'خوب', rating: Rating.Good, color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', desc: 'یادآوری' },
        { label: 'آسان', rating: Rating.Easy, color: 'var(--color-success)', bg: 'var(--color-success-soft)', desc: 'فوری' },
      ];

      ratingConfigs.forEach(cfg => {
        const btn = document.createElement('button');
        btn.style.cssText = `
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:var(--space-2);border-radius:var(--radius-card);border:2px solid ${cfg.color};
          background:${cfg.bg};color:${cfg.color};transition:transform var(--duration-fast) var(--ease-standard);
          min-height:76px;cursor:pointer;
        `;
        
        btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.03)');
        btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1.0)');
        
        const labelText = document.createElement('span');
        labelText.style.fontWeight = '800';
        labelText.style.fontSize = 'var(--text-body)';
        labelText.textContent = cfg.label;

        const intervalText = document.createElement('span');
        intervalText.style.fontSize = '10px';
        intervalText.style.fontWeight = '600';
        intervalText.style.marginTop = '2px';
        intervalText.style.opacity = '0.85';
        intervalText.textContent = formatInterval(intervals[cfg.rating]);

        btn.append(labelText, intervalText);
        btn.addEventListener('click', () => handleRating(cfg.rating));
        ratingGrid.appendChild(btn);
      });
    }

    async function handleRating(rating) {
      if (isProcessingRating) return;
      isProcessingRating = true;

      // Disable all rating buttons to prevent double click race conditions
      const ratingButtons = controlsArea.querySelectorAll('button');
      ratingButtons.forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.5';
        b.style.pointerEvents = 'none';
      });

      try {
        // Record review using FSRS StudySession engine and retrieve the updated card
        const { card: updatedCard } = await session.submitReview(currentCard, rating);

        // The card's nextReview time just changed, so the previously
        // scheduled "review due" reminder may now be pointing at the wrong
        // moment. Refresh it in the background; never block the UI on this.
        notifications.scheduleNextReviewReminder();

        // A card that hasn't graduated out of Learning/Relearning yet is on
        // a short minute-based step (see fsrs.js), not a multi-day FSRS
        // interval — so it needs to come back within THIS session, not the
        // next one. This used to only happen for "دوباره" (Again), so a new
        // card rated "سخت" (Hard) — which also stays in Learning — silently
        // vanished from the session instead of resurfacing a few minutes
        // later as intended.
        const stillLearning = updatedCard.fsrsState &&
          (updatedCard.fsrsState.state === State.Learning || updatedCard.fsrsState.state === State.Relearning);
        if (stillLearning) {
          sessionCards.push(updatedCard);
        }

        // Transition to next card or complete session
        if (currentIndex < sessionCards.length - 1) {
          currentIndex++;
          isProcessingRating = false; // Reset the state before loading the next card
          renderCurrentCard();
        } else {
          isProcessingRating = false;
          renderSessionSummary();
        }
      } catch (err) {
        console.error('Error during FSRS rating submission:', err);
        isProcessingRating = false;
        ratingButtons.forEach(b => {
          b.disabled = false;
          b.style.opacity = '1';
          b.style.pointerEvents = 'auto';
        });
      }
    }
  }

  // Calculate real FSRS preview intervals for each rating button by running
  // the actual scheduler as a dry-run (schedule() is pure — it returns a new
  // object and never touches the database), instead of showing a fixed
  // placeholder that didn't reflect the card's real state.
  function getFSRSIntervals(card) {
    const result = {};
    [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].forEach((rating) => {
      const { card: previewCard } = schedule(card, rating, new Date());
      result[rating] = new Date(previewCard.nextReview).getTime() - Date.now();
    });
    return result;
  }

  function formatInterval(msUntilNext) {
    const minutes = Math.max(1, Math.round(msUntilNext / 60000));
    if (minutes < 60) return `${minutes.toLocaleString('fa-IR')} دقیقه`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours.toLocaleString('fa-IR')} ساعت`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days.toLocaleString('fa-IR')} روز`;
    const months = Math.round(days / 30);
    return `${months.toLocaleString('fa-IR')} ماه`;
  }

  function renderFaceContent(contentBlocks, image) {
    const rawText = escapeHtml(textOf(contentBlocks)) || '';
    const text = rawText ? renderFractionsInText(rawText) : '<span style="color:var(--text-tertiary)">(بدون متن)</span>';
    const imgHtml = image ? `<img src="${escapeAttr(image)}" alt="" class="fc-face-image" style="max-height:160px;margin-bottom:var(--space-2);border-radius:var(--radius-btn);object-fit:contain;">` : '';
    // Wrapped in .fc-face-scroll: this plain (non-3D) inner element is what
    // actually clips/scrolls the content. See css/components.css for why.
    return `<div class="fc-face-scroll">${imgHtml}<div class="fc-face-text" style="font-size:var(--text-title);font-weight:700;line-height:var(--lh-normal);">${text}</div></div>`;
  }

  function textOf(contentBlocks) {
    if (!Array.isArray(contentBlocks)) return '';
    return contentBlocks.map((b) => b.value || '').join(' ').trim();
  }

  async function renderSessionSummary() {
    // Save finished study session record
    const record = await session.end();
    const streak = await calculateStreak();

    const timeSpentSec = Math.floor((Date.now() - startTime) / 1000);
    const timeMin = Math.floor(timeSpentSec / 60);
    const timeSec = timeSpentSec % 60;
    const timeStr = timeMin > 0 
      ? `${timeMin.toLocaleString('fa-IR')} دقیقه و ${timeSec.toLocaleString('fa-IR')} ثانیه`
      : `${timeSec.toLocaleString('fa-IR')} ثانیه`;

    const accuracy = record.cardsReviewed > 0 
      ? Math.round((record.correctAnswers / record.cardsReviewed) * 100) 
      : 0;

    container.innerHTML = '';
    
    // Celebratory Summary Card layout
    const summaryCard = document.createElement('div');
    summaryCard.className = 'ds-card';
    summaryCard.style.cssText = 'padding:var(--space-5);text-align:center;display:flex;flex-direction:column;gap:var(--space-4);width:100%;max-width:480px;margin:24px auto;';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'empty-state-icon';
    iconWrap.style.cssText = 'margin:0 auto;width:80px;height:80px;background:var(--color-primary-soft);color:var(--color-primary);border-radius:50%;display:flex;align-items:center;justify-content:center;';
    iconWrap.innerHTML = '<span class="material-symbols-rounded" style="font-size:40px;">emoji_events</span>';

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:22px;font-weight:800;color:var(--text-primary);';
    title.textContent = 'کارت‌ها با موفقیت مرور شدند!';

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:var(--text-body);color:var(--text-secondary);line-height:var(--lh-normal);';
    desc.textContent = 'خسته نباشید! الگوریتم FSRS اطلاعات شما را برای تکرار بعدی ثبت کرد.';

    // Grid details
    const statsGrid = document.createElement('div');
    statsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3, 1fr);gap:var(--space-2);margin:var(--space-3) 0;';

    const statItems = [
      { val: record.cardsReviewed.toLocaleString('fa-IR'), label: 'کارت مرور شده' },
      { val: `${accuracy.toLocaleString('fa-IR')}%`, label: 'دقت پاسخ‌ها' },
      { val: timeStr, label: 'زمان کل مطالعه' },
    ];

    statItems.forEach(item => {
      const box = document.createElement('div');
      box.style.cssText = 'background:var(--bg-sunken);padding:var(--space-2);border-radius:var(--radius-btn);display:flex;flex-direction:column;justify-content:center;align-items:center;';
      const v = document.createElement('span');
      v.style.cssText = 'font-size:var(--text-section);font-weight:800;color:var(--color-primary);display:block;';
      v.textContent = item.val;
      const l = document.createElement('span');
      l.style.cssText = 'font-size:10px;color:var(--text-tertiary);margin-top:2px;';
      l.textContent = item.label;
      box.append(v, l);
      statsGrid.appendChild(box);
    });

    // Streak details
    const streakRow = document.createElement('div');
    streakRow.style.cssText = 'background:var(--color-accent-soft);border:1px solid var(--color-accent);padding:var(--space-3);border-radius:var(--radius-card);display:flex;align-items:center;justify-content:center;gap:var(--space-2);color:var(--color-accent);font-size:var(--text-body);font-weight:700;';
    streakRow.innerHTML = `<span class="material-symbols-rounded">local_fire_department</span>
      <span>روند یادگیری روزانه شما: ${streak.currentStreak.toLocaleString('fa-IR')} روز متوالی!</span>`;

    const closeBtn = createButton({
      label: 'پایان و بازگشت',
      variant: 'primary',
      onClick: () => router.navigate(categoryId ? 'category' : 'library', categoryId)
    });
    closeBtn.style.height = '48px';

    const reviewAgainBtn = createButton({
      label: 'مرور دوباره کارت‌ها',
      icon: 'refresh',
      variant: 'secondary',
      onClick: () => renderStudySession(container, categoryId, true)
    });
    reviewAgainBtn.style.height = '48px';

    summaryCard.append(iconWrap, title, desc, statsGrid, streakRow, reviewAgainBtn, closeBtn);
    container.appendChild(summaryCard);
  }
}
