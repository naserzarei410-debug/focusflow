const fs = require('fs');

let content = fs.readFileSync('js/core/gemini-client.js', 'utf8');

content = content.replace('// once the app is packaged into an APK with a static-site wrapper\n// (web2apk, html2apk, WebView shells, etc.) — those tools only ship the', '// on various offline devices.');
content = content.replace('// REST API directly from the browser/WebView, using an API key the\n// user enters and saves locally (IndexedDB via db.js). Nothing is sent', '// REST API directly from the client, using an API key the\n// user enters and saves locally. Nothing is sent');

// Chat fallback replacement
const chatOriginal = `  if (!apiKey) {
    try {
      const res = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, systemInstruction, model, attachments }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new GeminiClientError(errData.error || \`خطا در ارتباط با سرور داخلی (کد \${res.status})\`);
      }
      const data = await res.json();
      return { text: data.text };
    } catch (err) {
      if (err instanceof GeminiClientError) throw err;
      throw new GeminiClientError(\`خطا در ارتباط با سرور واسط: \${err.message}\`);
    }
  }`;

const chatNew = `  if (!apiKey) {
    throw new GeminiClientError('لطفاً ابتدا کلید API را در تنظیمات وارد کنید');
  }`;

content = content.replace(chatOriginal, chatNew);

// Generate cards fallback replacement
const generateOriginal = `  if (!apiKey) {
    try {
      const res = await fetch('/api/gemini/generate-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, categoryTitle, model }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new GeminiClientError(errData.error || \`خطا در ارتباط با سرور داخلی (کد \${res.status})\`);
      }
      const data = await res.json();
      return { text: data.text };
    } catch (err) {
      if (err instanceof GeminiClientError) throw err;
      throw new GeminiClientError(\`خطا در ارتباط با سرور واسط: \${err.message}\`);
    }
  }`;

const generateNew = `  if (!apiKey) {
    throw new GeminiClientError('لطفاً ابتدا کلید API را در تنظیمات وارد کنید');
  }`;

content = content.replace(generateOriginal, generateNew);

fs.writeFileSync('js/core/gemini-client.js', content, 'utf8');
