const fs = require('fs');
const content = fs.readFileSync('js/features/pages.js', 'utf8');

const startStr = "      } else if (spec.type === 'connected_tubes') {";
const endStr = "      card.addEventListener('click', () => {";

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr, startIndex);

if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find start or end bounds.");
    process.exit(1);
}

const newBlock = `      } else if (spec.type === 'tube_system') {
        const arms = spec.arms || [];
        const connections = spec.connections || [];
        const liquids = spec.liquids || [];
        const labels = spec.labels || [];
        const dashedLines = spec.lines || [];
        
        const pad = 30;
        const w = 400 - 2 * pad;
        const h = 300 - 2 * pad;
        
        const pipeH = 20;
        const gap = 40;
        
        // Calculate X positions
        let totalW = 0;
        arms.forEach((arm, i) => {
           totalW += arm.w;
           if (i < arms.length - 1) totalW += gap;
        });
        
        let startX = pad + (w - totalW) / 2;
        let cx = [];
        let curX = startX;
        arms.forEach(arm => {
           cx.push(curX + arm.w / 2);
           curX += arm.w + gap;
        });
        
        const bottomY = pad + h - 20;
        const pxPerCm = spec.px_per_cm || 2.5;
        
        const liqGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const glassGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const uiGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(liqGroup);
        g.appendChild(glassGroup);
        g.appendChild(uiGroup);
        
        // Draw Liquids
        liquids.forEach(liq => {
           const color = liq.color || '#4285F4';
           if (liq.arm !== undefined && arms[liq.arm]) {
              const arm = arms[liq.arm];
              const c = cx[liq.arm];
              const h1 = (liq.h1 || 0) * pxPerCm;
              const h2 = (liq.h2 || 0) * pxPerCm;
              const yBottom = bottomY - h1;
              const yTop = bottomY - h2;
              
              const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
              rect.setAttribute("x", c - arm.w/2 + 2);
              rect.setAttribute("y", yTop);
              rect.setAttribute("width", arm.w - 4);
              rect.setAttribute("height", Math.max(0, yBottom - yTop));
              rect.setAttribute("fill", color);
              liqGroup.appendChild(rect);
           } else if (liq.conn) {
              const [a1, a2] = liq.conn;
              const type = liq.type || 'bottom';
              if (arms[a1] && arms[a2]) {
                  if (type === 'bottom') {
                     const x1 = cx[a1] + arms[a1].w/2;
                     const x2 = cx[a2] - arms[a2].w/2;
                     const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                     rect.setAttribute("x", x1 - 2);
                     rect.setAttribute("y", bottomY - pipeH + 2);
                     rect.setAttribute("width", Math.max(0, x2 - x1 + 4));
                     rect.setAttribute("height", pipeH - 4);
                     rect.setAttribute("fill", color);
                     liqGroup.appendChild(rect);
                  } else if (type === 'top') {
                     const y1 = bottomY - arms[a1].h;
                     const y2 = bottomY - arms[a2].h;
                     const topY = Math.max(y1, y2);
                     const x1 = cx[a1] + arms[a1].w/2;
                     const x2 = cx[a2] - arms[a2].w/2;
                     const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                     rect.setAttribute("x", x1 - 2); 
                     rect.setAttribute("y", topY + 2);
                     rect.setAttribute("width", Math.max(0, x2 - x1 + 4));
                     rect.setAttribute("height", pipeH - 4);
                     rect.setAttribute("fill", color);
                     liqGroup.appendChild(rect);
                  }
              }
           }
        });
        
        // Draw Glass Lines
        const lines = [];
        arms.forEach((arm, i) => {
           const x = cx[i];
           const w = arm.w;
           const topY = bottomY - arm.h;
           
           let leftBreaks = [];
           let rightBreaks = [];
           
           connections.forEach(c => {
              if (c.from === i || c.to === i) {
                 const other = c.from === i ? c.to : c.from;
                 if (!arms[other]) return;
                 const isRight = other > i;
                 
                 if (c.type === 'bottom') {
                    const by1 = bottomY - pipeH;
                    const by2 = bottomY;
                    if (isRight) rightBreaks.push([by1, by2]);
                    else leftBreaks.push([by1, by2]);
                    
                    if (c.from === i) {
                       const startX = x + w/2;
                       const endX = cx[c.to] - arms[c.to].w/2;
                       lines.push({x1: startX, y1: by1, x2: endX, y2: by1});
                       lines.push({x1: startX, y1: by2, x2: endX, y2: by2});
                    }
                 } else if (c.type === 'top') {
                    const ty1 = Math.max(topY, bottomY - arms[other].h);
                    const ty2 = ty1 + pipeH;
                    if (isRight) rightBreaks.push([ty1, ty2]);
                    else leftBreaks.push([ty1, ty2]);
                    
                    if (c.from === i) {
                       const startX = x + w/2;
                       const endX = cx[c.to] - arms[c.to].w/2;
                       lines.push({x1: startX, y1: ty1, x2: endX, y2: ty1});
                       lines.push({x1: startX, y1: ty2, x2: endX, y2: ty2});
                    }
                 }
              }
           });
           
           leftBreaks.sort((a,b) => a[0] - b[0]);
           let curY = topY;
           leftBreaks.forEach(brk => {
              if (brk[0] > curY) lines.push({x1: x - w/2, y1: curY, x2: x - w/2, y2: brk[0]});
              curY = Math.max(curY, brk[1]);
           });
           if (curY < bottomY) lines.push({x1: x - w/2, y1: curY, x2: x - w/2, y2: bottomY});
           
           rightBreaks.sort((a,b) => a[0] - b[0]);
           curY = topY;
           rightBreaks.forEach(brk => {
              if (brk[0] > curY) lines.push({x1: x + w/2, y1: curY, x2: x + w/2, y2: brk[0]});
              curY = Math.max(curY, brk[1]);
           });
           if (curY < bottomY) lines.push({x1: x + w/2, y1: curY, x2: x + w/2, y2: bottomY});
           
           lines.push({x1: x - w/2, y1: bottomY, x2: x + w/2, y2: bottomY});
           
           if (arm.type === 'closed') {
              lines.push({x1: x - w/2, y1: topY, x2: x + w/2, y2: topY});
           }
           
           if (arm.type === 'gas') {
               const gBoxW = arm.w + 40;
               const gBoxH = 60;
               const gBoxX = x - gBoxW/2;
               const gBoxY = topY - gBoxH; 
               
               const gasBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
               gasBox.setAttribute("x", gBoxX);
               gasBox.setAttribute("y", gBoxY);
               gasBox.setAttribute("width", gBoxW);
               gasBox.setAttribute("height", gBoxH);
               gasBox.setAttribute("rx", "10");
               gasBox.setAttribute("fill", "var(--bg-card)");
               gasBox.setAttribute("stroke", "var(--text-primary)");
               gasBox.setAttribute("stroke-width", "3");
               glassGroup.appendChild(gasBox);
               
               for (let j=0; j<30; j++) {
                   const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                   dot.setAttribute("cx", gBoxX + 5 + Math.random()*(gBoxW-10));
                   dot.setAttribute("cy", gBoxY + 5 + Math.random()*(gBoxH-10));
                   dot.setAttribute("r", 1.5);
                   dot.setAttribute("fill", "var(--text-secondary)");
                   glassGroup.appendChild(dot);
               }
               
               const gt = document.createElementNS("http://www.w3.org/2000/svg", "text");
               gt.setAttribute("x", gBoxX + gBoxW/2);
               gt.setAttribute("y", gBoxY + gBoxH/2 + 5);
               gt.setAttribute("text-anchor", "middle");
               gt.setAttribute("fill", "var(--text-primary)");
               gt.setAttribute("font-weight", "bold");
               gt.textContent = arm.gas_text || "گاز";
               glassGroup.appendChild(gt);
               
               const cover = document.createElementNS("http://www.w3.org/2000/svg", "line");
               cover.setAttribute("x1", x - w/2 + 2);
               cover.setAttribute("y1", topY);
               cover.setAttribute("x2", x + w/2 - 2);
               cover.setAttribute("y2", topY);
               cover.setAttribute("stroke", "var(--bg-card)");
               cover.setAttribute("stroke-width", "5");
               glassGroup.appendChild(cover);
           }
        });
        
        lines.forEach(l => {
           const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
           line.setAttribute("x1", l.x1);
           line.setAttribute("y1", l.y1);
           line.setAttribute("x2", l.x2);
           line.setAttribute("y2", l.y2);
           line.setAttribute("stroke", "var(--text-primary)");
           line.setAttribute("stroke-width", "3");
           line.setAttribute("stroke-linecap", "round");
           glassGroup.appendChild(line);
        });
        
        // Draw Labels
        labels.forEach(lbl => {
            const arm = arms[lbl.arm];
            if (!arm) return;
            const c = cx[lbl.arm];
            const y1 = bottomY - (lbl.h1 || 0) * pxPerCm;
            const y2 = bottomY - (lbl.h2 || 0) * pxPerCm;
            const isLeft = lbl.pos === 'left';
            const x = isLeft ? c - arm.w/2 - 15 : c + arm.w/2 + 15;
            
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x); line.setAttribute("x2", x);
            line.setAttribute("y1", y1); line.setAttribute("y2", y2);
            line.setAttribute("stroke", "var(--text-secondary)");
            line.setAttribute("stroke-width", "1");
            
            const a1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            a1.setAttribute("d", \`M \${x-2} \${y1+4} L \${x} \${y1} L \${x+2} \${y1+4}\`);
            a1.setAttribute("fill", "none");
            a1.setAttribute("stroke", "var(--text-secondary)");
            
            const a2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            a2.setAttribute("d", \`M \${x-2} \${y2-4} L \${x} \${y2} L \${x+2} \${y2-4}\`);
            a2.setAttribute("fill", "none");
            a2.setAttribute("stroke", "var(--text-secondary)");
            
            const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
            const tx = isLeft ? x - 4 : x + 4;
            txt.setAttribute("x", tx);
            txt.setAttribute("y", (y1+y2)/2 + 4);
            txt.setAttribute("text-anchor", isLeft ? "end" : "start");
            txt.setAttribute("fill", "var(--text-primary)");
            txt.setAttribute("font-size", "10px");
            txt.textContent = lbl.text;
            
            uiGroup.appendChild(line);
            uiGroup.appendChild(a1);
            uiGroup.appendChild(a2);
            uiGroup.appendChild(txt);
        });
        
        // Draw Dashed Lines
        dashedLines.forEach(dl => {
            const y = bottomY - (dl.h || 0) * pxPerCm;
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", cx[0] - arms[0].w/2 - 20);
            line.setAttribute("x2", cx[cx.length-1] + arms[arms.length-1].w/2 + 20);
            line.setAttribute("y1", y);
            line.setAttribute("y2", y);
            line.setAttribute("stroke", "var(--text-primary)");
            line.setAttribute("stroke-dasharray", "4,4");
            line.setAttribute("stroke-width", "1");
            uiGroup.appendChild(line);
        });
      }

`;

const finalContent = content.substring(0, startIndex) + newBlock + content.substring(endIndex);
fs.writeFileSync('js/features/pages.js', finalContent);
console.log('Update complete.');
