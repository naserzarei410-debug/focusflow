const fs = require('fs');
let code = fs.readFileSync('js/features/pages.js', 'utf8');

code = code.replace(
  "      if (key === 'title') {",
  "      if (key === 'charge') {\n        spec.charge = parseFloat(val);\n      } else if (key === 'title') {"
);

fs.writeFileSync('js/features/pages.js', code);
