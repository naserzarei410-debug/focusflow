import { db } from './db.js';
import { syncSystemBars } from './system-bars.js';

const ACCENTS = ['blue', 'violet', 'teal', 'amber', 'rose', 'slate'];
const FONT_SCALES = ['sm', 'md', 'lg'];
const CONTRAST_MODES = ['none', 'high-contrast-light', 'high-contrast-dark'];
const FONT_TARGETS = ['heading', 'body', 'mono'];

export const CUSTOM_PALETTES = [
  {
    id: 'palette1',
    name: 'عنابی و قهوه‌ای گرم',
    colors: ['#1F1D20', '#382C2C', '#3E3D38', '#A79986', '#803E2F'],
    vars: {
      '--bg-primary': '#1F1D20',
      '--bg-secondary': '#151316',
      '--bg-card': '#382C2C',
      '--bg-elevated': '#3E3D38',
      '--bg-sunken': '#100f11',
      '--border-strong': '#462427',
      '--border-soft': '#3E3D38',
      '--border-subtle': 'rgba(62,61,56,0.5)',
      '--text-primary': '#A79986',
      '--text-secondary': 'rgba(167, 153, 134, 0.7)',
      '--color-primary': '#803E2F',
      '--color-primary-hover': '#914F40',
      '--text-on-primary': '#1F1D20'
    }
  },
  {
    id: 'palette2',
    name: 'سبز زیتونی',
    colors: ['#1B2727', '#3C5148', '#688E4E', '#B2C582', '#D5DDDF'],
    vars: {
      '--bg-primary': '#1B2727',
      '--bg-secondary': '#151F1F',
      '--bg-card': '#3C5148',
      '--bg-elevated': '#4A6158',
      '--bg-sunken': '#111818',
      '--border-strong': '#688E4E',
      '--border-soft': '#3C5148',
      '--border-subtle': 'rgba(60, 81, 72, 0.5)',
      '--text-primary': '#D5DDDF',
      '--text-secondary': '#B2C582',
      '--color-primary': '#688E4E',
      '--color-primary-hover': '#7A9F5E',
      '--text-on-primary': '#1B2727'
    }
  },
  {
    id: 'palette3',
    name: 'آبی کلاسیک',
    colors: ['#021024', '#052659', '#5483B3', '#7DA0C4', '#C1E8FF'],
    vars: {
      '--bg-primary': '#021024',
      '--bg-secondary': '#010A1A',
      '--bg-card': '#052659',
      '--bg-elevated': '#073273',
      '--bg-sunken': '#01050F',
      '--border-strong': '#5483B3',
      '--border-soft': '#052659',
      '--border-subtle': 'rgba(5, 38, 89, 0.5)',
      '--text-primary': '#C1E8FF',
      '--text-secondary': '#7DA0C4',
      '--color-primary': '#5483B3',
      '--color-primary-hover': '#6696C7',
      '--text-on-primary': '#021024'
    }
  },
  {
    id: 'palette4',
    name: 'زیتونی تیره و خاکستری',
    colors: ['#101511', '#101916', '#222922', '#3D4633', '#717476'],
    vars: {
      '--bg-primary': '#101511',
      '--bg-secondary': '#0A0D0A',
      '--bg-card': '#222922',
      '--bg-elevated': '#2E382E',
      '--bg-sunken': '#050705',
      '--border-strong': '#3D4633',
      '--border-soft': '#222922',
      '--border-subtle': 'rgba(34, 41, 34, 0.5)',
      '--text-primary': '#FFFFFF',
      '--text-secondary': '#717476',
      '--color-primary': '#717476',
      '--color-primary-hover': '#868A8D',
      '--text-on-primary': '#101511'
    }
  },
  {
    id: 'palette5',
    name: 'شرابی و کرم',
    colors: ['#252B2B', '#380F17', '#8F0B13', '#4C4F54', '#EFDFC5'],
    vars: {
      '--bg-primary': '#252B2B',
      '--bg-secondary': '#1D2121',
      '--bg-card': '#380F17',
      '--bg-elevated': '#4F1520',
      '--bg-sunken': '#151818',
      '--border-strong': '#4C4F54',
      '--border-soft': '#380F17',
      '--border-subtle': 'rgba(56, 15, 23, 0.5)',
      '--text-primary': '#EFDFC5',
      '--text-secondary': 'rgba(239, 223, 197, 0.7)',
      '--color-primary': '#8F0B13',
      '--color-primary-hover': '#A60D17',
      '--text-on-primary': '#EFDFC5'
    }
  },
  {
    id: 'palette6',
    name: 'شکلاتی و بژ',
    colors: ['#291C0E', '#6E473B', '#A78D78', '#BEB5A9', '#E1D4C2'],
    vars: {
      '--bg-primary': '#291C0E',
      '--bg-secondary': '#1D1309',
      '--bg-card': '#6E473B',
      '--bg-elevated': '#865546',
      '--bg-sunken': '#120C06',
      '--border-strong': '#A78D78',
      '--border-soft': '#6E473B',
      '--border-subtle': 'rgba(110, 71, 59, 0.5)',
      '--text-primary': '#E1D4C2',
      '--text-secondary': '#BEB5A9',
      '--color-primary': '#A78D78',
      '--color-primary-hover': '#BA9F8A',
      '--text-on-primary': '#291C0E'
    }
  },
  {
    id: 'palette7',
    name: 'زمردی و نعنایی',
    colors: ['#051F20', '#163832', '#235347', '#8EB69B', '#DAF1DE'],
    vars: {
      '--bg-primary': '#051F20',
      '--bg-secondary': '#0B2B26',
      '--bg-card': '#163832',
      '--bg-elevated': '#1F4F46',
      '--bg-sunken': '#020C0C',
      '--border-strong': '#235347',
      '--border-soft': '#163832',
      '--border-subtle': 'rgba(22, 56, 50, 0.5)',
      '--text-primary': '#DAF1DE',
      '--text-secondary': '#8EB69B',
      '--color-primary': '#8EB69B',
      '--color-primary-hover': '#A1C7AE',
      '--text-on-primary': '#051F20'
    }
  },
  {
    id: 'palette8',
    name: 'سبز آبی و لیمویی',
    colors: ['#062223', '#418B7E', '#4E977A', '#7AB37C', '#F7F4D1'],
    vars: {
      '--bg-primary': '#062223',
      '--bg-secondary': '#041718',
      '--bg-card': '#418B7E',
      '--bg-elevated': '#4C9F91',
      '--bg-sunken': '#020B0C',
      '--border-strong': '#4E977A',
      '--border-soft': '#418B7E',
      '--border-subtle': 'rgba(65, 139, 126, 0.5)',
      '--text-primary': '#F7F4D1',
      '--text-secondary': 'rgba(247, 244, 209, 0.7)',
      '--color-primary': '#7AB37C',
      '--color-primary-hover': '#8EC290',
      '--text-on-primary': '#062223'
    }
  },
  {
    id: 'palette9',
    name: 'نارنجی و سرمه‌ای',
    colors: ['#263056', '#181E36', '#AA8173', '#F19035', '#FDB78E'],
    vars: {
      '--bg-primary': '#263056',
      '--bg-secondary': '#181E36',
      '--bg-card': '#AA8173',
      '--bg-elevated': '#C39382',
      '--bg-sunken': '#0E111F',
      '--border-strong': '#AA8173',
      '--border-soft': '#181E36',
      '--border-subtle': 'rgba(24, 30, 54, 0.5)',
      '--text-primary': '#FDB78E',
      '--text-secondary': '#DAC7C0',
      '--color-primary': '#F19035',
      '--color-primary-hover': '#F3A154',
      '--text-on-primary': '#263056'
    }
  },
  {
    id: 'palette10',
    name: 'آبی فولادی',
    colors: ['#263A47', '#4A5B6A', '#728495', '#98A9BE', '#B4C5D8'],
    vars: {
      '--bg-primary': '#263A47',
      '--bg-secondary': '#1C2B36',
      '--bg-card': '#4A5B6A',
      '--bg-elevated': '#5C7183',
      '--bg-sunken': '#121C23',
      '--border-strong': '#728495',
      '--border-soft': '#4A5B6A',
      '--border-subtle': 'rgba(74, 91, 106, 0.5)',
      '--text-primary': '#B4C5D8',
      '--text-secondary': '#98A9BE',
      '--color-primary': '#98A9BE',
      '--color-primary-hover': '#ABC0D6',
      '--text-on-primary': '#263A47'
    }
  }
];

