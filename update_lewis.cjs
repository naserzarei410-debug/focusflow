const fs = require('fs');
let code = fs.readFileSync('js/features/pages.js', 'utf8');

// 1. Update system prompt
code = code.replace(
  '- جفت‌های الکترون ناپیوندی (لون پر) با خط lone مشخص می‌شوند: lone: شناسه | تعداد جفت الکترون ناپیوندی روی آن اتم',
  '- جفت‌های الکترون ناپیوندی (لون پر) با خط lone مشخص می‌شوند: lone: شناسه | تعداد جفت الکترون ناپیوندی روی آن اتم\n- بار الکتریکی کل ساختار (برای یون‌ها): charge: مقدار بار (مثلاً -2 یا +1)'
);

code = code.replace(
  'title: یون آمونیوم (NH4+)',
  'title: یون آمونیوم (NH4+)\ncharge: 1'
);

// 2. Parse overall charge
code = code.replace(
  "const spec = { title: 'ساختار لوویس', atoms: [], bonds: [], lones: [] };",
  "const spec = { title: 'ساختار لوویس', charge: null, atoms: [], bonds: [], lones: [] };"
);

code = code.replace(
  "if (key === 'title') {",
  "if (key === 'charge') {\n        spec.charge = parseFloat(val);\n      } else if (key === 'title') {"
);

// 3. Fix dy for lone pairs
code = code.replace(
  "const dx = Math.cos(rad), dy = -Math.sin(rad);",
  "const dx = Math.cos(rad), dy = Math.sin(rad);"
);

// 4. Update buildLewisSvg to draw brackets if spec.charge != null
let svgFuncReplace = `
    const PADDING = spec.charge != null ? 65 : 50; // extra padding for brackets
    const ATOM_R = 15; // buffer radius so bonds/lone pairs don't overlap the symbol

    const xs = spec.atoms.map((a) => a.x);
    const ys = spec.atoms.map((a) => a.y);
    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 0);
    const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0);

    const toPx = (a) => ({
      x: PADDING + (a.x - minX) * PX_PER_UNIT,
      y: PADDING + (a.y - minY) * PX_PER_UNIT,
    });

    const width = PADDING * 2 + (maxX - minX) * PX_PER_UNIT;
    const height = PADDING * 2 + (maxY - minY) * PX_PER_UNIT;
`;

code = code.replace(
  "    const PADDING = 50;\n    const ATOM_R = 15; // buffer radius so bonds/lone pairs don't overlap the symbol\n\n    const xs = spec.atoms.map((a) => a.x);\n    const ys = spec.atoms.map((a) => a.y);\n    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 0);\n    const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0);\n\n    const toPx = (a) => ({\n      x: PADDING + (a.x - minX) * PX_PER_UNIT,\n      y: PADDING + (a.y - minY) * PX_PER_UNIT,\n    });\n\n    const width = PADDING * 2 + (maxX - minX) * PX_PER_UNIT;\n    const height = PADDING * 2 + (maxY - minY) * PX_PER_UNIT;",
  svgFuncReplace.trim()
);

// Brackets and charge drawing
let bracketSvg = `
    let overallChargeSvg = '';
    if (spec.charge != null && spec.charge !== 0) {
      const bX = 15;
      const bW = width - 30;
      const bY = 15;
      const bH = height - 30;
      const tlen = 10;
      
      overallChargeSvg += \`
        <path d="M \${bX + tlen} \${bY} L \${bX} \${bY} L \${bX} \${bY + bH} L \${bX + tlen} \${bY + bH}" fill="none" stroke="var(--text-primary)" stroke-width="2" />
        <path d="M \${bX + bW - tlen} \${bY} L \${bX + bW} \${bY} L \${bX + bW} \${bY + bH} L \${bX + bW - tlen} \${bY + bH}" fill="none" stroke="var(--text-primary)" stroke-width="2" />
        <text x="\${bX + bW + 4}" y="\${bY - 4}" font-size="18" font-weight="800" font-family="var(--font-mono), sans-serif" fill="var(--text-primary)">\${formatCharge(spec.charge)}</text>
      \`;
    }
`;

code = code.replace(
  "const svg = `<svg class=\"lewis-svg\"",
  bracketSvg + "\n    const svg = `<svg class=\"lewis-svg\""
);

code = code.replace(
  "${bondsSvg}${lonesSvg}${atomsSvg}",
  "${bondsSvg}${atomsSvg}${lonesSvg}${overallChargeSvg}"
);

fs.writeFileSync('js/features/pages.js', code);
