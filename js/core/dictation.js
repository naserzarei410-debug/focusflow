import { db } from './db.js';
/**
 * js/core/dictation.js
 *
 * Unified "speech-to-text" dictation for answer fields (used by both
 * Practice mode and Exam mode).
 *
 * Why this exists
 * ----------------
 * The previous version of the app had ~180 lines of near-identical
 * MediaRecorder + Gemini transcription code copy-pasted into both
 * practice-session.js and exam-session.js. That duplication made the
 * two mic buttons subtly drift apart and doubled the surface area for
 * bugs. It also had no fallback: it depended entirely on the user
 * having saved a Gemini API key, with no way to use the browser's own
 * (free, no-network) speech recognizer even when that works fine.
 *
 * This module provides ONE dictation engine with two backends and an
 * automatic fallback between them, because neither backend alone is
 * reliable on various devices.
 * web2apk/html2apk:
 *
 *   1. "native"  - the device's built-in SpeechRecognition
 *                  API. Free, fast, needs no API key - but many
 *                  some Android devices.
 *                  either don't implement it at all, or expose the
 *                  constructor but never actually deliver a result
 *                  (no on-device speech service behind it).
 *
 *   2. "ai"      - records raw audio (MediaRecorder) and sends it to
 *                  Gemini for transcription. Works on any device that
 *                  allows microphone access + internet access, but
 *                  needs the user's Gemini API key and a network call.
 *
 * In "auto" mode (the default) the button always tries native speech
 * recognition first. If it's unsupported, errors out, or silently
 * hangs (no result within a few seconds - a known failure
 * mode), it transparently switches to the AI backend for that same
 * click, so the user just sees "recording -> processing -> text
 * appears" either way. Users who know their environment can also force
 * one backend from Settings > AI & Voice.
 */

import { openDialog } from './ui.js';

// ---------------------------------------------------------------------
// Error messages (Persian) - single source of truth. Both practice and
// exam sessions used to each keep their own copy of this map.
// ---------------------------------------------------------------------
const MIC_ERROR_MESSAGES = {
  'not-allowed': 'دسترسی به میکروفون صادر نشده است. لطفاً از تنظیمات مرورگر یا اپلیکیشن، اجازه دسترسی به میکروفون را فعال نمایید.\n\nتوضیح راهنما: در صورتی که از شبیه‌ساز داخل وب‌سایت استفاده می‌کنید، به دلیل محدودیت‌های امنیتی مرورگر، دسترسی به میکروفون مسدود می‌شود. لطفاً بر روی دکمه «باز کردن در تب جدید» در بالای صفحه کلیک کنید تا برنامه به صورت مستقیم اجرا شده و امکان ضبط صدا فعال گردد.',
  'service-not-allowed': 'دسترسی به سرویس تشخیص گفتار مسدود گردیده است. لطفاً تنظیمات امنیتی میکروفون را مجدداً بررسی فرمایید.',
  'audio-capture': 'میکروفونی جهت ضبط صدا یافت نشد. لطفاً از اتصال و صحت عملکرد میکروفون دستگاه خود اطمینان حاصل کنید.',
  'network': 'اتصال اینترنت برقرار نیست. قابلیت تشخیص گفتار نیاز به شبکه فعال دارد. لطفاً اتصال خود را بررسی نمایید.',
  'no-speech': 'صدایی شناسایی نشد. لطفاً مجدداً تلاش کرده و واضح‌تر صحبت فرمایید.',
  'too-short': 'فایل صوتی بسیار کوتاه بود یا صدایی ضبط نشد. لطفاً دوباره تلاش کنید.',
  'start-failed': 'آغاز فرآیند ضبط صدا با خطا مواجه شد. در صورت استفاده از شبیه‌ساز پیش‌نمایش، لطفاً برنامه را در یک تب جدید باز کنید تا دسترسی‌ها بدون محدودیت برقرار شوند.',
  'no-api-key': 'روش تشخیص گفتار داخلی مرورگر در دسترس نبود و برای استفاده از دیکته هوشمند (هوش مصنوعی) نیاز به کلید API رایگان Gemini دارید. لطفاً از «تنظیمات > هوش مصنوعی و صدا» کلید خود را وارد کنید.',
  'ai-failed': 'سیستم موفق به تبدیل صدای شما به متن نشد. اتصال اینترنت و کلید API خود را بررسی کرده و دوباره تلاش کنید.',
  default: 'امکان استفاده از قابلیت دیکته صوتی در این دستگاه یا مرورگر فراهم نیست. برای رفع این مسئله، دسترسی میکروفون را بررسی کرده یا برنامه را در یک تب مستقل و جدید (خارج از شبیه‌ساز) باز فرمایید.',
};

export function showMicError(code) {
  const text = MIC_ERROR_MESSAGES[code] || MIC_ERROR_MESSAGES.default;
  openDialog({
    title: 'عدم تشخیص گفتار',
    body: text,
    actions: [{ label: 'متوجه شدم', variant: 'primary' }],
  });
}

