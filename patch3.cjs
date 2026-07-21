const fs = require('fs');

let content = fs.readFileSync('js/features/pages.js', 'utf8');

const emptyCheck = `      if (!codeStr.trim()) {
        finalHtml = finalHtml.replace(\`LIVECODEPLACEHOLDER\${i}\`, '<div style="padding:16px;background:var(--bg-sunken);color:var(--text-secondary);border-radius:var(--radius-card);text-align:center;border:1px solid var(--border-soft);margin:var(--space-2) 0;">پیش‌نمایش در دسترس نیست</div>');
        continue;
      }
`;

content = content.replace("      if (codeStr.length > 10000) {", emptyCheck + "      if (codeStr.length > 10000) {");

fs.writeFileSync('js/features/pages.js', content, 'utf8');
