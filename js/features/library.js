import {
  createButton, createCard, createEmptyState, createProgressBar,
  createTextField, createTextArea, openDialog
} from '../core/ui.js';
import { categoryRepository, flashcardRepository, aiConversationRepository, examRepository, examResultRepository } from '../core/repositories.js';
import { router } from '../core/router.js';
import { createCategoryModel } from '../core/models.js';

const LONG_PRESS_MS = 2000;

export async function renderLibrary(container) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);';
  
  const title = document.createElement('h2');
  title.style.cssText = 'font-size:var(--text-title);font-weight:800;color:var(--text-primary);';
  title.textContent = 'کتابخانه';
  header.appendChild(title);

  const addBtn = createButton({
    label: 'دسته جدید',
    icon: 'add',
    onClick: () => openAddCategoryDialog(onRefresh)
  });
  header.appendChild(addBtn);
  container.appendChild(header);

  // Selection-mode toolbar: appears once the user long-presses a category
  // to select one or more categories for bulk deletion.
  const selectionBar = document.createElement('div');
  selectionBar.style.cssText = 'display:none; align-items:center; justify-content:space-between; gap:var(--space-2); background:var(--color-danger-soft); border:1px solid var(--color-danger); border-radius:var(--radius-card); padding:var(--space-2) var(--space-3); margin-bottom:var(--space-3); width:100%; max-width:var(--max-content-w); margin-inline:auto;';
  container.appendChild(selectionBar);

  const listContainer = document.createElement('div');
  listContainer.style.cssText = 'display:grid;grid-template-columns:1fr;gap:var(--space-3);width:100%;max-width:var(--max-content-w);margin:0 auto;';
  container.appendChild(listContainer);

  const selection = new Set();
  let selectionMode = false;

  function updateSelectionBar() {
    selectionBar.style.display = selectionMode ? 'flex' : 'none';
    selectionBar.innerHTML = '';
    if (!selectionMode) return;

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size:var(--text-caption); font-weight:800; color:var(--color-danger);';
    countLabel.textContent = `${selection.size.toLocaleString('fa-IR')} دسته انتخاب شده`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:var(--space-2);';

    const cancelBtn = createButton({
      label: 'انصراف',
      variant: 'text',
      onClick: () => {
        selectionMode = false;
        selection.clear();
        onRefresh();
      }
    });

    const deleteBtn = createButton({
      label: 'حذف',
      icon: 'delete',
      variant: 'danger',
      disabled: selection.size === 0,
      onClick: () => confirmBulkDelete()
    });

    btnRow.append(cancelBtn, deleteBtn);
    selectionBar.append(countLabel, btnRow);
  }

  function confirmBulkDelete() {
    if (selection.size === 0) return;
    openDialog({
      title: `حذف ${selection.size.toLocaleString('fa-IR')} دسته؟`,
      body: 'با حذف هر دسته، تمام فلش‌کارت‌ها و گفتگوهای هوش مصنوعی مرتبط با آن نیز برای همیشه حذف می‌شوند. این کار قابل بازگشت نیست.',
      actions: [
        { label: 'انصراف', variant: 'text' },
        {
          label: 'حذف همه',
          variant: 'danger',
          onClick: async () => {
            for (const catId of selection) {
              await deleteCategoryCascade(catId);
            }
            selectionMode = false;
            selection.clear();
            onRefresh();
          }
        }
      ]
    });
  }

  async function deleteCategoryCascade(categoryId) {
    // Remove the category itself plus everything scoped to it, so no
    // orphaned flashcards / conversations / exams are left behind in
    // IndexedDB.
    try {
      const cards = await flashcardRepository.getByIndex('categoryId', categoryId);
      for (const card of cards) {
        await flashcardRepository.delete(card.id);
      }
    } catch (err) { console.error('Failed to delete category flashcards', err); }

    try {
      const convs = await aiConversationRepository.getByIndex('categoryId', categoryId);
      for (const conv of convs) {
        await aiConversationRepository.delete(conv.id);
      }
    } catch (err) { console.error('Failed to delete category AI conversations', err); }

    try {
      const exams = await examRepository.getByIndex('categoryId', categoryId);
      for (const exam of exams) {
        const results = await examResultRepository.getByIndex('examId', exam.id);
        for (const r of results) {
          await examResultRepository.delete(r.id);
        }
        await examRepository.delete(exam.id);
      }
    } catch (err) { console.error('Failed to delete category exams', err); }

    await categoryRepository.delete(categoryId);
  }

  async function onRefresh() {
    listContainer.innerHTML = '';
    updateSelectionBar();
    const categories = await categoryRepository.getAll();
    const activeCategories = categories.filter(c => !c.archived);

    if (activeCategories.length === 0) {
      listContainer.appendChild(
        createEmptyState({
          icon: 'folder_open',
          title: 'کتابخانه خالی است',
          desc: 'شما هنوز هیچ دسته مطالعاتی ایجاد نکرده‌اید. با دکمه بالا اولین دسته را بسازید.',
          action: createButton({
            label: 'ایجاد اولین دسته',
            onClick: () => openAddCategoryDialog(onRefresh)
          })
        })
      );
      return;
    }

    for (const cat of activeCategories) {
      const cards = await flashcardRepository.getByIndex('categoryId', cat.id);
      const activeCardsCount = cards.filter(c => !c.deleted).length;
      
      const cardProgress = cat.progress || 0;

      const progressContainer = document.createElement('div');
      progressContainer.style.cssText = 'margin-top:var(--space-2);';
      
      const progressLabel = document.createElement('div');
      progressLabel.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:4px;';
      progressLabel.innerHTML = `<span>یادگیری: ${cardProgress}%</span><span>${activeCardsCount} کارت</span>`;
      progressContainer.appendChild(progressLabel);
      
      const pBar = createProgressBar(cardProgress);
      progressContainer.appendChild(pBar);

      const catCard = createCard({
        title: cat.title,
        desc: cat.description || 'بدون توضیحات',
        children: [progressContainer],
        onClick: () => {
          if (selectionMode) {
            toggleSelect(cat.id, catCard, checkBox);
          } else {
            router.navigate('category', cat.id);
          }
        }
      });
      
      // Customize card border color with category theme color
      catCard.style.borderLeft = `4px solid ${cat.themeColor || '#3D6BFF'}`;
      catCard.style.position = 'relative';
      catCard.style.userSelect = 'none';
      catCard.style.webkitUserSelect = 'none';

      // Selection checkbox square (hidden until selection mode is active)
      const checkBox = document.createElement('div');
      checkBox.style.cssText = `
        position:absolute; top:var(--space-2); left:var(--space-2);
        width:24px; height:24px; border-radius:6px;
        border:2px solid var(--border-strong); background:var(--bg-card);
        display:${selectionMode ? 'flex' : 'none'}; align-items:center; justify-content:center;
        transition:all var(--duration-fast); z-index:5;
      `;
      if (selection.has(cat.id)) {
        checkBox.style.background = 'var(--color-danger)';
        checkBox.style.borderColor = 'var(--color-danger)';
        checkBox.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;color:#fff;">check</span>';
      }
      catCard.appendChild(checkBox);

      // Long-press (2s) to enter selection mode
      let pressTimer = null;
      const startPress = () => {
        if (selectionMode) return;
        pressTimer = setTimeout(() => {
          selectionMode = true;
          selection.add(cat.id);
          onRefresh();
        }, LONG_PRESS_MS);
      };
      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };
      catCard.addEventListener('pointerdown', startPress);
      catCard.addEventListener('pointerup', cancelPress);
      catCard.addEventListener('pointerleave', cancelPress);
      catCard.addEventListener('pointercancel', cancelPress);

      listContainer.appendChild(catCard);
    }
  }

  function toggleSelect(catId, catCard, checkBox) {
    if (selection.has(catId)) {
      selection.delete(catId);
      checkBox.style.background = 'var(--bg-card)';
      checkBox.style.borderColor = 'var(--border-strong)';
      checkBox.innerHTML = '';
    } else {
      selection.add(catId);
      checkBox.style.background = 'var(--color-danger)';
      checkBox.style.borderColor = 'var(--color-danger)';
      checkBox.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;color:#fff;">check</span>';
    }
    updateSelectionBar();
  }

  await onRefresh();
}

