
import { AIClientError } from './ai-errors.js';
import { FLASHCARD_SYSTEM_INSTRUCTION } from './flashcard-prompt.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const FILES_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FILES_UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

class GeminiClientError extends AIClientError {}

function buildModelList(preferredModel) {
  if (preferredModel && DEFAULT_MODELS.includes(preferredModel)) {
    return [preferredModel, ...DEFAULT_MODELS.filter((m) => m !== preferredModel)];
  }
  if (preferredModel) {
    return [preferredModel, ...DEFAULT_MODELS];
  }
  return [...DEFAULT_MODELS];
}

function isTransientError(message) {
  const m = (message || '').toLowerCase();
  return (
    m.includes('503') ||
    m.includes('demand') ||
    m.includes('unavailable') ||
    m.includes('429') ||
    m.includes('resource_exhausted') ||
    m.includes('rate limit') ||
    m.includes('limit')
  );
}

function extractText(data) {
  const candidate = data && data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  if (!parts || !parts.length) return '';
  return parts.map((p) => p.text || '').join('');
}

async function callModelWithRetry({ apiKey, model, contents, systemInstruction, responseMimeType, signal }) {
  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const body = { contents };
      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }
      if (responseMimeType) {
        body.generationConfig = { responseMimeType };
      }

      const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = (data && data.error && data.error.message) || `درخواست به Gemini ناموفق بود (کد ${res.status}).`;
        throw new GeminiClientError(errMsg);
      }

      const text = extractText(data);
      if (text) return text;
      throw new GeminiClientError('پاسخ خالی از Gemini دریافت شد.');
    } catch (err) {
      lastError = err;
      if (isTransientError(err.message) && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('خطای ناشناخته در ارتباط با Gemini.');
}

async function generateContentWithFallback({ apiKey, preferredModel, contents, systemInstruction, responseMimeType, signal }) {
  if (!apiKey) {
    throw new GeminiClientError('کلید API Gemini تنظیم نشده است. لطفاً ابتدا کلید خود را در تنظیمات وارد کنید.');
  }

  const models = buildModelList(preferredModel);
  let lastError = null;

  for (const model of models) {
    try {
      return await callModelWithRetry({ apiKey, model, contents, systemInstruction, responseMimeType, signal });
    } catch (err) {
      lastError = err;
      if (err && err.name === 'AbortError') break;
    }
  }

  throw lastError || new Error('Gemini API response was empty.');
}

/**
 * Pre-uploads a file to Gemini's Files API so its bytes are already sitting
 * on Google's servers by the time the chat message is actually sent — the
 * chat request can then reference it by URI (fileData) instead of
 * re-transmitting the whole file inline as base64, which is what makes
 * "Send" feel instant even for a large attachment (matching how Claude/
 * ChatGPT's own attachment UX works: the network transfer happens while the
 * file is being attached, not when the message is sent).
 *
 * This is meant to be best-effort: any failure (offline, CORS, unsupported
 * type, no key, etc.) should be caught by the caller, which can then simply
 * fall back to sending the file inline with the message as before — nothing
 * about the previous, always-working flow is removed.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {Blob} opts.blob - the raw file/image bytes
 * @param {string} opts.mimeType
 * @param {string} [opts.displayName]
 * @param {(pct:number)=>void} [opts.onProgress] - 0-100, real network upload progress
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ uri: string, name: string, mimeType: string }>}
 */
export async function uploadFileToGemini({ apiKey, blob, mimeType, displayName, onProgress, signal }) {
  if (!apiKey) throw new GeminiClientError('کلید API Gemini تنظیم نشده است.');
  if (!blob || !blob.size) throw new GeminiClientError('فایل خالی است.');

  // Step 1: start a resumable upload session — this returns a one-time
  // upload URL in a response header, it does not transfer any file bytes yet.
  const startRes = await fetch(`${FILES_UPLOAD_BASE}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': mimeType || 'application/octet-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName || 'file' } }),
    signal,
  });

  if (!startRes.ok) {
    throw new GeminiClientError(`شروع آپلود به Gemini ناموفق بود (کد ${startRes.status}).`);
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url') || startRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new GeminiClientError('آدرس آپلود از Gemini دریافت نشد.');
  }

  // Step 2: actually transfer the bytes. Uses XHR (not fetch) specifically
  // because only XHR exposes real upload-progress events in the browser —
  // this is the number shown on the attachment chip while it's "uploading".
  const fileInfo = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    try {
      xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
      xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    } catch (e) { /* some environments restrict custom headers on cross-origin POST; let it try anyway */ }
    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data && data.file);
        } catch (e) {
          reject(new GeminiClientError('پاسخ نامعتبر از Gemini هنگام آپلود.'));
        }
      } else {
        reject(new GeminiClientError(`آپلود فایل به Gemini ناموفق بود (کد ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new GeminiClientError('خطای شبکه هنگام آپلود فایل به Gemini.'));
    xhr.onabort = () => reject(new AIClientError('آپلود لغو شد.'));
    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(blob);
  });

  if (!fileInfo || !fileInfo.uri) {
    throw new GeminiClientError('اطلاعات فایل از Gemini دریافت نشد.');
  }

  // Step 3: images are normally ACTIVE immediately; larger files can briefly
  // report PROCESSING while Google finishes preparing them server-side.
  let state = fileInfo.state;
  let uri = fileInfo.uri;
  const name = fileInfo.name;
  let attempts = 0;
  while (state === 'PROCESSING' && attempts < 15) {
    await new Promise((r) => setTimeout(r, 1200));
    attempts++;
    try {
      const checkRes = await fetch(`${FILES_API_BASE}/${name}?key=${encodeURIComponent(apiKey)}`, { signal });
      const checkData = await checkRes.json().catch(() => ({}));
      state = checkData.state || state;
      uri = checkData.uri || uri;
    } catch (e) {
      break;
    }
  }

  if (state === 'FAILED') {
    throw new GeminiClientError('پردازش فایل در Gemini با خطا مواجه شد.');
  }

  return { uri, name, mimeType: fileInfo.mimeType || mimeType };
}

