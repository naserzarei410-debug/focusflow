const fs = require('fs');

let content = fs.readFileSync('js/features/pages.js', 'utf8');

// 1. Update the loop replacing LIVECODEPLACEHOLDER
const oldLoopRegex = /for \(let i = 0; i < liveCodeBlocks\.length; i\+\+\) \{[\s\S]*?finalHtml = finalHtml\.replace\(`LIVECODEPLACEHOLDER\$\{i\}`.*?;\n    \}/;

const newLoop = `    for (let i = 0; i < liveCodeBlocks.length; i++) {
      const codeStr = liveCodeBlocks[i];
      if (!codeStr.trim()) {
        finalHtml = finalHtml.replace(\`LIVECODEPLACEHOLDER\${i}\`, '<div style="padding:16px;background:var(--bg-sunken);color:var(--text-secondary);border-radius:var(--radius-card);text-align:center;border:1px solid var(--border-soft);margin:var(--space-2) 0;">پیش‌نمایش در دسترس نیست</div>');
        continue;
      }
      if (codeStr.length > 10000) {
        finalHtml = finalHtml.replace(\`LIVECODEPLACEHOLDER\${i}\`, '<div style="padding:16px;background:var(--color-danger-soft);color:var(--color-danger);border-radius:var(--radius-card);text-align:center;">کد بسیار طولانی است</div>');
        continue;
      }
      
      let docStr = '';
      if (codeStr.toLowerCase().includes('<html')) {
        docStr = codeStr;
        if (docStr.includes('</body>')) {
           docStr = docStr.replace('<head>', '<head><style>html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; } body { display:flex; align-items:center; justify-content:center; } #ai-scale-wrapper { transform-origin: center center; width:max-content; height:max-content; }</style>');
           docStr = docStr.replace(/<body[^>]*>/i, match => match + '<div id="ai-scale-wrapper">');
           docStr = docStr.replace('</body>', '</div><script>function updateScale() { const w = document.getElementById("ai-scale-wrapper"); let cw = w.scrollWidth, ch = w.scrollHeight; const fc = w.firstElementChild; if(fc) { const r = fc.getBoundingClientRect(); if(r.width>0) cw = r.width; if(r.height>0) ch = r.height; } if(cw>0 && ch>0) { const s = Math.min(window.innerWidth/cw, window.innerHeight/ch, 1); w.style.transform = "scale("+s+")"; } } window.addEventListener("load", updateScale); window.addEventListener("resize", updateScale); setTimeout(updateScale, 100);</script></body>');
        }
      } else {
        docStr = \`<!DOCTYPE html><html><head><meta charset="utf-8"><style>html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; } body { display:flex; align-items:center; justify-content:center; background: transparent; } #ai-scale-wrapper { transform-origin: center center; width:max-content; height:max-content; }</style></head><body><div id="ai-scale-wrapper">\${codeStr}</div><script>
      function updateScale() {
        const wrapper = document.getElementById('ai-scale-wrapper');
        const firstChild = wrapper.firstElementChild;
        let contentWidth = wrapper.scrollWidth;
        let contentHeight = wrapper.scrollHeight;
        if (firstChild) {
          const rect = firstChild.getBoundingClientRect();
          if (rect.width > 0) contentWidth = rect.width;
          if (rect.height > 0) contentHeight = rect.height;
        }
        if (contentWidth === 0 || contentHeight === 0) return;
        const scale = Math.min(window.innerWidth / contentWidth, window.innerHeight / contentHeight, 1);
        wrapper.style.transform = 'scale(' + scale + ')';
      }
      window.addEventListener('load', updateScale);
      window.addEventListener('resize', updateScale);
      setTimeout(updateScale, 100);
      </script></body></html>\`;
      }
      
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
            <div style="display:flex; gap: 8px;">
              <button class="icon-btn material-symbols-rounded live-code-view-btn" data-index="\${i}" style="font-size: 18px; color: var(--text-secondary); padding: 4px; border-radius: var(--radius-btn); cursor: pointer; transition: background 0.2s;" title="مشاهده کد">code</button>
              <button class="icon-btn material-symbols-rounded live-code-expand-btn" data-index="\${i}" style="font-size: 18px; color: var(--text-secondary); padding: 4px; border-radius: var(--radius-btn); cursor: pointer; transition: background 0.2s;" title="بزرگنمایی">open_in_full</button>
            </div>
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

content = content.replace(oldLoopRegex, newLoop);

fs.writeFileSync('js/features/pages.js', content, 'utf8');
