/**
 * PDF extraction utilities using PDF.js.
 * Operates client-side to extract text from user-uploaded PDF files.
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure pdfjs-dist worker URL
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function extractTextFromPdf(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    const numPages = pdf.numPages;
    
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `[صفحه ${i}]\n${pageText}\n\n`;
    }
    
    return {
      text: fullText,
      numPages: numPages
    };
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('خطا در خواندن فایل PDF: ' + (error.message || 'فرمت فایل معتبر نیست'));
  }
}
