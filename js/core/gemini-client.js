// js/core/gemini-client.js
//
// Direct, client-only Gemini API client.
//
// This app used to proxy every AI call through a local Node/Express
// backend (server.js -> /api/gemini/...). That backend does not exist
// on various offline devices.
// static HTML/CSS/JS, they do not run a Node server on the device.
//
// So instead, this module calls Google's public Generative Language
// REST API directly from the client, using an API key the
// user enters and saves locally. Nothing is sent
// to any server of ours — only straight to Google's API endpoint with
// the user's own key.

import { AIClientError } from './ai-errors.js';
import { FLASHCARD_SYSTEM_INSTRUCTION } from './flashcard-prompt.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

// Low-level call to a single model, with basic retry on transient errors.
async function callModelWithRetry({ apiKey, model, contents, systemInstruction, responseMimeType }) {
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

// Tries the preferred model first, then falls back through DEFAULT_MODELS.
async function generateContentWithFallback({ apiKey, preferredModel, contents, systemInstruction, responseMimeType }) {
  if (!apiKey) {
    throw new GeminiClientError('کلید API Gemini تنظیم نشده است. لطفاً ابتدا کلید خود را در تنظیمات وارد کنید.');
  }

  const models = buildModelList(preferredModel);
  let lastError = null;

  for (const model of models) {
    try {
      return await callModelWithRetry({ apiKey, model, contents, systemInstruction, responseMimeType });
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Gemini API response was empty.');
}

// Public: chat-style call, mirrors the old /api/gemini/chat endpoint.
export async function chatWithGemini({ apiKey, model, message, history, systemInstruction, attachments }) {
  if (!apiKey) {
    throw new GeminiClientError('لطفاً ابتدا کلید API را در تنظیمات وارد کنید');
  }

  const contents = [];
  if (history && Array.isArray(history)) {
    for (const msg of history) {
      const parts = [];
      if (msg.attachments && Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.data,
            },
          });
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
      activeParts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.data,
        },
      });
    }
  }
  activeParts.push({ text: message });
  contents.push({ role: 'user', parts: activeParts });

  const text = await generateContentWithFallback({
    apiKey,
    preferredModel: model,
    contents,
    systemInstruction,
  });

  return { text };
}

// Public: flashcard generation, mirrors the old /api/gemini/generate-cards endpoint.
export async function generateCardsWithGemini({ apiKey, model, text, categoryTitle }) {
  if (!apiKey) {
    throw new GeminiClientError('لطفاً ابتدا کلید API را در تنظیمات وارد کنید');
  }

  const systemInstruction = FLASHCARD_SYSTEM_INSTRUCTION;

  const contents = [
    {
      role: 'user',
      parts: [{ text: `موضوع دسته: "${categoryTitle || 'عمومی'}"\n\nمتن استخراج شده:\n${text}` }],
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
