
import { chatCompletion, buildOpenAIMessages } from './openai-compatible-client.js';
import { AIClientError } from './ai-errors.js';

const BASE_URL = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';

export async function chatWithDeepSeek({ apiKey, model, message, history, systemInstruction, attachments, signal }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً کلید API DeepSeek را در تنظیمات وارد کنید.');
  }
  const messages = buildOpenAIMessages({ systemInstruction, history, message, attachments });
  const text = await chatCompletion({
    apiKey,
    baseUrl: BASE_URL,
    model: model || DEEPSEEK_DEFAULT_MODEL,
    messages,
    providerLabel: 'DeepSeek',
    signal,
  });
  return { text };
}

export async function generateCardsWithDeepSeek({ apiKey, model, text, categoryTitle, systemInstruction }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً کلید API DeepSeek را در تنظیمات وارد کنید.');
  }
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: `موضوع دسته: "${categoryTitle || 'عمومی'}"\n\nمتن استخراج شده:\n${text}` },
  ];
  const responseText = await chatCompletion({
    apiKey,
    baseUrl: BASE_URL,
    model: model || DEEPSEEK_DEFAULT_MODEL,
    messages,
    providerLabel: 'DeepSeek',
  });
  return { text: responseText };
}
