// Shared component library — Phase 2

let toastTimer = null;
let toastEl = null;

/**
 * Lightweight, global toast/snackbar. Used to surface failures that
 * would otherwise be silent to the user — e.g. a "پخش صدا" tap that
 * failed on every TTS channel, or a notification permission that was
 * denied. Safe to call from anywhere; creates/reuses a single fixed
 * element appended to <body>.
 */
export function showToast(message, type = 'info', duration = 3200) {
  if (!message) return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.setAttribute('role', 'status');
    toastEl.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: calc(84px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%) translateY(12px);
      max-width: min(92vw, 420px);
      background: var(--bg-elevated, #1F2937);
      color: var(--text-on-dark, #fff);
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.6;
      text-align: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      z-index: 9999;
      opacity: 0;
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none;
    `;
    document.body.appendChild(toastEl);
  }

  const colors = {
    error: '#EF4444',
    success: '#10B981',
    warning: '#F59E0B',
    info: '#1F2937',
  };
  toastEl.style.background = colors[type] || colors.info;
  toastEl.textContent = message;

  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateX(-50%) translateY(0)';
  });

  toastTimer = setTimeout(() => {
    if (!toastEl) return;
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(-50%) translateY(12px)';
  }, duration);
}

export function createButton({ label, onClick, variant = 'primary', icon, id, disabled = false }) {
  const btn = document.createElement('button');
  btn.className = `btn btn-${variant}`;
  if (id) btn.id = id;
  btn.disabled = disabled;

  if (icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'material-symbols-rounded';
    iconSpan.textContent = icon;
    btn.appendChild(iconSpan);
  }

  if (label) {
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);
  }

  if (onClick) {
    btn.addEventListener('click', onClick);
  }

  return btn;
}

export function createCard({ title, desc, children = [], content, onClick, id }) {
  const card = document.createElement('div');
  card.className = `card ${onClick ? 'card-interactive' : ''}`;
  if (id) card.id = id;

  if (title) {
    const titleEl = document.createElement('h3');
    titleEl.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:var(--space-1);color:var(--text-primary);';
    titleEl.textContent = title;
    card.appendChild(titleEl);
  }

  if (desc) {
    const descEl = document.createElement('p');
    descEl.style.cssText = 'font-size:13px;color:var(--text-secondary);line-height:1.4;margin-bottom:var(--space-3);';
    descEl.textContent = desc;
    card.appendChild(descEl);
  }

  const items = content || children;
  if (items && Array.isArray(items)) {
    items.forEach(child => {
      if (child) card.appendChild(child);
    });
  } else if (items) {
    card.appendChild(items);
  }

  if (onClick) {
    card.addEventListener('click', onClick);
  }

  return card;
}

export function openDialog({ title, content, body, actions = [] }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';

  const dialog = document.createElement('div');
  dialog.className = 'dialog-content';

  if (title) {
    const titleEl = document.createElement('h2');
    titleEl.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:var(--space-3);color:var(--text-primary);display:flex;align-items:center;gap:var(--space-2);';
    titleEl.innerHTML = title;
    dialog.appendChild(titleEl);
  }

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = 'margin-bottom:var(--space-5);font-size:14px;color:var(--text-secondary);line-height:1.5;';
  const textVal = content || body;
  if (typeof textVal === 'string') {
    bodyEl.textContent = textVal;
  } else if (textVal instanceof HTMLElement) {
    bodyEl.appendChild(textVal);
  }
  dialog.appendChild(bodyEl);

  const actionsEl = document.createElement('div');
  actionsEl.style.cssText = 'display:flex;justify-content:flex-end;gap:var(--space-2);';
  
  actions.forEach(action => {
    const btn = createButton({
      label: action.label,
      variant: action.variant || 'secondary',
      onClick: async (e) => {
        if (action.onClick) {
          const result = await action.onClick(e);
          if (result === false || action.keepOpen) return;
        }
        if (!action.keepOpen) {
          overlay.remove();
        }
      }
    });
    actionsEl.appendChild(btn);
  });

  dialog.appendChild(actionsEl);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  return overlay;
}

export function openBottomSheet({ title, content }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';

  if (title) {
    const titleEl = document.createElement('h2');
    titleEl.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:var(--space-4);color:var(--text-primary);display:flex;align-items:center;gap:var(--space-2);';
    titleEl.innerHTML = title;
    sheet.appendChild(titleEl);
  }

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = 'font-size:14px;color:var(--text-secondary);line-height:1.5;';
  if (typeof content === 'string') {
    bodyEl.textContent = content;
  } else if (content instanceof HTMLElement) {
    bodyEl.appendChild(content);
  }
  sheet.appendChild(bodyEl);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  overlay.close = () => overlay.remove();

  return overlay;
}

export function createTextField({ label, placeholder, value = '', onInput, id, type = 'text' }) {
  const wrap = document.createElement('div');
  wrap.className = 'input-wrapper';

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'input-label';
    if (id) labelEl.htmlFor = id;
    labelEl.textContent = label;
    wrap.appendChild(labelEl);
  }

  const input = document.createElement('input');
  input.className = 'text-input';
  input.type = type;
  if (id) input.id = id;
  if (placeholder) input.placeholder = placeholder;
  input.value = value;

  if (onInput) {
    input.addEventListener('input', (e) => onInput(e.target.value, e));
  }

  wrap.appendChild(input);
  wrap.input = input;
  return wrap;
}

/**
 * Custom dropdown/select that does NOT use a native <select> element.
 *
 * WHY: native <select> popups rely on the WebView's own browser-chrome
 * UI to render the options list. Many generic "HTML to APK" wrappers
 * (including WebView-based ones like html2app.dev) don't implement
 * this popup at all, so tapping a <select> silently does nothing —
 * the dropdown never opens. This component reimplements the same
 * "pick one option" interaction entirely with our own DOM + the
 * existing openBottomSheet() component, so it's guaranteed to work
 * the same inside any WebView, with no dependency on browser chrome.
 *
 * API is kept close to a native select for easy call-site swaps:
 * the returned wrapper element exposes a `.value` getter/setter.
 */
export function createSelectField({ label, options, value, hint, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'ds-field';

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'ds-field-label';
    labelEl.textContent = label;
    wrap.appendChild(labelEl);
  }

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ds-field-input';
  trigger.style.cssText = 'background-color: var(--bg-card); cursor: pointer; display:flex; align-items:center; justify-content:space-between; gap:var(--space-2); width:100%; text-align:right; font-family:inherit; font-size:inherit; color:var(--text-primary); border:1.5px solid var(--border-soft);';

  const triggerLabel = document.createElement('span');
  triggerLabel.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
  const chevron = document.createElement('span');
  chevron.className = 'material-symbols-rounded';
  chevron.textContent = 'expand_more';
  chevron.style.cssText = 'font-size:20px; flex-shrink:0; color:var(--text-secondary);';
  trigger.append(triggerLabel, chevron);
  wrap.appendChild(trigger);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.style.cssText = 'font-size:var(--text-caption); color:var(--text-secondary); margin-top:4px; line-height:1.6;';
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }

  let currentValue = value;

  const syncLabel = () => {
    const match = options.find((o) => o.value === currentValue);
    triggerLabel.textContent = match ? match.label : (options[0] ? options[0].label : '');
  };
  syncLabel();

  trigger.addEventListener('click', () => {
    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
    options.forEach((opt) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = `
        display:flex; align-items:center; justify-content:space-between;
        width:100%; padding:12px 14px; border-radius:12px; text-align:right;
        font-family:inherit; font-size:14px; font-weight:${opt.value === currentValue ? '800' : '600'};
        color:${opt.value === currentValue ? 'var(--color-primary)' : 'var(--text-primary)'};
        background:${opt.value === currentValue ? 'var(--color-primary-soft)' : 'transparent'};
        border:1.5px solid ${opt.value === currentValue ? 'var(--color-primary)' : 'var(--border-soft)'};
        cursor:pointer;
      `;
      const txt = document.createElement('span');
      txt.textContent = opt.label;
      row.appendChild(txt);
      if (opt.value === currentValue) {
        const check = document.createElement('span');
        check.className = 'material-symbols-rounded';
        check.textContent = 'check';
        check.style.cssText = 'font-size:18px;';
        row.appendChild(check);
      }
      row.addEventListener('click', () => {
        currentValue = opt.value;
        syncLabel();
        overlay.close();
        if (onChange) onChange(currentValue);
      });
      list.appendChild(row);
    });
    const overlay = openBottomSheet({ title: label || '', content: list });
  });

  Object.defineProperty(wrap, 'value', {
    get() { return currentValue; },
    set(v) { currentValue = v; syncLabel(); },
  });

  return wrap;
}

export function createTextArea({ label, placeholder, value = '', onInput, id, rows = 4 }) {
  const wrap = document.createElement('div');
  wrap.className = 'input-wrapper';

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'input-label';
    if (id) labelEl.htmlFor = id;
    labelEl.textContent = label;
    wrap.appendChild(labelEl);
  }

  const input = document.createElement('textarea');
  input.className = 'text-area';
  input.rows = rows;
  // ~24px per line plus padding, so short fields (e.g. a one-line tags
  // field) don't render as an oversized box that wastes screen space.
  input.style.minHeight = `${Math.max(1, rows) * 24 + 16}px`;
  input.style.resize = 'vertical';
  if (id) input.id = id;
  if (placeholder) input.placeholder = placeholder;
  input.value = value;

  if (onInput) {
    input.addEventListener('input', (e) => onInput(e.target.value, e));
  }

  wrap.appendChild(input);
  wrap.input = input;
  return wrap;
}

export function createSearchBar({ placeholder, onSearch, id }) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:100%;';

  const icon = document.createElement('span');
  icon.className = 'material-symbols-rounded';
  icon.textContent = 'search';
  icon.style.cssText = 'position:absolute;right:var(--space-3);top:50%;transform:translateY(-50%);color:var(--text-secondary);';
  wrap.appendChild(icon);

  const input = document.createElement('input');
  input.className = 'text-input';
  input.style.paddingRight = '40px';
  if (id) input.id = id;
  if (placeholder) input.placeholder = placeholder;

  if (onSearch) {
    input.addEventListener('input', (e) => onSearch(e.target.value, e));
  }

  wrap.appendChild(input);
  return wrap;
}

export function createSkeletonList(count = 3) {
  const wrap = document.createElement('div');
  wrap.className = 'skeleton-list';

  for (let i = 0; i < count; i++) {
    const item = document.createElement('div');
    item.className = 'skeleton-item';
    wrap.appendChild(item);
  }

  return wrap;
}

export function createProgressBar(progress = 0) {
  const container = document.createElement('div');
  container.className = 'progress-bar';

  const fill = document.createElement('div');
  fill.className = 'progress-bar-fill';
  fill.style.width = `${Math.min(100, Math.max(0, progress))}%`;

  container.appendChild(fill);
  return container;
}

export function createProgressRing(progress = 0, radius = 24, stroke = 4) {
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, progress)) / 100) * circumference;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('height', (radius * 2).toString());
  svg.setAttribute('width', (radius * 2).toString());
  svg.style.transform = 'rotate(-90deg)';

  const circleBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circleBg.setAttribute('class', 'ds-progress-ring-bg');
  circleBg.setAttribute('stroke', 'var(--border-soft)');
  circleBg.setAttribute('fill', 'transparent');
  circleBg.setAttribute('stroke-width', stroke.toString());
  circleBg.setAttribute('r', normalizedRadius.toString());
  circleBg.setAttribute('cx', radius.toString());
  circleBg.setAttribute('cy', radius.toString());

  const circleFill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circleFill.setAttribute('class', 'ds-progress-ring-fill');
  circleFill.setAttribute('stroke', 'var(--color-primary)');
  circleFill.setAttribute('fill', 'transparent');
  circleFill.setAttribute('stroke-width', stroke.toString());
  circleFill.setAttribute('stroke-dasharray', `${circumference} ${circumference}`);
  circleFill.setAttribute('stroke-dashoffset', strokeDashoffset.toString());
  circleFill.style.transition = 'stroke-dashoffset 0.35s';
  circleFill.setAttribute('r', normalizedRadius.toString());
  circleFill.setAttribute('cx', radius.toString());
  circleFill.setAttribute('cy', radius.toString());

  svg.appendChild(circleBg);
  svg.appendChild(circleFill);

  return svg;
}

export function createLoadingInline() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:var(--space-2);color:var(--text-secondary);font-size:13px;';
  
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  spinner.style.width = '16px';
  spinner.style.height = '16px';
  spinner.style.borderWidth = '2px';
  
  const text = document.createElement('span');
  text.textContent = 'در حال پردازش...';

  wrap.appendChild(spinner);
  wrap.appendChild(text);
  return wrap;
}

export function createErrorState({ message, onRetry }) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-6);text-align:center;gap:var(--space-3);';

  const icon = document.createElement('span');
  icon.className = 'material-symbols-rounded';
  icon.textContent = 'error';
  icon.style.cssText = 'font-size:48px;color:#EF4444;';
  wrap.appendChild(icon);

  const text = document.createElement('p');
  text.style.cssText = 'font-size:14px;color:var(--text-secondary);max-width:300px;line-height:1.5;';
  text.textContent = message || 'خطایی رخ داده است.';
  wrap.appendChild(text);

  if (onRetry) {
    const btn = createButton({
      label: 'تلاش مجدد',
      variant: 'secondary',
      onClick: onRetry
    });
    wrap.appendChild(btn);
  }

  return wrap;
}

export function createEmptyState({ icon, title, desc, action }) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  if (icon) {
    const iconWrap = document.createElement('div');
    iconWrap.className = 'empty-state-icon';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'material-symbols-rounded';
    iconSpan.textContent = icon;
    iconWrap.appendChild(iconSpan);
    wrap.appendChild(iconWrap);
  }

  if (title) {
    const titleEl = document.createElement('h3');
    titleEl.className = 'empty-state-title';
    titleEl.textContent = title;
    wrap.appendChild(titleEl);
  }

  if (desc) {
    const descEl = document.createElement('p');
    descEl.className = 'empty-state-desc';
    descEl.textContent = desc;
    wrap.appendChild(descEl);
  }

  if (action) {
    wrap.appendChild(action);
  }

  return wrap;
}

// Shared HTML-escaping helpers. Previously duplicated verbatim in both
// category.js and study-session.js - kept here as the single source of
// truth so a future fix to one doesn't silently miss the other.
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function parseFractionTree(str) {
  let i = 0;
  const parts = [];

  while (i < str.length) {
    const fracIdx = str.indexOf('\\frac', i);
    if (fracIdx === -1) {
      parts.push({ type: 'text', value: str.substring(i) });
      break;
    }

    if (fracIdx > i) {
      parts.push({ type: 'text', value: str.substring(i, fracIdx) });
    }

    i = fracIdx + 5; // move past \frac

    while (i < str.length && str[i] !== '{') {
      i++;
    }
    if (i >= str.length) {
      parts.push({ type: 'text', value: '\\frac' });
      break;
    }

    const numStart = i + 1;
    let braceCount = 1;
    i++;
    while (i < str.length && braceCount > 0) {
      if (str[i] === '{') braceCount++;
      else if (str[i] === '}') braceCount--;
      i++;
    }
    if (braceCount > 0) {
      parts.push({ type: 'text', value: str.substring(fracIdx) });
      break;
    }
    const numStr = str.substring(numStart, i - 1);

    while (i < str.length && str[i] !== '{') {
      i++;
    }
    if (i >= str.length) {
      parts.push({ type: 'text', value: '\\frac{' + numStr + '}' });
      break;
    }

    const denStart = i + 1;
    braceCount = 1;
    i++;
    while (i < str.length && braceCount > 0) {
      if (str[i] === '{') braceCount++;
      else if (str[i] === '}') braceCount--;
      i++;
    }
    if (braceCount > 0) {
      parts.push({ type: 'text', value: '\\frac{' + numStr + '}{' + str.substring(denStart) });
      break;
    }
    const denStr = str.substring(denStart, i - 1);

    const numeratorNode = parseFractionTree(numStr);
    const denominatorNode = parseFractionTree(denStr);

    parts.push({
      type: 'fraction',
      numerator: numeratorNode,
      denominator: denominatorNode
    });
  }

  return parts;
}

export function getFractionHeight(parts) {
  let maxHeight = 0;
  for (const part of parts) {
    if (part.type === 'fraction') {
      const hNum = getFractionHeight(part.numerator);
      const hDen = getFractionHeight(part.denominator);
      const hFrac = Math.max(hNum, hDen) + 1;
      if (hFrac > maxHeight) {
        maxHeight = hFrac;
      }
    }
  }
  return maxHeight;
}

export function renderFractionTree(parts, parentHeight = null) {
  if (parentHeight === null) {
    parentHeight = getFractionHeight(parts);
  }

  let html = '';
  for (const part of parts) {
    if (part.type === 'text') {
      html += part.value;
    } else if (part.type === 'fraction') {
      const numHtml = renderFractionTree(part.numerator, parentHeight);
      const denHtml = renderFractionTree(part.denominator, parentHeight);

      const hNum = getFractionHeight(part.numerator);
      const hDen = getFractionHeight(part.denominator);
      const nodeHeight = Math.max(hNum, hDen) + 1;

      let lineThickness = '1.5px';
      let paddingX = '4px';
      let paddingY = '2px';
      let marginX = '4px';
      let fontSize = 'inherit';

      if (nodeHeight === 1) {
        lineThickness = '1.5px';
        paddingX = '4px';
        paddingY = '2px';
        marginX = '4px';
      } else if (nodeHeight === 2) {
        lineThickness = '2.5px';
        paddingX = '8px';
        paddingY = '4px';
        marginX = '6px';
      } else if (nodeHeight >= 3) {
        lineThickness = '3.5px';
        paddingX = '12px';
        paddingY = '6px';
        marginX = '8px';
      }

      html += `
        <span class="vertical-fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; margin: 0 ${marginX}; font-size: ${fontSize}; font-family: var(--font-mono), var(--font-sans); line-height: 1.15;">
          <span class="fraction-numerator" style="display: block; width: 100%; text-align: center; padding: 0 ${paddingX} ${paddingY} ${paddingX};">${numHtml}</span>
          <span class="fraction-line" style="display: block; height: ${lineThickness}; background: currentColor; width: 100%; min-width: 15px; border-radius: 1px;"></span>
          <span class="fraction-denominator" style="display: block; width: 100%; text-align: center; padding: ${paddingY} ${paddingX} 0 ${paddingX};">${denHtml}</span>
        </span>
      `;
    }
  }
  return html;
}

// Ordered table of LaTeX macro -> Unicode/HTML replacements. Exported so
// the AI chat renderer (js/features/pages.js) can share the exact same
// table instead of keeping its own separate, drifting copy.
export const LATEX_SYMBOL_MAP = [
  { regex: /\\mathbb\s*\{\s*R\s*\}/g, replacement: 'ℝ' },
  { regex: /\\mathbb\s*R\b/g, replacement: 'ℝ' },
  { regex: /\\mathbb\s*\{\s*N\s*\}/g, replacement: 'ℕ' },
  { regex: /\\mathbb\s*N\b/g, replacement: 'ℕ' },
  { regex: /\\mathbb\s*\{\s*Z\s*\}/g, replacement: 'ℤ' },
  { regex: /\\mathbb\s*Z\b/g, replacement: 'ℤ' },
  { regex: /\\mathbb\s*\{\s*Q\s*\}/g, replacement: 'ℚ' },
  { regex: /\\mathbb\s*Q\b/g, replacement: 'ℚ' },
  { regex: /\\mathbb\s*\{\s*C\s*\}/g, replacement: 'ℂ' },
  { regex: /\\mathbb\s*C\b/g, replacement: 'ℂ' },
  { regex: /\\mathbb\s*\{\s*([A-Za-z])\s*\}/g, replacement: '$1' },
  { regex: /\\mathbb\s*([A-Za-z])\b/g, replacement: '$1' },
  { regex: /\\emptyset/g, replacement: '∅' },
  { regex: /\\varnothing/g, replacement: '∅' },
  { regex: /\\cup/g, replacement: ' ∪ ' },
  { regex: /\\cap/g, replacement: ' ∩ ' },
  { regex: /\\in\b/g, replacement: ' ∈ ' },
  { regex: /\\notin/g, replacement: ' ∉ ' },
  { regex: /\\subseteq/g, replacement: ' ⊆ ' },
  { regex: /\\subset/g, replacement: ' ⊂ ' },
  { regex: /\\supseteq/g, replacement: ' ⊇ ' },
  { regex: /\\supset/g, replacement: ' ⊃ ' },
  { regex: /\\setminus/g, replacement: ' \\ ' },
  { regex: /\\backslash/g, replacement: '\\' },
  { regex: /\\dots/g, replacement: '…' },
  { regex: /\\ldots/g, replacement: '…' },
  { regex: /\\cdots/g, replacement: '⋯' },
  { regex: /\\vdots/g, replacement: '⋮' },
  { regex: /\\ddots/g, replacement: '⋱' },
  // Greek letters (lowercase)
  { regex: /\\alpha/g, replacement: 'α' }, { regex: /\\beta/g, replacement: 'β' },
  { regex: /\\gamma/g, replacement: 'γ' }, { regex: /\\delta/g, replacement: 'δ' },
  { regex: /\\epsilon/g, replacement: 'ε' }, { regex: /\\varepsilon/g, replacement: 'ε' },
  { regex: /\\zeta/g, replacement: 'ζ' }, { regex: /\\eta/g, replacement: 'η' },
  { regex: /\\theta/g, replacement: 'θ' }, { regex: /\\iota/g, replacement: 'ι' },
  { regex: /\\kappa/g, replacement: 'κ' }, { regex: /\\lambda/g, replacement: 'λ' },
  { regex: /\\mu/g, replacement: 'μ' }, { regex: /\\nu/g, replacement: 'ν' },
  { regex: /\\xi/g, replacement: 'ξ' }, { regex: /\\pi/g, replacement: 'π' },
  { regex: /\\rho/g, replacement: 'ρ' }, { regex: /\\sigma/g, replacement: 'σ' },
  { regex: /\\tau/g, replacement: 'τ' }, { regex: /\\upsilon/g, replacement: 'υ' },
  { regex: /\\phi/g, replacement: 'φ' }, { regex: /\\varphi/g, replacement: 'φ' },
  { regex: /\\chi/g, replacement: 'χ' }, { regex: /\\psi/g, replacement: 'ψ' },
  { regex: /\\omega/g, replacement: 'ω' },
  // Greek letters (uppercase)
  { regex: /\\Gamma/g, replacement: 'Γ' }, { regex: /\\Delta/g, replacement: 'Δ' },
  { regex: /\\Theta/g, replacement: 'Θ' }, { regex: /\\Lambda/g, replacement: 'Λ' },
  { regex: /\\Xi/g, replacement: 'Ξ' }, { regex: /\\Pi/g, replacement: 'Π' },
  { regex: /\\Sigma/g, replacement: 'Σ' }, { regex: /\\Upsilon/g, replacement: 'Υ' },
  { regex: /\\Phi/g, replacement: 'Φ' }, { regex: /\\Psi/g, replacement: 'Ψ' },
  { regex: /\\Omega/g, replacement: 'Ω' },
  { regex: /\\infty/g, replacement: '∞' },
  { regex: /\\neq/g, replacement: '≠' }, { regex: /\\ne\b/g, replacement: '≠' },
  { regex: /\\leq/g, replacement: '≤' }, { regex: /\\le\b/g, replacement: '≤' },
  { regex: /\\geq/g, replacement: '≥' }, { regex: /\\ge\b/g, replacement: '≥' },
  { regex: /\\ll/g, replacement: '≪' }, { regex: /\\gg/g, replacement: '≫' },
  { regex: /\\times/g, replacement: '×' },
  { regex: /\\div/g, replacement: '÷' },
  { regex: /\\pm/g, replacement: '±' }, { regex: /\\mp/g, replacement: '∓' },
  { regex: /\\cdot/g, replacement: '·' }, { regex: /\\ast/g, replacement: '∗' },
  { regex: /\\circ/g, replacement: '∘' }, { regex: /\\bullet/g, replacement: '•' },
  { regex: /\\Leftrightarrow|\\iff/g, replacement: '⇔' },
  { regex: /\\Rightarrow|\\implies/g, replacement: '⇒' },
  { regex: /\\Leftarrow/g, replacement: '⇐' },
  { regex: /\\leftrightarrow/g, replacement: '↔' },
  { regex: /\\rightarrow|\\to\b/g, replacement: '→' },
  { regex: /\\leftarrow/g, replacement: '←' },
  { regex: /\\mapsto/g, replacement: '↦' },
  { regex: /\\forall/g, replacement: '∀' },
  { regex: /\\exists/g, replacement: '∃' },
  { regex: /\\nexists/g, replacement: '∄' },
  { regex: /\\therefore/g, replacement: '∴' },
  { regex: /\\because/g, replacement: '∵' },
  { regex: /\\approx/g, replacement: '≈' },
  { regex: /\\equiv/g, replacement: '≡' },
  { regex: /\\sim\b/g, replacement: '∼' },
  { regex: /\\cong/g, replacement: '≅' },
  { regex: /\\propto/g, replacement: '∝' },
  { regex: /\\perp/g, replacement: '⊥' },
  { regex: /\\parallel/g, replacement: '∥' },
  { regex: /\\angle/g, replacement: '∠' },
  { regex: /\\triangle/g, replacement: '△' },
  { regex: /\\sum/g, replacement: '∑' },
  { regex: /\\prod/g, replacement: '∏' },
  { regex: /\\int/g, replacement: '∫' },
  { regex: /\\oint/g, replacement: '∮' },
  { regex: /\\partial/g, replacement: '∂' },
  { regex: /\\nabla/g, replacement: '∇' },
  { regex: /\\langle/g, replacement: '⟨' }, { regex: /\\rangle/g, replacement: '⟩' },
  { regex: /\\lceil/g, replacement: '⌈' }, { regex: /\\rceil/g, replacement: '⌉' },
  { regex: /\\lfloor/g, replacement: '⌊' }, { regex: /\\rfloor/g, replacement: '⌋' },
  { regex: /\\quad/g, replacement: '  ' },
  { regex: /\\qquad/g, replacement: '    ' },
  { regex: /\\,/g, replacement: ' ' },
  { regex: /\\;/g, replacement: '  ' },
  { regex: /\\:/g, replacement: ' ' },
  { regex: /\\!/g, replacement: '' },
  { regex: /\\[ ]/g, replacement: ' ' },
  { regex: /\\mid\b/g, replacement: ' | ' },
  // \left / \right size-modifiers just carry the bracket itself in flashcard text
  { regex: /\\left\(/g, replacement: '(' }, { regex: /\\right\)/g, replacement: ')' },
  { regex: /\\left\[/g, replacement: '[' }, { regex: /\\right\]/g, replacement: ']' },
  { regex: /\\left\\\{/g, replacement: '&#123;' }, { regex: /\\right\\\}/g, replacement: '&#125;' },
  { regex: /\\left\|/g, replacement: '|' }, { regex: /\\right\|/g, replacement: '|' },
  { regex: /\\left\./g, replacement: '' }, { regex: /\\right\./g, replacement: '' },
  { regex: /\\left|\\right/g, replacement: '' },
  { regex: /\\\{/g, replacement: '&#123;' }, { regex: /\\\}/g, replacement: '&#125;' },
  { regex: /\\color\s*\{([^}]*)\}/g, replacement: '<span style="color:$1;">' },
  { regex: /\\textcolor\s*\{([^}]*)\}\s*\{([^}]*)\}/g, replacement: '<span style="color:$1;">$2</span>' },
  // Upright function names (sin, cos, log, lim, ...) — just drop the backslash,
  // the surrounding text is already upright in this design.
  { regex: /\\(sin|cos|tan|cot|sec|csc|log|ln|lim|exp|min|max|gcd|lcm|det|dim|arg|sup|inf)\b/g, replacement: '$1' },
  { regex: /\\text\s*\{([^}]*)\}/g, replacement: '$1' },
  { regex: /\\mathrm\s*\{([^}]*)\}/g, replacement: '$1' },
  { regex: /\\mathcal\s*\{([^}]*)\}/g, replacement: '$1' },
  { regex: /\\mathscr\s*\{([^}]*)\}/g, replacement: '$1' },
  { regex: /\\mathsf\s*\{([^}]*)\}/g, replacement: '$1' },
  { regex: /\\mathbf\s*\{([^}]*)\}/g, replacement: '<b>$1</b>' },
  { regex: /\\textit\s*\{([^}]*)\}/g, replacement: '<i>$1</i>' },
  { regex: /\\textbf\s*\{([^}]*)\}/g, replacement: '<b>$1</b>' },
  { regex: /\\mathit\s*\{([^}]*)\}/g, replacement: '<i>$1</i>' },
  { regex: /\\vec\s*\{([^}]*)\}/g, replacement: '<span style="text-decoration:overline;">$1</span>' },
  { regex: /\\overline\s*\{([^}]*)\}/g, replacement: '<span style="text-decoration:overline;">$1</span>' },
  { regex: /\\hat\s*\{([^}]*)\}/g, replacement: '$1&#770;' },
  { regex: /\\bar\s*\{([^}]*)\}/g, replacement: '<span style="text-decoration:overline;">$1</span>' },
  { regex: /\\binom\s*\{([^}]*)\}\s*\{([^}]*)\}/g, replacement: '<span style="display:inline-flex; flex-direction:column; vertical-align:middle; font-size:0.9em; line-height:1.05; margin:0 2px;"><span>($1</span><span>$2)</span></span>' },
];

/**
 * Renders LaTeX-ish superscripts/subscripts/roots and the general
 * symbol table onto a chunk of math text (the content that was found
 * inside a $...$ / $$...$$ delimiter, or a bare \frac{}{} expression).
 * Intentionally a lightweight, dependency-free subset renderer (not a
 * full LaTeX engine) so it needs no external library and no network
 * access — important since the APK build has no bundler/CDN access
 * guarantee. It covers the constructs a flashcard-generation AI
 * realistically produces: fractions, exponents/indices, roots, set &
 * relation symbols, Greek letters, intervals (which are just plain
 * characters and need no special handling), and common functions.
 */
export function renderMathSegment(mathText) {
  let out = mathText;

  // Roots: \sqrt[n]{x} and \sqrt{x} (non-nested arguments — covers the
  // overwhelming majority of flashcard content).
  out = out.replace(/\\sqrt\[([^[\]]*)\]\{([^{}]*)\}/g, (m, idx, content) =>
    `<span style="white-space:nowrap;"><sup style="font-size:0.65em;">${idx}</sup>√<span style="border-top:1.5px solid currentColor; padding:0 3px;">${content}</span></span>`
  );
  out = out.replace(/\\sqrt\{([^{}]*)\}/g, (m, content) =>
    `√<span style="border-top:1.5px solid currentColor; padding:0 3px;">${content}</span>`
  );

  // Fractions (recursive, produces the nice vertical-stack HTML).
  if (out.includes('\\frac')) {
    out = renderFractionTree(parseFractionTree(out));
  }

  // Superscript / subscript — braced group or single character.
  out = out.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>');
  out = out.replace(/\^([A-Za-z0-9+\-])/g, '<sup>$1</sup>');
  out = out.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
  out = out.replace(/_([A-Za-z0-9+\-])/g, '<sub>$1</sub>');

  // General symbol table.
  for (const { regex, replacement } of LATEX_SYMBOL_MAP) {
    out = out.replace(regex, replacement);
  }

  // Any leftover, unrecognized \command — strip the backslash so at
  // least the word remains readable instead of a raw backslash.
  out = out.replace(/\\([A-Za-z]+)/g, '$1');
  // Leftover bare grouping braces that weren't consumed by a command.
  out = out.replace(/[{}]/g, '');

  return out;
}

/**
 * Public entry point. Finds $$...$$ / $...$ math delimiters in the
 * given (already HTML-escaped) text and renders their contents via
 * renderMathSegment(); also handles the legacy case of bare
 * \frac{}{} appearing with no $ delimiters at all, for text saved
 * before this renderer existed. Everything outside math delimiters is
 * left untouched (it was already escaped by the caller).
 */
export function renderFractionsInText(text) {
  if (!text) return text;
  const hasDelimiters = /\$/.test(text);
  const hasBareLatex = /\\(frac|sqrt|cup|cap|leq|geq|neq|infty|sum|int|alpha|beta|theta|pi|sigma)/.test(text);
  if (!hasDelimiters && !hasBareLatex) return text;

  try {
    let out = text;
    // Block math: $$ ... $$
    out = out.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (m, math) =>
      `<div style="text-align:center; margin: var(--space-2) 0; direction:ltr;">${renderMathSegment(math.trim())}</div>`
    );
    // Inline math: $ ... $
    out = out.replace(/\$([^$]+?)\$/g, (m, math) =>
      `<span style="direction:ltr; display:inline-block;">${renderMathSegment(math.trim())}</span>`
    );
    // Legacy/fallback: bare LaTeX with no $ delimiters at all.
    if (/\\(frac|sqrt|cup|cap|leq|geq|neq|infty|sum|int|alpha|beta|theta|pi|sigma)/.test(out)) {
      out = renderMathSegment(out);
    }
    return out;
  } catch (err) {
    console.warn('Error rendering math in text:', err);
    return text;
  }
}