// ---------------------------------------------------------------------
// Only one dictation session (native or AI) may be active app-wide at a
// time. Previously each page (practice-session.js / exam-session.js)
// tracked its own module-level `activeRecorder`/`activeStream`, so
// navigating from one to the other mid-recording could leave a
// microphone stream open in the background with nothing able to stop
// it. Centralizing it here fixes that for good.
// ---------------------------------------------------------------------
let activeStopFn = null;

function claimSession(stopFn) {
  if (activeStopFn) {
    try { activeStopFn(); } catch (err) { /* ignore */ }
  }
  activeStopFn = stopFn;
}

function releaseSession(stopFn) {
  if (activeStopFn === stopFn) activeStopFn = null;
}

export function stopAnyActiveDictation() {
  if (activeStopFn) {
    try { activeStopFn(); } catch (err) { /* ignore */ }
    activeStopFn = null;
  }
}

// ---------------------------------------------------------------------
// Backend 1: native device SpeechRecognition
// ---------------------------------------------------------------------
function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isNativeDictationSupported() {
  return !!getSpeechRecognitionCtor();
}

// Resolves with the transcribed text, or rejects with { code }.
// `requestStop` is called with a function the caller can invoke to end
// listening early (equivalent to the user clicking the mic button again).
function runNativeRecognition(lang, requestStop) {
  return new Promise((resolve, reject) => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      reject({ code: 'unsupported' });
      return;
    }

    let settled = false;
    let started = false;
    const recognition = new Ctor();
    recognition.lang = lang || 'fa-IR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const stop = () => { try { recognition.stop(); } catch (err) { /* ignore */ } };

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      releaseSession(stop);
      fn();
    };

    // Some Android devices
    // tools) expose `webkitSpeechRecognition` as a constructor but have
    // no actual speech service behind it: start() never fires onstart
    // or onresult, and just hangs silently. Detect that and bail out to
    // the AI fallback instead of leaving the user staring at a spinning
    // mic forever.
    const startTimer = setTimeout(() => {
      finish(() => { try { recognition.abort(); } catch (err) { /* ignore */ } reject({ code: 'start-timeout' }); });
    }, 4000);

    recognition.onstart = () => { started = true; };
    recognition.onresult = (event) => {
      const transcript = (event.results && event.results[0] && event.results[0][0])
        ? event.results[0][0].transcript
        : '';
      finish(() => resolve(transcript.trim()));
    };
    recognition.onerror = (event) => {
      finish(() => reject({ code: event.error || 'start-failed' }));
    };
    recognition.onend = () => {
      finish(() => reject({ code: started ? 'no-speech' : 'start-timeout' }));
    };

    claimSession(stop);
    requestStop(stop);

    try {
      recognition.start();
    } catch (err) {
      finish(() => reject({ code: 'start-failed' }));
    }
  });
}

// ---------------------------------------------------------------------
// Backend 2: record raw audio, transcribe with Gemini
// ---------------------------------------------------------------------
function pickSupportedMimeType() {
  const candidates = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return 'audio/webm';
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject({ code: 'start-failed' });
    reader.readAsDataURL(blob);
  });
}

// Resolves with a recorded audio Blob once the user (or the 30s safety
// timeout) stops recording. Rejects with { code }.
function recordAudio(requestStop) {
  return new Promise(async (resolve, reject) => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      reject({ code: 'not-allowed' });
      return;
    }

    let recorder;
    try {
      const mimeType = pickSupportedMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      reject({ code: 'start-failed' });
      return;
    }

    const chunks = [];
    let autoStopTimer;
    const stop = () => {
      clearTimeout(autoStopTimer);
      if (recorder.state !== 'inactive') recorder.stop();
    };

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      releaseSession(stop);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      resolve(blob);
    };
    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      releaseSession(stop);
      reject({ code: 'start-failed' });
    };

    claimSession(stop);
    requestStop(stop);

    recorder.start();
    // Safety net so a forgotten mic never records forever.
    autoStopTimer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 30000);
  });
}

async function transcribeWithGemini(blob) {
  
  const apiKey = await db.getSetting('gemini_api_key', '');
  if (!apiKey) throw { code: 'no-api-key' };

  const preferredModel = await db.getSetting('gemini_model', 'gemini-3.5-flash');
  const { chatWithGemini } = await import('./gemini-client.js');

  const base64Data = await blobToBase64(blob);
  const recordedType = (blob.type || 'audio/webm').split(';')[0] || 'audio/webm';

  let response;
  try {
    response = await chatWithGemini({
      apiKey,
      model: preferredModel,
      message: 'لطفاً این فایل صوتی پیوست‌شده را به متن دقیق فارسی تبدیل کنید. فقط و فقط متن گفتار داخل فایل صوتی را بدون هیچ کلمه، مقدمه، توضیح، یا نشانه‌گذاری اضافی بنویسید. در صورتی که صدایی وجود ندارد یا قابل تشخیص نیست، چیزی برنگردانید.',
      attachments: [{ mimeType: recordedType, data: base64Data }],
    });
  } catch (err) {
    throw { code: 'ai-failed', message: err && err.message };
  }

  const transcribedText = (response && response.text || '').trim();
  if (!transcribedText) throw { code: 'no-speech' };
  return transcribedText;
}

