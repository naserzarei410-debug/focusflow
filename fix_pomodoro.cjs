const fs = require('fs');
let code = fs.readFileSync('js/features/pomodoro.js', 'utf8');

const dialogCode = `
  function showCustomNumberDialog(title, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:9999; backdrop-filter:blur(4px); opacity:0; transition:opacity 0.2s ease;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-card); padding:var(--space-4); border-radius:24px; box-shadow:0 8px 32px rgba(0,0,0,0.1); display:flex; flex-direction:column; align-items:center; gap:var(--space-3); width:280px; max-width:90%; transform:scale(0.9); opacity:0; transition:all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); direction:rtl;';
    
    const titleEl = document.createElement('h3');
    titleEl.style.cssText = 'margin:0; font-size:16px; font-weight:800; color:var(--text-primary); text-align:center;';
    titleEl.textContent = title;
    
    const inputWrapper = document.createElement('div');
    inputWrapper.style.cssText = 'position:relative; width:100px; height:100px; margin:0 auto;';
    
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '999';
    input.style.cssText = 'width:100%; height:100%; padding:0; font-size:32px; font-weight:800; text-align:center; border:2px solid var(--border-soft); border-radius:50%; background:var(--bg-sunken); color:var(--color-primary); box-sizing:border-box; outline:none; transition:border-color 0.2s; -moz-appearance:textfield;';
    
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:var(--space-2); margin-top:var(--space-2); width:100%;';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline';
    cancelBtn.style.flex = '1';
    cancelBtn.textContent = 'انصراف';
    
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.style.flex = '1';
    confirmBtn.textContent = 'تایید';
    
    btnRow.append(cancelBtn, confirmBtn);
    dialog.append(titleEl, inputWrapper, btnRow);
    inputWrapper.appendChild(input);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    const style = document.createElement('style');
    style.textContent = \`
      input[type=number]::-webkit-inner-spin-button, 
      input[type=number]::-webkit-outer-spin-button { 
        -webkit-appearance: none; 
        margin: 0; 
      }
    \`;
    overlay.appendChild(style);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      dialog.style.opacity = '1';
      dialog.style.transform = 'scale(1)';
      input.focus();
    });
    
    const close = () => {
      overlay.style.opacity = '0';
      dialog.style.transform = 'scale(0.9)';
      dialog.style.opacity = '0';
      setTimeout(() => overlay.remove(), 200);
    };
    
    cancelBtn.onclick = close;
    overlay.onclick = (e) => { if(e.target === overlay) close(); };
    confirmBtn.onclick = () => {
      const val = parseInt(input.value, 10);
      if (!isNaN(val) && val > 0) {
        onConfirm(val);
        close();
      } else {
        input.style.borderColor = 'var(--color-danger)';
        setTimeout(() => input.style.borderColor = 'var(--border-soft)', 1000);
      }
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    };
  }

  function makePicker(labelText, defaultOptions, current, customKey, onPick) {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px; color:var(--text-tertiary); font-weight:600;';
    lbl.textContent = labelText;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; align-items:center;';

    let customOptions = [];
    if (customKey) {
      try { customOptions = JSON.parse(localStorage.getItem(customKey)) || []; } catch(e){}
    }
    const allOptions = Array.from(new Set([...defaultOptions, ...customOptions])).sort((a,b)=>a-b);

    allOptions.forEach((val) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const active = val === current;
      chip.style.cssText = \`padding:5px 10px; border-radius:var(--radius-pill); font-size:12px; font-weight:700; cursor:pointer; border:1.5px solid \${active ? 'var(--color-primary)' : 'var(--border-soft)'}; background:\${active ? 'var(--color-primary-soft)' : 'var(--bg-card)'}; color:\${active ? 'var(--color-primary)' : 'var(--text-secondary)'}; transition:all 0.2s;\`;
      chip.textContent = val.toLocaleString('fa-IR');
      chip.addEventListener('click', () => onPick(val, box));
      btnRow.appendChild(chip);
    });

    if (customKey) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.style.cssText = \`padding:0; width:28px; height:28px; display:flex; justify-content:center; align-items:center; border-radius:50%; border:1.5px dashed var(--border-soft); background:transparent; color:var(--text-tertiary); cursor:pointer; transition:all 0.2s;\`;
      addBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">add</span>';
      addBtn.addEventListener('click', () => {
        showCustomNumberDialog(\`زمان دلخواه (\${labelText})\`, (val) => {
          if (val > 0) {
            customOptions.push(val);
            localStorage.setItem(customKey, JSON.stringify(customOptions));
            onPick(val, box);
            rebuildSettingsGrid();
          }
        });
      });
      btnRow.appendChild(addBtn);
    }

    box.append(lbl, btnRow);
    return box;
  }
`;

const oldPicker = `  function makePicker(labelText, options, current, onPick) {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px; color:var(--text-tertiary); font-weight:600;';
    lbl.textContent = labelText;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px;';
    options.forEach((val) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const active = val === current;
      chip.style.cssText = \`padding:5px 10px; border-radius:var(--radius-pill); font-size:12px; font-weight:700; cursor:pointer; border:1.5px solid \${active ? 'var(--color-primary)' : 'var(--border-soft)'}; background:\${active ? 'var(--color-primary-soft)' : 'var(--bg-card)'}; color:\${active ? 'var(--color-primary)' : 'var(--text-secondary)'};\`;
      chip.textContent = val.toLocaleString('fa-IR');
      chip.addEventListener('click', () => onPick(val, box));
      btnRow.appendChild(chip);
    });
    box.append(lbl, btnRow);
    return box;
  }`;

code = code.replace(oldPicker, dialogCode);

code = code.replace(
  "settingsGrid.appendChild(makePicker('تمرکز (دقیقه)', [15, 20, 25, 30, 45, 50, 60], state.focusMin, (val) => {",
  "settingsGrid.appendChild(makePicker('تمرکز', [15, 20, 25, 30, 45, 50, 60], state.focusMin, 'custom_focus', (val) => {"
);
code = code.replace(
  "settingsGrid.appendChild(makePicker('استراحت کوتاه (دقیقه)', [5, 10, 15], state.shortMin, (val) => {",
  "settingsGrid.appendChild(makePicker('استراحت کوتاه', [5, 10, 15], state.shortMin, 'custom_short', (val) => {"
);
code = code.replace(
  "settingsGrid.appendChild(makePicker('استراحت بلند (دقیقه)', [15, 20, 30], state.longMin, (val) => {",
  "settingsGrid.appendChild(makePicker('استراحت بلند', [15, 20, 30], state.longMin, 'custom_long', (val) => {"
);
code = code.replace(
  "settingsGrid.appendChild(makePicker('چرخه تا استراحت بلند', [2, 3, 4, 5, 6], state.cyclesBeforeLong, (val) => {",
  "settingsGrid.appendChild(makePicker('تعداد چرخه', [2, 3, 4, 5, 6], state.cyclesBeforeLong, 'custom_cycles', (val) => {"
);

fs.writeFileSync('js/features/pomodoro.js', code);
