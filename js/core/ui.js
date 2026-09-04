
import katex from 'katex';

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
      bottom: calc(96px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
      transform: translateX(-50%) translateY(16px) scale(0.95);
      max-width: min(92vw, 420px);
      background: color-mix(in srgb, var(--text-primary) 90%, transparent);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: var(--bg-primary);
      padding: 12px 20px;
      border-radius: 16px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1.6;
      text-align: center;
      box-shadow: var(--shadow-md);
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      pointer-events: none;
    `;
    document.body.appendChild(toastEl);
  }

  const colors = {
    error: 'var(--color-danger)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    info: 'color-mix(in srgb, var(--text-primary) 90%, transparent)'
  };
  toastEl.style.background = colors[type] || colors.info;
  toastEl.textContent = message;

  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateX(-50%) translateY(0) scale(1)';
  });

  toastTimer = setTimeout(() => {
    if (!toastEl) return;
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(-50%) translateY(16px) scale(0.95)';
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
    titleEl.style.cssText = 'font-size:17px;font-weight:600;letter-spacing:-0.01em;margin-bottom:var(--space-1);color:var(--text-primary);';
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
    titleEl.style.cssText = 'font-size:20px;font-weight:600;letter-spacing:-0.01em;margin-bottom:var(--space-4);color:var(--text-primary);display:flex;align-items:center;gap:var(--space-2);';
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

  let actionInFlight = false;

  actions.forEach(action => {
    const btn = createButton({
      label: action.label,
      variant: action.variant || 'secondary',
      onClick: async (e) => {
        if (actionInFlight) return;
        if (action.onClick) {
          actionInFlight = true;
          actionsEl.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          try {
            const result = await action.onClick(e);
            if (result === false || action.keepOpen) {
              actionInFlight = false;
              actionsEl.querySelectorAll('button').forEach((b) => { b.disabled = false; });
              return;
            }
          } catch (err) {
            console.error('Dialog action failed', err);
            actionInFlight = false;
            actionsEl.querySelectorAll('button').forEach((b) => { b.disabled = false; });
            showToast('خطایی رخ داد. دوباره تلاش کنید.', 'error');
            return;
          }
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
    titleEl.style.cssText = 'font-size:20px;font-weight:600;letter-spacing:-0.01em;margin-bottom:var(--space-5);color:var(--text-primary);display:flex;align-items:center;gap:var(--space-2);';
    titleEl.innerHTML = title;
    sheet.appendChild(titleEl);
  }

  const bodyEl = document.createElement('div');
  bodyEl.className = 'bs-content';
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
 * WHY: native <select> popups rely on the device's own UI
 * to render the options list.
 * Some devices don't implement
 * this popup at all, so tapping a <select> silently does nothing —
 * the dropdown never opens. This component reimplements the same
 * "pick one option" interaction entirely with our own DOM + the
 * existing openBottomSheet() component, so it's guaranteed to work
 * the same on any device.
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

export function createLoadingInline(customText) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:var(--space-2);color:var(--text-secondary);font-size:13px;';
  
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  spinner.style.width = '16px';
  spinner.style.height = '16px';
  spinner.style.borderWidth = '2px';
  
  wrap.appendChild(spinner);

  if (customText !== null) {
    const text = document.createElement('span');
    text.textContent = customText || 'در حال پردازش...';
    wrap.appendChild(text);
  }
  
  return wrap;
}

export function createTypingIndicator() {
  const wrap = document.createElement('div');
  wrap.className = 'typing-indicator';
  
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.className = 'typing-dot';
    wrap.appendChild(dot);
  }
  
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

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/**
 * KaTeX-based math + light Markdown renderer.
 *
 * Replaces the previous lightweight regex/symbol-table renderer which
 * could only handle a small subset of LaTeX and fell back to stripping
 * the leading backslash from unknown commands (turning
 * \leftrightharpoons into the literal text "leftrightharpoons").
 *
 * Security: KaTeX does not execute JavaScript from the input. We keep
 * trust:false and throwOnError:false so unknown/unsupported commands
 * degrade gracefully instead of breaking the whole message.
 * Markdown transformations never introduce raw HTML from user/AI content
 * beyond the safe tags we emit ourselves.
 */

const KATEX_OPTIONS_BASE = {
  throwOnError: false,
  strict: 'ignore',
  trust: false,
  output: 'html',
  // Aliases for commands the AI (or users) sometimes write that aren't valid
  // KaTeX/LaTeX on their own, so they degrade to a working symbol instead of
  // leaking as raw, glued-together command text (e.g. "mboxBoxText").
  macros: {
    '\\mbox': '\\text',           // \mbox isn't in KaTeX; \text behaves the same for our use
    '\\leftharpoons': '\\leftharpoonup',   // not a real LaTeX command; closest single-barb harpoon
    '\\rightharpoons': '\\rightharpoonup',
    '\\cancelto': '\\overset{#1}{\\cancel{#2}}',
  },
};

/**
 * Render a single math segment (content that was inside $...$ or $$...$$).
 * Returns an HTML string. Falls back to a monospace escaped version if
 * KaTeX is unavailable or throws.
 */
export function renderMathSegment(mathText, displayMode = false) {
  const raw = String(mathText || '').trim();
  if (!raw) return '';

  // Use the imported KaTeX module or fallback to global window.katex
  const katexLib = katex || (typeof window !== 'undefined' && window.katex) || (typeof globalThis !== 'undefined' && globalThis.katex);
  if (!katexLib || typeof katexLib.renderToString !== 'function') {
    // Last-resort: keep the LaTeX readable, never throw.
    return `<span class="math-fallback" style="direction:ltr; font-family:var(--font-mono); white-space:pre-wrap;">${escapeHtml(raw)}</span>`;
  }

  try {
    return katexLib.renderToString(raw, {
      ...KATEX_OPTIONS_BASE,
      displayMode: !!displayMode,
    });
  } catch (err) {
    console.warn('KaTeX render error:', err);
    return `<span class="math-fallback" style="direction:ltr; font-family:var(--font-mono); white-space:pre-wrap; color:var(--text-secondary);">${escapeHtml(raw)}</span>`;
  }
}

function htmlUnescape(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

/**
 * Apply a carefully limited set of Markdown transforms on already-escaped text.
 * Math placeholders (@@MATH0@@ etc.) must already be protected.
 * Only emits safe HTML tags that we control.
 */
function applyLightMarkdown(escapedText) {
  let s = escapedText;

  // Fenced code blocks ```...```
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => {
    const clean = code.replace(/^\n+|\n+$/g, '');
    return `<pre><code>${clean}</code></pre>`;
  });

  // Inline code `...`
  s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

  // Bold **text** or __text__
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');

  // Italic *text* or _text_ (avoid matching already-bold)
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>');

  // Links – only http/https
  s = s.replace(/\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Headings
  s = s.replace(/(^|<br>)###\s+(.+?)(?=<br>|$)/g, '$1<h4>$2</h4>');
  s = s.replace(/(^|<br>)##\s+(.+?)(?=<br>|$)/g, '$1<h3>$2</h3>');
  s = s.replace(/(^|<br>)#\s+(.+?)(?=<br>|$)/g, '$1<h2>$2</h2>');

  // Blockquotes: > text
  s = s.replace(/(^|<br>)&gt;\s+(.+?)(?=<br>|$)/g, '$1<blockquote>$2</blockquote>');

  // Horizontal rule
  s = s.replace(/(^|<br>)(---|\*\*\*|___)\s*(?=<br>|$)/g, '$1<hr style="border:none;border-top:1px solid var(--border-strong);margin:12px 0;">');

  // Unordered lists (- or *)
  s = s.replace(/(^|<br>)[\-\*]\s+(.+?)(?=<br>|$)/g, '$1<li data-list="ul">$2</li>');
  // Ordered lists (1. 2. ...)
  s = s.replace(/(^|<br>)\d+\.\s+(.+?)(?=<br>|$)/g, '$1<li data-list="ol">$2</li>');

  // Group consecutive <li> of the same type into <ul> / <ol>
  s = s.replace(/(?:<li data-list="(ul|ol)">.*?<\/li>(?:<br>)?)+/g, (block) => {
    const type = block.includes('data-list="ol"') ? 'ol' : 'ul';
    const items = block
      .replace(/ data-list="(ul|ol)"/g, '')
      .replace(/<br>/g, '');
    return `<${type}>${items}</${type}>`;
  });

  return s;
}

/**
 * Public entry point used throughout the app.
 *
 * Input is expected to be the already HTML-escaped text (callers typically do
 *   renderFractionsInText(escapeHtml(text).replace(/\n/g, '<br>'))
 * ).
 *
 * Pipeline:
 *  1. Protect & render $$...$$ and $...$ math blocks (KaTeX).
 *  2. Apply light Markdown on the remaining escaped text.
 *  3. Support legacy bare \frac / \sqrt etc. for old saved cards.
 *
 * Unknown LaTeX never crashes the UI; Markdown never injects unsafe HTML.
 */
export function renderFractionsInText(text) {
  if (!text) return text;

  // If the input is already structured HTML (produced by renderMarkdownAndMath
  // or similar), do NOT run bare-LaTeX / markdown passes on the whole string —
  // that would destroy tags and surface them as visible text.
  // We ignore <br> because renderRichText injects it.
  const textWithoutBr = text.replace(/<br>/gi, '\n');
  const looksLikeHtml = /<\/?[a-zA-Z][^>]*>/.test(textWithoutBr) || textWithoutBr.includes('class="') || textWithoutBr.includes("class='");
  const hasDelimiters = /\$/.test(text);
  const hasBareLatex = !looksLikeHtml && /\\(displaystyle|cancelto|frac|sqrt|sum|int|prod|lim|alpha|beta|theta|pi|sigma|infty|left|right|begin|end|text|mathrm|mathbf|mathbb|partial|nabla|forall|exists|in|notin|subset|cup|cap|emptyset|rightarrow|leftarrow|mapsto|leftrightharpoons|rightleftharpoons)/.test(text);
  const hasMarkdown = !looksLikeHtml && /(\*\*|__|`|# |\n[\-\*] |\n\d+\. |\[.+?\]\(https?:|&gt; |---|```)/.test(textWithoutBr);

  if (!hasDelimiters && !hasBareLatex && !hasMarkdown) return text;

  try {
    const placeholders = [];
    let out = text;

    // 1) Display math $$ ... $$
    out = out.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (m, math) => {
      const mathRaw = math.replace(/<br>/gi, '\n').trim();
      // Skip if this region already sits inside a rendered HTML tag attribute mess
      if (looksLikeHtml && /[<>]/.test(mathRaw)) return m;
      const rendered = renderMathSegment(htmlUnescape(mathRaw), true);
      const token = `@@MATH${placeholders.length}@@`;
      placeholders.push(`<div class="katex-display-wrapper">${rendered}</div>`);
      return token;
    });

    // 2) Inline math $ ... $
    out = out.replace(/\$([^$]+?)\$/g, (m, math) => {
      if (math.includes('class="katex"') || math.includes('@@MATH')) return m;
      const mathRaw = math.replace(/<br>/gi, '\n').trim();
      if (looksLikeHtml && /[<>]/.test(mathRaw)) return m;
      const rendered = renderMathSegment(htmlUnescape(mathRaw), false);
      const token = `@@MATH${placeholders.length}@@`;
      placeholders.push(`<span class="katex-inline-wrapper">${rendered}</span>`);
      return token;
    });

    // 3) Light Markdown only on non-HTML plain text
    if (!looksLikeHtml) {
      out = applyLightMarkdown(out);
    }

    // 4) Legacy bare LaTeX only on plain (non-HTML) text
    if (!looksLikeHtml && /\\(displaystyle|cancelto|frac|sqrt|sum|int|begin|left|text|mathbb)/.test(out) && !out.includes('class="katex"')) {
      out = renderMathSegment(htmlUnescape(out), false);
    }

    // 5) Restore math placeholders
    placeholders.forEach((html, i) => {
      out = out.replace(`@@MATH${i}@@`, html);
    });

    return out;
  } catch (err) {
    console.warn('Error rendering rich text / math:', err);
    return text;
  }
}


/**
 * Convenience helper for AI responses and other raw text.
 * Accepts unescaped plain text, does escape + newlines + math + light Markdown.
 * Prefer this for new code instead of manually chaining escapeHtml + replace + renderFractionsInText.
 */
export function renderRichText(rawText) {
  if (rawText == null || rawText === '') return '';
  const escaped = escapeHtml(String(rawText)).replace(/\n/g, '<br>');
  const html = renderFractionsInText(escaped);
  // Wrap so CSS rules under .rich-text can style headings, lists, code, etc.
  return `<div class="rich-text">${html}</div>`;
}
