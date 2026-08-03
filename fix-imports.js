import fs from 'fs';

function fixFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Track if we made changes
    let changed = false;
    
    // For db.js in pages.js
    if (filePath.endsWith('pages.js')) {
        content = content.replace(/const\s*{\s*db\s*}\s*=\s*await\s*import\('\.\.\/core\/db\.js'\);/g, '');
        
        if (content.includes("await import('../core/theme.js')")) {
            content = "import { theme as themeApi } from '../core/theme.js';\n" + content;
            content = content.replace(/const\s*{\s*theme\s*:\s*themeApi\s*}\s*=\s*await\s*import\('\.\.\/core\/theme\.js'\);/g, '');
        }
        
        if (content.includes("await import('../core/tts.js')")) {
            content = "import { speak } from '../core/tts.js';\n" + content;
            content = content.replace(/const\s*{\s*speak\s*}\s*=\s*await\s*import\('\.\.\/core\/tts\.js'\);/g, '');
        }
        
        fs.writeFileSync(filePath, content, 'utf8');
        changed = true;
    }
    
    // For db.js in dictation.js
    if (filePath.endsWith('dictation.js')) {
        content = "import { db } from './db.js';\n" + content;
        content = content.replace(/const\s*{\s*db\s*}\s*=\s*await\s*import\('\.\/db\.js'\);/g, '');
        fs.writeFileSync(filePath, content, 'utf8');
        changed = true;
    }
}

fixFile('js/features/pages.js');
fixFile('js/core/dictation.js');
console.log('Fixed imports');
