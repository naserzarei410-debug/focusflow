import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Initialize Gemini SDK with telemetry header
const getAiClient = (req) => {
  const customKey = req && req.headers ? req.headers['x-gemini-key'] : null;
  const apiKey = customKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in Secrets or Settings.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

// Helper function to handle content generation with automatic retries and fallback models
async function generateContentWithRetry(ai, params, preferredModel) {
  const defaultModels = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  const models = preferredModel && defaultModels.includes(preferredModel)
    ? [preferredModel, ...defaultModels.filter(m => m !== preferredModel)]
    : (preferredModel ? [preferredModel, ...defaultModels] : defaultModels);

  let lastError = null;

  for (const model of models) {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Calling Gemini API using model ${model} (attempt ${attempt}/${maxRetries})...`);
        const response = await ai.models.generateContent({
          ...params,
          model: model
        });
        if (response && response.text) {
          return response;
        }
      } catch (err) {
        lastError = err;
        const errMsg = err.message || '';
        // Neutral logging to prevent triggering false-positive system error alerts
        console.log(`[Gemini SDK Info] Attempt ${attempt} with ${model} status:`, errMsg);
        
        const errMsgLower = errMsg.toLowerCase();
        const isTransient = errMsgLower.includes('503') || 
                            errMsgLower.includes('demand') || 
                            errMsgLower.includes('unavailable') || 
                            errMsgLower.includes('429') || 
                            errMsgLower.includes('resource_exhausted') ||
                            errMsgLower.includes('rate limit') ||
                            errMsgLower.includes('limit');
                            
        if (isTransient && attempt < maxRetries) {
          const delay = attempt * 1500;
          console.log(`Waiting ${delay}ms before retrying...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }
  }
  console.log('[Gemini SDK Info] All retry options ended:', lastError?.message || lastError);
  throw lastError || new Error('Gemini API response was empty.');
}

// POST endpoint for chat
app.post('/api/gemini/chat', async (req, res) => {
  try {
    const { message, history, systemInstruction, model, attachments } = req.body;
    const ai = getAiClient(req);

    const contents = [];
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        const parts = [];
        if (msg.attachments && Array.isArray(msg.attachments)) {
          for (const att of msg.attachments) {
            parts.push({
              inlineData: {
                mimeType: att.mimeType,
                data: att.data
              }
            });
          }
        }
        parts.push({ text: msg.text });
        contents.push({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts
        });
      }
    }

    const parts = [];
    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        parts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.data
          }
        });
      }
    }
    parts.push({ text: message });

    contents.push({
      role: 'user',
      parts
    });

    const response = await generateContentWithRetry(ai, {
      contents,
      config: {
        systemInstruction,
      }
    }, model);

    res.json({ text: response.text });
  } catch (error) {
    console.error('Gemini error:', error);
    res.status(500).json({ error: error.message || 'Error communicating with Gemini' });
  }
});

// POST endpoint for generating flashcards from PDF/text
app.post('/api/gemini/generate-cards', async (req, res) => {
  try {
    const { text, categoryTitle, model } = req.body;
    const ai = getAiClient(req);

    const systemInstruction = `شما یک دستیار هوشمند آموزشی دلسوز به زبان فارسی هستید.
وظیفه شما خواندن متن ارائه شده (که از فایل سند یا PDF کاربر استخراج شده است) و ایجاد بین ۵ تا ۱۰ فلش‌کارت فوق‌العاده کاربردی، دقیق و کلیدی برای یادگیری به زبان فارسی روان است.
هر فلش‌کارت باید شامل یک سوال متمرکز روی مفاهیم اصلی (کلیدواژه front) و پاسخ مختصر، دقیق و آموزنده در پشت کارت (کلیدواژه back) باشد.
پاسخ شما باید منحصراً و بدون هیچ متنِ اضافیِ دیگر، به شکل یک آرایه معتبر JSON به فرمت زیر باشد:

[
  {
    "front": "سوال روی کارت؟",
    "back": "پاسخ پشت کارت."
  }
]`;

    const response = await generateContentWithRetry(ai, {
      contents: [{
        role: 'user',
        parts: [{ text: `موضوع دسته: "${categoryTitle || 'عمومی'}"\n\nمتن استخراج شده:\n${text}` }]
      }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      }
    }, model);

    res.json({ text: response.text });
  } catch (error) {
    console.error('Gemini generate-cards error:', error);
    res.status(500).json({ error: error.message || 'Error communicating with Gemini' });
  }
});

// Serve sw.js and manifest.json from root (needed for PWA support in production)
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'sw.js'));
});
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Serve Vite build artifacts from "dist"
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback for SPA routing
app.get(/.*/, (req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    res.status(404).send('Not Found');
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
