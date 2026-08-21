
import { chatCompletion, buildOpenAIMessages } from './openai-compatible-client.js';
import { AIClientError } from './ai-errors.js';

const BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

export async function chatWithGroq({ apiKey, model, message, history, systemInstruction, attachments, signal }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً کلید API Groq را در تنظیمات وارد کنید.');
  }
  const messages = buildOpenAIMessages({ systemInstruction, history, message, attachments });
  const text = await chatCompletion({
    apiKey,
    baseUrl: BASE_URL,
    model: model || GROQ_DEFAULT_MODEL,
    messages,
    providerLabel: 'Groq',
    signal,
  });
  return { text };
}

export async function generateCardsWithGroq({ apiKey, model, text, categoryTitle, systemInstruction }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً کلید API Groq را در تنظیمات وارد کنید.');
  }
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: `موضوع دسته: "${categoryTitle || 'عمومی'}"\n\nمتن استخراج شده:\n${text}` },
  ];
  const responseText = await chatCompletion({
    apiKey,
    baseUrl: BASE_URL,
    model: model || GROQ_DEFAULT_MODEL,
    messages,
    providerLabel: 'Groq',
  });
  return { text: responseText };
}
