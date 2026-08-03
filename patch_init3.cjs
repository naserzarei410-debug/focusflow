const fs = require('fs');

let content = fs.readFileSync('js/features/pages.js', 'utf8');

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
      
      const encodedCode = encodeURIComponent(codeStr);
      
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
              <button class="icon-btn material-symbols-rounded live-code-view-btn" data-code="\${encodedCode}" style="font-size: 18px; color: var(--text-secondary); padding: 4px; border-radius: var(--radius-btn); cursor: pointer; transition: background 0.2s;" title="مشاهده کد">code</button>
              <button class="icon-btn material-symbols-rounded live-code-expand-btn" style="font-size: 18px; color: var(--text-secondary); padding: 4px; border-radius: var(--radius-btn); cursor: pointer; transition: background 0.2s;" title="بزرگنمایی">open_in_full</button>
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

const oldLoopRegex = /for \(let i = 0; i < liveCodeBlocks\.length; i\+\+\) \{[\s\S]*?finalHtml = finalHtml\.replace\(`LIVECODEPLACEHOLDER\$\{i\}`.*?;\n    \}/;

content = content.replace(oldLoopRegex, newLoop);

const oldInit = `  function initLiveCodeBlocks(parent) {
    const btns = parent.querySelectorAll('.live-code-expand-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.live-code-card');
        const iframe = card.querySelector('iframe');
        const docStr = iframe.srcdoc;
        
        const container = document.createElement('div');
        container.style.cssText = 'display:flex;flex-direction:column;height:70vh;overflow:hidden;border-radius:var(--radius-card);';
        
        const bigIframe = document.createElement('iframe');
        bigIframe.sandbox = 'allow-scripts';
        bigIframe.srcdoc = docStr;
        bigIframe.style.cssText = 'width:100%;flex:1;border:1px solid var(--border-soft);background:#fff;border-radius:var(--radius-card);';
        
        container.appendChild(bigIframe);

        import('../core/ui.js').then(({ openBottomSheet }) => {
          openBottomSheet({
            title: 'پیش‌نمایش زنده',
            content: container
          });
        });
      });
    });
  }`;

const newInit = `  function initLiveCodeBlocks(parent) {
    const expandBtns = parent.querySelectorAll('.live-code-expand-btn');
    expandBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.live-code-card');
        const iframe = card.querySelector('iframe');
        const docStr = iframe.srcdoc;
        
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:9999; background:var(--bg-page); display:flex; flex-direction:column;';
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'icon-btn material-symbols-rounded';
        closeBtn.textContent = 'close';
        closeBtn.style.cssText = 'position:fixed; top:16px; left:16px; z-index:10000; background:rgba(0,0,0,0.5); color:#fff; padding:8px; border-radius:50%; border:none; cursor:pointer; font-size:24px; display:flex; align-items:center; justify-content:center;';
        closeBtn.onclick = () => overlay.remove();
        
        const bigIframe = document.createElement('iframe');
        bigIframe.sandbox = 'allow-scripts';
        bigIframe.srcdoc = docStr;
        bigIframe.style.cssText = 'width:100%; height:100%; border:none; background:#fff;';
        
        overlay.appendChild(closeBtn);
        overlay.appendChild(bigIframe);
        document.body.appendChild(overlay);
      });
    });

    const codeBtns = parent.querySelectorAll('.live-code-view-btn');
    codeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const rawCode = decodeURIComponent(btn.getAttribute('data-code'));
        
        const container = document.createElement('div');
        container.style.cssText = 'display:flex; flex-direction:column; gap:16px;';
        
        const pre = document.createElement('pre');
        pre.className = 'code-block';
        pre.style.cssText = 'background:var(--bg-sunken); font-family:var(--font-mono); direction:ltr; text-align:left; overflow-x:auto; padding:16px; border-radius:12px; margin:0; border:1px solid var(--border-soft); font-size:var(--text-caption); max-height: 50vh;';
        const code = document.createElement('code');
        code.textContent = rawCode;
        pre.appendChild(code);
        
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:12px; justify-content:flex-end;';
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-outline';
        copyBtn.textContent = 'کپی کد';
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(rawCode).then(() => {
            import('../core/ui.js').then(({ showToast }) => showToast('کد کپی شد', 'success'));
          });
        };
        
        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn btn-primary';
        dlBtn.textContent = 'دانلود فایل';
        dlBtn.onclick = () => {
          const blob = new Blob([rawCode], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'ai-creation.html';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        };
        
        actions.append(copyBtn, dlBtn);
        container.append(pre, actions);
        
        import('../core/ui.js').then(({ openBottomSheet }) => {
          openBottomSheet({
            title: 'مشاهده کد',
            content: container
          });
        });
      });
    });
  }`;

content = content.replace(oldInit, newInit);
fs.writeFileSync('js/features/pages.js', content, 'utf8');
