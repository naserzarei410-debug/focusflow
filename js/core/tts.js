/**
 * Flashcard / app text-to-speech.
 *
 * Priority:
 *  1. Device TTS (Capacitor plugin) — works offline; primary path
 *  2. Web SpeechSynthesis — browsers / some WebViews
 *  3. Online Gemini TTS — only if online + API key configured
 *  4. Online Google Translate TTS — best-effort when online
 *
 * Device TTS is tried FIRST so offline / no-API-key use never depends on
 * network. Online tiers are optional enhancements.
 */

import { db } from './db.js';
import { showToast } from './ui.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
// Community plugin (fallback)
import { TextToSpeech } from '@capacitor-community/text-to-speech';
// Custom native plugin — talks to the SAME Android TTS engine as system "Read aloud"
const DeviceTts = registerPlugin('DeviceTts');

let activeAudio = null;
let activeAudioToken = 0;

const PERSIAN_REGEX = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_MARKERS = /[\u0629\u0649\u0635\u0636\u0637\u0638\u0639\u063A\u0642]/;

/**
 * Detect language from text content.
 * Persian vs Arabic is distinguished when possible; Latin → en-US.
 */
function detectSpeechLang(text, savedLangSetting) {
  const t = String(text || '');
  if (ARABIC_MARKERS.test(t) && PERSIAN_REGEX.test(t)) {
    return 'ar-SA';
  }
  if (PERSIAN_REGEX.test(t)) return 'fa-IR';
  if (/[a-zA-Z]/.test(t)) return savedLangSetting || 'en-US';
  return savedLangSetting || 'en-US';
}

let cachedSupportedLangs = null;
let lastPluginError = '';

