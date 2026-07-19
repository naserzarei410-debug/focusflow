import * as d3 from 'd3';

export function parseRange(rangeStr) {
  if (!rangeStr) return null;
  const match = rangeStr.trim().match(/^([\[\(])\s*(.+?)\s*,\s*(.+?)\s*([\]\)])$/);
  if (!match) return null;
  const [, startBracket, startStr, endStr, endBracket] = match;

  const evalVal = (s) => {
    s = s.toLowerCase().replace(/[\s\\]/g, '');
    if (s === '-infty' || s === '-infinity' || s === '-∞' || s === '−∞' || s === '-inf') return Number.NEGATIVE_INFINITY;
    if (s === '+infty' || s === '+infinity' || s === '+∞' || s === '∞' || s === 'inf' || s === '+inf' || s === 'infty' || s === 'infinity') return Number.POSITIVE_INFINITY;
    if (s.includes('/')) {
      const p = s.split('/');
      return parseFloat(p[0]) / parseFloat(p[1]);
    }
    return parseFloat(s);
  };

  const startVal = evalVal(startStr);
  const endVal = evalVal(endStr);
  if (isNaN(startVal) || isNaN(endVal)) return null;

  return {
    startOpen: startBracket === '(',
    startVal,
    startLabel: startStr,
    endOpen: endBracket === ')',
    endVal,
    endLabel: endStr,
    rangeStr: rangeStr.trim()
  };
}

export class IntervalSet {
  constructor(intervals = []) {
    this.intervals = [];
    intervals.forEach(inv => {
      if (inv) this.add(inv);
    });
  }

  add(inv) {
    if (inv.startVal > inv.endVal) return;
    if (inv.startVal === inv.endVal && (inv.startOpen || inv.endOpen)) return;
    this.intervals.push(inv);
    this.normalize();
  }

  normalize() {
    if (this.intervals.length === 0) return;
    this.intervals.sort((a, b) => {
      if (a.startVal !== b.startVal) return a.startVal - b.startVal;
      return (a.startOpen ? 1 : 0) - (b.startOpen ? 1 : 0);
    });

    const res = [this.intervals[0]];
    for (let i = 1; i < this.intervals.length; i++) {
      const curr = this.intervals[i];
      const last = res[res.length - 1];
      
      let overlap = false;
      let touchAndConnect = false;

      if (curr.startVal < last.endVal) {
        overlap = true;
      } else if (curr.startVal === last.endVal) {
        if (!last.endOpen || !curr.startOpen) {
          touchAndConnect = true;
        }
      }

      if (overlap || touchAndConnect) {
        if (curr.endVal > last.endVal) {
          last.endVal = curr.endVal;
          last.endOpen = curr.endOpen;
        } else if (curr.endVal === last.endVal) {
          last.endOpen = last.endOpen && curr.endOpen;
        }
      } else {
        res.push(curr);
      }
    }
    this.intervals = res;
  }

  intersect(otherSet) {
    const res = new IntervalSet();
    for (const a of this.intervals) {
      for (const b of otherSet.intervals) {
        const startVal = Math.max(a.startVal, b.startVal);
        const endVal = Math.min(a.endVal, b.endVal);
        if (startVal > endVal) continue;
        
        let startOpen = (startVal === a.startVal ? a.startOpen : false) || (startVal === b.startVal ? b.startOpen : false);
        let endOpen = (endVal === a.endVal ? a.endOpen : false) || (endVal === b.endVal ? b.endOpen : false);
        
        if (startVal === endVal && (startOpen || endOpen)) continue;
        
        res.add({startVal, endVal, startOpen, endOpen});
      }
    }
    return res;
  }

  union(otherSet) {
    const res = new IntervalSet(this.intervals);
    for (const b of otherSet.intervals) {
      res.add(b);
    }
    return res;
  }

