import Tesseract from 'tesseract.js';

/**
 * Load a File/Blob/URL into an HTMLImageElement.
 */
function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('بارگذاری تصویر برای OCR ناموفق بود.'));
    if (typeof source === 'string') {
      img.src = source;
    } else {
      const url = URL.createObjectURL(source);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.src = url;
    }
  });
}

/**
 * Preprocess for offline OCR:
 * - upscale small images
 * - grayscale + contrast stretch
 * Returns a PNG Blob.
 */
async function preprocessForOcr(imageFile) {
  const img = await loadImage(imageFile);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const longSide = Math.max(srcW, srcH);
  const targetLong = longSide < 1400 ? 2000 : longSide > 3200 ? 2400 : longSide;
  const scale = targetLong / longSide;

  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  }

  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * 0.01) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= total * 0.01) {
      hi = i;
      break;
    }
  }
  if (hi <= lo) {
    lo = 0;
    hi = 255;
  }
  const range = hi - lo || 1;

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let g = ((gray[p] - lo) / range) * 255;
    g = (g - 128) * 1.15 + 128;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i] = d[i + 1] = d[i + 2] = g;
    d[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('پیش‌پردازش تصویر ناموفق بود.'));
      else resolve(blob);
    }, 'image/png');
  });
}

/**
 * Client-side OCR using Tesseract.js (Persian + English).
 * Images are preprocessed to improve accuracy on phone photos.
 *
 * @param {File|Blob|string} imageFile
 * @param {function} [progressCallback] - receives 0–100
 * @returns {Promise<string>}
 */
export async function performOcr(imageFile, progressCallback) {
  let prepared = imageFile;
  try {
    if (typeof imageFile !== 'string') {
      if (progressCallback) progressCallback(3);
      prepared = await preprocessForOcr(imageFile);
      if (progressCallback) progressCallback(8);
    }
  } catch (e) {
    prepared = imageFile;
  }

  const worker = await Tesseract.createWorker('fas+eng', 1, {
    logger: (m) => {
      if (!progressCallback) return;
      if (m.status === 'recognizing text' || m.status === 'recognizing') {
        const p = typeof m.progress === 'number' ? m.progress : 0;
        progressCallback(Math.round(15 + p * 85));
      } else if (m.status === 'loading language traineddata') {
        progressCallback(10);
      } else if (m.status === 'initializing api' || m.status === 'initialized api') {
        progressCallback(12);
      }
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });

    const result = await worker.recognize(prepared);
    const text = (result?.data?.text || '').trim();
    return text;
  } catch (error) {
    console.error('Tesseract OCR error:', error);
    throw new Error('خطای تشخیص متن تصویر: ' + (error.message || 'مشکلی پیش آمد.'));
  } finally {
    try {
      await worker.terminate();
    } catch (e) { /* ignore */ }
  }
}