function isNativeApp() {
  try {
    return !!(Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
  } catch (e) {
    return false;
  }
}

/**
 * Prefer our custom DeviceTts plugin (direct Android TextToSpeech).
 * Fall back to @capacitor-community/text-to-speech if needed.
 * Returns { speak, stop, kind } or null.
 */
async function loadNativeDeviceTts() {
  if (!isNativeApp()) {
    lastPluginError = 'not-native';
    return null;
  }

  // 1) Custom plugin registered in MainActivity
  if (DeviceTts && typeof DeviceTts.speak === 'function') {
    try {
      // Probe readiness if available
      if (typeof DeviceTts.isReady === 'function') {
        const st = await DeviceTts.isReady();
        if (st && st.failed) {
          lastPluginError = 'device-tts-init-failed';
        } else {
          return {
            kind: 'device-tts',
            speak: (opts) => DeviceTts.speak(opts),
            stop: () => (DeviceTts.stop ? DeviceTts.stop() : Promise.resolve()),
          };
        }
      } else {
        return {
          kind: 'device-tts',
          speak: (opts) => DeviceTts.speak(opts),
          stop: () => (DeviceTts.stop ? DeviceTts.stop() : Promise.resolve()),
        };
      }
    } catch (e) {
      lastPluginError = 'device-tts: ' + (e.message || e);
      console.warn('DeviceTts probe failed', e);
    }
  }

  // 2) Community plugin fallback
  if (TextToSpeech && typeof TextToSpeech.speak === 'function') {
    return {
      kind: 'community',
      speak: (opts) => TextToSpeech.speak(opts),
      stop: () => (TextToSpeech.stop ? TextToSpeech.stop() : Promise.resolve()),
    };
  }

  lastPluginError = lastPluginError || 'no-plugin';
  return null;
}

function buildLangCandidates(lang) {
  const raw = (lang || 'en-US').trim().replace('_', '-');
  const parts = raw.split('-');
  const base = (parts[0] || 'en').toLowerCase();
  const region = (parts[1] || '').toUpperCase();
  const out = [];
  const add = (t) => {
    if (t && !out.includes(t)) out.push(t);
  };

  if (region) {
    add(`${base}-${region}`);
    add(`${base}_${region}`);
  }

  if (base === 'fa' || base === 'fas' || base === 'per') {
    add('fa-IR');
    add('fa_IR');
    add('fa');
    add('fas');
  } else if (base === 'ar') {
    add('ar-SA');
    add('ar_SA');
    add('ar-EG');
    add('ar');
  } else if (base === 'en') {
    add('en-US');
    add('en_US');
    add('en-GB');
    add('en_GB');
    add('en');
  } else {
    add(base);
  }

  // Always keep English as last-resort so *something* may play
  add('en-US');
  add('en');
  return out;
}

async function getSupportedLangList(plugin) {
  if (cachedSupportedLangs) return cachedSupportedLangs;
  try {
    const res = await plugin.getSupportedLanguages();
    const list = res && res.languages ? res.languages : [];
    cachedSupportedLangs = Array.isArray(list) ? list.map(String) : [];
  } catch (e) {
    cachedSupportedLangs = [];
  }
  return cachedSupportedLangs;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`${label || 'operation'} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Speak via the device TTS engine (Google TTS / Samsung / etc.).
 * Tries several language tags. Each attempt is time-boxed so a stuck
 * engine cannot freeze the UI with a silent hang.
 */
async function playNativeDeviceTts(text, lang, rate) {
  const plugin = await loadNativeDeviceTts();
  if (!plugin || typeof plugin.speak !== 'function') {
    console.warn('Device TTS: plugin missing', lastPluginError);
    return false;
  }

  const spoken = String(text).substring(0, 3500).trim();
  if (!spoken) return false;

  let r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) r = 1.0;
  // Android setSpeechRate: 1.0 = normal. Keep a safe range.
  r = Math.min(1.5, Math.max(0.6, r));

  // Fast path: simplest call first (matches what system "Read aloud" effectively does)
  try {
    try { await plugin.stop(); } catch (e) { /* ignore */ }
    await withTimeout(
      plugin.speak({ text: spoken, lang: (lang || 'en-US'), rate: r }),
      25000,
      'device-tts:simple'
    );
    return true;
  } catch (e) {
    console.warn('Device TTS simple speak failed, trying candidates:', e && (e.message || e));
    lastPluginError = String(e && e.message || e);
  }

  const supported = await getSupportedLangList(plugin);
  const candidates = buildLangCandidates(lang);

  // Prefer candidates that appear in the supported list (fuzzy)
  const ordered = [];
  const seen = new Set();
  const push = (tag) => {
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    ordered.push(tag);
  };

  if (supported.length) {
    const lower = supported.map((s) => s.toLowerCase().replace(/_/g, '-'));
    for (const tag of candidates) {
      const t = tag.toLowerCase().replace(/_/g, '-');
      const base = t.split('-')[0];
      const hit = lower.findIndex((s) => s === t || s.startsWith(base));
      if (hit >= 0) push(supported[hit]);
    }
  }
  for (const tag of candidates) push(tag);

  for (const tag of ordered) {
    try {
      try {
        if (typeof plugin.stop === 'function') await plugin.stop();
      } catch (e) { /* ignore */ }

      // Minimal options — avoid iOS-only fields that can confuse some Android builds
      const opts = {
        text: spoken,
        lang: tag,
        rate: r,
        pitch: 1.0,
        volume: 1.0,
      };

      await withTimeout(plugin.speak(opts), 20000, `device-tts:${tag}`);
      return true;
    } catch (e) {
      console.warn('Device TTS failed for', tag, e && (e.message || e));
    }
  }

  // Final attempt: no lang / default engine language
  try {
    try {
      if (typeof plugin.stop === 'function') await plugin.stop();
    } catch (e) { /* ignore */ }
    await withTimeout(
      plugin.speak({ text: spoken, rate: r, pitch: 1.0, volume: 1.0 }),
      20000,
      'device-tts:default'
    );
    return true;
  } catch (e) {
    console.warn('Device TTS default lang failed:', e && (e.message || e));
  }

  return false;
}

export async function openTtsVoiceInstaller() {
  const plugin = await loadNativeDeviceTts();
  if (!plugin || typeof plugin.openInstall !== 'function') return false;
  try {
    await plugin.openInstall();
    cachedSupportedLangs = null;
    return true;
  } catch (e) {
    return false;
  }
}

function pcmBase64ToWavDataUrl(base64Data, mimeType) {
  const rateMatch = /rate=(\d+)/i.exec(mimeType || '');
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
  const channels = 1;
  const bitsPerSample = 16;

  const binary = atob(base64Data);
  const pcmBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) pcmBytes[i] = binary.charCodeAt(i);

  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.length;
  const wavBytes = new Uint8Array(44 + dataSize);
  const view = new DataView(wavBytes.buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  wavBytes.set(pcmBytes, 44);

  let binaryOut = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < wavBytes.length; i += chunkSize) {
    binaryOut += String.fromCharCode.apply(null, wavBytes.subarray(i, i + chunkSize));
  }
  return `data:audio/wav;base64,${btoa(binaryOut)}`;
}

function playAndVerify(audio, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('timeupdate', onPlaying);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onError);
      clearTimeout(timer);
    };
    const onPlaying = () => {
      if (settled) return;
      if (audio.currentTime > 0 || audio.readyState >= 2) {
        settled = true;
        cleanup();
        resolve(true);
      }
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(audio.error || new Error('audio playback error'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('audio playback timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);

    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('timeupdate', onPlaying);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onError);

    audio.play().catch((err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
  });
}

async function playOnlineTts(text, lang) {
  const cleanLang = (lang || 'en').split(/[-_]/)[0];
  const shortText = text.substring(0, 180).trim();
  if (!shortText) throw new Error('empty text');

  const candidates = [
    `https://translate.google.com/translate_tts?ie=UTF-8&tl=${cleanLang}&client=tw-ob&q=${encodeURIComponent(shortText)}`,
    `https://translate.google.com/translate_tts?ie=UTF-8&tl=${cleanLang}&client=gtx&q=${encodeURIComponent(shortText)}`,
  ];

  let lastError = null;
  for (const url of candidates) {
    const myToken = ++activeAudioToken;
    const audio = new Audio();
    audio.preload = 'auto';
    activeAudio = audio;
    audio.src = url;
    try {
      await playAndVerify(audio, 5000);
      if (myToken !== activeAudioToken) return false;
      return true;
    } catch (err) {
      lastError = err;
      try { audio.pause(); } catch (e) { /* ignore */ }
    }
  }
  throw lastError || new Error('online TTS failed');
}