// ---------------------------------------------------------------------
// Button visuals shared by both backends
// ---------------------------------------------------------------------
function paintIdle(button) {
  button.innerHTML = '<span class="material-symbols-rounded">mic</span>';
  button.style.background = 'var(--bg-sunken)';
  button.style.color = 'var(--text-secondary)';
  button.style.borderColor = 'var(--border-strong)';
  button.title = 'دیکته صوتی هوشمند (تبدیل گفتار به متن)';
  button.style.pointerEvents = 'auto';
}

function paintListening(button) {
  button.style.background = 'var(--color-danger-soft)';
  button.style.color = 'var(--color-danger)';
  button.style.borderColor = 'var(--color-danger)';
  button.innerHTML = '<span class="material-symbols-rounded" style="animation: flamePulse 1.2s infinite ease-in-out;">mic</span>';
  button.title = 'در حال شنیدن... جهت اتمام و تبدیل به متن دوباره کلیک کنید';
}

function paintProcessing(button) {
  button.style.background = 'var(--bg-sunken)';
  button.style.color = 'var(--text-secondary)';
  button.style.borderColor = 'var(--border-strong)';
  button.innerHTML = '<span class="material-symbols-rounded" style="animation: spin 0.8s linear infinite;">sync</span>';
  button.style.pointerEvents = 'none';
  button.title = 'در حال تبدیل صدا به متن...';
}

/**
 * Wires a mic <button> to a textarea/input. Appends recognized text into
 * the field and fires an 'input' event so any existing listeners (grid
 * dots, live validation, etc.) update normally.
 *
 * @param {HTMLButtonElement} button
 * @param {HTMLTextAreaElement|HTMLInputElement} field
 * @param {(text: string) => void} [onTranscribed] optional extra hook,
 *        called after the field's value + 'input' event have already
 *        been dispatched.
 * @returns {{ cancel: () => void }}
 */
export function attachDictationButton(button, field, onTranscribed) {
  let phase = 'idle'; // 'idle' | 'listening' | 'processing'
  let requestStopFn = null;
  let destroyed = false;

  const setPhase = (p) => {
    phase = p;
    if (destroyed) return;
    if (p === 'idle') paintIdle(button);
    else if (p === 'listening') paintListening(button);
    else paintProcessing(button);
  };

  const registerStop = (fn) => { requestStopFn = fn; };

  async function handleClick(e) {
    e.preventDefault();

    if (phase === 'listening') {
      if (requestStopFn) requestStopFn();
      return;
    }
    if (phase === 'processing') return;

    setPhase('listening');
    requestStopFn = null;

    try {
      
      const method = await db.getSetting('dictation_method', 'auto');
      const tryNative = method === 'native' || method === 'auto';
      const tryAi = method === 'ai' || method === 'auto';

      let transcript = null;
      let nativeError = null;

      if (tryNative) {
        try {
          transcript = await runNativeRecognition(field.dataset.dictationLang || 'fa-IR', registerStop);
        } catch (err) {
          nativeError = err;
          if (method === 'native') {
            setPhase('idle');
            showMicError(err && err.code);
            return;
          }
          // auto mode: fall through silently to the AI backend below
        }
      }

      if (transcript === null && tryAi) {
        // Re-enter "listening" in case the native attempt above already
        // flipped visuals, then actually record audio for the AI path.
        setPhase('listening');
        requestStopFn = null;
        let audioBlob;
        try {
          audioBlob = await recordAudio(registerStop);
        } catch (err) {
          setPhase('idle');
          showMicError((err && err.code) || 'start-failed');
          return;
        }

        if (audioBlob.size < 1000) {
          setPhase('idle');
          showMicError('too-short');
          return;
        }

        setPhase('processing');
        try {
          transcript = await transcribeWithGemini(audioBlob);
        } catch (err) {
          setPhase('idle');
          showMicError((err && err.code) || 'ai-failed');
          return;
        }
      }

      setPhase('idle');

      if (!transcript && nativeError) {
        showMicError(nativeError.code);
        return;
      }

      if (transcript) {
        field.value = field.value ? `${field.value} ${transcript}` : transcript;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof onTranscribed === 'function') onTranscribed(transcript);
      }
    } catch (err) {
      setPhase('idle');
      showMicError((err && err.code) || 'start-failed');
    }
  }

  button.addEventListener('click', handleClick);
  paintIdle(button);

  return {
    cancel() {
      destroyed = true;
      button.removeEventListener('click', handleClick);
      if (phase !== 'idle') stopAnyActiveDictation();
    },
  };
}
