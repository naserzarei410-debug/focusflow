const specText = `title: یون آمونیوم (NH4+)
charge: 1
atom: N1 | N | 1 | 5 | 5
atom: H1 | H | 0 | 5 | 2
atom: H2 | H | 0 | 5 | 8
atom: H3 | H | 0 | 2 | 5
atom: H4 | H | 0 | 8 | 5
bond: N1-H1 | 1
bond: N1-H2 | 1
bond: N1-H3 | 1
bond: N1-H4 | 1`;

function parseLewisSpec(specText) {
    const spec = { title: 'ساختار لوویس', charge: null, atoms: [], bonds: [], lones: [] };
    specText.split('\n').forEach((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return;
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = line.slice(colonIdx + 1).trim();
      if (key === 'charge') {
        spec.charge = parseFloat(val);
      } else if (key === 'title') {
        spec.title = val;
      }
    });
    return spec;
}
console.log(parseLewisSpec(specText));
