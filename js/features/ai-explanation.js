import { chatWithAI, getActiveProviderInfo, AIClientError } from '../core/ai-client.js';
import { openBottomSheet, createLoadingInline, showToast, createButton, renderFractionsInText } from '../core/ui.js';

export async function openAiExplanationBottomSheet(frontText, backText) {
  const { configured, label } = await getActiveProviderInfo();
  if (!configured) {
    showToast(`برای این قابلیت باید ابتدا یک ارائه‌دهنده هوش مصنوعی (${label}) را در تنظیمات وصل کنید`, 'error');
    return;
  }

  const bs = openBottomSheet({
    title: 'توضیح با هوش مصنوعی',
    content: ''
  });

  const contentContainer = bs.querySelector('.bs-content');
  contentContainer.style.cssText = 'padding: 16px; display: flex; flex-direction: column; gap: 16px; text-align: right; line-height: 1.8;';
  
  const loadingEl = createLoadingInline('در حال دریافت توضیح از هوش مصنوعی...');
  contentContainer.appendChild(loadingEl);

  const systemInstruction = `شما یک معلم صبور و دلسوز فارسی‌زبان هستید.
وظیفه شما توضیح دادن یک فلش‌کارت (شامل سوال و جواب) به زبان ساده، قابل فهم، با مثال‌های روزمره و قدم‌به‌قدم است.
دانش‌آموز این سوال را متوجه نشده است. فقط جواب را تکرار نکنید، بلکه مفهوم را روشن کنید و دلیل آن را توضیح دهید.
فرمول‌های ریاضی را داخل $ $ قرار دهید.`;

  const contextMessage = `لطفا این فلش‌کارت را توضیح بده:
سوال:
${frontText}

پاسخ:
${backText}`;

  try {
    const res = await chatWithAI({
      message: contextMessage,
      systemInstruction
    });

    contentContainer.innerHTML = '';
    
    const textDiv = document.createElement('div');
    textDiv.style.cssText = 'font-size: 15px; color: var(--text-primary);';
    textDiv.innerHTML = renderFractionsInText(res.text.replace(/\n/g, '<br>'));
    contentContainer.appendChild(textDiv);

    const simplerBtn = createButton({
      label: 'ساده‌تر توضیح بده',
      icon: 'psychology',
      variant: 'secondary',
      onClick: async () => {
        textDiv.style.opacity = '0.5';
        simplerBtn.disabled = true;
        
        try {
          const followUpRes = await chatWithAI({
            message: 'لطفا همین موضوع را خیلی ساده‌تر و مثل یک داستان یا مثال کاملا روزمره توضیح بده.',
            history: [
              { sender: 'user', text: contextMessage },
              { sender: 'model', text: res.text }
            ],
            systemInstruction
          });
          textDiv.innerHTML = renderFractionsInText(followUpRes.text.replace(/\n/g, '<br>'));
          textDiv.style.opacity = '1';
          simplerBtn.style.display = 'none';
        } catch (err) {
          showToast(err.message, 'error');
          textDiv.style.opacity = '1';
          simplerBtn.disabled = false;
        }
      }
    });
    
    simplerBtn.style.marginTop = '12px';
    contentContainer.appendChild(simplerBtn);

  } catch (err) {
    contentContainer.innerHTML = '';
    showToast(err instanceof AIClientError ? err.message : 'خطا در ارتباط با هوش مصنوعی', 'error');
    bs.remove();
  }
}
