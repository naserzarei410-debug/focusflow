

import { db } from './db.js';
import { showToast } from './ui.js';

let activeAudio = null;
let activeAudioToken = 0;

const PERSIAN_ARABIC_REGEX = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Persian text-to-speech isn't supported (no reliable free engine), but
 * flashcards routinely mix an English term inside a Persian sentence
 * (e.g. "معنی apple چیست؟"). Previously ANY Persian character anywhere in
 * the text caused the whole request to be rejected, so the English word
 * right next to it never got read either. Instead, strip out the
 * Persian/Arabic runs and speak whatever Latin/English text remains.
 */
function extractSpeakableText(text) {
  return text
    .replace(new RegExp(PERSIAN_ARABIC_REGEX.source, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converts a base64-encoded raw PCM audio payload (as returned by Gemini's
 * native TTS models — typically mime type "audio/L16;codec=pcm;rate=24000",
 * i.e. headerless 16-bit signed little-endian samples) into a playable WAV
 * data URL by prepending a standard 44-byte WAV header. Without this, the
 * <audio> element has no idea how to decode the raw sample bytes and
 * playback silently fails — which is why Gemini TTS never actually played
 * anything before this fix, even when the API call itself succeeded.
 */
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
  view.setUint16(20, 1, true); // PCM
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
 * Uses standard HTML5 Audio.
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
  const mimeType = part.inlineData.mimeType || 'audio/L16;rate=24000';
  // Gemini's native TTS returns headerless raw PCM samples, not a
  // ready-to-play file. <audio> silently fails to decode that, so wrap it
  // in a minimal WAV header first (see pcmBase64ToWavDataUrl above). If a
  // future response ever already announces a real container format (wav/
  // mp3/ogg) via its mimeType, play it as-is instead of double-wrapping it.
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

/**
 * Helper to fall back to the browser's native SpeechSynthesis API.
 * NOTE: on some Android devices
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

  // Persian TTS itself isn't supported (no reliable free engine), but we
  // shouldn't throw away an English word just because it's sitting next
  // to Persian text in the same flashcard. Strip the Persian/Arabic runs
  // and speak whatever Latin/English text remains; only refuse outright
  // if nothing speakable is left.
  const speakableText = extractSpeakableText(cleanText);
  if (!speakableText) {
    showToast('تلفظ صوتی برای زبان فارسی پشتیبانی نمی‌شود.', 'error');
    return false;
  }

  try {
    const savedRateStr = await db.getSetting('tts_speed', '0.95');
    const rate = parseFloat(savedRateStr) || 0.95;

    // Auto-detect language if not explicitly provided
    let detectedLang = lang;
    if (!detectedLang) {
      detectedLang = 'en-US'; // Default to English now
      // Check if there's a custom preferred language setting saved
      const savedLang = await db.getSetting('tts_lang', '');
      if (savedLang) {
        detectedLang = savedLang;
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
          const success = await playGeminiTts(speakableText, detectedLang, apiKey);
          if (success) return true;
        } catch (geminiError) {
          errors.push(`Gemini TTS: ${geminiError.message || geminiError}`);
          console.warn('Gemini TTS failed, falling back:', geminiError);
        }
      }

      // Tier 2: Try Google Translate TTS, with real success verification.
      try {
        const success = await playOnlineTts(speakableText, detectedLang);
        if (success) return true;
      } catch (onlineError) {
        errors.push(`Google TTS: ${onlineError.message || onlineError}`);
        console.warn('Online Google TTS failed, falling back to native SpeechSynthesis:', onlineError);
      }
    } else {
      errors.push('offline');
    }

    // Tier 3. Offline / Fallback: Native Web Speech API (no-ops on most APKs)
    const success = await playNativeTts(speakableText, detectedLang, rate);
    if (success) return true;

    console.warn('All TTS channels failed for text:', speakableText, errors);
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
