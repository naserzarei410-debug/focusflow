
import { db } from './db.js';
import { AIClientError } from './ai-errors.js';
import { FLASHCARD_SYSTEM_INSTRUCTION } from './flashcard-prompt.js';
import { chatWithGemini, generateCardsWithGemini, uploadFileToGemini } from './gemini-client.js';
import { chatWithGroq, generateCardsWithGroq, GROQ_DEFAULT_MODEL } from './groq-client.js';
import { chatWithOpenRouter, generateCardsWithOpenRouter, OPENROUTER_DEFAULT_MODEL } from './openrouter-client.js';
import { chatWithDeepSeek, generateCardsWithDeepSeek, DEEPSEEK_DEFAULT_MODEL } from './deepseek-client.js';

export const AI_PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'groq', label: 'Groq' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'deepseek', label: 'DeepSeek' },
];

const PROVIDER_CONFIG = {
  gemini: {
    apiKeySetting: 'gemini_api_key',
    modelSetting: 'gemini_model',
    defaultModel: 'gemini-3.5-flash',
  },
  groq: {
    apiKeySetting: 'groq_api_key',
    modelSetting: 'groq_model',
    defaultModel: GROQ_DEFAULT_MODEL,
  },
  openrouter: {
    apiKeySetting: 'openrouter_api_key',
    modelSetting: 'openrouter_model',
    defaultModel: OPENROUTER_DEFAULT_MODEL,
  },
  deepseek: {
    apiKeySetting: 'deepseek_api_key',
    modelSetting: 'deepseek_model',
    defaultModel: DEEPSEEK_DEFAULT_MODEL,
  },
};

async function getActiveProvider() {
  const provider = await db.getSetting('ai_provider', 'gemini');
  return PROVIDER_CONFIG[provider] ? provider : 'gemini';
}

async function getProviderCredentials(providerId) {
  const cfg = PROVIDER_CONFIG[providerId];
  const apiKey = await db.getSetting(cfg.apiKeySetting, '');
  const model = await db.getSetting(cfg.modelSetting, cfg.defaultModel);
  return { apiKey, model };
}

/** Which provider + model the app will currently use, for display purposes (e.g. Settings, chat header). */
export async function getActiveProviderInfo() {
  const providerId = await getActiveProvider();
  const { apiKey, model } = await getProviderCredentials(providerId);
  const meta = AI_PROVIDERS.find((p) => p.id === providerId);
  return { providerId, label: meta ? meta.label : providerId, apiKey, model, configured: !!apiKey };
}

/**
 * Chat-style call used by the AI tab, flashcard "explain with AI",
 * topic naming, and anywhere else in the app that has a text conversation
 * with the AI. Dispatches to whichever provider is connected in Settings.
 */
/**
 * @param {object} opts
 * @param {string} opts.message
 * @param {Array} [opts.history]
 * @param {string} [opts.systemInstruction]
 * @param {Array} [opts.attachments]
 * @param {AbortSignal} [opts.signal]
 * @param {(delta: string, fullText: string) => void} [opts.onChunk] - when provided, providers stream tokens
 */
export async function chatWithAI({ message, history, systemInstruction, attachments, signal, onChunk }) {
  const providerId = await getActiveProvider();
  const { apiKey, model } = await getProviderCredentials(providerId);

  if (!apiKey) {
    const meta = AI_PROVIDERS.find((p) => p.id === providerId);
    throw new AIClientError(`لطفاً ابتدا کلید API ${meta ? meta.label : providerId} را در تنظیمات وارد کنید`);
  }

  const common = { apiKey, model, message, history, systemInstruction, attachments, signal, onChunk };

  if (providerId === 'groq') {
    return chatWithGroq(common);
  }
  if (providerId === 'openrouter') {
    return chatWithOpenRouter(common);
  }
  if (providerId === 'deepseek') {
    return chatWithDeepSeek(common);
  }
  return chatWithGemini(common);
}

/**
 * Flashcard generation from extracted document/PDF text. Dispatches to
 * whichever provider is connected in Settings, using the same shared
 * instruction/JSON format for every provider so downstream parsing
 * (extractJsonArray in pages.js) works identically either way.
 */
/** Builds the user message for PDF/text → flashcard generation. */
export function buildFlashcardUserMessage({ categoryTitle, text, userInstruction }) {
  const parts = [`موضوع دسته: "${categoryTitle || 'عمومی'}"`];
  const note = (userInstruction || '').trim();
  if (note) {
    parts.push(`دستورالعمل اضافی کاربر (الزامی برای رعایت):
${note}`);
  }
  parts.push(`متن استخراج شده از PDF:
${text}`);
  return parts.join('\n\n');
}

