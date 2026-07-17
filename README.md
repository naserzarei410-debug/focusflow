<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/08375116-6b41-4114-8af4-1f3904b12874

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## تبدیل به APK (بدون نیاز به سرور)

بخش هوش مصنوعی این نسخه اصلاح شده تا مستقیماً از داخل مرورگر/WebView به API عمومی Gemini
(`https://generativelanguage.googleapis.com`) وصل شود و دیگر به بک‌اند Node/Express محلی
(`server.js` و مسیرهای `/api/gemini/...`) وابسته نیست. کاربر کلید API رایگان خودش را از
Google AI Studio می‌گیرد و در «تنظیمات > هوش مصنوعی» داخل اپ وارد و ذخیره می‌کند (کلید فقط
در IndexedDB همان دستگاه ذخیره می‌شود). منطق مربوطه در `js/core/gemini-client.js` است.

برای گرفتن خروجی قابل تبدیل به APK با ابزارهایی مانند web2apk یا html2apk:

1. `npm install`
2. `npm run build` — این دستور یک پوشه `dist/` می‌سازد (شامل باندل نهایی pdfjs-dist و tesseract.js).
   توجه: بدون این مرحله، فایل‌های خام پروژه در مرورگر اجرا نمی‌شوند چون `pdf-utils.js` و
   `ocr-utils.js` از پکیج‌های npm ایمپورت می‌کنند که فقط بعد از build به فایل قابل استفاده در
   مرورگر تبدیل می‌شوند.
3. محتویات پوشه `dist/` را zip کرده و همان را وارد ابزار تبدیل به APK کنید (نه پوشه اصلی
   پروژه، و نه `server.js`/`package.json`، چون هیچ‌کدام در APK اجرا نمی‌شوند).
4. مطمئن شوید ابزار APK دسترسی اینترنت (INTERNET permission) را برای اپ فعال می‌کند، چون
   درخواست‌های هوش مصنوعی به صورت آنلاین و مستقیم به سرورهای Google ارسال می‌شوند.
