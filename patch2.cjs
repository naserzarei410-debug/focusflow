const fs = require('fs');

let content = fs.readFileSync('js/features/pages.js', 'utf8');

const target = "    return finalHtml;\n  }\n\n  function renderMessage";

const liveCodeLoop = `
    for (let i = 0; i < liveCodeBlocks.length; i++) {
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
    }

    return finalHtml;
  }

  function renderMessage`;

content = content.replace(target, liveCodeLoop);

fs.writeFileSync('js/features/pages.js', content, 'utf8');
