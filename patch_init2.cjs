const fs = require('fs');

let content = fs.readFileSync('js/features/pages.js', 'utf8');

const oldInit = `  function initLiveCodeBlocks(parent) {
    const btns = parent.querySelectorAll('.live-code-expand-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.live-code-card');
        const iframe = card.querySelector('iframe');
        const docStr = iframe.srcdoc;
        import('../core/ui.js').then(({ openBottomSheet }) => {
          openBottomSheet(\`
            <div style="display:flex;flex-direction:column;height:100%;background:var(--bg-card);overflow:hidden;border-radius:var(--radius-card) var(--radius-card) 0 0;">
              <div style="padding:16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-soft);font-weight:700;font-size:14px;color:var(--text-primary);text-align:center;">
                پیش‌نمایش زنده
              </div>
              <iframe sandbox="allow-scripts" srcdoc="\${escapeHtml(docStr)}" style="width:100%;flex:1;border:none;background:#fff;"></iframe>
            </div>
          \`, { height: '70vh' });
        });
      });
    });
  }`;

const newInit = `  function initLiveCodeBlocks(parent) {
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

content = content.replace(oldInit, newInit);

fs.writeFileSync('js/features/pages.js', content, 'utf8');
