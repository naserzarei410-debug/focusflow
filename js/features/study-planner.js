/**
 * Weekly Study Planner (جدول برنامه‌ریزی و عملکرد هفتگی).
 *
 * A digital version of the classic paper "دفتر برنامه‌ریزی" weekly table:
 * rows are subjects (user-customizable), columns are a weekly prediction,
 * the seven days, a live total, teacher/class hours, and an exam score
 * ("تراز"). Three fixed footer rows track extracurriculars, screen time,
 * and sleep. Everything autosaves per ISO-ish (Saturday-start) week, so the
 * user can flip back through past weeks like pages in the paper notebook.
 */
import { showToast, createButton, createTextField, createSelectField } from '../core/ui.js';
import { openBottomSheet } from '../core/ui.js';
import { categoryRepository, plannerSubjectRepository } from '../core/repositories.js';
import {
  PLANNER_DAYS, FOOTER_ROWS,
  weekStartOf, addWeeks, formatWeekRangeLabel,
  emptyRow, getSubjectsSorted, getWeekRecord, saveWeekRecord,
  sumRowHours, suggestWeeklyHours,
} from '../core/planner-data.js';

export async function renderStudyPlanner(container) {
  let currentWeekStart = weekStartOf();
  let subjects = await getSubjectsSorted(); // includes archived=false + archived=true (filtered per-view below)
  let weekRecord = await getWeekRecord(currentWeekStart);
  let categories = [];
  try { categories = await categoryRepository.getAll(); } catch (e) { categories = []; }

  const suggestionCache = new Map(); // subjectId -> hours|null

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveWeekRecord(weekRecord).catch((e) => console.error('Planner autosave failed', e));
      saveTimer = null;
    }, 600);
  }
  async function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try { await saveWeekRecord(weekRecord); } catch (e) { console.error('Planner save failed', e); }
  }

  function activeSubjectsForCurrentWeek() {
    return subjects.filter((s) => {
      if (!s.archived) return true;
      const row = weekRecord.rows && weekRecord.rows[s.id];
      return row && sumRowHours(row) > 0;
    });
  }

  function getRow(rowId) {
    if (!weekRecord.rows) weekRecord.rows = {};
    if (!weekRecord.rows[rowId]) weekRecord.rows[rowId] = emptyRow();
    return weekRecord.rows[rowId];
  }

  // ---------------------------------------------------------------- layout
  const root = document.createElement('div');
  root.style.cssText = 'display:flex; flex-direction:column; height:100%;';
  container.appendChild(root);

  // ---- week navigator -----------------------------------------------
  const header = document.createElement('div');
  header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:var(--space-2); padding:var(--space-3) var(--space-4) var(--space-2);';
  root.appendChild(header);

  function navBtn(icon, label) {
    const b = document.createElement('button');
    b.setAttribute('aria-label', label);
    b.className = 'icon-btn';
    b.innerHTML = `<span class="material-symbols-rounded">${icon}</span>`;
    return b;
  }
  // This app's RTL convention (see the header back-button) treats a
  // right-pointing chevron as "go back" and left-pointing as "go forward" —
  // kept consistent here for "previous / next week".
  const prevWeekBtn = navBtn('chevron_right', 'هفتهٔ قبل');
  const nextWeekBtn = navBtn('chevron_left', 'هفتهٔ بعد');

  const weekLabelWrap = document.createElement('div');
  weekLabelWrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:1px; min-width:0;';
  const weekLabel = document.createElement('div');
  weekLabel.style.cssText = 'font-weight:800; font-size:14px; color:var(--text-primary); white-space:nowrap;';
  const thisWeekBtn = document.createElement('button');
  thisWeekBtn.textContent = 'برو به این هفته';
  thisWeekBtn.style.cssText = 'font-size:11px; font-weight:700; color:var(--color-primary); background:none; border:none; cursor:pointer; padding:1px 4px;';
  weekLabelWrap.append(weekLabel, thisWeekBtn);

  header.append(prevWeekBtn, weekLabelWrap, nextWeekBtn);

  // ---- weekly summary strip -------------------------------------------
  const summaryBar = document.createElement('div');
  summaryBar.style.cssText = 'display:flex; align-items:center; justify-content:center; gap:var(--space-3); padding:0 var(--space-4) var(--space-3); font-size:12px; font-weight:700; color:var(--text-secondary); flex-wrap:wrap;';
  root.appendChild(summaryBar);

  // ---- scrollable table -------------------------------------------------
  const tableScroll = document.createElement('div');
  tableScroll.style.cssText = 'flex:1; overflow:auto; -webkit-overflow-scrolling:touch; padding:0 var(--space-3);';
  root.appendChild(tableScroll);

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = 'min-width:820px;';
  tableScroll.appendChild(tableWrap);

  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:separate; border-spacing:0 6px; width:100%; font-size:12.5px;';
  tableWrap.appendChild(table);

  const COLS = [
    { key: 'label', title: 'درس' },
    { key: 'prediction', title: 'پیش‌بینی' },
    ...PLANNER_DAYS.map((d) => ({ key: d.key, title: d.label })),
    { key: 'total', title: 'جمع کل' },
    { key: 'teacherClass', title: 'معلم و کلاس' },
    { key: 'taraz', title: 'تراز' },
  ];

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  COLS.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c.title;
    th.style.cssText = `
      position:${c.key === 'label' ? 'sticky' : 'static'}; right:${c.key === 'label' ? '0' : 'auto'}; z-index:${c.key === 'label' ? '3' : '1'};
      background:var(--bg-sunken); color:var(--text-secondary); font-size:11px; font-weight:800;
      padding:8px 6px; white-space:nowrap; border-radius:8px;
      min-width:${c.key === 'label' ? '92px' : c.key === 'prediction' || c.key === 'total' ? '58px' : c.key === 'teacherClass' || c.key === 'taraz' ? '70px' : '52px'};
    `;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  // Row refs so live input on one cell can recompute this row's total and
  // the grand-summary row without re-rendering the whole table.
  const rowRefs = new Map(); // rowId -> { totalEl, dayInputs: {key:input} }

  function makeCellInput({ value, placeholder, onInput, mono }) {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = value || '';
    if (placeholder) input.placeholder = placeholder;
    input.style.cssText = `
      width:100%; box-sizing:border-box; border:none; background:transparent; text-align:center;
      font-size:12.5px; font-weight:${mono ? '700' : '500'}; color:var(--text-primary); padding:9px 4px;
      font-family:${mono ? 'var(--font-mono)' : 'inherit'};
    `;
    input.addEventListener('input', () => onInput(input.value));
    input.addEventListener('focus', () => { input.parentElement.style.background = 'var(--color-primary-soft)'; });
    input.addEventListener('blur', () => { input.parentElement.style.background = 'var(--bg-card)'; });
    return input;
  }

  function recomputeRowTotal(rowId) {
    const refs = rowRefs.get(rowId);
    if (!refs) return;
    const total = sumRowHours(getRow(rowId));
    refs.totalEl.textContent = total > 0 ? total.toLocaleString('fa-IR') : '—';
  }

  function recomputeSummaryRow() {
    const activeSubjects = activeSubjectsForCurrentWeek();
    let grand = 0;
    PLANNER_DAYS.forEach((d) => {
      let daySum = 0;
      activeSubjects.forEach((s) => {
        const raw = getRow(s.id).days[d.key];
        const n = parseFloat(String(raw || '').replace(/[^\d.\-]/g, ''));
        if (Number.isFinite(n)) daySum += n;
      });
      grand += daySum;
      const el = summaryRefs.days[d.key];
      if (el) el.textContent = daySum > 0 ? (Math.round(daySum * 100) / 100).toLocaleString('fa-IR') : '—';
    });
    if (summaryRefs.total) summaryRefs.total.textContent = grand > 0 ? (Math.round(grand * 100) / 100).toLocaleString('fa-IR') : '—';
    updateSummaryBar(grand);
  }

  function updateSummaryBar(actualTotal) {
    const predictedTotal = activeSubjectsForCurrentWeek().reduce((acc, s) => {
      const n = parseFloat(String(getRow(s.id).prediction || '').replace(/[^\d.\-]/g, ''));
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    summaryBar.innerHTML = '';
    const chip = (icon, text, color) => {
      const span = document.createElement('span');
      span.style.cssText = `display:inline-flex; align-items:center; gap:4px; color:${color || 'var(--text-secondary)'};`;
      span.innerHTML = `<span class="material-symbols-rounded" style="font-size:15px;">${icon}</span>${text}`;
      return span;
    };
    summaryBar.appendChild(chip('flag', `پیش‌بینی: ${predictedTotal > 0 ? predictedTotal.toLocaleString('fa-IR') : '۰'} ساعت`));
    summaryBar.appendChild(chip('assignment_turned_in', `انجام‌شده: ${actualTotal > 0 ? (Math.round(actualTotal * 100) / 100).toLocaleString('fa-IR') : '۰'} ساعت`, 'var(--color-success)'));
  }

  const summaryRefs = { days: {}, total: null };

  function buildRow(rowDef, { isFooter } = {}) {
    const row = getRow(rowDef.id);
    const tr = document.createElement('tr');

    // --- label cell ---
    const labelTd = document.createElement('td');
    labelTd.style.cssText = `
      position:sticky; right:0; z-index:2; background:${isFooter ? 'var(--bg-sunken)' : 'var(--color-primary-soft)'};
      border-radius:10px 0 0 10px; padding:8px 10px; min-width:92px; max-width:120px;
    `;
    const labelInner = document.createElement('div');
    labelInner.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:4px;';
    const labelText = document.createElement('span');
    labelText.textContent = rowDef.title;
    labelText.style.cssText = `font-weight:800; font-size:12.5px; color:${isFooter ? 'var(--text-secondary)' : 'var(--text-primary)'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
    labelInner.appendChild(labelText);
    if (!isFooter) {
      const editBtn = document.createElement('button');
      editBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:15px;">more_vert</span>';
      editBtn.style.cssText = 'background:none; border:none; color:var(--text-tertiary); cursor:pointer; padding:2px; flex-shrink:0; display:flex;';
      editBtn.addEventListener('click', () => openSubjectEditor(subjects.find((s) => s.id === rowDef.id)));
      labelInner.appendChild(editBtn);
    }
    labelTd.appendChild(labelInner);
    tr.appendChild(labelTd);

    // --- prediction cell ---
    const predTd = document.createElement('td');
    predTd.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-soft); padding:0;';
    let predPlaceholder = '';
    if (!isFooter) {
      const subj = subjects.find((s) => s.id === rowDef.id);
      if (subj && subj.categoryId && suggestionCache.has(subj.id)) {
        const suggested = suggestionCache.get(subj.id);
        if (suggested && !row.prediction) predPlaceholder = `≈${suggested.toLocaleString('fa-IR')}`;
      }
    }
    const predInput = makeCellInput({
      value: row.prediction, placeholder: predPlaceholder || '—', mono: true,
      onInput: (v) => { row.prediction = v; scheduleSave(); recomputeSummaryRow(); },
    });
    predTd.appendChild(predInput);
    tr.appendChild(predTd);

    // --- 7 day cells ---
    const dayInputs = {};
    PLANNER_DAYS.forEach((d) => {
      const td = document.createElement('td');
      td.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-soft); padding:0;';
      const input = makeCellInput({
        value: row.days[d.key], mono: true,
        onInput: (v) => {
          row.days[d.key] = v;
          scheduleSave();
          recomputeRowTotal(rowDef.id);
          recomputeSummaryRow();
        },
      });
      dayInputs[d.key] = input;
      td.appendChild(input);
      tr.appendChild(td);
    });

    // --- total cell (computed, read-only) ---
    const totalTd = document.createElement('td');
    totalTd.style.cssText = 'background:var(--color-success-soft); border:1px solid var(--border-soft); padding:9px 4px; text-align:center;';
    const totalSpan = document.createElement('span');
    const initialTotal = sumRowHours(row);
    totalSpan.textContent = initialTotal > 0 ? initialTotal.toLocaleString('fa-IR') : '—';
    totalSpan.style.cssText = 'font-weight:800; font-size:12.5px; color:var(--color-success); font-family:var(--font-mono);';
    totalTd.appendChild(totalSpan);
    tr.appendChild(totalTd);

    // --- teacher/class cell ---
    const tcTd = document.createElement('td');
    tcTd.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-soft); padding:0;';
    const tcInput = makeCellInput({
      value: row.teacherClass,
      onInput: (v) => { row.teacherClass = v; scheduleSave(); },
    });
    tcTd.appendChild(tcInput);
    tr.appendChild(tcTd);

    // --- taraz cell ---
    const tarazTd = document.createElement('td');
    tarazTd.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-soft); padding:0; border-radius:0 10px 10px 0;';
    const tarazInput = makeCellInput({
      value: row.taraz,
      onInput: (v) => { row.taraz = v; scheduleSave(); },
    });
    tarazTd.appendChild(tarazInput);
    tr.appendChild(tarazTd);

    rowRefs.set(rowDef.id, { totalEl: totalSpan, dayInputs });
    return tr;
  }

  function buildSummaryRow() {
    const tr = document.createElement('tr');
    const labelTd = document.createElement('td');
    labelTd.style.cssText = 'position:sticky; right:0; z-index:2; background:var(--color-primary); border-radius:10px 0 0 10px; padding:8px 10px;';
    labelTd.innerHTML = `<span style="font-weight:800; font-size:12.5px; color:var(--text-on-primary);">جمع</span>`;
    tr.appendChild(labelTd);

    const predTd = document.createElement('td');
    predTd.style.cssText = 'background:var(--color-primary); padding:9px 4px; text-align:center; color:var(--text-on-primary); font-size:12px;';
    predTd.textContent = '—';
    tr.appendChild(predTd);

    PLANNER_DAYS.forEach((d) => {
      const td = document.createElement('td');
      td.style.cssText = 'background:var(--color-primary); padding:9px 4px; text-align:center;';
      const span = document.createElement('span');
      span.style.cssText = 'font-weight:800; font-size:12.5px; color:var(--text-on-primary); font-family:var(--font-mono);';
      span.textContent = '—';
      summaryRefs.days[d.key] = span;
      td.appendChild(span);
      tr.appendChild(td);
    });

    const totalTd = document.createElement('td');
    totalTd.style.cssText = 'background:var(--color-primary-hover); padding:9px 4px; text-align:center;';
    const totalSpan = document.createElement('span');
    totalSpan.style.cssText = 'font-weight:800; font-size:13px; color:var(--text-on-primary); font-family:var(--font-mono);';
    totalSpan.textContent = '—';
    summaryRefs.total = totalSpan;
    totalTd.appendChild(totalSpan);
    tr.appendChild(totalTd);

    const tcTd = document.createElement('td');
    tcTd.style.cssText = 'background:var(--color-primary); padding:9px 4px;';
    tr.appendChild(tcTd);
    const tarazTd = document.createElement('td');
    tarazTd.style.cssText = 'background:var(--color-primary); padding:9px 4px; border-radius:0 10px 10px 0;';
    tr.appendChild(tarazTd);

    return tr;
  }

  // --- add-subject row -----------------------------------------------
  function buildAddRow() {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = COLS.length;
    td.style.cssText = 'padding:6px 0 2px;';
    const btn = document.createElement('button');
    btn.style.cssText = 'width:100%; display:flex; align-items:center; justify-content:center; gap:6px; padding:9px; border-radius:10px; border:1.5px dashed var(--border-strong); background:none; color:var(--text-secondary); font-size:12.5px; font-weight:700; cursor:pointer;';
    btn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">add</span> افزودن درس جدید';
    btn.addEventListener('click', () => openSubjectEditor(null));
    td.appendChild(btn);
    tr.appendChild(td);
    return tr;
  }

  async function loadSuggestions(activeSubjects) {
    await Promise.all(activeSubjects.map(async (s) => {
      if (!s.categoryId || suggestionCache.has(s.id)) return;
      try {
        const val = await suggestWeeklyHours(s.categoryId);
        suggestionCache.set(s.id, val);
      } catch (e) {
        suggestionCache.set(s.id, null);
      }
    }));
  }

  async function renderTable() {
    rowRefs.clear();
    tbody.innerHTML = '';
    weekLabel.textContent = formatWeekRangeLabel(currentWeekStart);

    const activeSubjects = activeSubjectsForCurrentWeek();
    await loadSuggestions(activeSubjects);

    activeSubjects.forEach((s) => tbody.appendChild(buildRow({ id: s.id, title: s.title })));
    tbody.appendChild(buildAddRow());
    tbody.appendChild(buildSummaryRow());
    FOOTER_ROWS.forEach((f) => tbody.appendChild(buildRow(f, { isFooter: true })));

    recomputeSummaryRow();
  }

  // ---------------------------------------------------------------- subject editor
  function openSubjectEditor(subject) {
    const isNew = !subject;
    const form = document.createElement('div');
    form.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-4);';

    const nameField = createTextField({ label: 'نام درس', placeholder: 'مثلاً ریاضی', value: subject ? subject.title : '' });

    const categoryOptions = [
      { value: '', label: 'بدون پیوند (فقط ثبت دستی)' },
      ...categories.map((c) => ({ value: c.id, label: c.title })),
    ];
    const categoryField = createSelectField({
      label: 'پیوند به یکی از دسته‌های کتابخانه (اختیاری)',
      hint: 'با پیوند دادن، ستون «پیش‌بینی» می‌تواند بر اساس میانگین ساعات مطالعهٔ واقعی شما در این دسته، پیشنهاد بدهد.',
      options: categoryOptions.length > 1 ? categoryOptions : [{ value: '', label: 'دسته‌ای در کتابخانه وجود ندارد' }],
      value: subject ? (subject.categoryId || '') : '',
    });

    form.append(nameField, categoryField);

    if (!isNew) {
      const orderRow = document.createElement('div');
      orderRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:var(--space-2);';
      const orderLabel = document.createElement('span');
      orderLabel.textContent = 'ترتیب نمایش';
      orderLabel.style.cssText = 'font-size:13px; font-weight:700; color:var(--text-secondary);';
      const orderBtns = document.createElement('div');
      orderBtns.style.cssText = 'display:flex; gap:6px;';
      const upBtn = createButton({ label: '', icon: 'keyboard_arrow_up', variant: 'secondary', onClick: async () => { await moveSubject(subject, -1); sheet.close(); await renderTable(); } });
      const downBtn = createButton({ label: '', icon: 'keyboard_arrow_down', variant: 'secondary', onClick: async () => { await moveSubject(subject, 1); sheet.close(); await renderTable(); } });
      orderBtns.append(upBtn, downBtn);
      orderRow.append(orderLabel, orderBtns);
      form.appendChild(orderRow);
    }

    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display:flex; gap:var(--space-2); margin-top:var(--space-1);';
    const saveBtn = createButton({
      label: isNew ? 'افزودن درس' : 'ذخیره تغییرات',
      variant: 'primary',
      onClick: async () => {
        const title = nameField.input.value.trim();
        if (!title) { showToast('نام درس را وارد کنید', 'error'); return; }
        if (isNew) {
          const newSubj = {
            id: `subj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title,
            categoryId: categoryField.value || null,
            order: subjects.length,
            archived: false,
            createdAt: new Date().toISOString(),
          };
          await plannerSubjectRepository.create(newSubj);
          subjects.push(newSubj);
        } else {
          const categoryId = categoryField.value || null;
          await plannerSubjectRepository.update(subject.id, { title, categoryId });
          subject.title = title;
          subject.categoryId = categoryId;
          suggestionCache.delete(subject.id);
        }
        sheet.close();
        await renderTable();
      },
    });
    actionsRow.appendChild(saveBtn);
    form.appendChild(actionsRow);

    if (!isNew) {
      const dangerRow = document.createElement('div');
      dangerRow.style.cssText = 'margin-top:var(--space-2); padding-top:var(--space-3); border-top:1px solid var(--border-soft);';
      const removeBtn = createButton({
        label: 'حذف این درس از جدول',
        icon: 'delete',
        variant: 'danger',
        onClick: async () => {
          if (!window.confirm(`«${subject.title}» از فهرست دروس جدول برداشته می‌شود. اگر برای هفته‌های قبل داده ثبت کرده باشید، آن هفته‌ها همچنان قابل مشاهده خواهند بود. ادامه می‌دهید؟`)) return;
          await plannerSubjectRepository.update(subject.id, { archived: true });
          subject.archived = true;
          sheet.close();
          await renderTable();
        },
      });
      dangerRow.appendChild(removeBtn);
      form.appendChild(dangerRow);
    }

    const sheet = openBottomSheet({ title: isNew ? 'افزودن درس جدید' : 'ویرایش درس', content: form });
  }

  async function moveSubject(subject, dir) {
    const sorted = subjects.filter((s) => !s.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = sorted.findIndex((s) => s.id === subject.id);
    const swapIdx = idx + dir;
    if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    const a = subject.order ?? idx;
    const b = other.order ?? swapIdx;
    subject.order = b;
    other.order = a;
    await plannerSubjectRepository.update(subject.id, { order: subject.order });
    await plannerSubjectRepository.update(other.id, { order: other.order });
  }

  // ---------------------------------------------------------------- week nav wiring
  async function goToWeek(newWeekStart) {
    await flushSave();
    currentWeekStart = newWeekStart;
    weekRecord = await getWeekRecord(currentWeekStart);
    await renderTable();
  }

  prevWeekBtn.addEventListener('click', () => goToWeek(addWeeks(currentWeekStart, -1)));
  nextWeekBtn.addEventListener('click', () => goToWeek(addWeeks(currentWeekStart, 1)));
  thisWeekBtn.addEventListener('click', () => goToWeek(weekStartOf()));

  // ---- copy-last-week's predictions helper ----------------------------
  const toolsRow = document.createElement('div');
  toolsRow.style.cssText = 'display:flex; justify-content:center; padding:0 var(--space-4) var(--space-2);';
  const copyBtn = document.createElement('button');
  copyBtn.style.cssText = 'font-size:11.5px; font-weight:700; color:var(--text-tertiary); background:none; border:none; cursor:pointer; display:flex; align-items:center; gap:4px;';
  copyBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px;">content_copy</span> کپی «پیش‌بینی» از هفتهٔ قبل';
  copyBtn.addEventListener('click', async () => {
    const prevWeek = await getWeekRecord(addWeeks(currentWeekStart, -1));
    if (!prevWeek.rows || Object.keys(prevWeek.rows).length === 0) {
      showToast('هفتهٔ قبل داده‌ای برای کپی ندارد', 'info');
      return;
    }
    let copied = 0;
    activeSubjectsForCurrentWeek().forEach((s) => {
      const prevRow = prevWeek.rows[s.id];
      if (prevRow && prevRow.prediction) {
        getRow(s.id).prediction = prevRow.prediction;
        copied++;
      }
    });
    if (copied === 0) {
      showToast('برای دروس این هفته، پیش‌بینی ثبت‌شده‌ای در هفتهٔ قبل پیدا نشد', 'info');
      return;
    }
    scheduleSave();
    await renderTable();
    showToast(`پیش‌بینی ${copied.toLocaleString('fa-IR')} درس از هفتهٔ قبل کپی شد`, 'success');
  });
  toolsRow.appendChild(copyBtn);
  root.insertBefore(toolsRow, tableScroll);

  await renderTable();

  return () => {
    flushSave();
  };
}