  difference(otherSet) {
    let current = this.intervals;
    
    for (const b of otherSet.intervals) {
      const nextCurrent = [];
      for (const a of current) {
        if (b.endVal < a.startVal || b.startVal > a.endVal || 
           (b.endVal === a.startVal && (b.endOpen || a.startOpen)) ||
           (b.startVal === a.endVal && (b.startOpen || a.endOpen))) {
          nextCurrent.push(a);
        } else {
          if (a.startVal < b.startVal || (a.startVal === b.startVal && !a.startOpen && b.startOpen)) {
            nextCurrent.push({
              startVal: a.startVal,
              startOpen: a.startOpen,
              endVal: b.startVal,
              endOpen: !b.startOpen
            });
          }
          if (a.endVal > b.endVal || (a.endVal === b.endVal && !a.endOpen && b.endOpen)) {
            nextCurrent.push({
              startVal: b.endVal,
              startOpen: !b.endOpen,
              endVal: a.endVal,
              endOpen: a.endOpen
            });
          }
        }
      }
      current = nextCurrent;
    }
    return new IntervalSet(current);
  }

  isEmpty() {
    return this.intervals.length === 0;
  }

  toString() {
    if (this.isEmpty()) return '∅';
    const fmt = v => {
      if (v === Number.NEGATIVE_INFINITY) return '-∞';
      if (v === Number.POSITIVE_INFINITY) return '+∞';
      return v;
    };
    return this.intervals.map(inv => {
      const s = inv.startOpen ? '(' : '[';
      const e = inv.endOpen ? ')' : ']';
      return `${s}${fmt(inv.startVal)}, ${fmt(inv.endVal)}${e}`;
    }).join(' ∪ ');
  }
}

export function parseIntervalSpec(specText) {
  const lines = specText.split('\n');
  const spec = {
    title: 'بازه روی محور اعداد',
    intervals: []
  };

  lines.forEach((line) => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const key = parts[0].trim().toLowerCase();
      const val = parts.slice(1).join(':').trim();
      if (key === 'title') {
        spec.title = val;
      } else if (key === 'interval') {
        const iParts = val.split('|').map(s => s.trim());
        if (iParts.length >= 2) {
          const label = iParts[0];
          const rangeStr = iParts[1];
          const color = iParts[2] || 'var(--color-primary)';
          const desc = iParts[3] || '';
          spec.intervals.push({ label, rangeStr, color, desc });
        }
      }
    }
  });
  return spec;
}