function openAddCategoryDialog(onSuccess) {
  let title = '';
  let description = '';
  let themeColor = '#3D6BFF';

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-3);';

  const titleField = createTextField({
    label: 'عنوان دسته',
    placeholder: 'مثال: واژگان انگلیسی ۵۰۴',
    onInput: (val) => { title = val; }
  });
  form.appendChild(titleField);

  const descField = createTextArea({
    label: 'توضیحات (اختیاری)',
    placeholder: 'توضیح کوتاهی درباره این دسته بنویسید...',
    onInput: (val) => { description = val; }
  });
  form.appendChild(descField);

  // Color picker representation
  const colorLabel = document.createElement('label');
  colorLabel.className = 'input-label';
  colorLabel.textContent = 'رنگ پوسته دسته';
  form.appendChild(colorLabel);

  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;gap:var(--space-2);margin-top:2px;';
  const colors = ['#3D6BFF', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
  colors.forEach(col => {
    const dot = document.createElement('button');
    dot.style.cssText = `width:32px;height:32px;border-radius:50%;background-color:${col};border:2px solid ${col === themeColor ? 'var(--text-primary)' : 'transparent'};transition:transform 0.1s;`;
    dot.addEventListener('click', () => {
      themeColor = col;
      colorRow.querySelectorAll('button').forEach(b => {
        b.style.borderColor = 'transparent';
      });
      dot.style.borderColor = 'var(--text-primary)';
    });
    colorRow.appendChild(dot);
  });
  form.appendChild(colorRow);

  openDialog({
    title: 'دسته‌ی مطالعاتی جدید',
    content: form,
    actions: [
      {
        label: 'انصراف',
        variant: 'secondary'
      },
      {
        label: 'ایجاد دسته',
        variant: 'primary',
        onClick: async () => {
          if (!title.trim()) return;
          const newCat = createCategoryModel({
            title: title.trim(),
            description: description.trim(),
            themeColor
          });
          await categoryRepository.create(newCat);
          onSuccess();
        }
      }
    ]
  });
}
