import { chatWithAI, getActiveProviderInfo, AIClientError } from '../core/ai-client.js';
import { openBottomSheet, createLoadingInline, showToast, createButton, renderFractionsInText, renderRichText, escapeHtml } from '../core/ui.js';

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      resolve({ mimeType: file.type || 'image/jpeg', data: dataUrl.split(',')[1], previewUrl: dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function openAiExplanationBottomSheet(frontText, backText) {
  const { configured, label } = await getActiveProviderInfo();
  if (!configured) {
    showToast(`برای این قابلیت باید ابتدا یک ارائه‌دهنده هوش مصنوعی (${label}) را در تنظیمات وصل کنید`, 'error');
    return;
  }

  const bs = openBottomSheet({
    title: 'توضیح و گفتگو با هوش مصنوعی',
    content: ''
  });

  const contentContainer = bs.querySelector('.bs-content');
  contentContainer.style.cssText = 'display:flex; flex-direction:column; gap:12px; text-align:right;';

  const messagesEl = document.createElement('div');
  messagesEl.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
  contentContainer.appendChild(messagesEl);

  const systemInstruction = `شما یک معلم صبور و دلسوز فارسی‌زبان هستید.
وظیفه شما توضیح دادن یک فلش‌کارت (شامل سوال و جواب) به زبان ساده، قابل فهم، با مثال‌های روزمره و قدم‌به‌قدم است.
دانش‌آموز این سوال را متوجه نشده است. فقط جواب را تکرار نکنید، بلکه مفهوم را روشن کنید و دلیل آن را توضیح دهید.
پس از توضیح اولیه، دانش‌آموز می‌تواند سوالات بیشتری بپرسد یا عکس (مثلاً از حل خودش یا یک منبع دیگر) برایتان بفرستد — به آن‌ها هم به همین شکل صبورانه پاسخ بده.
فرمول‌های ریاضی را داخل $ $ قرار بده.`;

  const contextMessage = `لطفا این فلش‌کارت را توضیح بده:
سوال:
${frontText}

پاسخ:
${backText}`;

  const history = [];

  function appendBubble(sender, text, imagePreviewUrl) {
    const bubble = document.createElement('div');
    const isUser = sender === 'user';
    bubble.style.cssText = `
      max-width:88%; align-self:${isUser ? 'flex-start' : 'flex-end'};
      background:${isUser ? 'var(--bg-sunken)' : 'var(--color-primary-soft)'};
      color:var(--text-primary); border-radius:14px; padding:10px 14px;
      font-size:14px; line-height:1.8;
    `;
    if (imagePreviewUrl) {
      const img = document.createElement('img');
      img.src = imagePreviewUrl;
      img.style.cssText = 'max-width:160px; max-height:160px; border-radius:10px; display:block; margin-bottom:6px;';
      bubble.appendChild(img);
    }
    if (text) {
      const textEl = document.createElement('div');
      textEl.innerHTML = renderRichText(text);
      bubble.appendChild(textEl);
    }
    messagesEl.appendChild(bubble);
    bs.scrollTop = bs.scrollHeight;
    return bubble;
  }

  function appendLoadingBubble() {
    const bubble = document.createElement('div');
    bubble.style.cssText = 'align-self:flex-end;';
    bubble.appendChild(createLoadingInline('در حال فکر کردن...'));
    messagesEl.appendChild(bubble);
    bs.scrollTop = bs.scrollHeight;
    return bubble;
  }

  function createStreamingBubble() {
    const bubble = document.createElement('div');
    bubble.style.cssText = `
      max-width:88%; align-self:flex-end;
      background:var(--color-primary-soft);
      color:var(--text-primary); border-radius:14px; padding:10px 14px;
      font-size:14px; line-height:1.8;
    `;
    const textEl = document.createElement('div');
    textEl.style.cssText = 'white-space:pre-wrap; word-break:break-word;';
    const cursor = document.createElement('span');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = 'display:inline-block; width:2px; height:1em; margin-right:2px; vertical-align:text-bottom; background:var(--color-primary); animation:aiCursorBlink 1s step-end infinite;';
    if (!document.getElementById('ai-stream-cursor-style')) {
      const style = document.createElement('style');
      style.id = 'ai-stream-cursor-style';
      style.textContent = '@keyframes aiCursorBlink{0%,100%{opacity:1}50%{opacity:0}}';
      document.head.appendChild(style);
    }
    bubble.append(textEl, cursor);
    messagesEl.appendChild(bubble);
    bs.scrollTop = bs.scrollHeight;

    let pending = '';
    let raf = 0;
    const flush = () => {
      raf = 0;
      textEl.textContent = pending;
      bs.scrollTop = bs.scrollHeight;
    };
    return {
      el: bubble,
      setText(full) {
        pending = full || '';
        if (!raf) raf = requestAnimationFrame(flush);
      },
      remove() {
        if (raf) cancelAnimationFrame(raf);
        bubble.remove();
      },
    };
  }

  let pendingAttachment = null; // { mimeType, data, previewUrl }

  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex; align-items:flex-end; gap:8px; border-top:1px solid var(--border-subtle); padding-top:10px; margin-top:4px;';

  const attachPreviewRow = document.createElement('div');
  attachPreviewRow.style.cssText = 'display:none; align-items:center; gap:8px; margin-bottom:6px;';
  const attachPreviewImg = document.createElement('img');
  attachPreviewImg.style.cssText = 'width:40px; height:40px; border-radius:8px; object-fit:cover;';
  const attachRemoveBtn = document.createElement('button');
  attachRemoveBtn.type = 'button';
  attachRemoveBtn.className = 'material-symbols-rounded';
  attachRemoveBtn.textContent = 'close';
  attachRemoveBtn.style.cssText = 'background:transparent; border:none; color:var(--text-secondary); font-size:16px; cursor:pointer;';
  attachRemoveBtn.addEventListener('click', () => {
    pendingAttachment = null;
    attachPreviewRow.style.display = 'none';
  });
  attachPreviewRow.append(attachPreviewImg, attachRemoveBtn);
  contentContainer.appendChild(attachPreviewRow);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    pendingAttachment = await fileToAttachment(file);
    attachPreviewImg.src = pendingAttachment.previewUrl;
    attachPreviewRow.style.display = 'flex';
    fileInput.value = '';
  });

  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.className = 'material-symbols-rounded';
  attachBtn.title = 'افزودن عکس';
  attachBtn.textContent = 'attach_file';
  attachBtn.style.cssText = 'background:var(--bg-sunken); border:none; width:38px; height:38px; border-radius:19px; color:var(--text-secondary); font-size:18px; cursor:pointer; flex-shrink:0;';
  attachBtn.addEventListener('click', () => fileInput.click());

  const textInput = document.createElement('textarea');
  textInput.rows = 1;
  textInput.placeholder = 'سوال بعدی خود را بپرسید...';
  textInput.style.cssText = 'flex:1; resize:none; max-height:100px; border:1px solid var(--border-subtle); border-radius:14px; padding:8px 12px; font-family:inherit; font-size:14px; background:var(--bg-primary); color:var(--text-primary);';
  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 100) + 'px';
  });

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.title = 'ارسال';
  sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  sendBtn.style.cssText = 'background:var(--color-primary); border:none; width:38px; height:38px; border-radius:19px; color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;';

  inputRow.append(sendBtn, textInput, attachBtn, fileInput);
  contentContainer.appendChild(inputRow);

  async function sendFollowUp(messageOverride) {
    const text = (messageOverride || textInput.value).trim();
    if (!text && !pendingAttachment) return;

    const attachment = pendingAttachment;
    pendingAttachment = null;
    attachPreviewRow.style.display = 'none';
    textInput.value = '';
    textInput.style.height = 'auto';
    textInput.disabled = true;
    sendBtn.disabled = true;

    appendBubble('user', text, attachment ? attachment.previewUrl : null);
    history.push({ sender: 'user', text: text || '(تصویر ارسال شد)' });
    const loadingBubble = appendLoadingBubble();
    let streamUi = null;
    let streamedText = '';

    try {
      const res = await chatWithAI({
        message: text || 'لطفاً این تصویر را بررسی و راهنمایی کن.',
        history: history.slice(0, -1),
        systemInstruction,
        attachments: attachment ? [{ mimeType: attachment.mimeType, data: attachment.data }] : [],
        onChunk: (_delta, full) => {
          streamedText = full || '';
          if (!streamUi) {
            loadingBubble.remove();
            streamUi = createStreamingBubble();
          }
          streamUi.setText(streamedText);
        },
      });
      if (streamUi) streamUi.remove();
      else loadingBubble.remove();
      const finalText = (res && res.text) || streamedText;
      appendBubble('ai', finalText);
      history.push({ sender: 'model', text: finalText });
    } catch (err) {
      if (streamUi) streamUi.remove();
      else loadingBubble.remove();
      if (streamedText && streamedText.trim()) {
        appendBubble('ai', streamedText.trim());
        history.push({ sender: 'model', text: streamedText.trim() });
      }
      showToast(err instanceof AIClientError ? err.message : 'خطا در ارتباط با هوش مصنوعی', 'error');
    } finally {
      textInput.disabled = false;
      sendBtn.disabled = false;
      textInput.focus();
    }
  }

  sendBtn.addEventListener('click', () => sendFollowUp());
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFollowUp();
    }
  });

  const initialLoading = appendLoadingBubble();
  let initialStream = null;
  let initialText = '';
  try {
    const res = await chatWithAI({
      message: contextMessage,
      systemInstruction,
      onChunk: (_delta, full) => {
        initialText = full || '';
        if (!initialStream) {
          initialLoading.remove();
          initialStream = createStreamingBubble();
        }
        initialStream.setText(initialText);
      },
    });
    if (initialStream) initialStream.remove();
    else initialLoading.remove();
    const finalText = (res && res.text) || initialText;
    appendBubble('ai', finalText);
    history.push({ sender: 'user', text: contextMessage });
    history.push({ sender: 'model', text: finalText });

    const simplerBtn = createButton({
      label: 'ساده‌تر توضیح بده',
      icon: 'psychology',
      variant: 'secondary',
    });
    simplerBtn.style.cssText += '; align-self:flex-end; font-size:12px;';
    simplerBtn.addEventListener('click', () => {
      simplerBtn.remove();
      sendFollowUp('لطفا همین موضوع را خیلی ساده‌تر و مثل یک داستان یا مثال کاملا روزمره توضیح بده.');
    });
    messagesEl.appendChild(simplerBtn);
    bs.scrollTop = bs.scrollHeight;
  } catch (err) {
    if (initialStream) initialStream.remove();
    else initialLoading.remove();
    showToast(err instanceof AIClientError ? err.message : 'خطا در ارتباط با هوش مصنوعی', 'error');
    bs.remove();
  }
}
