const fs = require('fs');

let content = fs.readFileSync('js/features/pages.js', 'utf8');

// 1. Array declaration
content = content.replace(
  "    const vennDiagrams = [];",
  "    const vennDiagrams = [];\n    const liveCodeBlocks = [];"
);

// 2. Block parsing
const parseBlock = `      if (lang === 'physics') {
        const placeholder = \`PHYSICSPLOTPLACEHOLDER\${physicsPlots.length}\`;
        physicsPlots.push(code.trim());
        return placeholder;
      }`;
const newParseBlock = `      if (lang === 'run' || lang === 'live') {
        const placeholder = \`LIVECODEPLACEHOLDER\${liveCodeBlocks.length}\`;
        liveCodeBlocks.push(code.trim());
        return placeholder;
      }
` + parseBlock;

content = content.replace(parseBlock, newParseBlock);

// 3. Replacement loop
// First find where physics plots are replaced.
const physicsLoopRegex = /for \\(let i = 0; i < physicsPlots\\.length; i\\+\\+\\) \\{[\\s\\S]*?finalHtml = finalHtml\\.replace\\(\`PHYSICSPLOTPLACEHOLDER\\$\\{i\\}\`, physicsCardHtml\\);\\n    \\}/;

const liveCodeLoop = `    for (let i = 0; i < liveCodeBlocks.length; i++) {
      const codeStr = liveCodeBlocks[i];
      if (codeStr.length > 10000) {
        finalHtml = finalHtml.replace(\`LIVECODEPLACEHOLDER\${i}\`, '<div style="padding:16px;background:var(--color-danger-soft);color:var(--color-danger);border-radius:var(--radius-card);text-align:center;">کد بسیار طولانی است</div>');
        continue;
      }
      
      const docStr = codeStr.toLowerCase().includes('<html') ? codeStr : \`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;font-family:sans-serif;}</style></head><body>\${codeStr}</body></html>\`;
      
      const liveCardHtml = \`
        <div class="live-code-card" style="
          background: var(--bg-card);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-card);
          margin: var(--space-3) 0;
          box-shadow: var(--shadow-card);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          width: 100%;
          box-sizing: border-box;
        ">
          <div style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--bg-secondary);
            padding: 8px 16px;
            border-bottom: 1px solid var(--border-soft);
          ">
            <span style="font-size: 13px; font-weight: 700; color: var(--text-primary);">پیش‌نمایش زنده</span>
            <button class="icon-btn material-symbols-rounded live-code-expand-btn" data-index="\${i}" style="font-size: 18px; color: var(--text-secondary); padding: 4px; border-radius: var(--radius-btn); cursor: pointer; transition: background 0.2s;">open_in_full</button>
          </div>
          <iframe sandbox="allow-scripts" srcdoc="\${escapeHtml(docStr)}" style="
            width: 100%;
            height: 260px;
            border: none;
            background: #fff;
          "></iframe>
        </div>
      \`;
      finalHtml = finalHtml.replace(\`LIVECODEPLACEHOLDER\${i}\`, liveCardHtml);
    }`;

let foundMatch = content.match(physicsLoopRegex);
if (foundMatch) {
  content = content.replace(physicsLoopRegex, foundMatch[0] + "\n\n" + liveCodeLoop);
} else {
  console.log("Could not find physics loop");
}

// 4. Instruction
const instructionEnd = `در بلاک‌های physics توضیحات اضافه ننویسید.`;
const newInstruction = `۱۲. اگر کاربر خواست چیزی را با کدنویسی رسم کنید، بسازید یا شبیه‌سازی کنید (مثلاً 'یک دایره با کد بکش'، 'یک انیمیشن ساده بساز'، 'یک بازی کوچک درست کن')، حتماً یک بلاک کد با زبان run تولید کنید. کد داخل این بلاک باید یک سند HTML کامل، مستقل و بدون وابستگی به فایل یا کتابخانه خارجی باشد (تگ‌های style و script داخل همان بلاک نوشته شوند). از رنگ‌های ساده و خوانا استفاده کنید. در این بلاک هیچ متن توضیحی اضافه ننویسید؛ فقط کد.

` + instructionEnd;
content = content.replace(instructionEnd, newInstruction);

fs.writeFileSync('js/features/pages.js', content, 'utf8');
