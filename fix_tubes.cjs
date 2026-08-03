const fs = require('fs');
let content = fs.readFileSync('js/features/pages.js', 'utf8');

const startStr = "      } else if (spec.type === 'tube_system') {";
const endStr = "      card.addEventListener('click', () => {";

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr, startIndex);

if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find start or end bounds.");
    process.exit(1);
}

let block = content.substring(startIndex, endIndex);

// Make arm accesses safe
block = block.replace(/totalW \+= arm\.w;/g, 'if(arm) totalW += arm.w || 20;');
block = block.replace(/cx\.push\(curX \+ arm\.w \/ 2\);/g, 'cx.push(curX + (arm ? (arm.w || 20) : 20) / 2);');
block = block.replace(/curX \+= arm\.w \+ gap;/g, 'curX += (arm ? (arm.w || 20) : 20) + gap;');

block = block.replace(/arms\[liq.arm\]\.w/g, '(arms[liq.arm] ? arms[liq.arm].w || 20 : 20)');
block = block.replace(/arm\.w/g, '(arm.w || 20)');
block = block.replace(/arm\.h/g, '(arm.h || 40)');

block = block.replace(/arms\.forEach\(\(arm, i\) => {/g, 'arms.forEach((arm, i) => {\n           if (!arm) return;');
block = block.replace(/arms\.forEach\(arm => {/g, 'arms.forEach(arm => {\n           if (!arm) return;');

const finalContent = content.substring(0, startIndex) + block + content.substring(endIndex);
fs.writeFileSync('js/features/pages.js', finalContent);
console.log('Update complete.');
