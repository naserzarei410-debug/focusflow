

import {
  createButton, createCard, createEmptyState, createProgressBar,
  createProgressRing, createTextArea, openDialog, renderFractionsInText, escapeHtml
} from '../core/ui.js';
import { categoryRepository, flashcardRepository, examRepository, examResultRepository, studySessionRepository } from '../core/repositories.js';
import { router } from '../core/router.js';
import { attachDictationButton, stopAnyActiveDictation } from '../core/dictation.js';

// Every dictation button created while this view is mounted registers its
// controller here, so we can cleanly cancel any in-flight recording when
// the user navigates away or changes questions mid-recording.
const activeDictationSessions = [];

export async function renderExamSession(container, categoryId = null) {
  stopAnyActiveDictation();
  activeDictationSessions.length = 0;

  // Loading screen
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;color:var(--text-secondary);">
      <div class="spinner" style="margin-bottom:12px;"></div>
      <span>در حال آماده‌سازی شبیه‌ساز آزمون…</span>
    </div>
  `;

  if (!categoryId) {
    container.innerHTML = '';
    container.appendChild(
      createEmptyState({
        icon: 'folder',
        title: 'دسته‌ای انتخاب نشده است',
        desc: 'لطفاً برای شروع آزمون ابتدا یک دسته مطالعاتی را انتخاب کنید.',
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

  // Sourcing cards
  const allCards = await flashcardRepository.getByIndex('categoryId', categoryId);
  const activeCards = allCards.filter(c => !c.deleted);

  if (activeCards.length < 2) {
    container.innerHTML = '';
    container.appendChild(
      createEmptyState({
        icon: 'assignment_late',
        title: 'تعداد فلش‌کارت‌ها کافی نیست',
        desc: 'برای برگزاری یک آزمون استاندارد تستی و ترکیبی، نیاز به حداقل ۲ فلش‌کارت در این دسته دارید.',
        action: createButton({ 
          label: 'بازگشت به دسته', 
          icon: 'arrow_forward',
          onClick: () => router.navigate('category', categoryId) 
        })
      })
    );
    return;
  }

  // Initiate configurations screen
  renderSetupScreen();

  function renderSetupScreen() {
    router.setTitle(`تنظیمات آزمون: ${category.title}`);
    container.innerHTML = '';

    const setupWrap = document.createElement('div');
    setupWrap.style.cssText = 'width:100%;max-width:var(--max-content-w);margin:0 auto;display:flex;flex-direction:column;gap:var(--space-4);text-align:right;direction:rtl;padding:var(--space-2);';
    container.appendChild(setupWrap);

    // Hero cover card
    const coverCard = document.createElement('div');
    coverCard.className = 'ds-card';
    coverCard.style.cssText = `background: linear-gradient(135deg, ${category.themeColor}12, ${category.themeColor}1D); border: 1.5px solid ${category.themeColor}33; padding: var(--space-4); border-radius: var(--radius-card); display: flex; align-items: center; gap: var(--space-3);`;
    
    const iconBox = document.createElement('div');
    iconBox.style.cssText = `width:52px; height:52px; border-radius:50%; background:${category.themeColor}22; color:${category.themeColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;`;
    iconBox.innerHTML = `<span class="material-symbols-rounded" style="font-size:32px;">assignment</span>`;

    const coverInfo = document.createElement('div');
    coverInfo.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    const coverTitle = document.createElement('h2');
    coverTitle.style.cssText = 'font-size:var(--text-title); font-weight:800; color:var(--text-primary); margin:0;';
    coverTitle.textContent = `آزمون شبیه‌ساز دسته «${category.title}»`;
    const coverDesc = document.createElement('span');
    coverDesc.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
    coverDesc.textContent = `فرصت سنجش عمیق آموخته‌ها با قوانین آزمون واقعی و رسمی (بدون راهنمایی در حین پاسخ‌دهی)`;
    
    coverInfo.append(coverTitle, coverDesc);
    coverCard.append(iconBox, coverInfo);
    setupWrap.appendChild(coverCard);

    // Form settings card
    const configCard = document.createElement('div');
    configCard.className = 'ds-card';
    configCard.style.cssText = 'padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-4); background:var(--bg-card); border:1px solid var(--border-subtle);';
    setupWrap.appendChild(configCard);

    // 1. Question Count Field
    const countSection = document.createElement('div');
    countSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
    countSection.innerHTML = '<span style="font-weight:700; font-size:var(--text-body); color:var(--text-primary);">تعداد سوالات آزمون:</span>';
    
    const countSelect = document.createElement('select');
    countSelect.className = 'ds-field-input';
    countSelect.style.cssText = 'width:100%; padding:var(--space-2); border-radius:8px;';
    
    const availableCounts = [5, 10, 15, 20, 30, 50].filter(c => c <= activeCards.length);
    availableCounts.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = `${c.toLocaleString('fa-IR')} سوال`;
      countSelect.appendChild(opt);
    });
    // Option for ALL
    const optAll = document.createElement('option');
    optAll.value = activeCards.length;
    optAll.textContent = `همه فلش‌کارت‌ها (${activeCards.length.toLocaleString('fa-IR')} سوال)`;
    countSelect.appendChild(optAll);
    // Custom exact-count option: lets the user type the precise number of
    // questions instead of only choosing from fixed steps of 5/10/15...
    const optCustom = document.createElement('option');
    optCustom.value = 'custom';
    optCustom.textContent = 'دلخواه (وارد کردن تعداد دقیق)';
    countSelect.appendChild(optCustom);
    countSelect.value = availableCounts.length > 0 ? availableCounts[Math.min(1, availableCounts.length - 1)] : activeCards.length;
    countSection.appendChild(countSelect);

    const customCountInput = document.createElement('input');
    customCountInput.type = 'number';
    customCountInput.min = '1';
    customCountInput.max = String(activeCards.length);
    customCountInput.value = String(Math.min(10, activeCards.length));
    customCountInput.className = 'ds-field-input';
    customCountInput.placeholder = `عدد بین ۱ تا ${activeCards.length.toLocaleString('fa-IR')}`;
    customCountInput.style.cssText = 'width:100%; padding:var(--space-2); border-radius:8px; display:none;';
    countSection.appendChild(customCountInput);

    countSelect.addEventListener('change', () => {
      customCountInput.style.display = countSelect.value === 'custom' ? 'block' : 'none';
    });

    configCard.appendChild(countSection);

    // 2. Question formats checklist
    const formatsSection = document.createElement('div');
    formatsSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
    formatsSection.innerHTML = '<span style="font-weight:700; font-size:var(--text-body); color:var(--text-primary);">نوع سوالات آزمون (ترکیب دلخواه):</span>';
    
    const formatsGrid = document.createElement('div');
    formatsGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3);';
    formatsSection.appendChild(formatsGrid);

    const formatOptions = [
      { id: 'choice', label: 'چند گزینه‌ای (۴ گزینه‌ای)', checked: true },
      { id: 'tf', label: 'صحیح و غلط', checked: true },
      { id: 'blank', label: 'جای خالی (کلووز)', checked: true },
      { id: 'short', label: 'تشریحی (کوتاه پاسخ صوتی)', checked: true },
    ];

    const formatChecks = {};
    const hasClozeCards = activeCards.some(card => /[\.]{3,}/.test(textOf(card.frontContent)));

    formatOptions.forEach(opt => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex; align-items:center; gap:var(--space-2); cursor:pointer; font-size:var(--text-caption); font-weight:600; color:var(--text-secondary); padding:var(--space-2); border-radius:8px; border:1px solid var(--border-subtle); background:var(--bg-sunken); transition:all var(--duration-fast);';
      
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = opt.id === 'blank' && !hasClozeCards ? false : opt.checked;
      chk.style.cssText = 'accent-color:var(--color-secondary);';
      
      label.append(chk, document.createTextNode(opt.label));
      formatsGrid.appendChild(label);
      formatChecks[opt.id] = chk;

      chk.addEventListener('change', () => {
        label.style.borderColor = chk.checked ? 'var(--color-secondary)' : 'var(--border-subtle)';
        label.style.color = chk.checked ? 'var(--text-primary)' : 'var(--text-secondary)';
      });
      if (chk.checked) {
        label.style.borderColor = 'var(--color-secondary)';
        label.style.color = 'var(--text-primary)';
      }

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
            actions: [{ label: 'متوجه شدم', variant: 'secondary' }]
          });
        });
      }
    });
    configCard.appendChild(formatsSection);

    // 3. Time Limit Selector
    const timerSection = document.createElement('div');
    timerSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
    timerSection.innerHTML = '<span style="font-weight:700; font-size:var(--text-body); color:var(--text-primary);">مدت زمان آزمون (محدودیت):</span>';
    
    const timerSelect = document.createElement('select');
    timerSelect.className = 'ds-field-input';
    timerSelect.style.cssText = 'width:100%; padding:var(--space-2); border-radius:8px;';
    
    const timerOptions = [
      { val: 0, label: 'بدون محدودیت زمانی (آزاد)' },
      { val: 1, label: '۱ دقیقه' },
      { val: 2, label: '۲ دقیقه' },
      { val: 5, label: '۵ دقیقه' },
      { val: 10, label: '۱۰ دقیقه' },
      { val: 15, label: '۱۵ دقیقه' },
      { val: 20, label: '۲۰ دقیقه' },
      { val: 'custom', label: 'زمان سفارشی (وارد کردن به دقیقه)...' },
    ];
    timerOptions.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.val;
      opt.textContent = t.label;
      timerSelect.appendChild(opt);
    });
    timerSelect.value = 5; // default is 5 minutes
    timerSection.appendChild(timerSelect);

    const customTimeInput = document.createElement('input');
    customTimeInput.type = 'number';
    customTimeInput.min = '1';
    customTimeInput.value = '30';
    customTimeInput.className = 'ds-field-input';
    customTimeInput.placeholder = 'مدت زمان به دقیقه (مثلاً ۳۰)';
    customTimeInput.style.cssText = 'width:100%; padding:var(--space-2); border-radius:8px; display:none;';
    timerSection.appendChild(customTimeInput);

    timerSelect.addEventListener('change', () => {
      customTimeInput.style.display = timerSelect.value === 'custom' ? 'block' : 'none';
    });

    configCard.appendChild(timerSection);

    // 4. Order selection
    const orderSection = document.createElement('div');
    orderSection.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
    orderSection.innerHTML = '<span style="font-weight:700; font-size:var(--text-body); color:var(--text-primary);">ترتیب سوالات:</span>';
    
    const orderSelect = document.createElement('select');
    orderSelect.className = 'ds-field-input';
    orderSelect.style.cssText = 'width:100%; padding:var(--space-2); border-radius:8px;';
    
    const orderOptions = [
      { val: 'shuffled', label: 'تصادفی و درهم (پیشنهادی شبیه‌ساز)' },
      { val: 'sequential', label: 'به ترتیب کارت‌های کتابخانه' }
    ];
    orderOptions.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.val;
      opt.textContent = o.label;
      orderSelect.appendChild(opt);
    });
    orderSection.appendChild(orderSelect);
    configCard.appendChild(orderSection);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:var(--space-3); margin-top:var(--space-2);';
    
    const startBtn = createButton({
      label: 'شروع آزمون رسمی',
      icon: 'rocket_launch',
      variant: 'primary',
      onClick: () => {
        let count;
        if (countSelect.value === 'custom') {
          count = parseInt(customCountInput.value, 10);
          if (!Number.isFinite(count) || count < 1 || count > activeCards.length) {
            openDialog({
              title: 'تعداد سوالات نامعتبر است',
              body: `لطفاً عددی بین ۱ تا ${activeCards.length.toLocaleString('fa-IR')} وارد کنید.`,
              actions: [{ label: 'تایید', variant: 'primary' }]
            });
            return;
          }
        } else {
          count = parseInt(countSelect.value);
        }
        let limitMinutes;
        if (timerSelect.value === 'custom') {
          limitMinutes = parseInt(customTimeInput.value, 10);
          if (!Number.isFinite(limitMinutes) || limitMinutes < 1) {
            openDialog({
              title: 'مدت زمان آزمون نامعتبر است',
              body: 'لطفاً یک زمان معتبر بزرگتر از صفر (به دقیقه) وارد کنید.',
              actions: [{ label: 'تایید', variant: 'primary' }]
            });
            return;
          }
        } else {
          limitMinutes = parseInt(timerSelect.value, 10);
        }
        const order = orderSelect.value;
        const activeTypes = Object.keys(formatChecks).filter(k => formatChecks[k].checked);

        if (activeTypes.length === 0) {
          openDialog({
            title: 'خطای تنظیمات',
            body: 'لطفاً حداقل یک فرمت سوال (مثلا چندگزینه‌ای) را انتخاب کنید.',
            actions: [{ label: 'تایید', variant: 'primary' }]
          });
          return;
        }

        startExamGame({ count, limitMinutes, order, activeTypes });
      }
    });
    startBtn.style.cssText += '; background:var(--color-secondary); color:white; flex:2;';
    
    const backBtn = createButton({
      label: 'انصراف و بازگشت',
      icon: 'arrow_forward',
      variant: 'text',
      onClick: () => router.navigate('category', categoryId)
    });
    backBtn.style.flex = '1';

    btnRow.append(backBtn, startBtn);
    setupWrap.appendChild(btnRow);
  }

  // Sorter / Question creator
  function startExamGame({ count, limitMinutes, order, activeTypes }) {
    let pool = [...activeCards];
    const isOnlyBlank = activeTypes.length === 1 && activeTypes[0] === 'blank';
    if (isOnlyBlank) {
      pool = pool.filter(c => /[\.]{3,}/.test(textOf(c.frontContent)));
    }

    if (order === 'shuffled') {
      pool.sort(() => 0.5 - Math.random());
    }
    const selectedCards = pool.slice(0, Math.min(count, pool.length));

    const questions = selectedCards.map((card, idx) => {
      let qType;
      const isCloze = /[\.]{3,}/.test(textOf(card.frontContent));
      if (isCloze && activeTypes.includes('blank')) {
        qType = 'blank';
      } else {
        const filteredTypes = activeTypes.filter(t => t !== 'blank');
        if (filteredTypes.length > 0) {
          qType = filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
        } else {
          qType = activeTypes[Math.floor(Math.random() * activeTypes.length)];
        }
      }
      return generateQuestion(card, qType, activeCards, idx);
    });

    playExamGameplay(questions, limitMinutes);
  }

  function textOf(contentBlocks) {
    if (!Array.isArray(contentBlocks)) return '';
    return contentBlocks.map((b) => b.value || '').join(' ').trim();
  }

  function generateQuestion(card, type, fullList, index) {
    const qText = textOf(card.frontContent);
    const aText = textOf(card.backContent);

    if (type === 'choice') {
      const others = fullList.filter(c => c.id !== card.id);
      const distractors = others
        .sort(() => 0.5 - Math.random())
        .slice(0, Math.min(3, others.length))
        .map(c => textOf(c.backContent));
      
      const options = [aText, ...distractors].sort(() => 0.5 - Math.random());
      const correctIdx = options.indexOf(aText);

      return {
        card,
        type: 'choice',
        index,
        prompt: `کدام گزینه پاسخ صحیح برای عبارت زیر است؟\n\n« ${qText} »`,
        options,
        correctOptionIndex: correctIdx,
        correctAnswer: aText,
        explanation: card.explanation || 'بر اساس محتوای فلش‌کارت اصلی.'
      };
    } 
    else if (type === 'tf') {
      const isTrue = Math.random() >= 0.5;
      let displayAnswer = aText;
      let match = true;

      if (!isTrue) {
        const others = fullList.filter(c => c.id !== card.id);
        if (others.length > 0) {
          displayAnswer = textOf(others[Math.floor(Math.random() * others.length)].backContent);
          match = false;
        }
      }

      return {
        card,
        type: 'tf',
        index,
        prompt: `آیا گزاره پیشنهادی زیر با عبارت اصلی مطابقت دارد؟\n\nعبارت اصلی:\n« ${qText} »\n\nگزاره پیشنهادی:\n« ${displayAnswer} »`,
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
          prompt: `صورت سوال:\n« ${qText} »\n\nلطفاً بخش جای خالی را تکمیل کنید.`,
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
          prompt: `صورت سوال:\n« ${qText} »\n\nلطفاً کلمه یا عبارت خالی زیر را تکمیل کنید:\n\n« ${maskedText} »`,
          correctAnswer: answer,
          fullAnswer: aText,
          explanation: `عبارت کامل پاسخ:\n« ${aText} »`
        };
      }
    } 
    else {
      return {
        card,
        type: 'short',
        index,
        prompt: `لطفاً پاسخ تشریحی خود را برای سوال زیر بنویسید (یا دکمه میکروفون را بزنید و بگویید):\n\n« ${qText} »`,
        correctAnswer: aText,
        explanation: `پاسخ ثبت شده برای این سوال:\n« ${aText} »`
      };
    }
  }

  function maskBackContent(backText) {
    const bracketMatch = backText.match(/[\(\[\{](.+?)[\)\]\}]/);
    if (bracketMatch && bracketMatch[1] && bracketMatch[1].trim().length > 1) {
      const word = bracketMatch[1].trim();
      return {
        maskedText: backText.replace(word, ' (.....) '),
        answer: word
      };
    }

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

    const fallbackAns = backText.length > 5 ? backText.substring(0, 5) : backText;
    return {
      maskedText: '(.....) ' + backText.substring(fallbackAns.length),
      answer: fallbackAns
    };
  }

  // Primary interactive exam loop
  function playExamGameplay(questions, limitMinutes) {
    let currentIdx = 0;
    const userAnswers = Array(questions.length).fill('');
    const startTime = Date.now();

    // Timer setup
    let timerInterval = null;
    let timeRemainingSeconds = limitMinutes > 0 ? limitMinutes * 60 : 0;
    let secondsElapsed = 0;

    if (limitMinutes > 0) {
      timerInterval = setInterval(() => {
        timeRemainingSeconds--;
        secondsElapsed++;
        updateTimerDisplay();

        if (timeRemainingSeconds <= 0) {
          clearInterval(timerInterval);
          autoSubmitExam();
        }
      }, 1000);
    } else {
      timerInterval = setInterval(() => {
        secondsElapsed++;
      }, 1000);
    }

    // Safety net: if the user leaves this page any other way (top bar back
    // button, bottom nav, browser/hardware back) instead of the in-page
    // "انصراف" dialog, make sure the countdown still stops so it can't fire
    // autoSubmitExam() after the user is already looking at another screen.
    window.addEventListener('hashchange', () => {
      clearInterval(timerInterval);
      stopAnyActiveDictation();
    }, { once: true });

    renderActiveQuestion();

    function updateTimerDisplay() {
      const el = document.getElementById('exam-timer');
      if (!el) return;
      const mins = Math.floor(timeRemainingSeconds / 60);
      const secs = timeRemainingSeconds % 60;
      const display = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      el.textContent = display;
      if (timeRemainingSeconds < 30) {
        el.style.color = 'var(--color-danger)';
        el.style.animation = 'flamePulse 0.8s infinite ease-in-out';
      } else {
        el.style.color = 'var(--text-primary)';
        el.style.animation = 'none';
      }
    }

    function renderActiveQuestion() {
      // A dictation session belongs to the question that created it; make
      // sure switching questions never leaves a hidden mic recording in
      // the background.
      stopAnyActiveDictation();
      activeDictationSessions.forEach((session) => session.cancel());
      activeDictationSessions.length = 0;
      container.innerHTML = '';
      const q = questions[currentIdx];

      const playWrap = document.createElement('div');
      playWrap.style.cssText = 'width:100%;max-width:var(--max-content-w);margin:0 auto;display:flex;flex-direction:column;gap:var(--space-3);text-align:right;direction:rtl;padding:var(--space-2);';
      container.appendChild(playWrap);

      // Top bar details
      const topBar = document.createElement('div');
      topBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:var(--space-2); background:var(--bg-card); padding:var(--space-2) var(--space-3); border-radius:12px; border:1px solid var(--border-subtle);';
      playWrap.appendChild(topBar);

      // Back warning button
      const exitBtn = document.createElement('button');
      exitBtn.className = 'btn btn-text';
      exitBtn.style.cssText = 'padding: 4px 8px; font-size:var(--text-caption); display:flex; align-items:center; gap:4px; color:var(--text-secondary);';
      exitBtn.innerHTML = '<span class="material-symbols-rounded">arrow_forward</span> انصراف';
      exitBtn.addEventListener('click', () => {
        openDialog({
          title: 'خروج از آزمون رسمی؟',
          body: 'آیا مایلید از آزمون خارج شوید؟ پیشرفت و پاسخ‌های ثبت شده شما ذخیره نخواهد شد.',
          actions: [
            { label: 'ادامه آزمون', variant: 'primary' },
            { 
              label: 'خروج و انصراف', 
              variant: 'danger', 
              onClick: () => {
                clearInterval(timerInterval);
                router.navigate('category', categoryId);
              } 
            }
          ]
        });
      });
      topBar.appendChild(exitBtn);

      // Timer Display Component
      const timerBox = document.createElement('div');
      timerBox.style.cssText = 'display:flex; align-items:center; gap:var(--space-2);';
      
      const timerIcon = document.createElement('span');
      timerIcon.className = 'material-symbols-rounded';
      timerIcon.textContent = 'hourglass_empty';
      timerIcon.style.cssText = 'color:var(--color-secondary); font-size:22px;';
      
      const timerVal = document.createElement('span');
      timerVal.id = 'exam-timer';
      timerVal.style.cssText = 'font-family:monospace; font-weight:800; font-size:18px; direction:ltr; display:inline-block;';
      if (limitMinutes > 0) {
        const mins = Math.floor(timeRemainingSeconds / 60);
        const secs = timeRemainingSeconds % 60;
        timerVal.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        if (timeRemainingSeconds < 30) {
          timerVal.style.color = 'var(--color-danger)';
        }
      } else {
        timerVal.textContent = 'آزاد';
        timerIcon.textContent = 'timer';
      }

      timerBox.append(timerVal, timerIcon);
      topBar.appendChild(timerBox);

      // Info badge
      const qBadge = document.createElement('div');
      qBadge.style.cssText = 'font-weight:700; font-size:var(--text-caption); color:var(--text-secondary); background:var(--bg-sunken); padding:4px 10px; border-radius:8px;';
      qBadge.textContent = `سوال ${(currentIdx + 1).toLocaleString('fa-IR')} از ${questions.length.toLocaleString('fa-IR')}`;
      topBar.appendChild(qBadge);

      // Progress bar
      const progressPercent = ((currentIdx) / questions.length) * 100;
      const progressWidget = createProgressBar(progressPercent);
      progressWidget.style.cssText += '; border-radius:4px; height:6px;';
      playWrap.appendChild(progressWidget);

      // Center Question Card
      const qCard = document.createElement('div');
      qCard.className = 'ds-card';
      qCard.style.cssText = 'padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-4); border:1px solid var(--border-subtle);';
      playWrap.appendChild(qCard);

      // Question text block
      const qPromptEl = document.createElement('div');
      qPromptEl.style.cssText = 'font-size:var(--text-title); font-weight:700; color:var(--text-primary); line-height:1.6; white-space:pre-wrap; margin-bottom:var(--space-1); border-right:3px solid var(--color-secondary); padding-right:12px;';
      qPromptEl.innerHTML = renderFractionsInText(escapeHtml(q.prompt));
      qCard.appendChild(qPromptEl);

      // Interactive responses panel
      const answerArea = document.createElement('div');
      answerArea.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3);';
      qCard.appendChild(answerArea);

      // Multi choice
      if (q.type === 'choice') {
        q.options.forEach((opt, oIdx) => {
          const btn = document.createElement('button');
          btn.style.cssText = 'width:100%; padding:var(--space-3); border-radius:10px; border:1px solid var(--border-strong); background:var(--bg-sunken); color:var(--text-secondary); text-align:right; font-weight:600; font-size:var(--text-body); cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:var(--space-2); transition:all var(--duration-fast);';
          btn.innerHTML = `<span style="flex:1;">${renderFractionsInText(escapeHtml(opt))}</span><span style="width:20px; height:20px; border-radius:50%; border:2px solid var(--border-strong); display:flex; align-items:center; justify-content:center; flex-shrink:0;"><span style="width:10px; height:10px; border-radius:50%; background:transparent;"></span></span>`;
          
          if (userAnswers[currentIdx] === opt) {
            btn.style.borderColor = 'var(--color-secondary)';
            btn.style.background = 'rgba(108, 92, 231, 0.05)';
            btn.style.color = 'var(--text-primary)';
            btn.querySelector('span:last-child').style.borderColor = 'var(--color-secondary)';
            btn.querySelector('span:last-child span').style.background = 'var(--color-secondary)';
          }

          btn.addEventListener('click', () => {
            userAnswers[currentIdx] = opt;
            renderActiveQuestion();
          });
          answerArea.appendChild(btn);
        });
      }
      // True/False
      else if (q.type === 'tf') {
        const tfGrid = document.createElement('div');
        tfGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3);';
        answerArea.appendChild(tfGrid);

        const options = [
          { val: 'true', label: 'صحیح (درست)', icon: 'check_circle', color: 'var(--color-success)', activeBg: 'rgba(34, 197, 94, 0.08)' },
          { val: 'false', label: 'غلط (نادرست)', icon: 'cancel', color: 'var(--color-danger)', activeBg: 'rgba(239, 68, 68, 0.08)' }
        ];

        options.forEach(opt => {
          const btn = document.createElement('button');
          btn.style.cssText = 'padding:var(--space-4) var(--space-2); border-radius:12px; border:1px solid var(--border-strong); background:var(--bg-sunken); color:var(--text-secondary); font-weight:700; font-size:var(--text-section); cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--space-2); transition:all var(--duration-fast);';
          btn.innerHTML = `<span class="material-symbols-rounded" style="font-size:36px; color: ${userAnswers[currentIdx] === opt.val ? opt.color : 'var(--text-tertiary)'}">${opt.icon}</span> <span>${opt.label}</span>`;
          
          if (userAnswers[currentIdx] === opt.val) {
            btn.style.borderColor = 'var(--color-secondary)';
            btn.style.color = 'var(--text-primary)';
            btn.style.background = 'rgba(108, 92, 231, 0.05)';
          }

          btn.addEventListener('click', () => {
            userAnswers[currentIdx] = opt.val;
            renderActiveQuestion();
          });
          tfGrid.appendChild(btn);
        });
      }
      // Blank
      else if (q.type === 'blank') {
        const tfWrap = document.createElement('div');
        tfWrap.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
        answerArea.appendChild(tfWrap);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ds-field-input';
        input.placeholder = 'کلمه یا عبارت جا افتاده را اینجا بنویسید...';
        input.value = userAnswers[currentIdx] || '';
        input.style.cssText = 'width:100%; padding:var(--space-3); border-radius:10px; text-align:center; font-weight:700; font-size:var(--text-section);';
        
        input.addEventListener('input', () => {
          userAnswers[currentIdx] = input.value;
          updateGridDot(currentIdx, input.value);
        });

        tfWrap.appendChild(input);
        
        // Auto-focus blank field
        setTimeout(() => input.focus(), 50);
      }
      // Short / Descriptive Text
      else if (q.type === 'short') {
        const areaWrap = document.createElement('div');
        areaWrap.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-2);';
        answerArea.appendChild(areaWrap);

        const textRow = document.createElement('div');
        textRow.style.cssText = 'position:relative; width:100%;';
        areaWrap.appendChild(textRow);

        const textWidget = createTextArea({
          placeholder: 'پاسخ تشریحی خود را اینجا بنویسید یا دکمه میکروفون را بزنید...',
          rows: 5,
          value: userAnswers[currentIdx] || ''
        });
        const textarea = textWidget.input;
        textarea.style.paddingLeft = '50px'; // make room for dictation mic
        textRow.appendChild(textarea);

        textarea.addEventListener('input', () => {
          userAnswers[currentIdx] = textarea.value;
          updateGridDot(currentIdx, textarea.value);
        });

        // Hybrid dictation button: tries the browser's native speech
        // recognition first, and transparently falls back to AI
        // (MediaRecorder + Gemini) transcription if that isn't
        // available or fails - see js/core/dictation.js.
        const dictationBtn = document.createElement('button');
        dictationBtn.className = 'icon-btn';
        dictationBtn.style.cssText = 'position:absolute; bottom:12px; left:12px; width:42px; height:42px; border-radius:50%; background:var(--bg-sunken); border:1px solid var(--border-strong); color:var(--text-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all var(--duration-fast); z-index:10;';
        textRow.appendChild(dictationBtn);
        activeDictationSessions.push(attachDictationButton(dictationBtn, textarea, () => {
          userAnswers[currentIdx] = textarea.value;
          updateGridDot(currentIdx, textarea.value);
        }));
      }

      // Action navigation row
      const navRow = document.createElement('div');
      navRow.style.cssText = 'display:flex; justify-content:space-between; gap:var(--space-3); margin-top:var(--space-2);';
      playWrap.appendChild(navRow);

      const isLast = currentIdx === questions.length - 1;

      const prevBtn = createButton({
        label: 'قبلی',
        icon: 'chevron_right',
        variant: 'secondary',
        disabled: currentIdx === 0,
        onClick: () => {
          currentIdx--;
          renderActiveQuestion();
        }
      });
      prevBtn.style.flex = '1';

      const nextBtn = createButton({
        label: isLast ? 'ثبت و پایان آزمون' : 'بعدی',
        icon: isLast ? 'verified' : 'chevron_left',
        variant: isLast ? 'primary' : 'secondary',
        onClick: () => {
          if (isLast) {
            confirmAndSubmit();
          } else {
            currentIdx++;
            renderActiveQuestion();
          }
        }
      });
      nextBtn.style.flex = '2';
      if (isLast) {
        nextBtn.style.cssText += '; background:var(--color-secondary); color:white; font-weight:800;';
      }

      navRow.append(prevBtn, nextBtn);

      // Pagination Grid Map
      const mapBox = document.createElement('div');
      mapBox.className = 'ds-card';
      mapBox.style.cssText = 'padding:var(--space-3); background:var(--bg-sunken); border:1px solid var(--border-subtle); display:flex; flex-direction:column; gap:10px; align-items:center;';
      playWrap.appendChild(mapBox);

      const mapTitle = document.createElement('div');
      mapTitle.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); font-weight:700; width:100%; text-align:right;';
      mapTitle.textContent = 'نقشه پاسخ‌دهی سوالات (دسترسی سریع):';
      mapBox.appendChild(mapTitle);

      const gridList = document.createElement('div');
      gridList.id = 'exam-grid-map';
      gridList.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; justify-content:center;';
      mapBox.appendChild(gridList);

      questions.forEach((_, qIdx) => {
        const item = document.createElement('button');
        item.style.cssText = 'width:34px; height:34px; border-radius:50%; border:1.5px solid var(--border-strong); background:var(--bg-card); color:var(--text-secondary); font-family:monospace; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all var(--duration-fast);';
        item.textContent = (qIdx + 1).toLocaleString('fa-IR');
        
        // Styled based on state
        if (qIdx === currentIdx) {
          item.style.borderColor = 'var(--color-secondary)';
          item.style.borderWidth = '2.5px';
          item.style.color = 'var(--text-primary)';
          item.style.background = 'rgba(108, 92, 231, 0.15)';
        } else if (userAnswers[qIdx] && userAnswers[qIdx].trim() !== '') {
          item.style.borderColor = 'var(--color-secondary)';
          item.style.background = 'var(--color-secondary)';
          item.style.color = 'white';
        }

        item.addEventListener('click', () => {
          currentIdx = qIdx;
          renderActiveQuestion();
        });
        gridList.appendChild(item);
      });
    }

    function updateGridDot(index, value) {
      const grid = document.getElementById('exam-grid-map');
      if (!grid) return;
      const btn = grid.children[index];
      if (!btn) return;

      const isActive = index === currentIdx;
      if (isActive) return; // let renderActiveQuestion draw active state on next redraw

      if (value && value.trim() !== '') {
        btn.style.borderColor = 'var(--color-secondary)';
        btn.style.background = 'var(--color-secondary)';
        btn.style.color = 'white';
      } else {
        btn.style.borderColor = 'var(--border-strong)';
        btn.style.background = 'var(--bg-card)';
        btn.style.color = 'var(--text-secondary)';
      }
    }

    function confirmAndSubmit() {
      const unanswered = userAnswers.filter(a => !a || a.trim() === '').length;
      let bodyText = 'آیا از اتمام آزمون و ثبت پاسخ‌های خود اطمینان دارید؟';
      if (unanswered > 0) {
        bodyText = `شما به تعداد ${unanswered.toLocaleString('fa-IR')} سوال پاسخ نداده‌اید! آیا همچنان مایلید پاسخ‌برگ خود را ثبت و آزمون را به پایان برسانید؟`;
      }

      openDialog({
        title: 'ثبت نهایی آزمون',
        body: bodyText,
        actions: [
          { label: 'برگشت به آزمون', variant: 'text' },
          { 
            label: 'بله، ثبت و پایان', 
            variant: 'primary',
            onClick: () => {
              clearInterval(timerInterval);
              gradeAndDisplayResults(questions, userAnswers, secondsElapsed);
            }
          }
        ]
      });
    }

    function autoSubmitExam() {
      container.innerHTML = '';
      const finishAlert = document.createElement('div');
      finishAlert.style.cssText = 'width:100%; max-width:500px; margin: 15vh auto; text-align:center; display:flex; flex-direction:column; align-items:center; gap:var(--space-3); direction:rtl; padding:var(--space-4);';
      container.appendChild(finishAlert);

      finishAlert.innerHTML = `
        <div style="width:72px; height:72px; border-radius:50%; background:var(--color-danger-soft); color:var(--color-danger); display:flex; align-items:center; justify-content:center; margin-bottom:12px;">
          <span class="material-symbols-rounded" style="font-size:42px;">timer_off</span>
        </div>
        <h2 style="font-size:var(--text-title); font-weight:800; color:var(--text-primary); margin:0;">زمان آزمون شما تمام شد!</h2>
        <p style="color:var(--text-secondary); font-size:var(--text-body); line-height:1.6; margin:0;">مدت زمان محدود این آزمون شبیه‌ساز به اتمام رسیده است. پاسخ‌برگ شما به صورت خودکار تصحیح خواهد شد.</p>
      `;

      const proceedBtn = createButton({
        label: 'مشاهده کارنامه آزمون',
        icon: 'assignment_turned_in',
        variant: 'primary',
        onClick: () => {
          gradeAndDisplayResults(questions, userAnswers, secondsElapsed);
        }
      });
      proceedBtn.style.cssText += '; background:var(--color-secondary); color:white; font-weight:800; padding:12px 24px;';
      finishAlert.appendChild(proceedBtn);
    }
  }

  // Matching algorithm for typed and multiple choices questions
  function matchText(user, correct) {
    if (!user) return false;
    const clean = (s) => s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()؟?]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    return clean(user) === clean(correct);
  }

  function scoreShortAnswer(user, correct) {
    if (!user || !correct) return false;
    const uWords = user.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()؟?]/g, "").toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const cWords = correct.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()؟?]/g, "").toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    if (cWords.length === 0) return true;
    let matches = 0;
    cWords.forEach(w => {
      if (uWords.some(uw => uw.includes(w) || w.includes(uw))) matches++;
    });

    // If more than 35% of keywords overlap, pre-rate as correct, letting the user override manual review!
    return (matches / cWords.length) >= 0.35;
  }

  async function gradeAndDisplayResults(questions, userAnswers, totalTimeSeconds) {
    // Generate results array
    const gradedResults = questions.map((q, idx) => {
      const uAns = userAnswers[idx] || '';
      let correct = false;

      if (q.type === 'choice') {
        correct = uAns === q.correctAnswer;
      } else if (q.type === 'tf') {
        correct = uAns === q.correctAnswer;
      } else if (q.type === 'blank') {
        correct = matchText(uAns, q.correctAnswer);
      } else if (q.type === 'short') {
        correct = scoreShortAnswer(uAns, q.correctAnswer);
      }

      return {
        ...q,
        userAnswer: uAns,
        isCorrect: correct,
        isShortAnswer: q.type === 'short'
      };
    });

    const examId = 'exam_' + Date.now();
    
    // Save exam meta to database
    try {
      await examRepository.create({
        id: examId,
        categoryId,
        title: `آزمون شبیه‌ساز ${category.title}`,
        duration: totalTimeSeconds,
        questionCount: questions.length,
        createdAt: new Date().toISOString()
      });
    } catch(err) {
      console.error('Failed to save exam meta', err);
    }

    // Save a study-session record too so this exam is reflected in the
    // "آمار" (stats) tab — total review counts, daily goal progress, and
    // (via the isExamSession flag) the answer-accuracy percentage.
    let statsSessionId = null;
    if (questions.length > 0) {
      try {
        const correct = gradedResults.filter((r) => r.isCorrect).length;
        statsSessionId = `exam_session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await studySessionRepository.create({
          id: statsSessionId,
          categoryId,
          startTime: new Date(Date.now() - totalTimeSeconds * 1000).toISOString(),
          endTime: new Date().toISOString(),
          date: new Date().toISOString().split('T')[0],
          duration: totalTimeSeconds,
          cardsReviewed: questions.length,
          correctAnswers: correct,
          isExamSession: true
        });
      } catch (err) {
        console.error('Failed to save exam session to stats', err);
      }
    }

    await renderResultsScreen(gradedResults, totalTimeSeconds, examId, statsSessionId);
  }

  async function renderResultsScreen(results, timeSec, examId, statsSessionId) {
    router.setTitle(`کارنامه آزمون: ${category.title}`);
    container.innerHTML = '';

    const resultsWrap = document.createElement('div');
    resultsWrap.style.cssText = 'width:100%;max-width:var(--max-content-w);margin:0 auto;display:flex;flex-direction:column;gap:var(--space-4);text-align:right;direction:rtl;padding:var(--space-2);';
    container.appendChild(resultsWrap);

    // Score Calculations
    let correctCount = results.filter(r => r.isCorrect).length;
    let scorePercentage = Math.round((correctCount / results.length) * 100);

    // Hero stats board card
    const boardCard = document.createElement('div');
    boardCard.className = 'ds-card';
    boardCard.style.cssText = 'padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-3); border:1px solid var(--border-strong); position:relative;';
    resultsWrap.appendChild(boardCard);

    const boardFlex = document.createElement('div');
    boardFlex.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:var(--space-3); flex-wrap:wrap;';
    boardCard.appendChild(boardFlex);

    const scoreCol = document.createElement('div');
    scoreCol.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    
    const statusText = document.createElement('h2');
    statusText.style.cssText = 'font-size:24px; font-weight:850; color:var(--text-primary); margin:0;';
    
    const descText = document.createElement('p');
    descText.style.cssText = 'font-size:var(--text-body); color:var(--text-secondary); margin:0; line-height:1.5; max-width:340px;';

    if (scorePercentage >= 90) {
      statusText.textContent = 'عالی! تسلط شما بی‌نظیر است';
      descText.textContent = 'شما تسلط کاملی بر مباحث این بخش دارید و آماده آزمون‌های اصلی هستید!';
    } else if (scorePercentage >= 70) {
      statusText.textContent = 'بسیار خوب! نتیجه قبولی';
      descText.textContent = 'عملکرد شما رضایت‌بخش است. با یک مرور سبک روی نقاط خطای خود، به تسلط ۱۰۰٪ خواهید رسید.';
    } else if (scorePercentage >= 50) {
      statusText.textContent = 'قبول شدید، اما مرز شکننده!';
      descText.textContent = 'پایه خوبی دارید، اما هنوز برخی نقاط ضعف نیاز به تکرار و تمرین مجدد دارند.';
    } else {
      statusText.textContent = 'نیاز به تلاش مجدد';
      descText.textContent = 'برخی از مفاهیم این دسته هنوز به خوبی ملکه ذهن شما نشده‌اند. نگران نباشید، آزمون مجدد بهترین ابزار یادگیری است!';
    }

    scoreCol.append(statusText, descText);
    boardFlex.appendChild(scoreCol);

    // SVG Circular progress ring
    const ringWrapper = document.createElement('div');
    ringWrapper.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:6px; flex-shrink:0;';
    const progressRing = createProgressRing(scorePercentage, 96);
    // Custom color for secondary purple
    progressRing.querySelector('.ds-progress-ring-fill').style.stroke = 'var(--color-secondary)';
    
    const ringPercent = document.createElement('div');
    ringPercent.style.cssText = 'font-size:20px; font-weight:800; color:var(--text-primary); margin-top:-64px; margin-bottom:34px;';
    ringPercent.textContent = `${scorePercentage}٪`;

    ringWrapper.append(progressRing, ringPercent);
    boardFlex.appendChild(ringWrapper);

    // Statistics table cards
    const statsGrid = document.createElement('div');
    statsGrid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit, minmax(110px, 1fr)); gap:var(--space-2); margin-top:10px; border-top:1.5px solid var(--border-subtle); padding-top:var(--space-3);';
    boardCard.appendChild(statsGrid);

    const makeStatItem = (val, lbl, color = 'var(--text-primary)') => {
      const el = document.createElement('div');
      el.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:4px; padding:var(--space-2); background:var(--bg-sunken); border-radius:10px; border:1.5px solid var(--border-strong);';
      el.innerHTML = `<span style="font-size:22px; font-weight:800; color:${color}; font-family:monospace;">${val}</span><span style="font-size:var(--text-caption); color:var(--text-secondary); font-weight:600;">${lbl}</span>`;
      return el;
    };

    const minSpent = Math.floor(timeSec / 60);
    const secSpent = timeSec % 60;
    const timeDisplay = minSpent > 0 ? `${minSpent}:${secSpent.toString().padStart(2, '0')}` : `${secSpent} ثانیه`;

    statsGrid.appendChild(makeStatItem(results.length.toLocaleString('fa-IR'), 'کل سوالات'));
    statsGrid.appendChild(makeStatItem(correctCount.toLocaleString('fa-IR'), 'درست', 'var(--color-success)'));
    statsGrid.appendChild(makeStatItem((results.length - correctCount).toLocaleString('fa-IR'), 'نادرست', 'var(--color-danger)'));
    statsGrid.appendChild(makeStatItem(timeDisplay, 'زمان صرف‌شده', 'var(--color-accent)'));

    // Category suggestions plan card
    const incorrectCards = results.filter(r => !r.isCorrect).map(r => r.card);
    if (incorrectCards.length > 0) {
      const suggestCard = document.createElement('div');
      suggestCard.className = 'ds-card';
      suggestCard.style.cssText = 'border:1.5px dashed var(--color-warning); background:rgba(245, 158, 11, 0.05); padding:var(--space-3);';
      resultsWrap.appendChild(suggestCard);

      const sTitle = document.createElement('div');
      sTitle.style.cssText = 'font-weight:700; font-size:var(--text-body); color:var(--color-warning); display:flex; align-items:center; gap:6px;';
      sTitle.innerHTML = '<span class="material-symbols-rounded">recommend</span> طرح بهینه‌سازی و مرور پیشنهادی:';
      
      const sBody = document.createElement('p');
      sBody.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); margin:var(--space-2) 0 0 0; line-height:1.6;';
      sBody.textContent = `بر اساس تحلیل پاسخ‌های اشتباه، تعداد ${incorrectCards.length.toLocaleString('fa-IR')} مبحث یا مفهوم دارای چالش تشخیص داده شده‌اند. برای رفع این ضعف‌ها می‌توانید کلیک‌های عملیاتی زیر را انتخاب کنید:`;

      suggestCard.append(sTitle, sBody);
    }

    // Interactive actions rows
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:var(--space-2);';
    resultsWrap.appendChild(actionRow);

    // Wrapper just for the two "incorrect card" CTAs below, kept separate
    // from reBtn/endBtn (appended later) so the manual-override handler
    // can remove exactly these two buttons once every question is marked
    // correct, without also sweeping up "آزمون مجدد" - which uses the
    // same btn-secondary class and would otherwise vanish too.
    const incorrectCtaWrap = document.createElement('div');
    incorrectCtaWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:var(--space-2); width:100%;';

    if (incorrectCards.length > 0) {
      actionRow.appendChild(incorrectCtaWrap);
      // CTA to prioritize in FSRS review queue
      const fsrsResetBtn = createButton({
        label: 'اولویت مرور فوری در FSRS',
        icon: 'priority_high',
        variant: 'secondary',
        onClick: async () => {
          for (const card of incorrectCards) {
            const nowIso = new Date().toISOString();
            const fsrsState = !card.fsrsState
              ? { stability: 0.5, difficulty: 6, state: 2 }
              : {
                  ...card.fsrsState,
                  stability: Math.max(0.2, card.fsrsState.stability * 0.4), // heavily reduce stability
                  difficulty: Math.min(10, card.fsrsState.difficulty + 2), // increase difficulty
                };
            const changes = { nextReview: nowIso, lastReviewed: nowIso, fsrsState };
            await flashcardRepository.update(card.id, changes);
            Object.assign(card, changes);
          }
          openDialog({
            title: 'برنامه‌ریزی مرور FSRS انجام شد',
            body: 'تمامی کارت‌های نادرست با موفقیت در ابتدای صف مطالعه FSRS بعدی دسته شما اولویت‌دهی شدند.',
            actions: [{ label: 'عالی', variant: 'primary' }]
          });
        }
      });
      fsrsResetBtn.style.cssText += '; border-color:var(--color-warning); color:var(--color-warning); flex:1; min-width:200px;';
      incorrectCtaWrap.appendChild(fsrsResetBtn);

      // Star-bookmark incorrect cards CTA
      const bookmarkBtn = createButton({
        label: 'ستاره‌دار کردن کارت‌های غلط',
        icon: 'star',
        variant: 'secondary',
        onClick: async () => {
          for (const card of incorrectCards) {
            await flashcardRepository.update(card.id, { bookmark: true });
            card.bookmark = true;
          }
          openDialog({
            title: 'نشان‌گذاری موفق',
            body: 'فلش‌کارت‌های نادرست این آزمون با موفقیت بوکمارک شدند تا بعداً بتوانید از بخش فیلتر بوکمارک‌ها جداگانه آنها را بررسی کنید.',
            actions: [{ label: 'تایید', variant: 'primary' }]
          });
        }
      });
      bookmarkBtn.style.cssText += '; border-color:var(--color-accent); color:var(--color-accent); flex:1; min-width:200px;';
      incorrectCtaWrap.appendChild(bookmarkBtn);
    }

    const reBtn = createButton({
      label: 'آزمون مجدد',
      icon: 'replay',
      variant: 'secondary',
      onClick: () => renderExamSession(container, categoryId)
    });
    reBtn.style.cssText += '; border-color:var(--color-secondary); color:var(--color-secondary); flex:1; min-width:130px;';

    const endBtn = createButton({
      label: 'بازگشت به دسته',
      icon: 'home',
      variant: 'primary',
      onClick: () => router.navigate('category', categoryId)
    });
    endBtn.style.cssText += '; background:var(--color-secondary); color:white; font-weight:800; flex:1; min-width:130px;';

    actionRow.append(reBtn, endBtn);

    // Answer corrections sheet
    const listTitle = document.createElement('h3');
    listTitle.style.cssText = 'font-size:var(--text-section); font-weight:850; color:var(--text-primary); margin:var(--space-3) 0 0 0; border-bottom:2px solid var(--border-subtle); padding-bottom:8px;';
    listTitle.textContent = 'برگه پاسخ‌نامه شبیه‌ساز تصحیح شده:';
    resultsWrap.appendChild(listTitle);

    const sheetList = document.createElement('div');
    sheetList.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-3); margin-bottom:var(--space-4);';
    resultsWrap.appendChild(sheetList);

    results.forEach((r, rIdx) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'ds-card';
      cardEl.style.cssText = `padding:var(--space-3); border-right: 5px solid ${r.isCorrect ? 'var(--color-success)' : 'var(--color-danger)'}; display:flex; flex-direction:column; gap:10px; transition:all var(--duration-fast);`;
      sheetList.appendChild(cardEl);

      // Question title line
      const qTitleRow = document.createElement('div');
      qTitleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start; gap:var(--space-2);';
      
      const qNum = document.createElement('span');
      qNum.style.cssText = 'font-weight:800; font-family:monospace; font-size:var(--text-body); color:var(--text-secondary);';
      qNum.textContent = `سوال ${(rIdx + 1).toLocaleString('fa-IR')}:`;
      
      const qBadge = document.createElement('span');
      qBadge.style.cssText = `font-size:11px; font-weight:800; padding:2px 8px; border-radius:4px; text-transform:uppercase; color:white; background: ${r.isCorrect ? 'var(--color-success)' : 'var(--color-danger)'}`;
      qBadge.textContent = r.isCorrect ? 'درست' : 'نادرست';

      qTitleRow.append(qNum, qBadge);
      cardEl.appendChild(qTitleRow);

      const qText = document.createElement('div');
      qText.style.cssText = 'font-size:var(--text-body); font-weight:700; color:var(--text-primary); line-height:1.5; white-space:pre-wrap;';
      qText.textContent = r.prompt;
      cardEl.appendChild(qText);

      // Answers summary
      const ansGrid = document.createElement('div');
      ansGrid.style.cssText = 'display:grid; grid-template-columns:1fr; gap:8px; background:var(--bg-sunken); padding:var(--space-2); border-radius:8px; font-size:var(--text-caption); border:1.5px solid var(--border-strong);';
      cardEl.appendChild(ansGrid);

      const uAnsRow = document.createElement('div');
      uAnsRow.style.cssText = 'display:flex; gap:6px;';
      uAnsRow.innerHTML = `<span style="font-weight:700; color:var(--text-secondary); width:80px; flex-shrink:0;">پاسخ شما:</span> <span style="font-weight:800; color:${r.isCorrect ? 'var(--color-success)' : 'var(--color-danger)'};">${r.userAnswer || '(بدون پاسخ)'}</span>`;
      
      const cAnsRow = document.createElement('div');
      cAnsRow.style.cssText = 'display:flex; gap:6px; border-top:1px dashed var(--border-subtle); padding-top:6px;';
      cAnsRow.innerHTML = `<span style="font-weight:700; color:var(--text-secondary); width:80px; flex-shrink:0;">پاسخ درست:</span> <span style="font-weight:800; color:var(--color-success);">${r.correctAnswerText || r.correctAnswer}</span>`;

      ansGrid.append(uAnsRow, cAnsRow);

      // Explanation reference block
      const expBox = document.createElement('div');
      expBox.style.cssText = 'font-size:var(--text-caption); color:var(--text-tertiary); line-height:1.5; padding-right:8px; border-right:2px solid var(--border-strong); margin-top:4px;';
      expBox.textContent = `توضیح تفصیلی: ${r.explanation || 'توضیحات بیشتری برای این کارت ثبت نشده است.'}`;
      cardEl.appendChild(expBox);

      // Manual rating override switch (Signature UX showcase!)
      if (r.isShortAnswer) {
        const manualRow = document.createElement('div');
        manualRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:var(--space-2); border-top:1px dashed var(--border-subtle); padding-top:10px; margin-top:4px;';
        cardEl.appendChild(manualRow);

        const manualLabel = document.createElement('span');
        manualLabel.style.cssText = 'font-size:var(--text-caption); font-weight:700; color:var(--text-secondary);';
        manualLabel.textContent = 'نمره‌دهی دستی (تشخیص تشابه نظر شما):';
        manualRow.appendChild(manualLabel);

        const toggleBtn = createButton({
          label: r.isCorrect ? 'علامت به عنوان غلط' : 'علامت به عنوان درست',
          icon: r.isCorrect ? 'close' : 'check',
          variant: 'text',
          onClick: () => {
            r.isCorrect = !r.isCorrect;
            // update results view dynamically
            correctCount = results.filter(res => res.isCorrect).length;
            scorePercentage = Math.round((correctCount / results.length) * 100);

            // update badge
            qBadge.style.background = r.isCorrect ? 'var(--color-success)' : 'var(--color-danger)';
            qBadge.textContent = r.isCorrect ? 'درست' : 'نادرست';
            cardEl.style.borderColor = r.isCorrect ? 'var(--color-success)' : 'var(--color-danger)';
            uAnsRow.querySelector('span:last-child').style.color = r.isCorrect ? 'var(--color-success)' : 'var(--color-danger)';

            // update Progress Ring
            const newRing = createProgressRing(scorePercentage, 96);
            newRing.querySelector('.ds-progress-ring-fill').style.stroke = 'var(--color-secondary)';
            ringWrapper.replaceChild(newRing, ringWrapper.firstElementChild);
            ringPercent.textContent = `${scorePercentage}٪`;

            // update Grade stats
            if (scorePercentage >= 90) {
              statusText.innerHTML = 'عالی! تسلط شما بی‌نظیر است <span class="material-symbols-rounded" style="font-size:18px; vertical-align:middle; color:var(--color-warning);">emoji_events</span>';
            } else if (scorePercentage >= 70) {
              statusText.innerHTML = 'بسیار خوب! نتیجه قبولی <span class="material-symbols-rounded" style="font-size:18px; vertical-align:middle; color:var(--color-primary);">celebration</span>';
            } else if (scorePercentage >= 50) {
              statusText.innerHTML = 'قبول شدید، اما مرز شکننده! <span class="material-symbols-rounded" style="font-size:18px; vertical-align:middle; color:var(--color-warning);">warning</span>';
            } else {
              statusText.innerHTML = 'مردود! نیاز به تلاش مجدد <span class="material-symbols-rounded" style="font-size:18px; vertical-align:middle; color:var(--color-danger);">menu_book</span>';
            }

            // update grid counts
            statsGrid.innerHTML = '';
            statsGrid.appendChild(makeStatItem(results.length.toLocaleString('fa-IR'), 'کل سوالات'));
            statsGrid.appendChild(makeStatItem(correctCount.toLocaleString('fa-IR'), 'درست', 'var(--color-success)'));
            statsGrid.appendChild(makeStatItem((results.length - correctCount).toLocaleString('fa-IR'), 'نادرست', 'var(--color-danger)'));
            statsGrid.appendChild(makeStatItem(timeDisplay, 'زمان صرف‌شده', 'var(--color-accent)'));

            // refresh action buttons for FSRS lists
            const updatedIncorrect = results.filter(res => !res.isCorrect).map(res => res.card);
            // Re-render CTA lists if they empty out or grow
            if (updatedIncorrect.length === 0) {
              // hide CTAs (only the incorrect-card ones, not "آزمون مجدد")
              incorrectCtaWrap.remove();
              const sc = resultsWrap.querySelector('div[style*="dashed"]');
              if (sc) sc.remove();
            }

            toggleBtn.querySelector('span').textContent = r.isCorrect ? 'close' : 'check';
            toggleBtn.lastChild.textContent = r.isCorrect ? 'علامت به عنوان غلط' : 'علامت به عنوان درست';

            // Keep the saved stats record (آمار tab) consistent with manual overrides
            if (statsSessionId) {
              studySessionRepository.update(statsSessionId, { correctAnswers: correctCount }).catch(() => {});
            }
          }
        });
        toggleBtn.style.cssText += `; color:${r.isCorrect ? 'var(--color-danger)' : 'var(--color-success)'}; padding:4px 8px; font-size:11px;`;
        manualRow.appendChild(toggleBtn);
      }
    });

    // Save final scorecard details to db results history list
    try {
      await examResultRepository.create({
        id: 'result_' + Date.now(),
        examId,
        score: correctCount,
        correctAnswers: correctCount,
        wrongAnswers: results.length - correctCount,
        timeSpent: timeSec,
        completedAt: new Date().toISOString()
      });
    } catch(err) {
      console.error('Failed to save exam results history', err);
    }
  }
}
