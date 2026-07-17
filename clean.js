import fs from 'fs';
import path from 'path';

function cleanFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    // Remove block comments that mention "Phase"
    let newContent = content.replace(/\/\*\*[\s\S]*?Phase[\s\S]*?\*\//ig, '');
    
    // Remove console.log entirely
    newContent = newContent.replace(/console\.log\([^)]*\);?/g, '');
    
    // Collapse 3 or more empty lines to 2 empty lines
    newContent = newContent.replace(/\n{4,}/g, '\n\n\n');
    
    if (content !== newContent) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log('Cleaned', filePath);
    }
}

function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            scanDir(fullPath);
        } else if (fullPath.endsWith('.js')) {
            cleanFile(fullPath);
        }
    }
}

scanDir('js');
cleanFile('js/app.js');
