const fs = require('fs');
try {
  new Function(fs.readFileSync('js/features/pages.js', 'utf8'));
  console.log("No syntax error");
} catch(e) {
  console.error("Syntax Error: " + e.message);
}