async function playGeminiTts(text, lang, apiKey) {
  const shortText = text.substring(0, 250).trim();
  if (!shortText) throw new Error('empty text');
  const model = 'gemini-3.1-flash-tts-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          {
            text: `تلفظ صوتی برای متن زیر تولید کن. فقط تلفظ صوتی متن را برگردان و هیچ حرف یا توضیح متنی دیگری ننویس:\n${shortText}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: (lang || '').startsWith('fa') ? 'Puck' : 'Kore',
          },
        },
      },
    },
  };

  const response = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    12000,
    'gemini-tts-fetch'
  );

  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}`);
  }

  const data = await response.json();
  const part = data?.candidates?.[0]?.content?.parts?.[0];
  if (!part?.inlineData?.data) {
    throw new Error('No audio inline data returned from Gemini TTS response');
  }

  const base64Data = part.inlineData.data;
  const mimeType = part.inlineData.mimeType || 'audio/L16;rate=24000';
  const audioUrl = /wav|mpeg|mp3|ogg/i.test(mimeType)
    ? `data:${mimeType};base64,${base64Data}`
    : pcmBase64ToWavDataUrl(base64Data, mimeType);

  const myToken = ++activeAudioToken;
  const audio = new Audio(audioUrl);
  activeAudio = audio;
  await playAndVerify(audio, 6000);
  if (myToken !== activeAudioToken) return false;
  return true;
}

