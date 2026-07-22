// js/core/ai-client.js
//
// Single entry point every feature in the app should use to talk to "the
// AI", instead of importing a specific provider's client directly. Reads
// which provider the user connected in Settings > AI (ai_provider: 'gemini'
// | 'groq' | 'openrouter') and the matching API key/model for that
// provider, and dispatches the call there. This is what makes "connect one
// provider in Settings, and every AI feature in the app uses it" work.
//
// NOTE: Voice dictation-by-AI (js/core/dictation.js) and AI-generated
// speech (js/core/tts.js) are NOT routed through here. Both send raw
// audio and rely on Gemini's audio understanding/generation, which has no
// equivalent in Groq's or OpenRouter's plain chat-completions API — so
// those two features intentionally keep using the dedicated Gemini key
// regardless of which provider is selected for chat/flashcards.

import { db } from './db.js';
import { AIClientError } from './ai-errors.js';
import { FLASHCARD_SYSTEM_INSTRUCTION } from './flashcard-prompt.js';
import { chatWithGemini, generateCardsWithGemini } from './gemini-client.js';
import { chatWithGroq, generateCardsWithGroq, GROQ_DEFAULT_MODEL } from './groq-client.js';
import { chatWithOpenRouter, generateCardsWithOpenRouter, OPENROUTER_DEFAULT_MODEL } from './openrouter-client.js';

export const AI_PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'groq', label: 'Groq' },
  { id: 'openrouter', label: 'OpenRouter' },
];

// Per-provider setting keys and sane defaults, kept in one place so the
// Settings UI and this dispatcher never drift apart.
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
export async function chatWithAI({ message, history, systemInstruction, attachments }) {
  const providerId = await getActiveProvider();
  const { apiKey, model } = await getProviderCredentials(providerId);

  if (!apiKey) {
    const meta = AI_PROVIDERS.find((p) => p.id === providerId);
    throw new AIClientError(`لطفاً ابتدا کلید API ${meta ? meta.label : providerId} را در تنظیمات وارد کنید`);
  }

  if (providerId === 'groq') {
    return chatWithGroq({ apiKey, model, message, history, systemInstruction, attachments });
  }
  if (providerId === 'openrouter') {
    return chatWithOpenRouter({ apiKey, model, message, history, systemInstruction, attachments });
  }
  return chatWithGemini({ apiKey, model, message, history, systemInstruction, attachments });
}

/**
 * Flashcard generation from extracted document/PDF text. Dispatches to
 * whichever provider is connected in Settings, using the same shared
 * instruction/JSON format for every provider so downstream parsing
 * (extractJsonArray in pages.js) works identically either way.
 */
export async function generateCardsWithAI({ text, categoryTitle }) {
  const providerId = await getActiveProvider();
  const { apiKey, model } = await getProviderCredentials(providerId);

  if (!apiKey) {
    const meta = AI_PROVIDERS.find((p) => p.id === providerId);
    throw new AIClientError(`لطفاً ابتدا کلید API ${meta ? meta.label : providerId} را در تنظیمات وارد کنید`);
  }

  if (providerId === 'groq') {
    return generateCardsWithGroq({ apiKey, model, text, categoryTitle, systemInstruction: FLASHCARD_SYSTEM_INSTRUCTION });
  }
  if (providerId === 'openrouter') {
    return generateCardsWithOpenRouter({ apiKey, model, text, categoryTitle, systemInstruction: FLASHCARD_SYSTEM_INSTRUCTION });
  }
  return generateCardsWithGemini({ apiKey, model, text, categoryTitle });
}

export { AIClientError };
