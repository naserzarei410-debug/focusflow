import fs from 'fs';
let content = fs.readFileSync('index.html', 'utf8');
content = content.replace(/<!--[\s\S]*?-->/g, '');
content = content.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync('index.html', content, 'utf8');
