const fs = require('fs');

const file = 'js/features/pages.js';
let content = fs.readFileSync(file, 'utf-8');

// We need to find the `initIntervalPlots(parent)` function and replace its body
// Wait, actually, let's just add the import at the top and replace the whole function

// Find function initIntervalPlots(parent) { ... }
const startIdx = content.indexOf('function initIntervalPlots(parent) {');
if (startIdx === -1) {
  console.log("Could not find initIntervalPlots");
  process.exit(1);
}

// Simple brace matching
let braceCount = 0;
let inBrace = false;
let endIdx = -1;

for (let i = startIdx; i < content.length; i++) {
  if (content[i] === '{') {
    braceCount++;
    inBrace = true;
  } else if (content[i] === '}') {
    braceCount--;
    if (inBrace && braceCount === 0) {
      endIdx = i;
      break;
    }
  }
}

if (endIdx === -1) {
  console.log("Could not find end of initIntervalPlots");
  process.exit(1);
}

// Add import if not present
if (!content.includes("import { initInteractiveInterval }")) {
  content = "import { initInteractiveInterval } from './interval-plot.js';\n" + content;
}

// Let's adjust the startIdx if there are preceding lines we want to keep, but we are just replacing the function
const replacement = `function initIntervalPlots(parent) {
    const cards = parent.querySelectorAll('.interactive-interval-card');
    cards.forEach((card) => {
        initInteractiveInterval(card);
    });
}`;

content = content.substring(0, startIdx) + replacement + content.substring(endIdx + 1);

fs.writeFileSync(file, content);
console.log("Done");
