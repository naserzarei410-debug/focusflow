
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
      if (err && err.name === 'AbortError') throw err;
      if (isTransientError(err.message) && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error(`خطای ناشناخته در ارتباط با ${providerLabel || 'سرویس هوش مصنوعی'}.`);
}

/**
 * OpenAI-compatible SSE streaming. Calls onChunk(delta, fullText) for each token.
 * Falls back to non-stream chatCompletion if the body cannot be read as a stream.
 */
export async function chatCompletionStream({
  apiKey,
  baseUrl,
  model,
  messages,
  providerLabel,
  signal,
  onChunk,
  extraHeaders = {},
}) {
  if (!apiKey) {
    throw new AIClientError(`لطفاً ابتدا کلید API ${providerLabel || 'هوش مصنوعی'} را در تنظیمات وارد کنید.`);
  }
  if (!model) {
    throw new AIClientError(`لطفاً ابتدا مدل ${providerLabel || 'هوش مصنوعی'} را در تنظیمات وارد کنید.`);
  }

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const errMsg = (data && data.error && (data.error.message || data.error)) ||
      `درخواست به ${providerLabel || 'سرویس هوش مصنوعی'} ناموفق بود (کد ${res.status}).`;
    throw new AIClientError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
  }

  // Some proxies return JSON even when stream was requested.
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
    const data = await res.json().catch(() => ({}));
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new AIClientError(`پاسخ خالی از ${providerLabel || 'سرویس هوش مصنوعی'} دریافت شد.`);
    if (typeof onChunk === 'function') onChunk(text, text);
    return text;
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    // Last resort: non-stream request
    return chatCompletion({ apiKey, baseUrl, model, messages, providerLabel, signal });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  const emit = (delta) => {
    if (!delta) return;
    full += delta;
    if (typeof onChunk === 'function') {
      try { onChunk(delta, full); } catch (e) { /* UI callback must not break the stream */ }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Normalize CRLF and split complete SSE events
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';

    for (const rawLine of parts) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue; // comment / keepalive
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const choice = json.choices && json.choices[0];
        const delta =
          (choice && choice.delta && (choice.delta.content || choice.delta.text)) ||
          (choice && choice.message && choice.message.content) ||
          '';
        if (typeof delta === 'string' && delta) emit(delta);
      } catch (e) {
        // Incomplete or non-JSON line — ignore
      }
    }
  }

  // Flush trailing buffer if it holds a final data line
  if (buffer.trim().startsWith('data:')) {
    const payload = buffer.trim().slice(5).trim();
    if (payload && payload !== '[DONE]') {
      try {
        const json = JSON.parse(payload);
        const choice = json.choices && json.choices[0];
        const delta =
          (choice && choice.delta && (choice.delta.content || choice.delta.text)) ||
          (choice && choice.message && choice.message.content) ||
          '';
        if (typeof delta === 'string' && delta) emit(delta);
      } catch (e) { /* ignore */ }
    }
  }

  if (!full) {
    throw new AIClientError(`پاسخ خالی از ${providerLabel || 'سرویس هوش مصنوعی'} دریافت شد.`);
  }
  return full;
}
