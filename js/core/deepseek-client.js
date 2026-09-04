
import { chatCompletion, chatCompletionStream, buildOpenAIMessages } from './openai-compatible-client.js';
import { AIClientError } from './ai-errors.js';

const BASE_URL = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';

export async function chatWithDeepSeek({ apiKey, model, message, history, systemInstruction, attachments, signal, onChunk }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً کلید API DeepSeek را در تنظیمات وارد کنید.');
  }
  const messages = buildOpenAIMessages({ systemInstruction, history, message, attachments });
  const opts = {
    apiKey,
    baseUrl: BASE_URL,
    model: model || DEEPSEEK_DEFAULT_MODEL,
    messages,
    providerLabel: 'DeepSeek',
    signal,
  };
  if (typeof onChunk === 'function') {
    const text = await chatCompletionStream({ ...opts, onChunk });
    return { text };
  }
  const text = await chatCompletion(opts);
  return { text };
}

export async function generateCardsWithDeepSeek({ apiKey, model, text, categoryTitle, systemInstruction, userInstruction = '' }) {
  if (!apiKey) {
    throw new AIClientError('لطفاً کلید API DeepSeek را در تنظیمات وارد کنید.');
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
    model: model || DEEPSEEK_DEFAULT_MODEL,
    messages,
    providerLabel: 'DeepSeek',
  });
  return { text: responseText };
}
