const parseRange = (rangeStr) => {
    const clean = rangeStr.trim();
    if (clean.length < 5) return null;
    const startChar = clean[0];
    const endChar = clean[clean.length - 1];
    const inner = clean.slice(1, -1);
    const parts = inner.split(',').map(s => s.trim());
    if (parts.length === 2) {
      const startValStr = parts[0];
      const endValStr = parts[1];
      
      const evalVal = (str) => {
        const s = str.toLowerCase().replace(/\\/g, '');
        if (s.includes('-infty') || s.includes('-∞')) return Number.NEGATIVE_INFINITY;
        if (s.includes('+infty') || s.includes('+∞') || s === 'infty' || s === '∞') return Number.POSITIVE_INFINITY;
        if (str.includes('/')) {
          const p = str.split('/');
          return parseFloat(p[0]) / parseFloat(p[1]);
        }
        return parseFloat(str);
      };
      
      const startVal = evalVal(startValStr);
      const endVal = evalVal(endValStr);
      
      return {
        startOpen: startChar === '(',
        startVal,
        startLabel: startValStr,
        endOpen: endChar === ')',
        endVal,
        endLabel: endValStr
      };
    }
    return null;
}

console.log(parseRange("(-∞, +∞)"));
console.log(parseRange("(- ∞, + ∞)"));