export async function generateCardsWithAI({ text, categoryTitle, userInstruction = '' }) {
  const providerId = await getActiveProvider();
  const { apiKey, model } = await getProviderCredentials(providerId);

  if (!apiKey) {
    const meta = AI_PROVIDERS.find((p) => p.id === providerId);
    throw new AIClientError(`لطفاً ابتدا کلید API ${meta ? meta.label : providerId} را در تنظیمات وارد کنید`);
  }

  const common = { apiKey, model, text, categoryTitle, userInstruction, systemInstruction: FLASHCARD_SYSTEM_INSTRUCTION };

  if (providerId === 'groq') {
    return generateCardsWithGroq(common);
  }
  if (providerId === 'openrouter') {
    return generateCardsWithOpenRouter(common);
  }
  if (providerId === 'deepseek') {
    return generateCardsWithDeepSeek(common);
  }
  return generateCardsWithGemini(common);
}

/**
 * Extracts text from an image using the active AI provider's vision
 * capability (Gemini, or a vision-capable Groq/OpenRouter model), as an
 * alternative to the on-device Tesseract OCR in js/core/ocr-utils.js.
 * Often more accurate than classic OCR for handwriting, low-quality
 * photos, or complex/mixed Persian-English layouts, at the cost of
 * needing an AI provider connected in Settings and an internet connection.
 *
 * @param {{ mimeType: string, data: string }} image - base64 image data (no data: prefix), as produced by FileReader.readAsDataURL(file).split(',')[1]
 * @returns {Promise<string>} The extracted text.
 */
export async function extractTextFromImageWithAI({ mimeType, data }) {
  const providerId = await getActiveProvider();
  const { apiKey, model } = await getProviderCredentials(providerId);

  if (!apiKey) {
    const meta = AI_PROVIDERS.find((p) => p.id === providerId);
    throw new AIClientError(`لطفاً ابتدا کلید API ${meta ? meta.label : providerId} را در تنظیمات وارد کنید`);
  }

  if (providerId === 'deepseek') {
    throw new AIClientError('ارائه‌دهنده DeepSeek از تحلیل تصویر پشتیبانی نمی‌کند. برای استخراج متن با هوش مصنوعی، از Gemini یا یک مدل تصویری در Groq/OpenRouter استفاده کنید، یا از گزینه «OCR سریع (آفلاین)» استفاده کنید.');
  }

  const systemInstruction = 'You are a precise OCR engine. Read the image carefully and output ONLY the exact text that appears in it (Persian and/or English), preserving the original line breaks and order. Do not translate, summarize, explain, or add any commentary or markdown formatting. If the image contains no readable text at all, output exactly: NO_TEXT_FOUND';
  const message = 'متن موجود در این تصویر را دقیقاً و بدون هیچ توضیح اضافه‌ای استخراج و بازنویسی کن.';
  const attachments = [{ mimeType, data }];

  let result;
  if (providerId === 'groq') {
    result = await chatWithGroq({ apiKey, model, message, history: [], systemInstruction, attachments });
  } else if (providerId === 'openrouter') {
    result = await chatWithOpenRouter({ apiKey, model, message, history: [], systemInstruction, attachments });
  } else {
    result = await chatWithGemini({ apiKey, model, message, history: [], systemInstruction, attachments });
  }

  const text = (result.text || '').trim();
  if (!text || text === 'NO_TEXT_FOUND') {
    throw new AIClientError('متنی در تصویر یافت نشد. لطفاً تصویر واضح‌تری امتحان کنید.');
  }
  return text;
}

export { AIClientError };

/**
 * Whether the currently active provider supports pre-uploading an
 * attachment ahead of sending the message (so the network transfer happens
 * while the file is being attached, not when Send is clicked). Only Gemini
 * exposes a Files API that's directly reachable from the browser with just
 * an API key; the other providers (Groq, OpenRouter, DeepSeek) only accept
 * files inline with the chat request itself, so there's nothing to pre-send.
 */
export async function canPreUploadAttachments() {
  const providerId = await getActiveProvider();
  if (providerId !== 'gemini') return false;
  const { apiKey } = await getProviderCredentials('gemini');
  return !!apiKey;
}

/**
 * Best-effort pre-upload of an attachment straight to the active provider's
 * servers. Returns null if the active provider doesn't support this (the
 * caller should then just keep using the local base64 copy and send it
 * inline with the message as before — nothing breaks either way).
 *
 * @param {object} opts
 * @param {Blob} opts.blob
 * @param {string} opts.mimeType
 * @param {string} [opts.displayName]
 * @param {(pct:number)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ fileUri: string, provider: string } | null>}
 */
export async function preUploadAttachment({ blob, mimeType, displayName, onProgress, signal }) {
  const providerId = await getActiveProvider();
  if (providerId !== 'gemini') return null;

  const { apiKey } = await getProviderCredentials('gemini');
  if (!apiKey) return null;

  const result = await uploadFileToGemini({ apiKey, blob, mimeType, displayName, onProgress, signal });
  return { fileUri: result.uri, provider: 'gemini' };
}
