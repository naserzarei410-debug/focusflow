const fs = require('fs');
const lines = fs.readFileSync('js/features/pages.js', 'utf8').split('\n');

const startIndex = lines.findIndex(l => l.includes("else if (spec.type === 'manometer_tanks') {"));
const endIndex = lines.findIndex((l, i) => i > startIndex && l.includes("} else if (spec.type === 'tube_system') {"));

if (startIndex !== -1 && endIndex !== -1) {
    const newLines = `      } else if (spec.type === 'manometer_tanks') {
        const p_a = spec.p_a || '0.12MPa';
        const h1 = spec.h1 || 'h';
        const h2 = spec.h2 || '11 cm';
        const liq1 = spec.liq1 || 'آب';
        const liq2 = spec.liq2 || 'آب';
        const text_a = spec.text_a || 'مخزن گاز A';
        const text_b = spec.text_b || 'مخزن گاز B';

        const svgStr = \`<defs>
        <pattern id="dotPink" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#ffe6f0"/>
            <circle cx="3" cy="3" r="1.5" fill="#f48fb1"/>
            <circle cx="9" cy="9" r="1.5" fill="#f48fb1"/>
        </pattern>
        <pattern id="dotGreen" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#e8f5e9"/>
            <circle cx="3" cy="3" r="1.5" fill="#81c784"/>
            <circle cx="9" cy="9" r="1.5" fill="#81c784"/>
        </pattern>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3e2723" />
        </marker>
    </defs>

    <g transform="translate(40, 50)">
        <rect x="0" y="0" width="150" height="260" fill="url(#dotPink)" stroke="#3e2723" stroke-width="3"/>
        <text x="75" y="60" text-anchor="middle" font-size="20" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" font-weight="bold" direction="rtl">\${text_a}</text>
        <text x="75" y="180" text-anchor="middle" font-size="20" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" font-weight="bold" direction="rtl">\${p_a}</text>

        <rect x="150" y="0" width="200" height="260" fill="url(#dotGreen)" stroke="#3e2723" stroke-width="3"/>
        <text x="220" y="60" text-anchor="middle" font-size="20" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" font-weight="bold" direction="rtl">\${text_b}</text>

        <path d="M 170 180 L 190 180 L 190 220 A 30 30 0 0 0 250 220 L 250 140 L 230 140 L 230 220 A 10 10 0 0 1 170 220 Z" fill="#03a9f4"/>
        <path d="M 150 90 L 160 90 A 30 30 0 0 1 190 120 L 190 220 A 30 30 0 0 0 250 220 L 250 70 M 230 70 L 230 220 A 10 10 0 0 1 170 220 L 170 120 A 10 10 0 0 0 160 110 L 150 110" fill="none" stroke="#3e2723" stroke-width="3"/>
        
        <line x1="150" y1="91.5" x2="150" y2="108.5" stroke="#ffe6f0" stroke-width="4"/>

        <path d="M 370 190 L 390 190 L 390 220 A 30 30 0 0 0 450 220 L 450 80 L 430 80 L 430 220 A 10 10 0 0 1 370 220 Z" fill="#03a9f4"/>
        <path d="M 350 90 L 360 90 A 30 30 0 0 1 390 120 L 390 220 A 30 30 0 0 0 450 220 L 450 40 M 430 40 L 430 220 A 10 10 0 0 1 370 220 L 370 120 A 10 10 0 0 0 360 110 L 350 110" fill="none" stroke="#3e2723" stroke-width="3"/>
        
        <line x1="350" y1="91.5" x2="350" y2="108.5" stroke="#e8f5e9" stroke-width="4"/>

        <line x1="160" y1="180" x2="225" y2="180" stroke="#3e2723" stroke-width="1.5" stroke-dasharray="6,4"/>
        <line x1="360" y1="190" x2="425" y2="190" stroke="#3e2723" stroke-width="1.5" stroke-dasharray="6,4"/>
        <line x1="425" y1="80" x2="475" y2="80" stroke="#3e2723" stroke-width="1.5" stroke-dasharray="6,4"/>

        <line x1="210" y1="145" x2="210" y2="175" stroke="#3e2723" stroke-width="2" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <text x="220" y="165" font-size="16" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">\${h1}</text>

        <line x1="465" y1="85" x2="465" y2="185" stroke="#3e2723" stroke-width="2" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <g transform="translate(485, 135) rotate(90)">
            <text x="0" y="0" text-anchor="middle" font-size="18" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">\${h2}</text>
        </g>

        <text x="260" y="240" font-size="18" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">\${liq1}</text>
        <line x1="250" y1="235" x2="235" y2="225" stroke="#3e2723" stroke-width="1.5"/>

        <text x="460" y="240" font-size="18" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">\${liq2}</text>
        <line x1="450" y1="235" x2="435" y2="225" stroke="#3e2723" stroke-width="1.5"/>

        <text x="440" y="25" text-anchor="middle" font-size="18" font-family="IRANSans, Arial, sans-serif" fill="#3e2723" direction="rtl">هوای محیط</text>
        <line x1="440" y1="30" x2="440" y2="40" stroke="#3e2723" stroke-width="1.5"/>

    </g>\`;
        g.innerHTML = svgStr;`;

    const resultLines = [...lines.slice(0, startIndex), newLines, ...lines.slice(endIndex)];
    fs.writeFileSync('js/features/pages.js', resultLines.join('\n'));
    console.log('Fixed SVG!');
} else {
    console.error('Could not find start/end lines');
}
