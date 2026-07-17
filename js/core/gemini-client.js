// js/core/gemini-client.js
//
// Direct, client-only Gemini API client.
//
// This app used to proxy every AI call through a local Node/Express
// backend (server.js -> /api/gemini/...). That backend does not exist
// once the app is packaged into an APK with a static-site wrapper
// (web2apk, html2apk, WebView shells, etc.) — those tools only ship the
// static HTML/CSS/JS, they do not run a Node server on the device.
//
// So instead, this module calls Google's public Generative Language
// REST API directly from the browser/WebView, using an API key the
// user enters and saves locally (IndexedDB via db.js). Nothing is sent
// to any server of ours — only straight to Google's API endpoint with
// the user's own key.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

class GeminiClientError extends Error {}

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
    try {
      const res = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, systemInstruction, model, attachments }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new GeminiClientError(errData.error || `خطا در ارتباط با سرور داخلی (کد ${res.status})`);
      }
      const data = await res.json();
      return { text: data.text };
    } catch (err) {
      if (err instanceof GeminiClientError) throw err;
      throw new GeminiClientError(`خطا در ارتباط با سرور واسط: ${err.message}`);
    }
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
    try {
      const res = await fetch('/api/gemini/generate-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, categoryTitle, model }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new GeminiClientError(errData.error || `خطا در ارتباط با سرور داخلی (کد ${res.status})`);
      }
      const data = await res.json();
      return { text: data.text };
    } catch (err) {
      if (err instanceof GeminiClientError) throw err;
      throw new GeminiClientError(`خطا در ارتباط با سرور واسط: ${err.message}`);
    }
  }

  const systemInstruction = `شما یک دستیار هوشمند آموزشی دلسوز به زبان فارسی هستید.
وظیفه شما خواندن متن ارائه شده (که از فایل سند یا PDF کاربر استخراج شده است) و ایجاد بین ۵ تا ۱۰ فلش‌کارت فوق‌العاده کاربردی، دقیق و کلیدی برای یادگیری به زبان فارسی روان است.
هر فلش‌کارت باید شامل یک سوال متمرکز روی مفاهیم اصلی (کلیدواژه front) و پاسخ مختصر، دقیق و آموزنده در پشت کارت (کلیدواژه back) باشد.

قوانین نمایش فرمول و نماد ریاضی (بسیار مهم):
- هر عبارت ریاضی (کسر، توان، ریشه، مجموعه، بازه، نامعادله، حد، انتگرال، حروف یونانی و...) را همیشه داخل علامت دلار بگذار: برای فرمول داخل متن از یک $ در ابتدا و یک $ در انتها استفاده کن، مثلاً $n(A \\cup B) = n(A) + n(B) - n(A \\cap B)$. برای فرمول مستقل و بزرگ از $$ در ابتدا و انتها استفاده کن.
- از دستورات استاندارد LaTeX استفاده کن: کسر با \\frac{صورت}{مخرج}، توان با ^{}، اندیس با _{}، ریشه با \\sqrt{}، مجموعه‌ها با \\cup و \\cap و \\in و \\subseteq، نامعادله با \\leq و \\geq و \\neq، بی‌نهایت با \\infty، حروف یونانی با \\alpha و \\beta و \\pi و مشابه آن.
- بازه‌های عددی مثل [a, b) یا (a, b] را به همان شکل معمولی و بدون هیچ دستور خاصی و فقط داخل $...$ بنویس.
- هرگز از فرمت‌های دیگر (مثل Markdown دوبل ستاره یا کد بلاک) برای فرمول استفاده نکن؛ فقط از $...$ یا $$...$$ همراه دستورات LaTeX استاندارد بالا.

پاسخ شما باید منحصراً و بدون هیچ متنِ اضافیِ دیگر، به شکل یک آرایه معتبر JSON به فرمت زیر باشد:

[
  {
    "front": "سوال روی کارت؟",
    "back": "پاسخ پشت کارت."
  }
]`;

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
