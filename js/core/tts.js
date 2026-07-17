

import { db } from './db.js';

let activeAudio = null;
let activeAudioToken = 0;

/**
 * Detects whether the given text is primarily Persian/Arabic or Latin-based.
 */
function detectLanguage(text) {
  const faRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  if (faRegex.test(text)) {
    return 'fa-IR';
  }
  return 'en-US';
}

/**
 * Plays a given <audio> element and resolves ONLY once we have real
 * evidence that audio is actually flowing (not just that play() didn't
 * throw). Rejects on any load/playback error or if nothing plays
 * within `timeoutMs`. This is what makes failure detection reliable
 * for the online TTS tiers, which is what lets the fallback chain in
 * speak() actually do its job.
 */
function playAndVerify(audio, timeoutMs = 6000) {
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
      // Ignore the very first timeupdate fired at currentTime 0 on some
      // WebViews right as playback begins buffering.
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
      reject(new Error('audio playback timed out (no data after ' + timeoutMs + 'ms)'));
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

/**
 * Helper to speak using online Google Translate TTS API.
 * Uses standard HTML5 Audio which is supported inside WebView/APK
 * environments. Tries two known-working client params in sequence and
 * verifies real playback before declaring success (see playAndVerify).
 */
async function playOnlineTts(text, lang) {
  const cleanLang = lang.split('-')[0];
  const shortText = text.substring(0, 200).trim();
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
    audio.crossOrigin = 'anonymous';
    activeAudio = audio;
    audio.src = url;
    try {
      await playAndVerify(audio, 6000);
      // If stopSpeaking() was called (or another speak() started) while
      // we were waiting, don't report success for a stale request.
      if (myToken !== activeAudioToken) return false;
      return true;
    } catch (err) {
      lastError = err;
      try { audio.pause(); } catch (e) { /* ignore */ }
      // try next candidate URL
    }
  }
  throw lastError || new Error('online TTS failed');
}

/**
 * Helper to generate and play speech audio using the Gemini TTS API.
 * Uses the user's saved Gemini API Key. Works well for Persian since
 * it doesn't depend on the undocumented Translate endpoint or on any
 * device-installed voice packs.
 */
async function playGeminiTts(text, lang, apiKey) {
  const shortText = text.substring(0, 250).trim();
  if (!shortText) throw new Error('empty text');
  const model = 'gemini-3.1-flash-tts-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: `تلفظ صوتی برای متن زیر تولید کن. فقط تلفظ صوتی متن را برگردان و هیچ حرف یا توضیح متنی دیگری ننویس:\n${shortText}` }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: lang.startsWith('fa') ? 'Puck' : 'Kore'
          }
        }
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}`);
  }

  const data = await response.json();
  const part = data?.candidates?.[0]?.content?.parts?.[0];

  if (!part?.inlineData?.data) {
    throw new Error('No audio inline data returned from Gemini TTS response');
  }

  const base64Data = part.inlineData.data;
  const mimeType = part.inlineData.mimeType || 'audio/wav';
  const audioUrl = `data:${mimeType};base64,${base64Data}`;

  const myToken = ++activeAudioToken;
  const audio = new Audio(audioUrl);
  activeAudio = audio;
  await playAndVerify(audio, 6000);
  if (myToken !== activeAudioToken) return false;
  return true;
}

/**
 * Helper to fall back to the browser's native SpeechSynthesis API.
 * NOTE: on stock Android WebView (the engine behind html2app.dev-style
 * APKs) `'speechSynthesis' in window` is simply false — this tier is a
 * bonus for real browsers/PWAs and silently no-ops on plain APKs, by
 * design, so it must never be the *only* tier relied on.
 */
function playNativeTts(text, lang, rate = 0.95) {
  return new Promise((resolve) => {
    try {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve(false);
        return;
      }
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;

      // Pick best matching native voice if possible
      const pickVoice = () => {
        try {
          const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
          const shortLang = lang.toLowerCase().split('-')[0];
          const matchingVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(shortLang));
          if (matchingVoice) utterance.voice = matchingVoice;
        } catch (e) { /* ignore */ }
      };
      pickVoice();

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);

      window.speechSynthesis.speak(utterance);

      // Safety timeout: some WebViews accept the utterance but never
      // fire onend/onerror (silent no-op). Don't let the whole speak()
      // chain hang forever — but don't report false success either.
      setTimeout(() => finish(false), 8000);
    } catch (e) {
      resolve(false);
    }
  });
}

export async function speak(text, lang) {
  if (!text || !String(text).trim()) return false;

  // Stop any currently playing audio stream or speech synthesis
  stopSpeaking();

  const cleanText = String(text).trim();

  try {
    const savedRateStr = await db.getSetting('tts_speed', '0.95');
    const rate = parseFloat(savedRateStr) || 0.95;

    // Auto-detect language if not explicitly provided
    let detectedLang = lang;
    if (!detectedLang) {
      detectedLang = detectLanguage(cleanText);
      // If it's English, check if there's a custom preferred language setting saved
      if (detectedLang === 'en-US') {
        const savedLang = await db.getSetting('tts_lang', '');
        if (savedLang) {
          detectedLang = savedLang;
        }
      }
    }

    const errors = [];

    // 1. Try Online Channels first if there is an active internet connection
    if (navigator.onLine) {
      // Tier 1: Try Gemini TTS if API key is configured (most reliable
      // for Persian since it doesn't depend on the undocumented
      // Translate endpoint).
      const apiKey = await db.getSetting('gemini_api_key', '');
      if (apiKey) {
        try {
          const success = await playGeminiTts(cleanText, detectedLang, apiKey);
          if (success) return true;
        } catch (geminiError) {
          errors.push(`Gemini TTS: ${geminiError.message || geminiError}`);
          console.warn('Gemini TTS failed, falling back:', geminiError);
        }
      }

      // Tier 2: Try Google Translate TTS, with real success verification.
      try {
        const success = await playOnlineTts(cleanText, detectedLang);
        if (success) return true;
      } catch (onlineError) {
        errors.push(`Google TTS: ${onlineError.message || onlineError}`);
        console.warn('Online Google TTS failed, falling back to native SpeechSynthesis:', onlineError);
      }
    } else {
      errors.push('offline');
    }

    // Tier 3. Offline / Fallback: Native Web Speech API (no-ops on most APKs)
    const success = await playNativeTts(cleanText, detectedLang, rate);
    if (success) return true;

    console.warn('All TTS channels failed for text:', cleanText, errors);
    return false;
  } catch (e) {
    console.error('All TTS channels failed:', e);
    return false;
  }
}

export function stopSpeaking() {
  // Invalidate any in-flight online/Gemini TTS requests so their
  // eventual resolution can't be mistaken for a fresh success.
  activeAudioToken++;

  // Stop online HTML5 Audio playback
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.src = '';
      activeAudio.currentTime = 0;
    } catch (e) {
      // ignore
    }
    activeAudio = null;
  }

  // Stop native speech synthesis
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      // ignore
    }
  }
}

export function isSpeechSupported() {
  // We always have at least a shot via the online HTML5 Audio TTS tier
  // when the device has internet, and native as a bonus otherwise.
  // Returning true keeps the speak button available; speak() itself
  // reports (via its return value) whether a given attempt succeeded,
  // and callers should surface that to the user instead of assuming
  // silent success.
  return true;
}