function playWebSpeechTts(text, lang, rate = 1.0) {
  return new Promise((resolve) => {
    try {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve(false);
        return;
      }

      const synth = window.speechSynthesis;
      try { synth.cancel(); } catch (e) { /* ignore */ }

      let voices = [];
      try { voices = synth.getVoices() || []; } catch (e) { voices = []; }

      const candidates = buildLangCandidates(lang);
      const utterance = new SpeechSynthesisUtterance(String(text).substring(0, 3500));
      let r = Number(rate);
      if (!Number.isFinite(r) || r <= 0) r = 1.0;
      utterance.rate = Math.min(1.5, Math.max(0.6, r));
      utterance.pitch = 1;
      utterance.volume = 1;

      let chosenLang = candidates[0] || 'en-US';
      for (const tag of candidates) {
        const short = tag.toLowerCase().split(/[-_]/)[0];
        const match = voices.find(
          (v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(short)
        );
        if (match) {
          utterance.voice = match;
          chosenLang = match.lang || tag;
          break;
        }
      }
      utterance.lang = chosenLang;

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      utterance.onstart = () => {
        // Speech actually started — count as success even if onend is flaky
        // (some Android WebViews never fire onend reliably)
        setTimeout(() => finish(true), 300);
      };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);

      setTimeout(() => {
        try {
          synth.speak(utterance);
        } catch (e) {
          finish(false);
        }
      }, 50);

      const ms = Math.min(45000, Math.max(8000, String(text).length * 100));
      setTimeout(() => finish(false), ms);
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * Main entry: speak text aloud. Never hangs silently — always resolves.
 * Shows a toast when every channel fails.
 */
export async function speak(text, lang) {
  if (!text || !String(text).trim()) {
    showToast('متنی برای تلفظ وجود ندارد.', 'error');
    return false;
  }

  stopSpeaking();

  const cleanText = String(text).trim();

  try {
    let rate = 1.0;
    let savedLang = '';
    try {
      const savedRateStr = await db.getSetting('tts_speed', '1.0');
      rate = parseFloat(savedRateStr) || 1.0;
      savedLang = (await db.getSetting('tts_lang', '')) || '';
    } catch (e) {
      /* settings optional */
    }

    const detectedLang = lang || detectSpeechLang(cleanText, savedLang);
    const online = typeof navigator !== 'undefined' && navigator.onLine === true;
    const errors = [];

    // ── 1) Device TTS first (offline-safe, no API key) ───────────────
    try {
      const ok = await playNativeDeviceTts(cleanText, detectedLang, rate);
      if (ok) return true;
      errors.push('device-tts: false');
    } catch (e) {
      errors.push('device-tts: ' + (e.message || e));
    }

    // ── 2) Web SpeechSynthesis ───────────────────────────────────────
    try {
      const ok = await playWebSpeechTts(cleanText, detectedLang, rate);
      if (ok) return true;
      errors.push('web-speech: false');
    } catch (e) {
      errors.push('web-speech: ' + (e.message || e));
    }

    // ── 3) Online Gemini (optional) ──────────────────────────────────
    if (online) {
      try {
        const apiKey = await db.getSetting('gemini_api_key', '');
        if (apiKey) {
          try {
            const ok = await playGeminiTts(cleanText, detectedLang, apiKey);
            if (ok) return true;
          } catch (e) {
            errors.push('gemini: ' + (e.message || e));
          }
        }
      } catch (e) {
        errors.push('gemini-settings: ' + (e.message || e));
      }

      // ── 4) Online Google Translate TTS (best-effort) ──────────────
      try {
        const ok = await playOnlineTts(cleanText, detectedLang);
        if (ok) return true;
      } catch (e) {
        errors.push('google-tts: ' + (e.message || e));
      }
    }

    console.warn('All TTS channels failed:', cleanText, detectedLang, errors);

    const plugin = await loadNativeDeviceTts();
    if (!plugin) {
      showToast(
        'پلاگین تلفظ به موتور گوشی وصل نشد (' + (lastPluginError || 'unknown') + '). APK را از بیلد جدید نصب کنید.',
        'error',
        5500
      );
    } else {
      const base = (detectedLang || '').toLowerCase().split(/[-_]/)[0];
      if (base === 'fa') {
        showToast(
          'تلفظ فارسی پیدا نشد. در تنظیمات گوشی → «خروجی متن به گفتار» بستهٔ زبان فارسی Google را نصب کنید.',
          'error',
          6000
        );
      } else if (base === 'ar') {
        showToast(
          'تلفظ عربی پیدا نشد. در تنظیمات گوشی بستهٔ زبان عربی را برای موتور Google نصب کنید.',
          'error',
          6000
        );
      } else {
        showToast(
          'پخش صدا انجام نشد. موتور «متن به گفتار Google» را در تنظیمات گوشی فعال و بستهٔ زبان را نصب کنید.',
          'error',
          5500
        );
      }
    }
    return false;
  } catch (e) {
    console.error('speak() unexpected error:', e);
    showToast('پخش صدا با مشکل مواجه شد: ' + (e.message || 'خطای ناشناخته'), 'error', 4500);
    return false;
  }
}

export function stopSpeaking() {
  activeAudioToken++;

  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.src = '';
      activeAudio.currentTime = 0;
    } catch (e) { /* ignore */ }
    activeAudio = null;
  }

  try {
    if (isNativeApp()) {
      if (DeviceTts && typeof DeviceTts.stop === 'function') DeviceTts.stop();
      if (TextToSpeech && typeof TextToSpeech.stop === 'function') TextToSpeech.stop();
    }
  } catch (e) { /* ignore */ }

  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) { /* ignore */ }
  }
}

export function isSpeechSupported() {
  return true;
}

export async function isNativeDeviceTtsAvailable() {
  const plugin = await loadNativeDeviceTts();
  return !!plugin;
}

/** Call once at app start to warm the native plugin (optional). */
export async function initTts() {
  try {
    await loadNativeDeviceTts();
  } catch (e) { /* ignore */ }
}
