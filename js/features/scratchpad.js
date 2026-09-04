// ScratchPad / Digital Drawing Board
// -----------------------------------------------------------------------
// این ماژول فقط ویجت کادر یادداشت را می‌سازد و برمی‌گرداند (pad.element).
// محل قرارگیری آن در صفحه آزمون (زیر تایمر / بالای کارت سوال) باید توسط
// کدی که این تابع را صدا می‌زند و element را در DOM درج می‌کند مشخص شود.
// -----------------------------------------------------------------------

export function getOrCreateScratchPad(onClose) {
    if (window._currentScratchPad) {
        window._currentScratchPad._onClose = onClose;
        window._currentScratchPad.reset();
        return window._currentScratchPad.element;
    }

    const pad = createScratchPadDOM();
    window._currentScratchPad = pad;
    pad._onClose = onClose;
    return pad.element;
}

export function destroyScratchPad() {
    window._currentScratchPad = null;
}

// ---------------- helpers ----------------

function iconButton(iconName, size, fontSize) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.style.cssText = `width:${size}px; height:${size}px; padding:0; border:none; background:transparent; color:#4b5563; display:flex; align-items:center; justify-content:center; cursor:pointer; border-radius:8px; transition:background .18s ease, color .18s ease;`;
    btn.innerHTML = `<span class="material-symbols-rounded" style="font-size:${fontSize}px; font-weight:300;">${iconName}</span>`;
    return btn;
}