function buildChatContents({ message, history, attachments }) {
  // Prefer a pre-uploaded Gemini file reference (fileData) when we have one —
  // it was already fully transmitted while the user was attaching it — and
  // only fall back to sending the raw bytes inline (inlineData) when no such
  // reference exists (e.g. a different provider was active at attach time,
  // or the pre-upload failed for some reason).
  const partForAttachment = (att) => {
    if (att.fileUri) {
      return { fileData: { mimeType: att.mimeType, fileUri: att.fileUri } };
    }
    return { inlineData: { mimeType: att.mimeType, data: att.data } };
  };

  const contents = [];
  if (history && Array.isArray(history)) {
    for (const msg of history) {
      const parts = [];
      if (msg.attachments && Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          parts.push(partForAttachment(att));
        }
      }
      parts.push({ text: msg.text });
      contents.push({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts,
      });
    }
  }

  const activeParts = [];
  if (attachments && Array.isArray(attachments)) {
    for (const att of attachments) {
      activeParts.push(partForAttachment(att));
    }
  }
  activeParts.push({ text: message });
  contents.push({ role: 'user', parts: activeParts });
  return contents;
}

/**
 * Gemini SSE streaming via streamGenerateContent?alt=sse
 */
async function streamGeminiContent({ apiKey, model, contents, systemInstruction, signal, onChunk }) {
  const body = { contents };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const url = `${API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const errMsg = (data && data.error && data.error.message) || `درخواست به Gemini ناموفق بود (کد ${res.status}).`;
    throw new GeminiClientError(errMsg);
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    // Fallback to non-stream
    return callModelWithRetry({ apiKey, model, contents, systemInstruction, signal });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  const emit = (delta) => {
    if (!delta) return;
    full += delta;
    if (typeof onChunk === 'function') {
      try { onChunk(delta, full); } catch (e) { /* ignore UI errors */ }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';

    for (const rawLine of parts) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = extractText(json);
        if (delta) emit(delta);
      } catch (e) { /* ignore partial JSON */ }
    }
  }

  if (buffer.trim().startsWith('data:')) {
    try {
      const json = JSON.parse(buffer.trim().slice(5).trim());
      const delta = extractText(json);
      if (delta) emit(delta);
    } catch (e) { /* ignore */ }
  }

  if (!full) throw new GeminiClientError('پاسخ خالی از Gemini دریافت شد.');
  return full;
}

async function streamWithFallback({ apiKey, preferredModel, contents, systemInstruction, signal, onChunk }) {
  if (!apiKey) {
    throw new GeminiClientError('کلید API Gemini تنظیم نشده است. لطفاً ابتدا کلید خود را در تنظیمات وارد کنید.');
  }
  const models = buildModelList(preferredModel);
  let lastError = null;
  for (const model of models) {
    try {
      return await streamGeminiContent({ apiKey, model, contents, systemInstruction, signal, onChunk });
    } catch (err) {
      lastError = err;
      if (err && err.name === 'AbortError') break;
      // If we already streamed some tokens, don't switch models mid-response
      // (caller would see mixed content). Only fall through if empty.
      if (err && err.message && !isTransientError(err.message) && !String(err.message).includes('503')) {
        // try next model only on hard failures before any tokens; we can't know easily
      }
    }
  }
  throw lastError || new Error('Gemini API response was empty.');
}

export async function chatWithGemini({ apiKey, model, message, history, systemInstruction, attachments, signal, onChunk }) {
  if (!apiKey) {
    throw new GeminiClientError('لطفاً ابتدا کلید API را در تنظیمات وارد کنید');
  }

  const hasFileRef = (Array.isArray(attachments) && attachments.some((a) => a && a.fileUri))
    || (Array.isArray(history) && history.some((m) => Array.isArray(m.attachments) && m.attachments.some((a) => a && a.fileUri)));

  // Gemini file references expire after 48h, or can fail for other reasons
  // (permissions, transient issues). Since we always keep the original
  // base64 data around too, we can transparently retry once, inline,
  // instead of surfacing an error to the user for something this recoverable.
  const isFileReferenceError = (msg) => {
    const m = (msg || '').toLowerCase();
    return m.includes('file') && (m.includes('not found') || m.includes('404') || m.includes('permission') || m.includes('invalid') || m.includes('expired'));
  };

  const buildInlineFallbackContents = () => {
    const stripFileUri = (att) => (att && att.fileUri ? { ...att, fileUri: null } : att);
    const inlineAttachments = Array.isArray(attachments) ? attachments.map(stripFileUri) : attachments;
    const inlineHistory = Array.isArray(history)
      ? history.map((m) => ({
          ...m,
          attachments: Array.isArray(m.attachments) ? m.attachments.map(stripFileUri) : m.attachments,
        }))
      : history;
    return buildChatContents({ message, history: inlineHistory, attachments: inlineAttachments });
  };

  const contents = buildChatContents({ message, history, attachments });

  if (typeof onChunk === 'function') {
    let emittedAny = false;
    const wrappedOnChunk = (delta, full) => {
      emittedAny = true;
      onChunk(delta, full);
    };
    try {
      const text = await streamWithFallback({ apiKey, preferredModel: model, contents, systemInstruction, signal, onChunk: wrappedOnChunk });
      return { text };
    } catch (err) {
      // Only safe to retry if nothing has streamed to the user yet (otherwise
      // a retry would duplicate/confuse an already-partial response).
      if (hasFileRef && !emittedAny && isFileReferenceError(err && err.message)) {
        const fallbackContents = buildInlineFallbackContents();
        const text = await streamWithFallback({ apiKey, preferredModel: model, contents: fallbackContents, systemInstruction, signal, onChunk });
        return { text };
      }
      throw err;
    }
  }

  try {
    const text = await generateContentWithFallback({ apiKey, preferredModel: model, contents, systemInstruction, signal });
    return { text };
  } catch (err) {
    if (hasFileRef && isFileReferenceError(err && err.message)) {
      const fallbackContents = buildInlineFallbackContents();
      const text = await generateContentWithFallback({ apiKey, preferredModel: model, contents: fallbackContents, systemInstruction, signal });
      return { text };
    }
    throw err;
  }
}

export async function generateCardsWithGemini({ apiKey, model, text, categoryTitle, userInstruction = '' }) {
  if (!apiKey) {
    throw new GeminiClientError('لطفاً ابتدا کلید API را در تنظیمات وارد کنید');
  }

  const systemInstruction = FLASHCARD_SYSTEM_INSTRUCTION;

  const userNote = (userInstruction || '').trim();
  const userText = [
    `موضوع دسته: "${categoryTitle || 'عمومی'}"`,
    userNote ? `دستورالعمل اضافی کاربر (الزامی برای رعایت):\n${userNote}` : null,
    `متن استخراج شده از PDF:\n${text}`,
  ].filter(Boolean).join('\n\n');

  const contents = [
    {
      role: 'user',
      parts: [{ text: userText }],
    },
  ];

  const responseText = await generateContentWithFallback({
    apiKey,
    preferredModel: model,
    contents,
    systemInstruction,
    responseMimeType: 'application/json',
  });

  return { text: responseText };
}

export { GeminiClientError };
