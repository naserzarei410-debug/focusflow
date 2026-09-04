
import { chatCompletion, chatCompletionStream, buildOpenAIMessages } from './openai-compatible-client.js';
import { AIClientError } from './ai-errors.js';

const BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

export async function chatWithGroq({ apiKey, model, message, history, systemInstruction, attachments, signal, onChunk }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً کلید API Groq را در تنظیمات وارد کنید.');
  }
  const messages = buildOpenAIMessages({ systemInstruction, history, message, attachments });
  const opts = {
    apiKey,
    baseUrl: BASE_URL,
    model: model || GROQ_DEFAULT_MODEL,
    messages,
    providerLabel: 'Groq',
    signal,
  };
  if (typeof onChunk === 'function') {
    const text = await chatCompletionStream({ ...opts, onChunk });
    return { text };
  }
  const text = await chatCompletion(opts);
  return { text };
}

export async function generateCardsWithGroq({ apiKey, model, text, categoryTitle, systemInstruction, userInstruction = '' }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً کلید API Groq را در تنظیمات وارد کنید.');
  }
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: [
      `موضوع دسته: "${categoryTitle || 'عمومی'}"`,
      (userInstruction || '').trim() ? `دستورالعمل اضافی کاربر (الزامی برای رعایت):\n${(userInstruction || '').trim()}` : null,
      `متن استخراج شده از PDF:\n${text}`,
    ].filter(Boolean).join('\n\n') },
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
