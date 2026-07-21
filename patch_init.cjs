const fs = require('fs');

let content = fs.readFileSync('js/features/pages.js', 'utf8');

const target1 = "  function initPhysicsSimulations(parent) {";
const insertion1 = `  function initLiveCodeBlocks(parent) {
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
  }

  function initPhysicsSimulations`;

content = content.replace(target1, insertion1);

const target2 = "    initPhysicsSimulations(bubble);\n  }\n}";
const insertion2 = "    initPhysicsSimulations(bubble);\n    initLiveCodeBlocks(bubble);\n  }\n}";

content = content.replace(target2, insertion2);

fs.writeFileSync('js/features/pages.js', content, 'utf8');
