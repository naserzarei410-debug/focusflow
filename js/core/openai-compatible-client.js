
import { AIClientError } from './ai-errors.js';

function isTransientError(message) {
  const m = (message || '').toLowerCase();
  return (
    m.includes('503') ||
    m.includes('demand') ||
    m.includes('unavailable') ||
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('overloaded') ||
    m.includes('limit')
  );
}

export function buildOpenAIMessages({ systemInstruction, history, message, attachments }) {
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  if (Array.isArray(history)) {
    for (const msg of history) {
      const role = msg.sender === 'user' ? 'user' : 'assistant';
      messages.push({ role, content: buildContent(msg.text, msg.attachments) });
    }
  }
  messages.push({ role: 'user', content: buildContent(message, attachments) });
  return messages;
}

function buildContent(text, attachments) {
  const images = (attachments || []).filter((a) => a && a.mimeType && a.mimeType.startsWith('image/'));
  if (images.length === 0) {
    return text || '';
  }
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  for (const att of images) {
    parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.data}` } });
  }
  return parts;
}

export async function chatCompletion({ apiKey, baseUrl, model, messages, providerLabel, signal }) {
  if (!apiKey) {
    throw new AIClientError(`لطفاً ابتدا کلید API ${providerLabel || 'هوش مصنوعی'} را در تنظیمات وارد کنید.`);
  }
  if (!model) {
    throw new AIClientError(`لطفاً ابتدا مدل ${providerLabel || 'هوش مصنوعی'} را در تنظیمات وارد کنید.`);
  }

  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages }),
        signal,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = (data && data.error && (data.error.message || data.error)) ||
          `درخواست به ${providerLabel || 'سرویس هوش مصنوعی'} ناموفق بود (کد ${res.status}).`;
        throw new AIClientError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
      }

      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text) return text;
      throw new AIClientError(`پاسخ خالی از ${providerLabel || 'سرویس هوش مصنوعی'} دریافت شد.`);
    } catch (err) {
      lastError = err;
      if (isTransientError(err.message) && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error(`خطای ناشناخته در ارتباط با ${providerLabel || 'سرویس هوش مصنوعی'}.`);
}
