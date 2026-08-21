
import {
  createButton, createSearchBar, createTextArea, createEmptyState,
  createSkeletonList, openBottomSheet, openDialog, escapeHtml, escapeAttr,
  showToast, renderFractionsInText, renderRichText, createSelectField, createTextField,
} from '../core/ui.js';
import { categoryRepository, flashcardRepository } from '../core/repositories.js';
import { createFlashcardModel } from '../core/models.js';
import { speak, isSpeechSupported } from '../core/tts.js';
import { router } from '../core/router.js';
import { getStudyQueues } from '../core/study.js';

function textOf(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return '';
  return contentBlocks.map((b) => b.value || '').join(' ').trim();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function recalcCategoryCount(categoryId) {
  const cards = await flashcardRepository.getByIndex('categoryId', categoryId);
  const activeCount = cards.filter((c) => !c.deleted).length;
  await categoryRepository.update(categoryId, { totalCards: activeCount });
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB

function buildActionCard({ cardStyle, textColChildren, btnLabel, btnIcon, btnVariant = 'secondary', btnHeight, btnExtraStyle, onClick }) {
  const card = document.createElement('div');
  card.className = 'ds-card';
  card.style.cssText = cardStyle;

  const textCol = document.createElement('div');
  textCol.style.cssText = 'display:flex; flex-direction:column; gap:4px; text-align:right;';
  textCol.append(...textColChildren);

  const btn = createButton({ label: btnLabel, icon: btnIcon, variant: btnVariant, onClick });
  if (btnHeight) btn.style.height = btnHeight;
  if (btnExtraStyle) btn.style.cssText += btnExtraStyle;

  card.append(textCol, btn);
  return card;
}

export async function renderCategoryWorkspace(container, categoryId) {
  const category = await categoryRepository.getById(categoryId);

  if (!category) {
    container.appendChild(
      createEmptyState({
        icon: 'error_outline',
        title: 'دسته یافت نشد',
        desc: 'ممکن است این دسته حذف شده باشد.',
        action: createButton({ label: 'بازگشت به کتابخانه', onClick: () => router.navigate('library') }),
      })
    );
    return;
  }

  router.setTitle(category.title);

  const state = { query: '' };

  const statsRow = document.createElement('div');
  statsRow.className = 'fc-stats-row';

  const fsrsHeader = document.createElement('div');
  fsrsHeader.style.cssText = 'width:100%; margin-bottom:var(--space-3);';

  const search = createSearchBar({
    placeholder: 'جستجو در فلش‌کارت‌های این دسته…',
    onSearch: (val) => { state.query = val; refresh(); },
  });

  const listEl = document.createElement('div');
  listEl.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-2);margin-top:var(--space-3);';

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.setAttribute('aria-label', 'ساخت فلش‌کارت جدید');
  fab.innerHTML = '<span class="material-symbols-rounded">add</span>';
  fab.addEventListener('click', () => openEditor());

  container.append(statsRow, fsrsHeader, search, listEl);
  document.getElementById('app').appendChild(fab);

  listEl.appendChild(createSkeletonList(3));
  await refresh();

  return () => {
    if (fab.parentNode) {
      fab.parentNode.removeChild(fab);
    }
  };

  async function refresh() {
    const all = await flashcardRepository.getByIndex('categoryId', categoryId);
    const active = all.filter((c) => !c.deleted);
    const q = state.query.trim().toLowerCase();
    const filtered = q
      ? active.filter((c) => {
          const text = `${textOf(c.frontContent)} ${textOf(c.backContent)} ${(c.tags || []).join(' ')}`.toLowerCase();
          return text.includes(q);
        })
      : active;

    filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    statsRow.textContent = `${active.length} فلش‌کارت · ${active.filter((c) => c.bookmark).length} بوکمارک‌شده`;

    const queues = await getStudyQueues(categoryId);
    const totalDue = queues.due.length + queues.learning.length;
    const totalNew = queues.new.length;

    fsrsHeader.innerHTML = '';
    if (totalDue > 0 || totalNew > 0) {
      const dueRow = document.createElement('div');
      dueRow.style.cssText = 'font-size:var(--text-caption); color:var(--text-primary); font-weight:700;';
      dueRow.innerHTML = `کارت برای مرور : <span style="color:var(--color-primary); font-weight:800;">${totalDue.toLocaleString('fa-IR')}</span>`;

      const newRow = document.createElement('div');
      newRow.style.cssText = 'font-size:var(--text-caption); color:var(--text-primary); font-weight:700;';
      newRow.innerHTML = `کارت جدید : <span style="color:var(--color-secondary); font-weight:800;">${totalNew.toLocaleString('fa-IR')}</span>`;

      fsrsHeader.appendChild(buildActionCard({
        cardStyle: 'background:var(--color-primary-soft); border:1.5px solid var(--color-primary); padding:var(--space-3); border-radius:var(--radius-card); display:flex; justify-content:space-between; align-items:center; gap:var(--space-2);',
        textColChildren: [dueRow, newRow],
        btnLabel: 'مرور',
        btnIcon: 'play_arrow',
        btnVariant: 'primary',
        btnHeight: '42px',
        onClick: () => router.navigate('study', categoryId),
      }));
    } else if (active.length > 0) {
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:700; font-size:var(--text-body); color:var(--text-secondary); display:flex; align-items:center; gap:var(--space-1);';
      title.innerHTML = 'همه کارت‌ها مرور شده‌اند! <span class="material-symbols-rounded" style="font-size:18px; color:var(--color-primary);">auto_awesome</span>';

      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:var(--text-caption); color:var(--text-tertiary);';
      sub.textContent = 'کارت‌های این بخش کاملاً به‌روز هستند.';

      fsrsHeader.appendChild(buildActionCard({
        cardStyle: 'background:var(--bg-card); border:1px dashed var(--border-strong); padding:var(--space-3); border-radius:var(--radius-card); display:flex; justify-content:space-between; align-items:center; gap:var(--space-2);',
        textColChildren: [title, sub],
        btnLabel: 'مرور',
        btnIcon: 'history',
        btnVariant: 'secondary',
        btnHeight: '38px',
        onClick: () => router.navigate('study', categoryId),
      }));
    }

    if (active.length > 0) {
      const pTitle = document.createElement('div');
      pTitle.style.cssText = 'font-weight:800; font-size:var(--text-section); color:var(--text-primary);';
      pTitle.textContent = 'تمرین هوشمند';

      const pSub = document.createElement('div');
      pSub.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
      pSub.textContent = 'خودآزمون با سوالات تستی، صحیح/غلط، جای خالی و تشریحی صوتی';

      fsrsHeader.appendChild(buildActionCard({
        cardStyle: 'background:rgba(245, 158, 11, 0.08); border:1.5px solid var(--color-warning); padding:var(--space-3); border-radius:var(--radius-card); display:flex; justify-content:space-between; align-items:center; gap:var(--space-2); margin-top:var(--space-2);',
        textColChildren: [pTitle, pSub],
        btnLabel: 'تمرین',
        btnIcon: 'quiz',
        btnVariant: 'secondary',
        btnExtraStyle: '; border-color: var(--color-warning); color: var(--color-warning); height: 42px; background: var(--bg-card);',
        onClick: () => router.navigate('practice', categoryId),
      }));
    }

    if (active.length > 0) {
      const eTitle = document.createElement('div');
      eTitle.style.cssText = 'font-weight:800; font-size:var(--text-section); color:var(--text-primary);';
      eTitle.textContent = 'شبیه‌ساز آزمون';

      const eSub = document.createElement('div');
      eSub.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary);';
      eSub.textContent = 'سنجش واقعی دانش بدون راهنما و در زمان مشخص با کارنامه تحلیلی تفصیلی';

      fsrsHeader.appendChild(buildActionCard({
        cardStyle: 'background:rgba(108, 92, 231, 0.08); border:1.5px solid var(--color-secondary); padding:var(--space-3); border-radius:var(--radius-card); display:flex; justify-content:space-between; align-items:center; gap:var(--space-2); margin-top:var(--space-2);',
        textColChildren: [eTitle, eSub],
        btnLabel: 'آزمون',
        btnIcon: 'assignment',
        btnVariant: 'secondary',
        btnExtraStyle: '; border-color: var(--color-secondary); color: var(--color-secondary); height: 42px; background: var(--bg-card);',
        onClick: () => router.navigate('exam', categoryId),
      }));
    }

    listEl.innerHTML = '';
    if (filtered.length === 0) {
      listEl.appendChild(
        q
          ? createEmptyState({ icon: 'search_off', title: 'نتیجه‌ای یافت نشد', desc: `هیچ فلش‌کارتی با عبارت «${state.query}» مطابقت ندارد.` })
          : createEmptyState({
              icon: 'style',
              title: 'هیچ فلش‌کارتی ثبت نشده است',
              desc: 'شما می‌توانید اولین فلش‌کارت را برای این دسته ایجاد کنید.',
              action: createButton({ label: 'ساخت فلش‌کارت', icon: 'add', onClick: () => openEditor() }),
            })
      );
      return;
    }
    for (const card of filtered) listEl.appendChild(renderListItem(card));
  }

  function renderListItem(card) {
    const item = document.createElement('div');
    item.className = 'ds-card tappable fc-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    const thumb = document.createElement('div');
    thumb.className = 'fc-item-thumb';
    if (card.frontImage) {
      const img = document.createElement('img');
      img.src = card.frontImage;
      img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = `<span class="material-symbols-rounded">style</span>`;
    }

    const body = document.createElement('div');
    body.className = 'category-body';
    const preview = textOf(card.frontContent) || '(بدون متن)';
    body.innerHTML = `
      <div class="ds-card-title fc-item-title">${renderRichText(preview)}</div>
      <div class="category-meta">${(card.tags || []).map(escapeHtml).join(' · ') || 'بدون برچسب'}</div>
    `;

    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = 'icon-btn';
    bookmarkBtn.setAttribute('aria-label', card.bookmark ? 'حذف بوکمارک' : 'افزودن بوکمارک');
    bookmarkBtn.innerHTML = `<span class="material-symbols-rounded">${card.bookmark ? 'bookmark_fill' : 'bookmark'}</span>`;
    bookmarkBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await flashcardRepository.update(card.id, { bookmark: !card.bookmark });
      refresh();
    });

    item.append(thumb, body, bookmarkBtn);
    const open = () => openViewer(card);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return item;
  }

  function openViewer(card) {
    let flipped = false;
    const flipCard = document.createElement('div');
    flipCard.className = 'flip-card';
    flipCard.innerHTML = `
      <div class="flip-card-inner">
        <div class="flip-face">${renderFace(card.frontContent, card.frontImage)}</div>
        <div class="flip-face flip-face-back">${renderFace(card.backContent, card.backImage)}</div>
      </div>
    `;
    flipCard.addEventListener('click', () => {
      flipped = !flipped;
      flipCard.classList.toggle('flipped', flipped);
    });

    const hint = document.createElement('div');
    hint.className = 'fc-flip-hint';
    hint.textContent = 'برای دیدن پاسخ ضربه بزنید';

    const controls = document.createElement('div');
    controls.className = 'kit-row';
    controls.style.justifyContent = 'center';
    controls.style.marginTop = 'var(--space-3)';

    const bookmarkBtn = createButton({
      label: card.bookmark ? 'حذف بوکمارک' : 'بوکمارک',
      icon: card.bookmark ? 'bookmark_fill' : 'bookmark',
      variant: 'secondary',
      onClick: async () => {
        await flashcardRepository.update(card.id, { bookmark: !card.bookmark });
        card.bookmark = !card.bookmark;
        bookmarkBtn.firstChild.textContent = card.bookmark ? 'bookmark_fill' : 'bookmark';
        bookmarkBtn.lastChild.textContent = card.bookmark ? 'حذف بوکمارک' : 'بوکمارک';
        refresh();
      },
    });

    const speakBtn = createButton({
      label: 'خواندن با صدا',
      icon: 'volume_up',
      variant: 'secondary',
      disabled: !isSpeechSupported(),
      onClick: async () => {
        const ok = await speak(flipped ? textOf(card.backContent) : textOf(card.frontContent));
        if (!ok) {
          showToast('پخش صدا انجام نشد. اگر آفلاین هستید، بستهٔ صوتی زبان را در تنظیمات گوشی نصب کنید.', 'error');
        }
      },
    });

    const editBtn = createButton({
      label: 'ویرایش',
      icon: 'edit',
      variant: 'secondary',
      onClick: () => { sheet.close(); openEditor(card); },
    });

    const deleteBtn = createButton({
      label: 'حذف',
      icon: 'delete',
      variant: 'danger',
      onClick: () => {
        openDialog({
          title: 'حذف این فلش‌کارت؟',
          body: 'این کار قابل بازگشت نیست.',
          actions: [
            { label: 'انصراف', variant: 'text' },
            {
              label: 'حذف', variant: 'danger',
              onClick: async () => {
                await flashcardRepository.delete(card.id);
                await recalcCategoryCount(categoryId);
                sheet.close();
                refresh();
              },
            },
          ],
        });
      },
    });

    controls.append(bookmarkBtn, speakBtn, editBtn, deleteBtn);

    const wrap = document.createElement('div');
    wrap.append(flipCard, hint, controls);

    const sheet = openBottomSheet({ content: wrap });
  }

  function renderFace(contentBlocks, image) {
    const text = renderRichText(textOf(contentBlocks)) || '<span style="color:var(--text-tertiary)">(بدون متن)</span>';
    const img = image ? `<img src="${escapeAttr(image)}" alt="" class="fc-face-image">` : '';
    return `<div class="fc-face-scroll">${img}<div class="fc-face-text">${text}</div></div>`;
  }

  function openEditor(existing = null) {
    const isEdit = !!existing;
    let frontImageData = existing?.frontImage || null;
    let backImageData = existing?.backImage || null;

    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-3);';

    const frontField = createTextArea({ label: 'روی کارت (پرسش)', placeholder: 'متن پرسش…', value: textOf(existing?.frontContent), rows: 3 });
    const frontImageRow = buildImagePicker('تصویر روی کارت (اختیاری)', frontImageData, (data) => { frontImageData = data; });

    const backField = createTextArea({ label: 'پشت کارت (پاسخ)', placeholder: 'متن پاسخ…', value: textOf(existing?.backContent), rows: 3 });
    const backImageRow = buildImagePicker('تصویر پشت کارت (اختیاری)', backImageData, (data) => { backImageData = data; });

    const tagsField = createTextArea({
      label: 'برچسب‌ها (با ویرگول جدا کنید)',
      placeholder: 'مثلاً: فصل۱, مهم',
      value: (existing?.tags || []).join(', '),
      rows: 1,
    });

    const answerTypeField = createSelectField({
      label: 'نوع سوال آزمون/تمرین برای این کارت (اختیاری)',
      options: [
        { value: 'auto', label: 'پیش‌فرض (تصادفی، بدون گزینه‌های اختصاصی)' },
        { value: 'choice', label: 'چند گزینه‌ای (۴ گزینه‌ای)' },
        { value: 'tf', label: 'صحیح / غلط' },
        { value: 'blank', label: 'جای خالی' },
      ],
      value: existing?.answerType || 'auto',
      hint: 'اگر «پیش‌فرض» را انتخاب کنید، سیستم به‌صورت خودکار گزینه‌های اشتباه را از سایر کارت‌های این دسته می‌سازد.',
      onChange: () => updateAnswerTypeVisibility(),
    });

    const existingChoiceOptions = existing?.choiceOptions || [];
    const choiceOptionsWrap = document.createElement('div');
    choiceOptionsWrap.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-2);';
    const choiceHint = document.createElement('div');
    choiceHint.className = 'ds-field-label';
    choiceHint.textContent = 'گزینه‌های غلط (پاسخ درست همان «پشت کارت» است):';
    const choiceInputs = [0, 1, 2].map((i) => createTextField({
      label: `گزینه غلط ${['اول', 'دوم', 'سوم'][i]}`,
      placeholder: 'متن گزینه اشتباه…',
      value: existingChoiceOptions[i] || '',
    }));
    choiceOptionsWrap.append(choiceHint, ...choiceInputs);

    const tfWrap = createTextArea({
      label: 'گزاره نادرست (نسخه غلط این عبارت، برای حالت صحیح/غلط)',
      placeholder: 'مثلاً اگر پاسخ درست «پاریس» است، اینجا یک پاسخ غلط مثل «لندن» را بنویسید…',
      value: existing?.falseStatement || '',
      rows: 2,
    });

    function updateAnswerTypeVisibility() {
      const val = answerTypeField.value;
      choiceOptionsWrap.style.display = val === 'choice' ? 'flex' : 'none';
      tfWrap.style.display = val === 'tf' ? 'block' : 'none';
    }

    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'color:var(--color-danger);font-size:var(--text-caption);display:none;';
    errorMsg.textContent = 'متن روی کارت نمی‌تواند خالی باشد.';

    let saving = false;

    const saveBtn = createButton({
      label: isEdit ? 'ذخیره تغییرات' : 'ساخت فلش‌کارت',
      onClick: async () => {
        if (saving) return;

        const frontText = frontField.input.value.trim();
        if (!frontText) { errorMsg.style.display = 'block'; return; }
        errorMsg.style.display = 'none';

        const tags = tagsField.input.value.split(',').map((t) => t.trim()).filter(Boolean);
        const answerType = answerTypeField.value || 'auto';
        const choiceOptions = choiceInputs
          .map((f) => f.input.value.trim())
          .filter(Boolean);
        const payload = {
          categoryId,
          frontContent: [{ type: 'text', value: frontText }],
          backContent: [{ type: 'text', value: backField.input.value.trim() }],
          frontImage: frontImageData,
          backImage: backImageData,
          tags,
          answerType,
          choiceOptions: answerType === 'choice' ? choiceOptions : [],
          falseStatement: answerType === 'tf' ? tfWrap.input.value.trim() : '',
        };

        saving = true;
        saveBtn.disabled = true;
        try {
          if (isEdit) {
            await flashcardRepository.update(existing.id, payload);
            await recalcCategoryCount(categoryId);
            sheet.close();
            refresh();
          } else {
            await flashcardRepository.create(createFlashcardModel(payload));
            await recalcCategoryCount(categoryId);
            refresh();

            frontField.input.value = '';
            backField.input.value = '';
            tagsField.input.value = '';
            answerTypeField.value = 'auto';
            choiceInputs.forEach((f) => { f.input.value = ''; });
            tfWrap.input.value = '';
            updateAnswerTypeVisibility();
            frontImageData = null;
            backImageData = null;
            content.querySelectorAll('.fc-image-remove').forEach(btn => btn.click());

            frontField.input.focus();
            showToast('کارت جدید اضافه شد');
          }
        } catch (err) {
          console.error('Failed to save flashcard', err);
          showToast('ذخیره فلش‌کارت با خطا مواجه شد. دوباره تلاش کنید.', 'error');
        } finally {
          saving = false;
          saveBtn.disabled = false;
        }
      },
    });
    const cancelBtn = createButton({ label: 'انصراف', variant: 'text', onClick: () => sheet.close() });
    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-2);';
    actionsRow.append(cancelBtn, saveBtn);

    content.append(frontField, frontImageRow, backField, backImageRow, tagsField, answerTypeField, choiceOptionsWrap, tfWrap, errorMsg, actionsRow);
    updateAnswerTypeVisibility();

    const sheet = openBottomSheet({ title: isEdit ? 'ویرایش فلش‌کارت' : 'فلش‌کارت جدید', content });
    frontField.input.focus();
  }

  function buildImagePicker(label, initialData, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'ds-field';

    const labelEl = document.createElement('div');
    labelEl.className = 'ds-field-label';
    labelEl.textContent = label;

    const preview = document.createElement('div');
    preview.className = 'fc-image-picker-preview';

    function renderPreview(data) {
      preview.innerHTML = '';
      if (data) {
        const img = document.createElement('img');
        img.src = data;
        const removeBtn = document.createElement('button');
        removeBtn.className = 'icon-btn fc-image-remove';
        removeBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';
        removeBtn.setAttribute('aria-label', 'حذف تصویر');
        removeBtn.addEventListener('click', () => { onChange(null); renderPreview(null); });
        const box = document.createElement('div');
        box.className = 'fc-image-box';
        box.append(img, removeBtn);
        preview.appendChild(box);
      } else {
        const pickBtn = createButton({
          label: 'افزودن تصویر', icon: 'add_photo_alternate', variant: 'secondary',
          onClick: () => fileInput.click(),
        });
        preview.appendChild(pickBtn);
      }
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (file.size > MAX_IMAGE_BYTES) {
        showToast('حجم تصویر باید کمتر از ۴ مگابایت باشد.', 'error');
        fileInput.value = '';
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      onChange(dataUrl);
      renderPreview(dataUrl);
      fileInput.value = '';
    });

    renderPreview(initialData);
    wrap.append(labelEl, preview, fileInput);
    return wrap;
  }
}