export function initInteractiveInterval(card) {
  const specStr = card.getAttribute('data-spec');
  if (!specStr) return;
  const spec = parseIntervalSpec(specStr);
  
  const svgEl = card.querySelector('.interval-svg');
  const hoverInfo = card.querySelector('.interval-hover-info');
  const btnContainer = card.querySelector('.interval-buttons');
  const resultDisplay = card.querySelector('.interval-result-display');
  const resultTitle = card.querySelector('.result-title');
  const resultDesc = card.querySelector('.result-desc');
  const resultSet = card.querySelector('.result-set');

  if (!svgEl || !btnContainer || !resultDisplay) return;

  // Find dynamic range
  let minVal = 0, maxVal = 0;
  const finiteVals = [];
  spec.intervals.forEach((inv) => {
    const range = parseRange(inv.rangeStr);
    if (range) {
      if (isFinite(range.startVal)) finiteVals.push(range.startVal);
      if (isFinite(range.endVal)) finiteVals.push(range.endVal);
    }
  });
  if (finiteVals.length > 0) {
    minVal = Math.min(...finiteVals);
    maxVal = Math.max(...finiteVals);
  } else {
    minVal = -5; maxVal = 5;
  }
  if (minVal === maxVal) {
    minVal -= 5; maxVal += 5;
  }
  const valRange = maxVal - minVal;
  const padding = valRange * 0.15 || 2;

  const width = svgEl.clientWidth || 350;
  const height = svgEl.clientHeight || 160;
  
  const margin = { top: 20, right: 30, bottom: 40, left: 30 };
  const yAxis = height - 40;

  const d3Svg = d3.select(svgEl);
  d3Svg.selectAll("*").remove();
  
  // Create a defs for clipPath
  d3Svg.append("defs").append("clipPath")
    .attr("id", "clip")
    .append("rect")
    .attr("x", margin.left)
    .attr("y", 0)
    .attr("width", width - margin.left - margin.right)
    .attr("height", height);

  let x = d3.scaleLinear()
    .domain([minVal - padding, maxVal + padding])
    .range([margin.left, width - margin.right]);

  const gAxis = d3Svg.append("g");
  const gPlot = d3Svg.append("g").attr("clip-path", "url(#clip)");
  
  let activeOverlayResult = null; // Instance of IntervalSet

  function draw(currentXScale) {
    gAxis.selectAll("*").remove();
    gPlot.selectAll("*").remove();

    // Draw main axis line extending across entire view (or padded)
    gAxis.append("line")
      .attr("x1", margin.left)
      .attr("y1", yAxis)
      .attr("x2", width - margin.right)
      .attr("y2", yAxis)
      .attr("stroke", "var(--text-primary)")
      .attr("stroke-width", 1.5);

    // Arrows
    gAxis.append("polygon")
      .attr("points", `${width - margin.right},${yAxis - 4} ${width - margin.right + 6},${yAxis} ${width - margin.right},${yAxis + 4}`)
      .attr("fill", "var(--text-primary)");
    gAxis.append("polygon")
      .attr("points", `${margin.left},${yAxis - 4} ${margin.left - 6},${yAxis} ${margin.left},${yAxis + 4}`)
      .attr("fill", "var(--text-primary)");

    // Ticks
    const ticks = currentXScale.ticks(width / 50);
    ticks.forEach(tick => {
      const xPos = currentXScale(tick);
      if (xPos >= margin.left && xPos <= width - margin.right) {
        gAxis.append("line")
          .attr("x1", xPos).attr("y1", yAxis - 3)
          .attr("x2", xPos).attr("y2", yAxis + 3)
          .attr("stroke", "var(--text-primary)");
        gAxis.append("text")
          .attr("x", xPos).attr("y", yAxis + 16)
          .attr("text-anchor", "middle")
          .attr("font-size", 10)
          .attr("font-family", "var(--font-mono)")
          .attr("fill", "var(--text-primary)")
          .text(tick);
      }
    });

    // Draw intervals
    spec.intervals.forEach((inv, idx) => {
      const range = parseRange(inv.rangeStr);
      if (!range) return;
      
      const y = yAxis - 25 - idx * 22;
      const color = inv.color || '#3B82F6';

      const startX = range.startVal === Number.NEGATIVE_INFINITY ? margin.left - 20 : currentXScale(range.startVal);
      const endX = range.endVal === Number.POSITIVE_INFINITY ? width - margin.right + 20 : currentXScale(range.endVal);

      // Dash lines
      if (isFinite(range.startVal) && startX >= margin.left && startX <= width - margin.right) {
        gPlot.append("line")
          .attr("x1", startX).attr("y1", y + 4)
          .attr("x2", startX).attr("y2", yAxis)
          .attr("stroke", "var(--border-subtle)")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "2,2")
          .style("opacity", 0.6);
      }
      if (isFinite(range.endVal) && endX >= margin.left && endX <= width - margin.right) {
        gPlot.append("line")
          .attr("x1", endX).attr("y1", y + 4)
          .attr("x2", endX).attr("y2", yAxis)
          .attr("stroke", "var(--border-subtle)")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "2,2")
          .style("opacity", 0.6);
      }

      // Interval line
      const group = gPlot.append("g")
        .style("cursor", "pointer")
        .on("mouseenter", () => {
          group.selectAll(".main-line").attr("stroke-width", 5.5);
          hoverInfo.style.opacity = '1';
          hoverInfo.innerHTML = `بازه <span style="color:${color}; font-weight:800;">${inv.label}</span>: <span style="direction:ltr; display:inline-block; font-family:var(--font-mono); font-weight:800;">${inv.rangeStr}</span> ${inv.desc ? ` - ${inv.desc}` : ''}`;
        })
        .on("mouseleave", () => {
          group.selectAll(".main-line").attr("stroke-width", 3.5);
          hoverInfo.style.opacity = '0';
        });

      group.append("line")
        .attr("class", "main-line")
        .attr("x1", startX).attr("y1", y)
        .attr("x2", endX).attr("y2", y)
        .attr("stroke", color)
        .attr("stroke-width", 3.5)
        .attr("stroke-linecap", "round")
        .style("transition", "stroke-width 0.15s");

      // Start point
      if (range.startVal === Number.NEGATIVE_INFINITY) {
        // No arrow head, just let the line bleed off the edge
      } else {
        group.append("circle")
          .attr("cx", startX).attr("cy", y)
          .attr("r", range.startOpen ? 4 : 5.5)
          .attr("fill", range.startOpen ? "var(--bg-card)" : color)
          .attr("stroke", color).attr("stroke-width", range.startOpen ? 2.5 : 0);
      }

      // End point
      if (range.endVal === Number.POSITIVE_INFINITY) {
        // No arrow head, just let the line bleed off the edge
      } else {
        group.append("circle")
          .attr("cx", endX).attr("cy", y)
          .attr("r", range.endOpen ? 4 : 5.5)
          .attr("fill", range.endOpen ? "var(--bg-card)" : color)
          .attr("stroke", color).attr("stroke-width", range.endOpen ? 2.5 : 0);
      }

      // Label
      let labelX = startX;
      if (range.startVal === Number.NEGATIVE_INFINITY && range.endVal === Number.POSITIVE_INFINITY) {
        labelX = width / 2;
      } else if (range.startVal === Number.NEGATIVE_INFINITY) {
        labelX = endX;
      } else if (range.endVal === Number.POSITIVE_INFINITY) {
        labelX = startX;
      } else {
        labelX = (startX + endX) / 2;
      }

      gPlot.append("text")
        .attr("x", labelX)
        .attr("y", y - 8)
        .attr("font-size", 12)
        .attr("fill", color)
        .attr("text-anchor", "middle")
        .attr("font-weight", 800)
        .attr("stroke", "var(--bg-card)")
        .attr("stroke-width", 4)
        .attr("stroke-linejoin", "round")
        .style("paint-order", "stroke fill")
        .text(inv.label);
    });

    // Draw active overlay result
    if (activeOverlayResult && !activeOverlayResult.isEmpty()) {
      const y = yAxis;
      activeOverlayResult.intervals.forEach(inv => {
        const startX = inv.startVal === Number.NEGATIVE_INFINITY ? margin.left - 20 : currentXScale(inv.startVal);
        const endX = inv.endVal === Number.POSITIVE_INFINITY ? width - margin.right + 20 : currentXScale(inv.endVal);

        gPlot.append("line")
          .attr("x1", startX).attr("y1", y)
          .attr("x2", endX).attr("y2", y)
          .attr("stroke", "#F59E0B")
          .attr("stroke-width", 5.5)
          .attr("stroke-linecap", "round");

          if (inv.startVal === Number.NEGATIVE_INFINITY) {
            // No arrow head
          } else {
            gPlot.append("circle")
              .attr("cx", startX).attr("cy", y)
              .attr("r", inv.startOpen ? 4.5 : 5.5)
              .attr("fill", inv.startOpen ? "var(--bg-card)" : "#F59E0B")
              .attr("stroke", inv.startOpen ? "#F59E0B" : "#FFFFFF")
              .attr("stroke-width", 1.5);
          }

          if (inv.endVal === Number.POSITIVE_INFINITY) {
            // No arrow head
          } else {
            gPlot.append("circle")
              .attr("cx", endX).attr("cy", y)
              .attr("r", inv.endOpen ? 4.5 : 5.5)
              .attr("fill", inv.endOpen ? "var(--bg-card)" : "#F59E0B")
              .attr("stroke", inv.endOpen ? "#F59E0B" : "#FFFFFF")
              .attr("stroke-width", 1.5);
          }
      });
    }
  }

  // Zoom setup
  const zoom = d3.zoom()
    .scaleExtent([0.1, 50])
    .extent([[margin.left, 0], [width - margin.right, height]])
    .on("zoom", (e) => {
      const currentX = e.transform.rescaleX(x);
      draw(currentX);
    });

  d3Svg.call(zoom);

  // Initial draw
  draw(x);

  // Set up buttons
  btnContainer.innerHTML = '';
  const intervals = spec.intervals;
  const ops = [];
  const labels = intervals.map(inv => inv.label || 'بازه');
  const sets = intervals.map(inv => new IntervalSet([parseRange(inv.rangeStr)]));

  if (intervals.length === 2) {
    ops.push({
      label: `${labels[0]} ∩ ${labels[1]}`,
      desc: `اشتراک دو بازه: محدوده‌ای که عضو هر دو بازه باشد.`,
      calc: () => sets[0].intersect(sets[1])
    });
    ops.push({
      label: `${labels[0]} ∪ ${labels[1]}`,
      desc: `اجتماع دو بازه: تمام محدوده تحت پوشش هر دو بازه.`,
      calc: () => sets[0].union(sets[1])
    });
    ops.push({
      label: `${labels[0]} - ${labels[1]}`,
      desc: `تفاضل: محدوده‌ای که در ${labels[0]} هست ولی در ${labels[1]} نیست.`,
      calc: () => sets[0].difference(sets[1])
    });
    ops.push({
      label: `${labels[1]} - ${labels[0]}`,
      desc: `تفاضل: محدوده‌ای که در ${labels[1]} هست ولی در ${labels[0]} نیست.`,
      calc: () => sets[1].difference(sets[0])
    });
  } else if (intervals.length >= 3) {
    ops.push({
      label: `${labels[0]} ∩ ${labels[1]}`,
      desc: `اشتراک ${labels[0]} و ${labels[1]}`,
      calc: () => sets[0].intersect(sets[1])
    });
    ops.push({
      label: `${labels[1]} ∩ ${labels[2]}`,
      desc: `اشتراک ${labels[1]} و ${labels[2]}`,
      calc: () => sets[1].intersect(sets[2])
    });
    ops.push({
      label: `${labels[0]} ∩ ${labels[2]}`,
      desc: `اشتراک ${labels[0]} و ${labels[2]}`,
      calc: () => sets[0].intersect(sets[2])
    });
    ops.push({
      label: `${labels[0]} ∩ ${labels[1]} ∩ ${labels[2]}`,
      desc: `اشتراک هر سه بازه`,
      calc: () => sets[0].intersect(sets[1]).intersect(sets[2])
    });
    ops.push({
      label: `${labels[0]} ∪ ${labels[1]} ∪ ${labels[2]}`,
      desc: `اجتماع هر سه بازه`,
      calc: () => sets[0].union(sets[1]).union(sets[2])
    });
  }

  ops.push({
    label: 'پاک کردن',
    op: 'clear',
    isClear: true
  });

  const renderedBtns = [];
  ops.forEach((op) => {
    const btn = document.createElement('button');
    btn.textContent = op.label;
    btn.style.cssText = 'padding: 4px 8px; font-size: 10px; border-radius: 8px; border: 1.5px solid var(--border-soft); background: var(--bg-card); color: var(--text-primary); cursor: pointer; font-weight: 700; transition: all 0.2s; white-space: nowrap; margin: 2px;';
    
    if (op.isClear) {
      btn.style.borderColor = 'var(--color-danger)';
      btn.style.background = 'var(--color-danger-soft)';
      btn.style.color = 'var(--color-danger)';
    }

    btn.addEventListener('click', () => {
      renderedBtns.forEach((b) => {
        if (b === btn && !op.isClear) {
          b.style.background = 'var(--color-primary)';
          b.style.color = '#FFFFFF';
          b.style.borderColor = 'var(--color-primary)';
        } else {
          const opData = ops.find(o => o.label === b.textContent);
          if (opData && opData.isClear) {
            b.style.borderColor = 'var(--color-danger)';
            b.style.background = 'var(--color-danger-soft)';
            b.style.color = 'var(--color-danger)';
          } else {
            b.style.background = 'var(--bg-card)';
            b.style.color = 'var(--text-primary)';
            b.style.borderColor = 'var(--border-soft)';
          }
        }
      });

      if (op.isClear) {
        activeOverlayResult = null;
        resultDisplay.style.display = 'none';
        draw(d3.zoomTransform(svgEl).rescaleX(x));
        return;
      }

      const result = op.calc();
      if (result.isEmpty()) {
        activeOverlayResult = null;
        resultDisplay.style.display = 'flex';
        resultTitle.textContent = op.label;
        resultSet.textContent = '∅ (تهی)';
        resultDesc.textContent = 'این عملیات هیچ عضو مشترکی ندارد و پاسخ مجموعه تهی است.';
        draw(d3.zoomTransform(svgEl).rescaleX(x));
        return;
      }

      resultDisplay.style.display = 'flex';
      resultTitle.textContent = `عملیات ${op.label}`;
      resultDesc.textContent = op.desc;

      resultSet.innerHTML = `x ∈ <span style="direction:ltr; display:inline-block; font-family:var(--font-mono);">${result.toString()}</span>`;
      activeOverlayResult = result;
      
      draw(d3.zoomTransform(svgEl).rescaleX(x));
    });
    renderedBtns.push(btn);
    btnContainer.appendChild(btn);
  });
}