// Inline-SVG icon button. Used for icons that were newly added (eraser, palette,
// trash, undo/redo) so we never depend on a "material-symbols" ligature name
// actually being present in the app's (likely subsetted) icon font — that
// mismatch is what rendered as a plain dot instead of an eraser icon before.
function svgIconButton(svgInner, btnSize, iconSize) {
    const size = iconSize || Math.round(btnSize * 0.56);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.style.cssText = `width:${btnSize}px; height:${btnSize}px; padding:0; border:none; background:transparent; color:#4b5563; display:flex; align-items:center; justify-content:center; cursor:pointer; border-radius:8px; transition:background .18s ease, color .18s ease, opacity .18s ease;`;
    btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg>`;
    return btn;
}

const ICONS = {
    eraser: '<path d="m7 21-4.3-4.3c-.94-.94-.94-2.46 0-3.4l9.6-9.6c.94-.94 2.46-.94 3.4 0l5.6 5.6c.94.94.94 2.46 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.8-.8 1.8-1.8 0-.47-.18-.9-.48-1.22-.29-.31-.47-.74-.47-1.2 0-1 .8-1.8 1.8-1.8H16a4 4 0 0 0 4-4c0-4.4-3.58-8-8-8Z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.2" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="16.3" cy="10.8" r="1" fill="currentColor" stroke="none"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/>'
};

function smallLabel(text) {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.cssText = 'font-size:11px; color:#9ca3af; flex-shrink:0; white-space:nowrap;';
    return span;
}

function getClientPos(e) {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

// ---------------- main builder ----------------

function createScratchPadDOM() {
    const CANVAS_CONTENT_HEIGHT = 1500;
    const MIN_PAD_HEIGHT = 180;

    // ---- state ----
    let activeColor = '#1c1917';
    let activeThickness = 3;
    let isEraser = false;
    let secondaryOpen = null; // null | 'pen' | 'plus'
    let ctx = null;
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    let scrollY = 0;
    let strokes = [];       // committed strokes, for redraw/undo
    let redoStack = [];
    let currentStroke = null;

    const colors = [
        { id: 'red', hex: '#ef4444' },
        { id: 'white', hex: '#ffffff' },
        { id: 'black', hex: '#1c1917' }
    ];

    // ---- container ----
    const container = document.createElement('div');
    container.style.cssText = 'background:#ffffff; border-radius:12px; border:1px solid #e5e7eb; display:flex; flex-direction:column; overflow:hidden; margin-top:var(--space-2); margin-bottom:var(--space-2); position:relative; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03); opacity:1; transform:none; transition:opacity .18s ease, transform .18s ease;';

    // ================= MAIN TOOLBAR =================
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:#ffffff; min-height:56px; position:relative; z-index:3; direction:ltr;';

    // Close (left)
    const closeBtn = iconButton('close', 36, 26);
    toolbar.appendChild(closeBtn);

    // Undo / Redo (middle — between the close button and the "+" controls)
    const undoRedoGroup = document.createElement('div');
    undoRedoGroup.style.cssText = 'display:flex; align-items:center; gap:4px;';
    const undoBtn = svgIconButton(ICONS.undo, 32);
    undoBtn.title = 'واگرد';
    const redoBtn = svgIconButton(ICONS.redo, 32);
    redoBtn.title = 'ازنو';
    undoRedoGroup.appendChild(undoBtn);
    undoRedoGroup.appendChild(redoBtn);
    toolbar.appendChild(undoRedoGroup);

    // Right side controls
    const rightControls = document.createElement('div');
    rightControls.style.cssText = 'display:flex; align-items:center; gap:10px;';

    const pill = document.createElement('div');
    pill.style.cssText = 'display:flex; align-items:center; gap:6px; border:1px solid #e5e7eb; border-radius:24px; padding:4px 10px; background:#ffffff;';

    const plusBtn = iconButton('add', 28, 22);
    plusBtn.title = 'ابزار بیشتر';
    pill.appendChild(plusBtn);

    const colorBtns = [];
    colors.forEach(c => {
        const dotWrap = document.createElement('button');
        dotWrap.type = 'button';
        dotWrap.style.cssText = 'display:flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%; border:none; background:transparent; padding:0; cursor:pointer;';
        const dot = document.createElement('div');
        dot.style.cssText = `width:18px; height:18px; border-radius:50%; background:${c.hex}; border:1px solid ${c.hex === '#ffffff' ? '#d1d5db' : 'transparent'}; box-shadow:0 0 0 2px transparent; transition:box-shadow .18s ease, transform .18s ease;`;
        dotWrap.appendChild(dot);
        dotWrap.onclick = () => {
            isEraser = false;
            activeColor = c.hex;
            hiddenColorInput.value = c.hex;
            updateActiveState();
            if (secondaryOpen === 'plus') closeSecondary();
        };
        colorBtns.push({ dot, hex: c.hex });
        pill.appendChild(dotWrap);
    });

    // extra indicator shown only when a CUSTOM color is active
    const customDotWrap = document.createElement('div');
    customDotWrap.style.cssText = 'display:flex; align-items:center; justify-content:center; width:0; height:26px; overflow:hidden; transition:width .18s ease;';
    const customDot = document.createElement('div');
    customDot.style.cssText = 'width:18px; height:18px; border-radius:50%; flex-shrink:0; box-shadow:0 0 0 2px #111827; transition:transform .18s ease;';
    customDotWrap.appendChild(customDot);
    pill.appendChild(customDotWrap);

    rightControls.appendChild(pill);

    const penBtn = iconButton('edit', 36, 20);
    penBtn.style.border = '1px solid #e5e7eb';
    penBtn.style.background = '#f9fafb';
    penBtn.title = 'ضخامت قلم';
    rightControls.appendChild(penBtn);

    toolbar.appendChild(rightControls);
    container.appendChild(toolbar);

    // ================= SECONDARY TOOLBARS =================
    // pen thickness bar و + پنل هرگز همزمان باز نیستند
    const secondaryWrap = document.createElement('div');
    secondaryWrap.style.cssText = 'max-height:0; overflow:hidden; opacity:0; background:#fafafa; border-top:1px solid #f3f4f6; transition:max-height .28s cubic-bezier(.4,0,.2,1), opacity .2s ease; direction:ltr;';

    // --- pen thickness panel ---
    const penPanel = document.createElement('div');
    penPanel.style.cssText = 'display:none; align-items:center; gap:10px; padding:12px 16px;';

    const thicknessSlider = document.createElement('input');
    thicknessSlider.type = 'range';
    thicknessSlider.min = '1';
    thicknessSlider.max = '14';
    thicknessSlider.step = '1';
    thicknessSlider.value = String(activeThickness);
    thicknessSlider.style.cssText = 'flex:1; accent-color:#111827; height:4px;';
    thicknessSlider.oninput = (e) => {
        activeThickness = parseInt(e.target.value, 10);
        updateActiveState();
    };

    const previewDot = document.createElement('div');
    previewDot.style.cssText = 'border-radius:50%; flex-shrink:0; transition:width .12s ease, height .12s ease, background .12s ease;';

    penPanel.appendChild(smallLabel('نازک'));
    penPanel.appendChild(thicknessSlider);
    penPanel.appendChild(smallLabel('ضخیم'));
    penPanel.appendChild(previewDot);

    // --- "+" panel: eraser / custom color / clear ---
    const plusPanel = document.createElement('div');
    plusPanel.style.cssText = 'display:none; align-items:center; justify-content:space-around; padding:10px 16px;';

    const eraserBtn = svgIconButton(ICONS.eraser, 40);
    eraserBtn.title = 'پاک‌کن';
    eraserBtn.onclick = () => {
        isEraser = true;
        updateActiveState();
    };

    // Custom color picker: the real <input type="color"> lives INSIDE a <label>.
    // Tapping anywhere on the label (the visible button) natively activates the
    // control it wraps — this is the reliable, standard way to trigger a color/file
    // input on mobile WebViews. Calling input.click() from a sibling button's
    // onclick (the previous approach) is exactly what was silently failing on the
    // 2nd+ open on some mobile browsers.
    const colorPickerBtn = document.createElement('label');
    colorPickerBtn.style.cssText = 'width:40px; height:40px; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; border-radius:8px; color:#4b5563;';
    colorPickerBtn.title = 'انتخاب رنگ دلخواه';
    colorPickerBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS.palette}</svg>`;

    const hiddenColorInput = document.createElement('input');
    hiddenColorInput.type = 'color';
    hiddenColorInput.value = '#000000';
    hiddenColorInput.style.cssText = 'position:absolute; width:1px; height:1px; opacity:0;';
    function applyCustomColor(e) {
        const val = e.target.value;
        if (!val) return;
        activeColor = val;
        isEraser = false;
        updateActiveState();
        closeSecondary();
    }
    // Listen to both events: some mobile WebViews only reliably fire one of the two,
    // which is why a picked custom color could silently fail to apply before.
    hiddenColorInput.addEventListener('input', applyCustomColor);
    hiddenColorInput.addEventListener('change', applyCustomColor);
    colorPickerBtn.appendChild(hiddenColorInput);

    const clearBtn = svgIconButton(ICONS.trash, 40);
    clearBtn.title = 'پاک کردن کل بوم';
    clearBtn.onclick = () => showConfirmDialog();

    plusPanel.appendChild(eraserBtn);
    plusPanel.appendChild(colorPickerBtn);
    plusPanel.appendChild(clearBtn);

    secondaryWrap.appendChild(penPanel);
    secondaryWrap.appendChild(plusPanel);
    container.appendChild(secondaryWrap);

    function openSecondary(which) {
        secondaryOpen = which;
        penPanel.style.display = which === 'pen' ? 'flex' : 'none';
        plusPanel.style.display = which === 'plus' ? 'flex' : 'none';
        secondaryWrap.style.opacity = '1';
        requestAnimationFrame(() => {
            secondaryWrap.style.maxHeight = secondaryWrap.scrollHeight + 'px';
        });
    }
    function closeSecondary() {
        secondaryOpen = null;
        secondaryWrap.style.maxHeight = '0px';
        secondaryWrap.style.opacity = '0';
    }
    function togglePanel(which) {
        if (secondaryOpen === which) closeSecondary();
        else openSecondary(which);
    }

    penBtn.onclick = () => {
        isEraser = false;
        updateActiveState();
        togglePanel('pen');
    };
    plusBtn.onclick = () => togglePanel('plus');

    // ================= CANVAS =================
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative; width:100%; height:320px; background:#ffffff; overflow:hidden; touch-action:none;';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = `position:absolute; top:0; left:0; width:100%; height:${CANVAS_CONTENT_HEIGHT}px; touch-action:none; cursor:crosshair;`;
    canvasWrap.appendChild(canvas);

    // scrollbar
    const scrollbar = document.createElement('div');
    scrollbar.style.cssText = 'position:absolute; right:4px; top:16px; width:6px; height:100px; background:#d1d5db; border-radius:3px; z-index:10; transition:transform .2s ease, background .2s ease; touch-action:none; opacity:0.8;';
    canvasWrap.appendChild(scrollbar);

    // bottom-left grip / resize handle
    const handleWrap = document.createElement('div');
    handleWrap.style.cssText = 'position:absolute; left:0; bottom:0; width:44px; height:44px; cursor:ns-resize; touch-action:none; z-index:11; display:flex; align-items:flex-end; justify-content:flex-start; padding:12px; box-sizing:border-box;';
    handleWrap.innerHTML = `
        <div style="position:relative; width:16px; height:16px;">
            <div style="position:absolute; left:2px; top:6px; width:16px; height:2px; background:#9ca3af; border-radius:1px; transform:rotate(45deg); transform-origin:left center; pointer-events:none;"></div>
            <div style="position:absolute; left:2px; top:14px; width:10px; height:2px; background:#9ca3af; border-radius:1px; transform:rotate(45deg); transform-origin:left center; pointer-events:none;"></div>
        </div>`;
    canvasWrap.appendChild(handleWrap);

    container.appendChild(canvasWrap);

    // ================= CONFIRM DIALOG =================
    const confirmOverlay = document.createElement('div');
    confirmOverlay.style.cssText = 'position:absolute; inset:0; background:rgba(17,24,39,0.35); display:flex; align-items:center; justify-content:center; opacity:0; pointer-events:none; transition:opacity .18s ease; z-index:30;';

    const confirmCard = document.createElement('div');
    confirmCard.style.cssText = 'background:#ffffff; border-radius:14px; padding:20px 18px; width:min(84%,300px); box-shadow:0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.08); text-align:center; transform:scale(0.94); transition:transform .18s ease;';

    const confirmText = document.createElement('p');
    confirmText.textContent = 'آیا از پاک کردن کامل بوم اطمینان دارید؟';
    confirmText.style.cssText = 'margin:0 0 16px 0; font-size:14px; color:#1f2937; line-height:1.6;';

    const confirmActions = document.createElement('div');
    confirmActions.style.cssText = 'display:flex; gap:10px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'انصراف';
    cancelBtn.style.cssText = 'flex:1; padding:10px 0; border-radius:10px; border:1px solid #e5e7eb; background:#f9fafb; color:#374151; font-size:13px; cursor:pointer;';
    cancelBtn.onclick = () => hideConfirmDialog();

    const confirmClearBtn = document.createElement('button');
    confirmClearBtn.type = 'button';
    confirmClearBtn.textContent = 'پاک کردن';
    confirmClearBtn.style.cssText = 'flex:1; padding:10px 0; border-radius:10px; border:none; background:#ef4444; color:#ffffff; font-size:13px; cursor:pointer;';
    confirmClearBtn.onclick = () => {
        clearCanvas();
        strokes = [];
        redoStack = [];
        currentStroke = null;
        updateUndoRedoButtons();
        hideConfirmDialog();
        closeSecondary();
    };

    confirmActions.appendChild(cancelBtn);
    confirmActions.appendChild(confirmClearBtn);
    confirmCard.appendChild(confirmText);
    confirmCard.appendChild(confirmActions);
    confirmOverlay.appendChild(confirmCard);
    container.appendChild(confirmOverlay);

    function showConfirmDialog() {
        confirmOverlay.style.pointerEvents = 'auto';
        confirmOverlay.style.opacity = '1';
        requestAnimationFrame(() => { confirmCard.style.transform = 'scale(1)'; });
    }
    function hideConfirmDialog() {
        confirmOverlay.style.opacity = '0';
        confirmOverlay.style.pointerEvents = 'none';
        confirmCard.style.transform = 'scale(0.94)';
    }

    // ================= CLOSE (with smooth animation) =================
    closeBtn.onclick = () => {
        closeSecondary();
        container.style.opacity = '0';
        container.style.transform = 'scale(0.98)';
        setTimeout(() => {
            if (window._currentScratchPad && window._currentScratchPad._onClose) {
                window._currentScratchPad._onClose();
            }
        }, 160);
    };

    // ================= ACTIVE STATE =================
    function updateActiveState() {
        const isCustom = !colors.some(c => c.hex === activeColor);

        colorBtns.forEach(btn => {
            const active = !isEraser && !isCustom && btn.hex === activeColor;
            btn.dot.style.transform = active ? 'scale(1.15)' : 'scale(1)';
            btn.dot.style.boxShadow = active ? '0 0 0 2px #111827' : '0 0 0 2px transparent';
        });

        const customActive = !isEraser && isCustom;
        customDotWrap.style.width = customActive ? '26px' : '0px';
        customDot.style.background = activeColor;
        customDot.style.transform = customActive ? 'scale(1.15)' : 'scale(1)';

        eraserBtn.style.background = isEraser ? '#e5e7eb' : 'transparent';
        eraserBtn.style.color = isEraser ? '#111827' : '#4b5563';

        const size = 6 + activeThickness * 1.6;
        previewDot.style.width = size + 'px';
        previewDot.style.height = size + 'px';
        previewDot.style.background = isEraser ? '#9ca3af' : activeColor;

        thicknessSlider.value = String(activeThickness);
    }
    updateActiveState();
    undoBtn.style.opacity = '0.35';
    redoBtn.style.opacity = '0.35';
    undoBtn.style.pointerEvents = 'none';
    redoBtn.style.pointerEvents = 'none';

    // ================= CANVAS SETUP =================
    function initCanvas() {
        const rect = canvasWrap.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = CANVAS_CONTENT_HEIGHT * dpr;
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        clearCanvas();
    }
    function clearCanvas() {
        if (!ctx) return;
        const prevOp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = prevOp;
    }
    setTimeout(initCanvas, 100);

    // ================= RESIZE HANDLE (grip) =================
    function getMaxPadHeight() {
        return Math.max(MIN_PAD_HEIGHT, Math.round(window.innerHeight * 0.7));
    }
    let isResizing = false, resizeStartY = 0, resizeStartHeight = 0;

    function startResize(clientY) {
        isResizing = true;
        resizeStartY = clientY;
        resizeStartHeight = canvasWrap.getBoundingClientRect().height;
    }
    function moveResize(clientY) {
        if (!isResizing) return;
        const dy = clientY - resizeStartY;
        let newHeight = resizeStartHeight + dy;
        newHeight = Math.max(MIN_PAD_HEIGHT, Math.min(newHeight, getMaxPadHeight()));
        canvasWrap.style.height = newHeight + 'px';
    }
    function endResize() { isResizing = false; }

    handleWrap.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); startResize(getClientPos(e).y); }, { passive: false });
    handleWrap.addEventListener('touchmove', (e) => { if (!isResizing) return; e.preventDefault(); e.stopPropagation(); moveResize(getClientPos(e).y); }, { passive: false });
    handleWrap.addEventListener('touchend', (e) => { e.stopPropagation(); endResize(); });
    handleWrap.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); startResize(e.clientY); });
    window.addEventListener('mousemove', (e) => { if (isResizing) moveResize(e.clientY); });
    window.addEventListener('mouseup', () => { if (isResizing) endResize(); });

    // ================= SCROLL =================
    function updateScroll(newY) {
        const rect = canvasWrap.getBoundingClientRect();
        const max = Math.max(0, CANVAS_CONTENT_HEIGHT - rect.height);
        scrollY = Math.max(0, Math.min(newY, max));
        canvas.style.transform = `translateY(-${scrollY}px)`;
        const scrollPct = max > 0 ? scrollY / max : 0;
        const barMax = rect.height - 20 - 100; // 20 padding, 100 = bar height
        scrollbar.style.top = `${10 + scrollPct * Math.max(0, barMax)}px`;
    }

    let scrollTimer = null;
    let isScrollingMode = false;
    let scrollStartY = 0;
    let scrollStartScrollY = 0;

    function scrollHoldStart(e) {
        e.preventDefault();
        const p = getClientPos(e);
        scrollStartY = p.y;
        scrollTimer = setTimeout(() => {
            isScrollingMode = true;
            scrollbar.style.transform = 'translateX(-8px) scaleY(1.2)';
            scrollbar.style.background = 'rgba(0,0,0,0.55)';
            scrollStartY = p.y;
            scrollStartScrollY = scrollY;
        }, 500);
    }
    function scrollHoldMove(e) {
        e.preventDefault();
        const p = getClientPos(e);
        if (isScrollingMode) {
            const dy = p.y - scrollStartY;
            const rect = canvasWrap.getBoundingClientRect();
            const barMax = rect.height - 20 - 100;
            const scrollMax = Math.max(0, CANVAS_CONTENT_HEIGHT - rect.height);
            const contentDy = barMax > 0 ? (dy / barMax) * scrollMax : 0;
            updateScroll(scrollStartScrollY + contentDy);
        } else if (Math.abs(p.y - scrollStartY) > 10) {
            clearTimeout(scrollTimer);
        }
    }
    function scrollHoldEnd() {
        clearTimeout(scrollTimer);
        isScrollingMode = false;
        scrollbar.style.transform = 'none';
        scrollbar.style.background = '#d1d5db';
    }

    scrollbar.addEventListener('touchstart', scrollHoldStart, { passive: false });
    scrollbar.addEventListener('touchmove', scrollHoldMove, { passive: false });
    scrollbar.addEventListener('touchend', scrollHoldEnd);
    scrollbar.addEventListener('mousedown', scrollHoldStart);
    window.addEventListener('mousemove', (e) => { if (scrollTimer !== null || isScrollingMode) scrollHoldMove(e); });
    window.addEventListener('mouseup', () => { if (isScrollingMode) scrollHoldEnd(); else clearTimeout(scrollTimer); });

    // ================= DRAWING =================
    function getPos(e) {
        const rect = canvasWrap.getBoundingClientRect();
        const p = getClientPos(e);
        return { x: p.x - rect.left, y: p.y - rect.top + scrollY };
    }
    function isBlockedTarget(target) {
        return target === scrollbar || handleWrap.contains(target);
    }
    function strokeTo(x, y) {
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        if (isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = activeThickness * 1.8;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = activeColor;
            ctx.lineWidth = activeThickness;
        }
        ctx.stroke();
        lastX = x;
        lastY = y;
    }
    function drawDot(pt, s) {
        if (!ctx) return;
        ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
        ctx.fillStyle = s.color;
        const r = (s.eraser ? s.thickness * 1.8 : s.thickness) / 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(r, 0.75), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }
    function redrawAll() {
        if (!ctx) return;
        clearCanvas();
        strokes.forEach(s => {
            if (s.points.length < 2) {
                if (s.points.length === 1) drawDot(s.points[0], s);
                return;
            }
            ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.eraser ? s.thickness * 1.8 : s.thickness;
            ctx.beginPath();
            ctx.moveTo(s.points[0].x, s.points[0].y);
            for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
            ctx.stroke();
        });
        ctx.globalCompositeOperation = 'source-over';
    }
    function updateUndoRedoButtons() {
        const canUndo = strokes.length > 0;
        const canRedo = redoStack.length > 0;
        undoBtn.style.opacity = canUndo ? '1' : '0.35';
        redoBtn.style.opacity = canRedo ? '1' : '0.35';
        undoBtn.style.pointerEvents = canUndo ? 'auto' : 'none';
        redoBtn.style.pointerEvents = canRedo ? 'auto' : 'none';
    }
    function undo() {
        if (!strokes.length) return;
        redoStack.push(strokes.pop());
        if (redoStack.length > 300) redoStack.shift();
        redrawAll();
        updateUndoRedoButtons();
    }
    function redo() {
        if (!redoStack.length) return;
        strokes.push(redoStack.pop());
        redrawAll();
        updateUndoRedoButtons();
    }
    undoBtn.onclick = undo;
    redoBtn.onclick = redo;

    function pointerDown(e) {
        if (isBlockedTarget(e.target)) return;
        if (e.type === 'touchstart') e.preventDefault();
        isDrawing = true;
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;
        currentStroke = { points: [{ x: pos.x, y: pos.y }], color: activeColor, thickness: activeThickness, eraser: isEraser };
    }
    function pointerMove(e) {
        if (!isDrawing || isBlockedTarget(e.target)) return;
        if (e.type === 'touchmove') e.preventDefault();
        const pos = getPos(e);
        strokeTo(pos.x, pos.y);
        if (currentStroke) currentStroke.points.push({ x: pos.x, y: pos.y });
    }
    function pointerUp() {
        if (isDrawing && currentStroke) {
            if (currentStroke.points.length === 1) drawDot(currentStroke.points[0], currentStroke);
            strokes.push(currentStroke);
            if (strokes.length > 300) strokes.shift();
            redoStack = [];
            updateUndoRedoButtons();
        }
        currentStroke = null;
        isDrawing = false;
    }

    canvasWrap.addEventListener('touchstart', pointerDown, { passive: false });
    canvasWrap.addEventListener('touchmove', pointerMove, { passive: false });
    canvasWrap.addEventListener('touchend', pointerUp);
    canvasWrap.addEventListener('mousedown', pointerDown);
    canvasWrap.addEventListener('mousemove', pointerMove);
    window.addEventListener('mouseup', pointerUp);

    // ================= PUBLIC API =================
    function reset() {
        container.style.opacity = '1';
        container.style.transform = 'none';
    }

    return {
        element: container,
        clear: clearCanvas,
        reset
    };
}
