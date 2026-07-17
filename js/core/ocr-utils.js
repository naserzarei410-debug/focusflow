import Tesseract from 'tesseract.js';

/**
 * Client-side OCR using Tesseract.js
 * Supports Persian ('fas') and English ('eng') languages.
 * 
 * @param {File|Blob|string} imageFile - Image file, blob or URL to recognize.
 * @param {function} progressCallback - Callback function receiving progress integer (0-100).
 * @returns {Promise<string>} Extracted text.
 */
export async function performOcr(imageFile, progressCallback) {
  try {
    const result = await Tesseract.recognize(
      imageFile,
      'fas+eng',
      {
        logger: m => {
          if (progressCallback && m.status === 'recognizing') {
            progressCallback(Math.round(m.progress * 100));
          }
        }
      }
    );
    return result.data.text || '';
  } catch (error) {
    console.error('Tesseract OCR error:', error);
    throw new Error('خطا در تشخیص متن تصویر: ' + (error.message || 'مشکلی پیش آمد.'));
  }
}
