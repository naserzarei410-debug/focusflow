// js/core/openrouter-client.js
//
// OpenRouter client, built on the shared OpenAI-compatible low-level
// client. OpenRouter is a gateway in front of many different model
// providers, so the model id is whatever the user picked on
// openrouter.ai/models (their free-model catalog rotates often, so we
// default to their own "auto pick a free model" router instead of hardcoding
// a specific id that could get deprecated).

import { chatCompletion, buildOpenAIMessages } from './openai-compatible-client.js';
import { AIClientError } from './ai-errors.js';

const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_DEFAULT_MODEL = 'openrouter/free';

export async function chatWithOpenRouter({ apiKey, model, message, history, systemInstruction, attachments }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً ابتدا کلید API OpenRouter را در تنظیمات وارد کنید');
  }
  const messages = buildOpenAIMessages({ systemInstruction, history, message, attachments });
  const text = await chatCompletion({
    apiKey,
    baseUrl: BASE_URL,
    model: model || OPENROUTER_DEFAULT_MODEL,
    messages,
    providerLabel: 'OpenRouter',
  });
  return { text };
}

export async function generateCardsWithOpenRouter({ apiKey, model, text, categoryTitle, systemInstruction }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً ابتدا کلید API OpenRouter را در تنظیمات وارد کنید');
  }
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: `موضوع دسته: "${categoryTitle || 'عمومی'}"\n\nمتن استخراج شده:\n${text}` },
  ];
  const responseText = await chatCompletion({
    apiKey,
    baseUrl: BASE_URL,
    model: model || OPENROUTER_DEFAULT_MODEL,
    messages,
    providerLabel: 'OpenRouter',
  });
  return { text: responseText };
}
