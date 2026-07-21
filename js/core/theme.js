import { db } from './db.js';

const ACCENTS = ['blue', 'violet', 'teal', 'amber', 'rose', 'slate'];
const FONT_SCALES = ['sm', 'md', 'lg'];
const CONTRAST_MODES = ['none', 'high-contrast-light', 'high-contrast-dark'];
const FONT_TARGETS = ['heading', 'body', 'mono'];

let mediaQuery = null;
let mediaListener = null;

function resolveTheme(mode) {
  if (mode === 'auto') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
  return mode === 'dark' ? 'dark' : 'light';
}

function applyAccentClass(accent) {
  ACCENTS.forEach((a) => document.documentElement.classList.remove(`accent-${a}`));
  if (accent && accent !== 'blue') {
    document.documentElement.classList.add(`accent-${accent}`);
  }
}

function applyFontScaleClass(scale) {
  FONT_SCALES.forEach((s) => document.documentElement.classList.remove(`font-scale-${s}`));
  document.documentElement.classList.add(`font-scale-${FONT_SCALES.includes(scale) ? scale : 'md'}`);
}

function applyReducedMotionClass(pref) {
  document.documentElement.classList.remove('reduce-motion', 'motion-force-on');
  if (pref === 'on') {
    document.documentElement.classList.add('reduce-motion');
  } else if (pref === 'off') {
    document.documentElement.classList.add('motion-force-on');
  }
  // pref === 'system' (default): neither class, CSS media query decides.
}

function applyContrastMode(contrast) {
  if (!contrast || contrast === 'none') {
    document.documentElement.removeAttribute('data-contrast');
  } else if (CONTRAST_MODES.includes(contrast)) {
    document.documentElement.setAttribute('data-contrast', contrast);
  }
}

async function applyCustomFonts() {
  let styleEl = document.getElementById('custom-fonts-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'custom-fonts-style';
    document.head.appendChild(styleEl);
  }
  
  let cssText = '';
  
  for (const target of FONT_TARGETS) {
    const fontDataUrl = await db.getSetting(`custom_font_${target}`);
    if (fontDataUrl) {
      const familyName = `CustomFont${target.charAt(0).toUpperCase() + target.slice(1)}`;
      cssText += `
        @font-face {
          font-family: '${familyName}';
          src: url('${fontDataUrl}');
          font-display: swap;
        }
        :root {
          --font-${target}: '${familyName}', sans-serif !important;
        }
      `;
    }
  }
  
  styleEl.textContent = cssText;
}

export const theme = {
  async initTheme() {
    const mode = await db.getSetting('theme_mode', 'light');
    const resolved = resolveTheme(mode);
    document.documentElement.setAttribute('data-theme', resolved);
    this.updateIcon(resolved);
    this._watchSystemTheme(mode);

    const accent = await db.getSetting('accent_color', 'blue');
    applyAccentClass(accent);

    const fontScale = await db.getSetting('font_scale', 'md');
    applyFontScaleClass(fontScale);

    const reducedMotion = await db.getSetting('reduced_motion', 'system');
    applyReducedMotionClass(reducedMotion);
    
    const contrastMode = await db.getSetting('contrast_mode', 'none');
    applyContrastMode(contrastMode);

    await applyCustomFonts();

    return resolved;
  },

  // Quick toggle (topbar button): flips light/dark directly and opts out
  // of "auto" mode, since an explicit tap means the person wants that
  // exact theme right now, not the system default.
  async toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    await db.setSetting('theme_mode', next);
    this._watchSystemTheme(next);
    this.updateIcon(next);
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { mode: next } }));
    return next;
  },

  // Explicit 3-way setter used by Settings > Appearance (light/dark/auto).
  async setThemeMode(mode) {
    const resolved = resolveTheme(mode);
    document.documentElement.setAttribute('data-theme', resolved);
    await db.setSetting('theme_mode', mode);
    this._watchSystemTheme(mode);
    this.updateIcon(resolved);
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { mode } }));
    return resolved;
  },

  async getThemeMode() {
    return db.getSetting('theme_mode', 'light');
  },

  _watchSystemTheme(mode) {
    if (mediaQuery && mediaListener) {
      mediaQuery.removeEventListener('change', mediaListener);
      mediaQuery = null;
      mediaListener = null;
    }
    if (mode === 'auto' && window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaListener = (e) => {
        const resolved = e.matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', resolved);
        this.updateIcon(resolved);
      };
      mediaQuery.addEventListener('change', mediaListener);
    }
  },

  updateIcon(currentTheme) {
    const iconEl = document.getElementById('theme-icon');
    if (iconEl) {
      iconEl.textContent = currentTheme === 'dark' ? 'light_mode' : 'dark_mode';
    }
  },

  // --- Accent color ---
  accents: ACCENTS,
  async getAccent() {
    return db.getSetting('accent_color', 'blue');
  },
  async setAccent(accent) {
    const value = ACCENTS.includes(accent) ? accent : 'blue';
    applyAccentClass(value);
    await db.setSetting('accent_color', value);
    return value;
  },

  // --- Font size scale ---
  fontScales: FONT_SCALES,
  async getFontScale() {
    return db.getSetting('font_scale', 'md');
  },
  async setFontScale(scale) {
    applyFontScaleClass(scale);
    await db.setSetting('font_scale', scale);
    return scale;
  },

  // --- Reduced motion: 'system' | 'on' | 'off' ---
  async getReducedMotion() {
    return db.getSetting('reduced_motion', 'system');
  },
  async setReducedMotion(pref) {
    applyReducedMotionClass(pref);
    await db.setSetting('reduced_motion', pref);
    return pref;
  },

  // --- Contrast Mode ---
  contrastModes: CONTRAST_MODES,
  async getContrastMode() {
    return db.getSetting('contrast_mode', 'none');
  },
  async setContrastMode(mode) {
    const value = CONTRAST_MODES.includes(mode) ? mode : 'none';
    applyContrastMode(value);
    await db.setSetting('contrast_mode', value);
    return value;
  },
  
  // --- Custom Fonts ---
  async setCustomFont(target, dataUrl) {
    if (FONT_TARGETS.includes(target)) {
      await db.setSetting(`custom_font_${target}`, dataUrl);
      await applyCustomFonts();
    }
  },
  async resetCustomFont(target) {
    if (FONT_TARGETS.includes(target)) {
      await db.deleteSetting(`custom_font_${target}`);
      await applyCustomFonts();
    }
  }
};