export const THEME_GROUPS = [
  { id: 'background', label: 'پس‌زمینه اصلی', vars: ['--bg-primary', '--bg-secondary', '--bg-sunken'] },
  { id: 'surface', label: 'پنل‌ها و کارت‌ها', vars: ['--bg-card', '--bg-elevated'] },
  { id: 'textPrimary', label: 'متن اصلی', vars: ['--text-primary', '--text-on-primary'] },
  { id: 'textSecondary', label: 'متن ثانویه', vars: ['--text-secondary'] },
  { id: 'accent', label: 'رنگ تأکیدی و دکمه‌ها', vars: ['--color-primary', '--color-primary-hover'] },
  { id: 'border', label: 'حاشیه‌ها', vars: ['--border-strong', '--border-soft', '--border-subtle'] }
];

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
  if (accent && ACCENTS.includes(accent)) {
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
}

function applyContrastMode(contrast) {
  if (!contrast || contrast === 'none') {
    document.documentElement.removeAttribute('data-contrast');
  } else if (CONTRAST_MODES.includes(contrast)) {
    document.documentElement.setAttribute('data-contrast', contrast);
  }
}

function applyCustomPalette(paletteId, overrides = {}) {
  let styleEl = document.getElementById('custom-palette-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'custom-palette-style';
    document.head.appendChild(styleEl);
  }

  let finalVars = {};

  const basePalette = CUSTOM_PALETTES.find((p) => p.id === paletteId);
  if (basePalette) {
    Object.assign(finalVars, basePalette.vars);
  }

  for (const group of THEME_GROUPS) {
    const override = overrides[group.id];
    if (override) {
      if (override.type === 'default') {
        group.vars.forEach(v => delete finalVars[v]);
      } else if (override.type === 'palette') {
        const pal = CUSTOM_PALETTES.find(p => p.id === override.value);
        if (pal) {
          group.vars.forEach(v => {
            if (pal.vars[v]) finalVars[v] = pal.vars[v];
          });
        }
      } else if (override.type === 'custom') {
        if (group.id === 'background') {
          finalVars['--bg-primary'] = override.value;
          finalVars['--bg-secondary'] = `color-mix(in srgb, ${override.value} 95%, #000)`;
          finalVars['--bg-sunken'] = `color-mix(in srgb, ${override.value} 90%, #000)`;
        } else if (group.id === 'surface') {
          finalVars['--bg-card'] = override.value;
          finalVars['--bg-elevated'] = `color-mix(in srgb, ${override.value} 90%, #fff)`;
        } else if (group.id === 'accent') {
          finalVars['--color-primary'] = override.value;
          finalVars['--color-primary-hover'] = `color-mix(in srgb, ${override.value} 85%, #fff)`;
        } else if (group.id === 'border') {
          finalVars['--border-strong'] = override.value;
          finalVars['--border-soft'] = `color-mix(in srgb, ${override.value} 50%, transparent)`;
          finalVars['--border-subtle'] = `color-mix(in srgb, ${override.value} 25%, transparent)`;
        } else {
          group.vars.forEach(v => finalVars[v] = override.value);
        }
      }
    }
  }

  if (Object.keys(finalVars).length === 0) {
    styleEl.textContent = '';
    return;
  }

  let cssText = ':root, [data-theme="dark"] {\n';
  for (const [key, val] of Object.entries(finalVars)) {
    cssText += `  ${key}: ${val} !important;\n`;
  }
  cssText += '}';
  styleEl.textContent = cssText;
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
    syncSystemBars(resolved);
    this._watchSystemTheme(mode);

    const accent = await db.getSetting('accent_color', 'blue');
    applyAccentClass(accent);

    const fontScale = await db.getSetting('font_scale', 'md');
    applyFontScaleClass(fontScale);

    const reducedMotion = await db.getSetting('reduced_motion', 'system');
    applyReducedMotionClass(reducedMotion);
    
    const contrastMode = await db.getSetting('contrast_mode', 'none');
    applyContrastMode(contrastMode);

    const customPalette = await db.getSetting('custom_palette', 'none');
    const overridesStr = await db.getSetting('theme_overrides', '{}');
    let overrides = {};
    try { overrides = JSON.parse(overridesStr); } catch(e) {}
    applyCustomPalette(customPalette, overrides);

    await applyCustomFonts();

    return resolved;
  },

  async toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    await db.setSetting('theme_mode', next);
    this._watchSystemTheme(next);
    this.updateIcon(next);
    syncSystemBars(next);
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { mode: next } }));
    return next;
  },

  async setThemeMode(mode) {
    const resolved = resolveTheme(mode);
    document.documentElement.setAttribute('data-theme', resolved);
    await db.setSetting('theme_mode', mode);
    this._watchSystemTheme(mode);
    this.updateIcon(resolved);
    syncSystemBars(resolved);
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
        syncSystemBars(resolved);
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

  fontScales: FONT_SCALES,
  async getFontScale() {
    return db.getSetting('font_scale', 'md');
  },
  async setFontScale(scale) {
    applyFontScaleClass(scale);
    await db.setSetting('font_scale', scale);
    return scale;
  },

  async getReducedMotion() {
    return db.getSetting('reduced_motion', 'system');
  },
  async setReducedMotion(pref) {
    applyReducedMotionClass(pref);
    await db.setSetting('reduced_motion', pref);
    return pref;
  },

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

  async getCustomPalette() {
    return db.getSetting('custom_palette', 'none');
  },
  async getThemeOverrides() {
    const str = await db.getSetting('theme_overrides', '{}');
    try { return JSON.parse(str); } catch(e) { return {}; }
  },
  async setThemeOverrides(overrides) {
    await db.setSetting('theme_overrides', JSON.stringify(overrides));
    const basePalette = await db.getSetting('custom_palette', 'none');
    applyCustomPalette(basePalette, overrides);
  },
  async setCustomPalette(paletteId) {
    const overrides = await this.getThemeOverrides();
    applyCustomPalette(paletteId, overrides);
    await db.setSetting('custom_palette', paletteId);
    return paletteId;
  },
  
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
