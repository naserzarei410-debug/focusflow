

import {
  createButton, createCard, createEmptyState, createProgressBar,
  createProgressRing, createTextArea, openDialog, renderFractionsInText, escapeHtml
} from '../core/ui.js';
import { categoryRepository, flashcardRepository, studySessionRepository } from '../core/repositories.js';
import { router } from '../core/router.js';
import { speak, isSpeechSupported } from '../core/tts.js';
import { attachDictationButton, stopAnyActiveDictation } from '../core/dictation.js';
import { openAiExplanationBottomSheet } from './ai-explanation.js';

// Every dictation button created while this view is mounted registers its
// controller here, so we can cleanly cancel any in-flight recording when
// the user navigates away mid-session instead of leaking a mic stream.
const activeDictationSessions = [];

export async function renderPracticeSession(container, categoryId = null) {
  stopAnyActiveDictation();
  activeDictationSessions.length = 0;

  // Start loading screen
  container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;color:var(--text-secondary);">
    <div class="spinner" style="margin-bottom:12px;"></div>
    <span>در حال آماده‌سازی جلسه تمرین…</span>
  </div>`;

  if (!categoryId) {
    container.innerHTML = '';
    container.appendChild(
      createEmptyState({
        icon: 'folder',
        title: 'دسته‌ای انتخاب نشده است',
        desc: 'لطفاً برای شروع تمرین ابتدا یک دسته مطالعاتی را از کتابخانه باز کنید.',
        action: createButton({ label: 'مشاهده کتابخانه', onClick: () => router.navigate('library') })
      })
    );
    return;
  }

  const category = await categoryRepository.getById(categoryId);
  if (!category) {
    container.innerHTML = '';
    container.appendChild(
      createEmptyState({
        icon: 'error_outline',
        title: 'دسته یافت نشد',
        desc: 'دسته مورد نظر یافت نشد.',
        action: createButton({ label: 'بازگشت به کتابخانه', onClick: () => router.navigate('library') })
      })
    );
    return;
  }

  // Retrieve active flashcards for this category
  const allCards = await flashcardRepository.getByIndex('categoryId', categoryId);
  const activeCards = allCards.filter(c => !c.deleted);

  if (activeCards.length < 2) {
    container.innerHTML = '';
    container.appendChild(
      createEmptyState({
        icon: 'style',
        title: 'تعداد فلش‌کارت‌ها کافی نیست',
        desc: 'برای شروع تمرین هوشمند و ساخت سوالات تستی و چندگزینه‌ای، باید حداقل ۲ فلش‌کارت در این دسته داشته باشید.',
        action: createButton({ 
          label: 'ساخت فلش‌کارت جدید', 
          icon: 'add',
          onClick: () => router.navigate('category', categoryId) 
        })
      })
    );
    return;
  }

  // ----------------------------------------------------
  // Setup Screen State
  // ----------------------------------------------------
  renderSetupScreen();

  function renderSetupScreen() {
    router.setTitle(`تنظیمات تمرین: ${category.title}`);
    container.innerHTML = '';

    const setupWrap = document.createElement('div');
    setupWrap.style.cssText = 'width:100%;max-width:var(--max-content-w);margin:0 auto;display:flex;flex-direction:column;gap:var(--space-4);text-align:right;';
    container.appendChild(setupWrap);

    // Cover Card Header
    const coverCard = document.createElement('div');
    coverCard.className = 'ds-card';
    coverCard.style.cssText = `background: linear-gradient(135deg, ${category.themeColor}12, ${category.themeColor}1A); border: 1px solid ${category.themeColor}33; padding: var(--space-4); border-radius: var(--radius-card); display: flex; align-items: center; gap: var(--space-3);`;
    
    const iconBox = document.createElement('div');
    iconBox.style.cssText = `width:48px; height:48px; border-radius:50%; background:${category.themeColor}22; color:${category.themeColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;`;
    iconBox.innerHTML = `<span class="material-symbols-rounded" style="font-size:28px;">quiz</span>`;

    const coverInfo = document.createElement('div');
    coverInfo.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    const coverTitle = document.createElement('h2');
    coverTitle.style.cssText = 'font-size:var(--text-title); font-weight:800; color:var(--text-primary); margin:0;';
    coverTitle.textContent = `تمرین خودآزمون دسته «${category.title}»`;
    const coverDesc = document.createElement('span');
    coverDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
    coverDesc.textContent = `مجموعاً ${activeCards.length.toLocaleString('fa-IR')} فلش‌کارت برای تولید سوالات تستی، چندگزینه‌ای و تشریحی در دسترس است.`;
    
    coverInfo.append(coverTitle, coverDesc);
    coverCard.append(iconBox, coverInfo);
    setupWrap.appendChild(coverCard);

    // Configuration Settings Form
    const configCard = document.createElement('div');
    configCard.className = 'ds-card';
    configCard.style.cssText = 'padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-4);';
    setupWrap.appendChild(configCard);

    // 1. Question Count Choice
    const countSection = document.createElement('div');
    countSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
    countSection.innerHTML = '<span style="font-weight:700; font-size:var(--text-body); color:var(--text-primary);">تعداد سوالات جلسه:</span>';
    
    const countGrid = document.createElement('div');
    countGrid.style.cssText = 'display:grid; grid-template-columns:repeat(4, 1fr); gap:var(--space-2);';
    countSection.appendChild(countGrid);

    let selectedCount = Math.min(10, activeCards.length);
    const countOptions = [5, 10, 15, activeCards.length];
    const countButtons = [];

    countOptions.forEach(opt => {
      // Avoid duplicate keys or options larger than active list
      if (opt > activeCards.length && opt !== 5 && opt !== 10) return;
      const displayOpt = Math.min(opt, activeCards.length);
      const isSelected = displayOpt === selectedCount;

      const btn = document.createElement('button');
      btn.style.cssText = `padding:var(--space-2); border-radius:12px; border:1.5px solid var(--border-strong); font-weight:700; background:var(--bg-elevated); color:var(--text-secondary); cursor:pointer; text-align:center; transition: all var(--duration-fast);`;
      btn.textContent = displayOpt === activeCards.length ? 'کل کارت‌ها' : `${displayOpt.toLocaleString('fa-IR')} سوال`;
      
      const updateBtnStyle = (isActive) => {
        if (isActive) {
          btn.style.borderColor = 'var(--color-primary)';
          btn.style.background = 'var(--color-primary-soft)';
          btn.style.color = 'var(--color-primary)';
        } else {
          btn.style.borderColor = 'var(--border-strong)';
          btn.style.background = 'var(--bg-elevated)';
          btn.style.color = 'var(--text-secondary)';
        }
      };

      updateBtnStyle(isSelected);
      btn.addEventListener('click', () => {
        selectedCount = displayOpt;
        countButtons.forEach(b => b.update(b.val === selectedCount));
      });

      countGrid.appendChild(btn);
      countButtons.push({ el: btn, val: displayOpt, update: updateBtnStyle });
    });
    configCard.appendChild(countSection);

    // 2. Question Formats Checkbox Row
    const formatsSection = document.createElement('div');
    formatsSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
    formatsSection.innerHTML = '<span style="font-weight:700; font-size:var(--text-body); color:var(--text-primary);">نوع سوالات تمرین:</span>';
    
    const formatsGrid = document.createElement('div');
    formatsGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3);';
    formatsSection.appendChild(formatsGrid);

    const formatOptions = [
      { id: 'choice', label: 'چند گزینه‌ای (چهار گزینه‌ای)', checked: true },
      { id: 'tf', label: 'صحیح و غلط', checked: true },
      { id: 'short', label: 'کوتاه پاسخ (تشریحی و صوتی)', checked: true },
      { id: 'blank', label: 'جای خالی (تکمیل متن)', checked: true },
    ];

    const formatChecks = {};
    const hasClozeCards = activeCards.some(card => /[\.]{3,}/.test(textOf(card.frontContent)));

    formatOptions.forEach(opt => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); cursor:pointer; font-size:var(--text-caption); font-weight:600; color:var(--text-secondary); padding:var(--space-2); border-radius:8px; border:1px solid var(--border-subtle); background:var(--bg-sunken);';
      
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = opt.id === 'blank' && !hasClozeCards ? false : opt.checked;
      chk.style.cssText = 'width:18px; height:18px; cursor:pointer; accent-color:var(--color-primary);';
      
      const text = document.createElement('span');
      text.textContent = opt.label;
      
      label.append(chk, text);
      formatsGrid.appendChild(label);
      formatChecks[opt.id] = chk;

      if (opt.id === 'blank' && !hasClozeCards) {
        chk.disabled = true;
        label.style.opacity = '0.6';
        label.style.cursor = 'not-allowed';
        
        const lockIcon = document.createElement('span');
        lockIcon.className = 'material-symbols-rounded';
        lockIcon.style.cssText = 'font-size:16px; margin-right:auto; color:var(--text-secondary);';
        lockIcon.textContent = 'lock';
        label.appendChild(lockIcon);

        label.addEventListener('click', (e) => {
          e.preventDefault();
          openDialog({
            title: 'سوالات جای خالی قفل است',
            body: 'شما هیچ سوال جای خالی در این دسته طراحی نکرده‌اید.\n\nبرای طراحی این نوع سوالات، کافیست هنگام ساخت یا ویرایش فلش‌کارت، در متن روی کارت (صورت سوال) از ۳ یا بیشتر نقطه پشت سر هم (مثلاً .....) استفاده کنید و پاسخ را در پشت کارت بنویسید تا سیستم آن را به عنوان سوال جای خالی تشخیص دهد.',
            actions: [{ label: 'متوجه شدم', variant: 'primary' }]
          });
        });
      }
    });
    configCard.appendChild(formatsSection);

    // 3. Smart Filtering Segment
    const filterSection = document.createElement('div');
    filterSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
    filterSection.innerHTML = '<span style="font-weight:700; font-size:var(--text-body); color:var(--text-primary);">تمرکز مطالعه:</span>';

    const filterGrid = document.createElement('div');
    filterGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr 1fr; gap:var(--space-2);';
    filterSection.appendChild(filterGrid);

    let focusMode = 'all'; // 'all', 'bookmark', 'weak'
    const filterButtons = [];
    const filterOpts = [
      { id: 'all', label: 'همه کارت‌ها', icon: 'style' },
      { id: 'bookmark', label: 'بوکمارک‌ها', icon: 'bookmark' },
      { id: 'weak', label: 'کارت‌های دشوار', icon: 'trending_down' },
    ];

    filterOpts.forEach(opt => {
      const btn = document.createElement('button');
      btn.style.cssText = `padding:var(--space-2) var(--space-1); border-radius:12px; border:1.5px solid var(--border-strong); font-weight:700; background:var(--bg-elevated); color:var(--text-secondary); cursor:pointer; text-align:center; transition: all var(--duration-fast); display:flex; align-items:center; justify-content:center; gap:4px; font-size:12px;`;
      btn.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">${opt.icon}</span><span>${opt.label}</span>`;

      const updateFilterStyle = (isActive) => {
        if (isActive) {
          btn.style.borderColor = 'var(--color-warning)';
          btn.style.background = 'var(--color-warning-soft)';
          btn.style.color = 'var(--color-warning)';
        } else {
          btn.style.borderColor = 'var(--border-strong)';
          btn.style.background = 'var(--bg-elevated)';
          btn.style.color = 'var(--text-secondary)';
        }
      };

      updateFilterStyle(opt.id === focusMode);
      btn.addEventListener('click', () => {
        focusMode = opt.id;
        filterButtons.forEach(b => b.update(b.id === focusMode));
      });

      filterGrid.appendChild(btn);
      filterButtons.push({ el: btn, id: opt.id, update: updateFilterStyle });
    });
    configCard.appendChild(filterSection);

    // Launch Button
    const startBtn = createButton({
      label: 'شروع جلسه تمرین',
      icon: 'play_arrow',
      variant: 'primary',
      onClick: () => launchSession(selectedCount, formatChecks, focusMode)
    });
    startBtn.style.height = '48px';
    setupWrap.appendChild(startBtn);
  }

  // ----------------------------------------------------
  // Session Launch & Question Generation
  // ----------------------------------------------------
  function launchSession(selectedCount, formatChecks, focusMode) {
    // 1. Gather configured types
    const activeTypes = Object.keys(formatChecks).filter(k => formatChecks[k].checked);
    if (activeTypes.length === 0) {
      openDialog({
        title: 'انتخاب نوع سوال الزامی است',
        body: 'لطفاً حداقل یکی از انواع سوالات (چند گزینه‌ای، صحیح/غلط، کوتاه پاسخ، جای خالی) را فعال کنید.',
        actions: [{ label: 'باشه', variant: 'primary' }]
      });
      return;
    }

    // 2. Filter base pool of cards
    let pool = [...activeCards];
    if (focusMode === 'bookmark') {
      pool = activeCards.filter(c => c.bookmark);
      if (pool.length < 2) {
        openDialog({
          title: 'بوکمارک‌های ناکافی',
          body: 'تعداد فلش‌کارت‌های بوکمارک‌شده شما کمتر از ۲ عدد است. سیستم به‌طور خودکار روی کل کارت‌ها تمرکز خواهد کرد.',
          actions: [{ label: 'شروع با همه کارت‌ها', variant: 'primary', onClick: () => startWithPool(activeCards, activeTypes, selectedCount) }]
        });
        return;
      }
    } else if (focusMode === 'weak') {
      // Find cards where FSRS state has low difficulty or are recently graded "Again" or "Hard"
      pool = activeCards.filter(c => c.fsrsState && (c.fsrsState.difficulty > 6 || c.fsrsState.state === 1)); // State 1 is Learning
      if (pool.length < 2) {
        // Fallback: sort by difficulty index or take bottom-performing cards if studySession/review history suggests so
        pool = [...activeCards].slice(0, Math.ceil(activeCards.length / 2));
      }
    }

    startWithPool(pool, activeTypes, selectedCount);
  }

  function startWithPool(pool, allowedTypes, count) {
    // If only 'blank' is allowed, filter the pool to only cloze cards
    let finalPool = [...pool];
    const isOnlyBlank = allowedTypes.length === 1 && allowedTypes[0] === 'blank';
    if (isOnlyBlank) {
      finalPool = pool.filter(c => /[\.]{3,}/.test(textOf(c.frontContent)));
    }

    // Shuffle pool
    const shuffled = finalPool.sort(() => 0.5 - Math.random());
    const selectedCards = shuffled.slice(0, count);

    // Generate dynamic Question objects
    const questions = selectedCards.map((card, idx) => {
      let qType;
      const isCloze = /[\.]{3,}/.test(textOf(card.frontContent));
      // A card the user (or the AI) explicitly authored as a specific quiz
      // type takes priority — that's what lets it carry its own
      // hand-written wrong options instead of borrowing them from
      // unrelated cards.
      const forcedType = card.answerType && card.answerType !== 'auto' ? card.answerType : null;
      if (forcedType && allowedTypes.includes(forcedType)) {
        qType = forcedType;
      } else if (isCloze && allowedTypes.includes('blank')) {
        qType = 'blank';
      } else {
        // Exclude 'blank' if card is not cloze so we don't randomly mask normal cards
        const filteredTypes = allowedTypes.filter(t => t !== 'blank');
        if (filteredTypes.length > 0) {
          qType = filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
        } else {
          qType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
        }
      }
      return generateQuestion(card, qType, activeCards, idx);
    });

    playPracticeGameplay(questions);
  }

  // Generate individual question metadata depending on type
  function generateQuestion(card, type, fullList, index) {
    const qText = textOf(card.frontContent);
    const aText = textOf(card.backContent);

    if (type === 'choice') {
      const authoredOptions = (card.choiceOptions || []).map((s) => (s || '').trim()).filter(Boolean);
      let distractors;
      if (authoredOptions.length > 0) {
        // The user (or the AI) wrote these wrong options specifically for
        // this card, so they always relate to the actual question.
        distractors = authoredOptions.slice(0, 3);
      } else {
        // No authored options: fall back to the old behaviour of borrowing
        // answers from other cards in the category.
        const others = fullList.filter(c => c.id !== card.id);
        distractors = others
          .sort(() => 0.5 - Math.random())
          .slice(0, Math.min(3, others.length))
          .map(c => textOf(c.backContent));
      }

      // Shuffle correct answer and distractors
      const options = [aText, ...distractors].sort(() => 0.5 - Math.random());
      const correctIdx = options.indexOf(aText);

      return {
        card,
        type: 'choice',
        index,
        prompt: qText,
        options,
        correctOptionIndex: correctIdx,
        correctAnswer: aText,
        explanation: card.explanation || 'پاسخ دقیقاً مطابق صورت فلش‌کارت مرور شده ثبت گردیده است.'
      };
    } 
    else if (type === 'tf') {
      const isTrue = Math.random() >= 0.5;
      let displayAnswer = aText;
      let match = true;

      if (!isTrue) {
        const authoredFalse = (card.falseStatement || '').trim();
        if (authoredFalse) {
          // The user (or the AI) wrote this false version specifically for
          // this card's statement.
          displayAnswer = authoredFalse;
          match = false;
        } else {
          const others = fullList.filter(c => c.id !== card.id);
          if (others.length > 0) {
            displayAnswer = textOf(others[Math.floor(Math.random() * others.length)].backContent);
            match = false;
          }
        }
      }

      return {
        card,
        type: 'tf',
        index,
        prompt: `${qText}\n\n(پیشنهاد: ${displayAnswer})`,
        correctAnswer: match ? 'true' : 'false',
        matchStateText: match ? 'بله، صحیح است' : 'خیر، غلط است',
        correctAnswerText: aText,
        explanation: match 
          ? 'بله، این گزاره کاملاً صحیح و مطابق با پاسخ کارت است.' 
          : `خیر، پاسخ واقعی این کارت عبارت است از:\n« ${aText} »`,
      };
    } 
    else if (type === 'blank') {
      const isCloze = /[\.]{3,}/.test(qText);
      if (isCloze) {
        return {
          card,
          type: 'blank',
          index,
          prompt: qText,
          correctAnswer: aText,
          fullAnswer: aText,
          explanation: `پاسخ صحیح جای خالی:\n« ${aText} »`
        };
      } else {
        const { maskedText, answer } = maskBackContent(aText);
        return {
          card,
          type: 'blank',
          index,
          prompt: `${qText}\n\n${maskedText}`,
          correctAnswer: answer,
          fullAnswer: aText,
          explanation: `عبارت کامل پاسخ:\n« ${aText} »`
        };
      }
    } 
    else {
      // Default fallback: short answer (descriptive)
      return {
        card,
        type: 'short',
        index,
        prompt: qText,
        correctAnswer: aText,
        explanation: `پاسخ ثبت شده برای این سوال:\n« ${aText} »`
      };
    }
  }

  // Word-masker for fill-in-the-blank Cloze generator
  function maskBackContent(backText) {
    // Search brackets or parentheses first
    const bracketMatch = backText.match(/[\(\[\{](.+?)[\)\]\}]/);
    if (bracketMatch && bracketMatch[1] && bracketMatch[1].trim().length > 1) {
      const word = bracketMatch[1].trim();
      return {
        maskedText: backText.replace(word, ' (.....) '),
        answer: word
      };
    }

    // Split words, find a decent middle Persian noun or word longer than 3 characters
    const words = backText.split(/\s+/);
    const suitable = words.filter(w => w.length > 3 && !w.includes('<') && !w.includes('>'));
    if (suitable.length > 0) {
      const chosenWord = suitable[Math.floor(suitable.length / 2)].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()؟?]/g, "").trim();
      if (chosenWord.length > 1) {
        return {
          maskedText: backText.replace(chosenWord, ' (.....) '),
          answer: chosenWord
        };
      }
    }

    // Absolute fallback
    const fallbackAns = backText.length > 5 ? backText.substring(0, 5) : backText;
    return {
      maskedText: '(.....) ' + backText.substring(fallbackAns.length),
      answer: fallbackAns
    };
  }

  function textOf(contentBlocks) {
    if (!Array.isArray(contentBlocks)) return '';
    return contentBlocks.map((b) => b.value || '').join(' ').trim();
  }

  // ----------------------------------------------------
  // Interactive Gameplay Screen
  // ----------------------------------------------------
  function playPracticeGameplay(questions) {
    let currentIdx = 0;
    let score = 0;
    const sessionHistory = [];
    const startTime = Date.now();

    window.addEventListener('hashchange', () => {
      stopAnyActiveDictation();
    }, { once: true });

    renderQuestion();

    function renderQuestion() {
      // A dictation session belongs to the question that created it; make
      // sure switching questions never leaves a hidden mic recording in
      // the background.
      stopAnyActiveDictation();
      activeDictationSessions.forEach((session) => session.cancel());
      activeDictationSessions.length = 0;
      container.innerHTML = '';
      const q = questions[currentIdx];

      const playWrap = document.createElement('div');
      playWrap.style.cssText = 'width:100%;max-width:var(--max-content-w);margin:0 auto;display:flex;flex-direction:column;gap:var(--space-3);text-align:right;';
      container.appendChild(playWrap);

      // Header Progress Row
      const progHeader = document.createElement('div');
      progHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);font-size:var(--text-caption);color:var(--text-secondary);font-weight:600;';
      
      const countLabel = document.createElement('span');
      countLabel.textContent = `سوال ${(currentIdx + 1).toLocaleString('fa-IR')} از ${questions.length.toLocaleString('fa-IR')}`;
      
      const scoreLabel = document.createElement('span');
      scoreLabel.innerHTML = `امتیاز فعلی: <span style="color:var(--color-success);font-weight:800;">${score.toLocaleString('fa-IR')}</span>`;
      
      progHeader.append(countLabel, scoreLabel);

      const progBarWrap = document.createElement('div');
      const percent = Math.round((currentIdx / questions.length) * 100);
      progBarWrap.appendChild(createProgressBar(percent));

      playWrap.append(progHeader, progBarWrap);

      // Main Card Display
      const questionCard = document.createElement('div');
      questionCard.className = 'ds-card';
      questionCard.style.cssText = 'padding:var(--space-4); margin-top:var(--space-1); display:flex; flex-direction:column; gap:var(--space-3); position:relative;';
      
      const qIconType = { choice: 'list_alt', tf: 'rule', blank: 'edit_square', short: 'edit_note' }[q.type];
      const qTypeTitle = { choice: 'سوال تستی چند گزینه‌ای', tf: 'ارزیابی گزاره (صحیح/غلط)', blank: 'تکمیل عبارت (جای خالی)', short: 'پاسخ تشریحی کوتاه' }[q.type];

      const typeBadge = document.createElement('div');
      typeBadge.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:11px; font-weight:800; color:var(--color-primary); background:var(--color-primary-soft); padding:4px 10px; border-radius:var(--radius-pill); align-self:flex-start;';
      typeBadge.innerHTML = `<span class="material-symbols-rounded" style="font-size:14px;">${qIconType}</span><span>${qTypeTitle}</span>`;
      
      const aiExplainBtn = document.createElement('button');
      aiExplainBtn.className = 'icon-btn';
      aiExplainBtn.setAttribute('aria-label', 'توضیح با هوش مصنوعی');
      aiExplainBtn.style.cssText = 'width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: transparent; border: none; color: var(--color-primary); cursor: pointer; transition: transform var(--duration-fast), background-color var(--duration-fast);';
      aiExplainBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:20px;">psychology</span>';
      aiExplainBtn.addEventListener('click', () => {
        const backText = textOf(q.card.backContent);
        openAiExplanationBottomSheet(q.prompt, backText);
      });
      aiExplainBtn.addEventListener('mouseenter', () => { aiExplainBtn.style.transform = 'scale(1.08)'; aiExplainBtn.style.backgroundColor = 'var(--color-primary-soft)'; });
      aiExplainBtn.addEventListener('mouseleave', () => { aiExplainBtn.style.transform = 'scale(1.0)'; aiExplainBtn.style.backgroundColor = 'transparent'; });

      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; width:100%; margin-bottom:4px;';
      headerRow.append(typeBadge, aiExplainBtn);

      const promptText = document.createElement('div');
      promptText.style.cssText = 'font-size:var(--text-title); font-weight:700; color:var(--text-primary); line-height:var(--lh-normal); margin-top:4px; white-space:pre-line;';
      promptText.innerHTML = renderFractionsInText(escapeHtml(q.prompt));

      questionCard.append(headerRow, promptText);
      playWrap.appendChild(questionCard);

      // Interaction Zone - varies by Question Type
      const interactionBox = document.createElement('div');
      interactionBox.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2); margin-top:var(--space-1);';
      playWrap.appendChild(interactionBox);

      // Explanation/Feedback Box (rendered hidden, revealed after submit)
      const feedbackBox = document.createElement('div');
      feedbackBox.className = 'ds-card';
      feedbackBox.style.cssText = 'padding:var(--space-3); border-radius:var(--radius-card); display:none; flex-direction:column; gap:var(--space-2); margin-top:var(--space-2); transition: all 0.3s ease; text-align:right;';

      const nextBtnRow = document.createElement('div');
      nextBtnRow.style.cssText = 'display:none; justify-content:flex-end; margin-top:var(--space-2);';
      
      const nextBtn = createButton({
        label: currentIdx < questions.length - 1 ? 'سوال بعدی' : 'مشاهده نتایج تمرین',
        icon: 'arrow_forward',
        variant: 'primary',
        onClick: () => {
          currentIdx++;
          if (currentIdx < questions.length) {
            renderQuestion();
          } else {
            renderFinalSummary();
          }
        }
      });
      nextBtn.style.height = '44px';
      nextBtnRow.appendChild(nextBtn);

      playWrap.append(feedbackBox, nextBtnRow);

      // 1. Multiple Choice Interface
      if (q.type === 'choice') {
        q.options.forEach((opt, oIdx) => {
          const optBtn = document.createElement('button');
          optBtn.className = 'ds-card tappable';
          optBtn.style.cssText = 'padding:var(--space-3); border:1.5px solid var(--border-subtle); border-radius:12px; display:flex; align-items:center; gap:var(--space-3); text-align:right; cursor:pointer; background:var(--bg-card); font-size:var(--text-body); font-weight:600; width:100%; transition:all var(--duration-fast);';
          
          const labelPrefix = ['الف', 'ب', 'ج', 'د'][oIdx] || (oIdx + 1);
          const badge = document.createElement('div');
          badge.style.cssText = 'width:28px; height:28px; border-radius:50%; background:var(--bg-sunken); color:var(--text-secondary); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:12px; border:1px solid var(--border-strong); flex-shrink:0;';
          badge.textContent = labelPrefix;

          const optText = document.createElement('span');
          optText.innerHTML = renderFractionsInText(escapeHtml(opt));

          optBtn.append(badge, optText);
          interactionBox.appendChild(optBtn);

          optBtn.addEventListener('click', () => {
            // Disable all options
            interactionBox.querySelectorAll('button').forEach(b => b.disabled = true);
            const isCorrect = oIdx === q.correctOptionIndex;
            
            if (isCorrect) {
              score++;
              scoreLabel.innerHTML = `امتیاز فعلی: <span style="color:var(--color-success);font-weight:800;">${score.toLocaleString('fa-IR')}</span>`;
              optBtn.style.borderColor = 'var(--color-success)';
              optBtn.style.background = '#EBFDF2';
              badge.style.background = 'var(--color-success)';
              badge.style.color = 'white';
              badge.style.borderColor = 'var(--color-success)';
              badge.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">done</span>';
              
              showFeedback(true, 'پاسخ شما کاملاً درست است! آفرین.', q.explanation);
            } else {
              optBtn.style.borderColor = 'var(--color-danger)';
              optBtn.style.background = 'var(--color-danger-soft)';
              badge.style.background = 'var(--color-danger)';
              badge.style.color = 'white';
              badge.style.borderColor = 'var(--color-danger)';
              badge.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">close</span>';

              // Highlight correct one
              const correctBtn = interactionBox.querySelectorAll('button')[q.correctOptionIndex];
              if (correctBtn) {
                correctBtn.style.borderColor = 'var(--color-success)';
                correctBtn.style.background = '#EBFDF2';
                const correctBadge = correctBtn.querySelector('div');
                correctBadge.style.background = 'var(--color-success)';
                correctBadge.style.color = 'white';
                correctBadge.style.borderColor = 'var(--color-success)';
                correctBadge.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">done</span>';
              }
              
              showFeedback(false, 'پاسخ شما اشتباه بود.', q.explanation);
            }

            sessionHistory.push({
              question: q.prompt,
              userResponse: opt,
              correctResponse: q.correctAnswer,
              isCorrect
            });
          });
        });
      }

      // 2. True / False Interface
      else if (q.type === 'tf') {
        const tfRow = document.createElement('div');
        tfRow.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3); width:100%;';
        interactionBox.appendChild(tfRow);

        const choices = [
          { val: 'true', label: 'بله، صحیح است', icon: 'check_circle', color: 'var(--color-success)', bg: '#EBFDF2' },
          { val: 'false', label: 'خیر، غلط است', icon: 'cancel', color: 'var(--color-danger)', bg: 'var(--color-danger-soft)' }
        ];

        choices.forEach(c => {
          const btn = document.createElement('button');
          btn.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-3);border-radius:var(--radius-card);border:2.5px dashed var(--border-strong);background:var(--bg-card);color:var(--text-secondary);cursor:pointer;font-weight:800;transition:all var(--duration-fast);font-size:var(--text-body);gap:var(--space-2);min-height:96px;`;
          btn.innerHTML = `<span class="material-symbols-rounded" style="font-size:32px;color:var(--text-tertiary)">${c.icon}</span><span>${c.label}</span>`;
          
          btn.addEventListener('click', () => {
            tfRow.querySelectorAll('button').forEach(b => b.disabled = true);
            const isCorrect = c.val === q.correctAnswer;

            if (isCorrect) {
              score++;
              scoreLabel.innerHTML = `امتیاز فعلی: <span style="color:var(--color-success);font-weight:800;">${score.toLocaleString('fa-IR')}</span>`;
              btn.style.borderColor = c.color;
              btn.style.background = c.bg;
              btn.style.color = c.color;
              btn.querySelector('span').style.color = c.color;
              showFeedback(true, 'درست پاسخ دادید!', q.explanation);
            } else {
              btn.style.borderColor = c.color;
              btn.style.background = c.bg;
              btn.style.color = c.color;
              btn.querySelector('span').style.color = c.color;

              // Highlight correct option
              const correctBtn = c.val === 'true' ? tfRow.querySelectorAll('button')[1] : tfRow.querySelectorAll('button')[0];
              const cConfig = c.val === 'true' ? choices[1] : choices[0];
              correctBtn.style.borderColor = cConfig.color;
              correctBtn.style.background = cConfig.bg;
              correctBtn.style.color = cConfig.color;
              correctBtn.querySelector('span').style.color = cConfig.color;

              showFeedback(false, 'پاسخ فرضی گزاره با واقعیت کارت سازگار نبود.', q.explanation);
            }

            sessionHistory.push({
              question: q.prompt,
              userResponse: c.label,
              correctResponse: q.matchStateText,
              isCorrect
            });
          });
          tfRow.appendChild(btn);
        });
      }

      // 3. Fill in the Blank Interface
      else if (q.type === 'blank') {
        const fieldWrap = document.createElement('div');
        fieldWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
        
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.placeholder = 'عبارت یا کلمه جاافتاده را در این بخش بنویسید…';
        textInput.className = 'ds-field-input';
        textInput.style.textAlign = 'right';
        textInput.style.height = '48px';
        fieldWrap.appendChild(textInput);

        const subBtn = createButton({
          label: 'بررسی پاسخ',
          icon: 'verified',
          variant: 'primary',
          onClick: () => {
            if (!textInput.value.trim()) {
              textInput.style.borderColor = 'var(--color-danger)';
              textInput.focus();
              return;
            }
            textInput.disabled = true;
            subBtn.disabled = true;

            const uAns = textInput.value.trim().toLowerCase();
            const cAns = q.correctAnswer.toLowerCase();
            
            // Loose Persian string comparison (removing spacing, standard characters)
            const isCorrect = uAns === cAns || cAns.includes(uAns) || uAns.includes(cAns);

            if (isCorrect) {
              score++;
              scoreLabel.innerHTML = `امتیاز فعلی: <span style="color:var(--color-success);font-weight:800;">${score.toLocaleString('fa-IR')}</span>`;
              textInput.style.borderColor = 'var(--color-success)';
              textInput.style.background = '#EBFDF2';
              showFeedback(true, `صحیح است! پاسخ دقیق: « ${q.correctAnswer} »`, q.explanation);
            } else {
              textInput.style.borderColor = 'var(--color-danger)';
              textInput.style.background = 'var(--color-danger-soft)';
              showFeedback(false, `نادرست است. پاسخ صحیح این است: « ${q.correctAnswer} »`, q.explanation);
            }

            sessionHistory.push({
              question: q.prompt,
              userResponse: textInput.value.trim(),
              correctResponse: q.correctAnswer,
              isCorrect
            });
          }
        });
        subBtn.style.height = '44px';
        fieldWrap.appendChild(subBtn);

        interactionBox.appendChild(fieldWrap);
      }

      // 4. Short Answer Interface (Voice + Manual self-evaluation)
      else if (q.type === 'short') {
        const areaWrap = document.createElement('div');
        areaWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';

        const textRow = document.createElement('div');
        textRow.style.cssText = 'position:relative; width:100%;';
        areaWrap.appendChild(textRow);

        const textWidget = createTextArea({
          placeholder: 'پاسخ تشریحی خود را اینجا یادداشت کنید. یا با زدن دکمه بلندگو پاسخ خود را دیکته کنید...',
          rows: 4
        });
        const textarea = textWidget.input;
        textRow.appendChild(textarea);

        // Hybrid dictation button: tries the browser's native speech
        // recognition first, and transparently falls back to AI
        // (MediaRecorder + Gemini) transcription if that isn't
        // available or fails - see js/core/dictation.js.
        const dictationBtn = document.createElement('button');
        dictationBtn.className = 'icon-btn';
        dictationBtn.style.cssText = 'position:absolute; bottom:12px; left:12px; width:40px; height:40px; border-radius:50%; background:var(--bg-sunken); border:1px solid var(--border-strong); color:var(--text-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all var(--duration-fast); z-index:10;';
        textRow.appendChild(dictationBtn);
        activeDictationSessions.push(attachDictationButton(dictationBtn, textarea));

        const submitDescriptive = createButton({
          label: 'ثبت و بررسی پاسخ تشریحی',
          icon: 'publish',
          variant: 'primary',
          onClick: () => {
            textarea.disabled = true;
            submitDescriptive.disabled = true;
            dictationBtn.style.display = 'none';

            // Reveal correct answers and launch Manual Self-Evaluation buttons
            showDescriptiveEvaluation(textarea.value.trim());
          }
        });
        submitDescriptive.style.height = '44px';
        areaWrap.appendChild(submitDescriptive);
        interactionBox.appendChild(areaWrap);

        function showDescriptiveEvaluation(userText) {
          showFeedback(true, 'پاسخ اصلی فلش‌کارت را با پاسخ خود مقایسه کنید:', q.explanation);
          
          const evalPrompt = document.createElement('div');
          evalPrompt.style.cssText = 'border-top:1px solid var(--border-subtle); padding-top:var(--space-3); margin-top:var(--space-2);';
          evalPrompt.innerHTML = '<span style="font-weight:700; font-size:var(--text-caption); color:var(--text-secondary);">آیا صحت پاسخ خود را تأیید می‌کنید؟ (خودارزیابی):</span>';
          feedbackBox.appendChild(evalPrompt);

          const evalGrid = document.createElement('div');
          evalGrid.style.cssText = 'display:grid; grid-template-columns:repeat(3, 1fr); gap:var(--space-2); margin-top:var(--space-2);';
          evalPrompt.appendChild(evalGrid);

          const evalOptions = [
            { id: 'correct', label: 'کاملاً درست', color: 'var(--color-success)', bg: 'var(--color-success-soft)' },
            { id: 'partial', label: 'تا حدی درست', color: 'var(--color-warning)', bg: 'var(--color-warning-soft)' },
            { id: 'wrong', label: 'اشتباه', color: 'var(--color-danger)', bg: 'var(--color-danger-soft)' }
          ];

          evalOptions.forEach(opt => {
            const optBtn = document.createElement('button');
            optBtn.style.cssText = `padding:var(--space-2); border-radius:10px; border:1.5px solid ${opt.color}; background:${opt.bg}; color:${opt.color}; font-weight:800; cursor:pointer; font-size:12px; text-align:center; transition:transform 0.15s;`;
            optBtn.textContent = opt.label;
            
            optBtn.addEventListener('click', () => {
              evalGrid.querySelectorAll('button').forEach(b => b.disabled = true);
              const approved = opt.id !== 'wrong';
              
              if (approved) {
                score++;
                scoreLabel.innerHTML = `امتیاز فعلی: <span style="color:var(--color-success);font-weight:800;">${score.toLocaleString('fa-IR')}</span>`;
              }

              sessionHistory.push({
                question: q.prompt,
                userResponse: userText || '(بدون یادداشت)',
                correctResponse: q.correctAnswer,
                isCorrect: approved,
                ratingGrade: opt.label
              });

              // Reveal next question row
              nextBtnRow.style.display = 'flex';
            });
            evalGrid.appendChild(optBtn);
          });
        }
      }

      // Reveals feedback box with dynamic formatting
      function showFeedback(success, mainMsg, explanation) {
        feedbackBox.style.display = 'flex';
        feedbackBox.style.borderColor = success ? 'var(--color-success)' : 'var(--color-danger)';
        feedbackBox.style.background = success ? 'var(--color-success-soft)' : 'var(--color-danger-soft)';
        
        const header = document.createElement('div');
        header.style.cssText = `display:flex; align-items:center; gap:var(--space-2); font-weight:800; font-size:var(--text-body); color:${success ? 'var(--color-success)' : 'var(--color-danger)'};`;
        header.innerHTML = success 
          ? '<span class="material-symbols-rounded">verified_user</span><span>صحیح</span>' 
          : '<span class="material-symbols-rounded">cancel</span><span>نیاز به تلاش دوباره</span>';

        const mainText = document.createElement('p');
        mainText.style.cssText = 'font-size:var(--text-caption); font-weight:700; color:var(--text-primary); margin:0;';
        mainText.textContent = mainMsg;

        const expText = document.createElement('div');
        expText.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); line-height:var(--lh-normal); margin-top:2px; white-space:pre-line;';
        expText.textContent = explanation;

        feedbackBox.append(header, mainText, expText);

        // Hide next button ONLY if short answer descriptive manual self-eval is loaded instead
        if (q.type !== 'short') {
          nextBtnRow.style.display = 'flex';
        }
      }
    }

    // ----------------------------------------------------
    // Session Completion Summary Screen
    // ----------------------------------------------------
    async function renderFinalSummary() {
      container.innerHTML = '';

      const timeSpentSec = Math.floor((Date.now() - startTime) / 1000);
      const timeMin = Math.floor(timeSpentSec / 60);
      const timeSec = timeSpentSec % 60;
      const timeStr = timeMin > 0 
        ? `${timeMin.toLocaleString('fa-IR')} دقیقه و ${timeSec.toLocaleString('fa-IR')} ثانیه`
        : `${timeSec.toLocaleString('fa-IR')} ثانیه`;

      const accuracy = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;

      // 1. Log Session record (Integrating with stats calculations)
      const sessionRecord = {
        id: `practice_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        categoryId,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
        date: new Date(startTime).toISOString().split('T')[0],
        duration: timeSpentSec,
        cardsReviewed: questions.length,
        correctAnswers: score,
        isPracticeSession: true
      };

      if (questions.length > 0) {
        await studySessionRepository.create(sessionRecord);
      }

      // Build Summary View
      const sumWrap = document.createElement('div');
      sumWrap.style.cssText = 'width:100%;max-width:var(--max-content-w);margin:0 auto;display:flex;flex-direction:column;gap:var(--space-3);text-align:right;';
      container.appendChild(sumWrap);

      const mainCard = document.createElement('div');
      mainCard.className = 'ds-card';
      mainCard.style.cssText = 'padding:var(--space-5); text-align:center; display:flex; flex-direction:column; align-items:center; gap:var(--space-3);';
      sumWrap.appendChild(mainCard);

      const trophy = document.createElement('div');
      trophy.style.cssText = 'width:72px; height:72px; border-radius:50%; background:var(--color-accent-soft); color:var(--color-accent); display:flex; align-items:center; justify-content:center; font-size:36px; box-shadow:var(--shadow-card); animation: flamePulse 2s infinite ease-in-out;';
      trophy.innerHTML = '<span class="material-symbols-rounded" style="font-size:36px;">emoji_events</span>';

      const sumTitle = document.createElement('h2');
      sumTitle.style.cssText = 'font-size:var(--text-title); font-weight:800; color:var(--text-primary); margin:0;';
      sumTitle.textContent = 'آفرین! تمرین به پایان رسید';

      const sumDesc = document.createElement('p');
      sumDesc.style.cssText = 'font-size:var(--text-body); color:var(--text-secondary); margin:0; line-height:var(--lh-normal);';
      sumDesc.textContent = `شما جلسه تمرینی مربوط به دسته‌ی «${category.title}» را با موفقیت تمام کردید. آمار جلسه شما در روند پیشرفتتان ذخیره گردید.`;

      // Circular Ring or Percentage Badge
      const circularBadge = document.createElement('div');
      circularBadge.style.cssText = 'margin:var(--space-2) 0; display:flex; flex-direction:column; align-items:center; gap:var(--space-1);';
      circularBadge.appendChild(createProgressRing(accuracy, 80));
      
      const badgeText = document.createElement('span');
      badgeText.style.cssText = 'font-size:var(--text-section); font-weight:800; color:var(--color-primary); margin-top:var(--space-1);';
      badgeText.textContent = `دقت کل پاسخ‌ها: ${accuracy.toLocaleString('fa-IR')}%`;
      circularBadge.appendChild(badgeText);

      // Stats Mini-grid
      const statsGrid = document.createElement('div');
      statsGrid.style.cssText = 'display:grid; grid-template-columns:repeat(3, 1fr); gap:var(--space-2); width:100%; margin-top:var(--space-2);';
      
      const statItems = [
        { val: `${score.toLocaleString('fa-IR')} از ${questions.length.toLocaleString('fa-IR')}`, label: 'پاسخ درست' },
        { val: timeStr, label: 'مدت زمان تمرین' },
        { val: `${questions.length.toLocaleString('fa-IR')}`, label: 'کل سوالات' },
      ];

      statItems.forEach(item => {
        const itemBox = document.createElement('div');
        itemBox.style.cssText = 'background:var(--bg-sunken); padding:var(--space-2); border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center;';
        
        const itemVal = document.createElement('span');
        itemVal.style.cssText = 'font-size:14px; font-weight:800; color:var(--text-primary);';
        itemVal.textContent = item.val;

        const itemLbl = document.createElement('span');
        itemLbl.style.cssText = 'font-size:10px; color:var(--text-tertiary); margin-top:2px;';
        itemLbl.textContent = item.label;

        itemBox.append(itemVal, itemLbl);
        statsGrid.appendChild(itemBox);
      });

      mainCard.append(trophy, sumTitle, sumDesc, circularBadge, statsGrid);

      // 2. Identify Weak Topics (Questions with wrong responses)
      const wrongSessions = sessionHistory.filter(h => !h.isCorrect);
      if (wrongSessions.length > 0) {
        const weakCard = document.createElement('div');
        weakCard.className = 'ds-card';
        weakCard.style.cssText = 'padding:var(--space-3); border:1.5px solid var(--color-danger); background:var(--color-danger-soft); display:flex; flex-direction:column; gap:var(--space-2);';
        
        const weakHeader = document.createElement('div');
        weakHeader.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); font-weight:800; font-size:var(--text-body); color:var(--color-danger);';
        weakHeader.innerHTML = '<span class="material-symbols-rounded">trending_down</span><span>مباحث نیازمند توجه و مرور مجدد:</span>';
        weakCard.appendChild(weakHeader);

        const weakList = document.createElement('div');
        weakList.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-1); margin-top:4px;';
        
        // Remove duplicates and list top weak cards
        const listedCards = [];
        questions.forEach(q => {
          const matchingHistory = sessionHistory.find(h => h.question === q.prompt);
          if (matchingHistory && !matchingHistory.isCorrect && !listedCards.includes(q.card.id)) {
            listedCards.push(q.card.id);

            const item = document.createElement('div');
            item.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:var(--space-2); font-size:var(--text-caption); padding:var(--space-2); border-radius:8px; background:var(--bg-card); border:1px solid var(--border-subtle);';
            
            const textCol = document.createElement('span');
            textCol.style.cssText = 'font-weight:600; color:var(--text-primary);';
            const fText = textOf(q.card.frontContent);
            textCol.textContent = fText.length > 40 ? `${fText.substring(0, 40)}…` : fText;

            // Simple Flag Bookmarks button
            const bkButton = document.createElement('button');
            bkButton.style.cssText = 'display:flex; align-items:center; gap:2px; font-size:10px; font-weight:700; color:var(--color-accent); background:var(--color-accent-soft); border:1px solid var(--color-accent); border-radius:6px; padding:3px 8px; cursor:pointer;';
            bkButton.innerHTML = q.card.bookmark 
              ? '<span class="material-symbols-rounded" style="font-size:12px;font-variation-settings:\'FILL\' 1">bookmark</span><span>نشان‌شده</span>'
              : '<span class="material-symbols-rounded" style="font-size:12px;font-variation-settings:\'FILL\' 0">bookmark</span><span>نشان کردن</span>';
            
            bkButton.addEventListener('click', async () => {
              const updated = !q.card.bookmark;
              await flashcardRepository.update(q.card.id, { bookmark: updated });
              q.card.bookmark = updated;
              bkButton.innerHTML = updated
                ? '<span class="material-symbols-rounded" style="font-size:12px;font-variation-settings:\'FILL\' 1">bookmark</span><span>نشان‌شده</span>'
                : '<span class="material-symbols-rounded" style="font-size:12px;font-variation-settings:\'FILL\' 0">bookmark</span><span>نشان کردن</span>';
            });

            item.append(textCol, bkButton);
            weakList.appendChild(item);
          }
        });

        weakCard.appendChild(weakList);
        sumWrap.appendChild(weakCard);
      }

      // Action Buttons Footer
      const footerBtns = document.createElement('div');
      footerBtns.style.cssText = 'display:flex; gap:var(--space-2); margin-top:var(--space-2);';
      sumWrap.appendChild(footerBtns);

      const closeBtn = createButton({
        label: 'پایان و بازگشت به کلاس',
        variant: 'primary',
        onClick: () => router.navigate('category', categoryId)
      });
      closeBtn.style.flex = '1';
      closeBtn.style.height = '48px';

      const retryBtn = createButton({
        label: 'تمرین مجدد',
        icon: 'refresh',
        variant: 'secondary',
        onClick: () => {
          renderSetupScreen();
        }
      });
      retryBtn.style.height = '48px';

      footerBtns.append(retryBtn, closeBtn);
    }
  }
}
