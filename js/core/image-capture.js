/**
 * Camera / gallery pick + in-app crop for OCR and attachments.
 * Prefers Capacitor Camera on native; falls back to getUserMedia / file input.
 */

function isNative() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
}

function loadImageFromSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('بارگذاری تصویر ناموفق بود.'));
    img.src = src;
  });
}

/** Open system gallery (no capture attribute). */
export function pickFromGallery() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (file) resolve(file);
      else reject(new Error('cancelled'));
    }, { once: true });
    // If user dismisses without selecting, clean up eventually
    setTimeout(() => {
      if (input.parentNode) {
        // keep until change; no reliable cancel event on all platforms
      }
    }, 0);
    input.click();
  });
}

/**
 * Open the real device camera.
 * Native: @capacitor/camera with CameraSource.Camera
 * Web / fallback: getUserMedia live preview with shutter button
 */
export async function captureFromCamera() {
  if (isNative()) {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({
        quality: 92,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        correctOrientation: true,
        width: 2000,
      });
      if (!photo.webPath) throw new Error('no path');
      const resp = await fetch(photo.webPath);
      const blob = await resp.blob();
      return new File([blob], `camera-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
    } catch (err) {
      // User cancelled or plugin missing → try getUserMedia
      if (err && (err.message === 'User cancelled photos app' || String(err).includes('cancel'))) {
        throw new Error('cancelled');
      }
    }
  }

  return captureWithGetUserMedia();
}

function captureWithGetUserMedia() {
  return new Promise(async (resolve, reject) => {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
    } catch (err) {
      reject(new Error('دسترسی به دوربین ممکن نشد. مجوز دوربین را در تنظیمات گوشی فعال کنید.'));
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000;display:flex;flex-direction:column;';

    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    video.srcObject = stream;
    video.style.cssText = 'flex:1;width:100%;object-fit:cover;background:#000;';
    overlay.appendChild(video);

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-around;padding:16px 20px;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));background:rgba(0,0,0,0.85);';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'انصراف';
    cancelBtn.style.cssText = 'background:transparent;border:none;color:#fff;font-size:15px;font-weight:700;padding:12px;';

    const shutter = document.createElement('button');
    shutter.type = 'button';
    shutter.setAttribute('aria-label', 'عکس');
    shutter.style.cssText = 'width:68px;height:68px;border-radius:50%;border:4px solid #fff;background:rgba(255,255,255,0.25);padding:0;';

    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:28px;color:#fff;">cameraswitch</span>';
    switchBtn.style.cssText = 'background:transparent;border:none;padding:12px;';

    bar.append(cancelBtn, shutter, switchBtn);
    overlay.appendChild(bar);
    document.body.appendChild(overlay);

    await video.play().catch(() => {});

    let facing = 'environment';

    function cleanup() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
    }

    cancelBtn.addEventListener('click', () => {
      cleanup();
      reject(new Error('cancelled'));
    });

    switchBtn.addEventListener('click', async () => {
      facing = facing === 'environment' ? 'user' : 'environment';
      try {
        stream.getTracks().forEach((t) => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        video.srcObject = stream;
        await video.play().catch(() => {});
      } catch (e) { /* keep previous */ }
    });

    shutter.addEventListener('click', () => {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      cleanup();
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('ثبت تصویر ناموفق بود.'));
          return;
        }
        resolve(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.92);
    });
  });
}

/**
 * Full-screen crop UI. User pans the image under a fixed frame, pinch-zooms,
 * then confirms. Returns a cropped JPEG File.
 * @param {File|Blob|string} source
 * @returns {Promise<File>}
 */
export function showCropper(source) {
  return new Promise(async (resolve, reject) => {
    let objectUrl = null;
    let src;
    if (typeof source === 'string') {
      src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      src = objectUrl;
    }

    let img;
    try {
      img = await loadImageFromSrc(src);
    } catch (e) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(e);
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0a0a0a;display:flex;flex-direction:column;direction:ltr;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top,0px));color:#fff;font-weight:700;font-size:15px;';
    header.innerHTML = '<span style="opacity:0.9">برش تصویر</span>';
    const headerActions = document.createElement('div');
    headerActions.style.cssText = 'display:flex;gap:8px;';
    header.appendChild(headerActions);
    overlay.appendChild(header);

    const stage = document.createElement('div');
    stage.style.cssText = 'flex:1;position:relative;overflow:hidden;touch-action:none;background:#111;';
    overlay.appendChild(stage);

    // Crop frame: centered, ~86% of the smaller stage side, 3:4-ish free rect
    const frame = document.createElement('div');
    frame.style.cssText = 'position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,0.55);border-radius:4px;pointer-events:none;z-index:2;';
    stage.appendChild(frame);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;z-index:1;';
    stage.appendChild(canvas);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:12px;padding:14px 16px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));background:#111;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'انصراف';
    cancelBtn.style.cssText = 'flex:1;padding:14px;border:none;border-radius:14px;background:#2a2a2a;color:#fff;font-weight:700;font-size:14px;';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = 'تأیید و ادامه';
    okBtn.style.cssText = 'flex:1.4;padding:14px;border:none;border-radius:14px;background:var(--color-primary,#475569);color:#fff;font-weight:800;font-size:14px;';
    footer.append(cancelBtn, okBtn);
    overlay.appendChild(footer);

    document.body.appendChild(overlay);

    // Draw full-res image onto canvas for crisp pan/zoom
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    let scale = 1;
    let tx = 0;
    let ty = 0;
    let frameRect = { x: 0, y: 0, w: 100, h: 100 };

    function layoutFrame() {
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const side = Math.min(sw, sh) * 0.86;
      frameRect = {
        x: (sw - side) / 2,
        y: (sh - side) / 2,
        w: side,
        h: side,
      };
      frame.style.left = `${frameRect.x}px`;
      frame.style.top = `${frameRect.y}px`;
      frame.style.width = `${frameRect.w}px`;
      frame.style.height = `${frameRect.h}px`;
    }

    function fitImage() {
      layoutFrame();
      const iw = canvas.width;
      const ih = canvas.height;
      // Cover the crop frame
      scale = Math.max(frameRect.w / iw, frameRect.h / ih);
      tx = frameRect.x + (frameRect.w - iw * scale) / 2;
      ty = frameRect.y + (frameRect.h - ih * scale) / 2;
      applyTransform();
    }

    function applyTransform() {
      canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

    fitImage();
    window.addEventListener('resize', fitImage);

    // Pointer / pinch handling
    const pointers = new Map();
    let lastDist = 0;
    let panStart = null;

    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        panStart = { x: e.clientX, y: e.clientY, tx, ty };
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        lastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    });

    stage.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && panStart) {
        const p = pointers.values().next().value;
        tx = panStart.tx + (p.x - panStart.x);
        ty = panStart.ty + (p.y - panStart.y);
        applyTransform();
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (lastDist > 0) {
          const midX = (pts[0].x + pts[1].x) / 2;
          const midY = (pts[0].y + pts[1].y) / 2;
          const stageBox = stage.getBoundingClientRect();
          const localX = midX - stageBox.left;
          const localY = midY - stageBox.top;
          const ratio = dist / lastDist;
          const newScale = Math.min(8, Math.max(0.2, scale * ratio));
          // Zoom around midpoint
          tx = localX - (localX - tx) * (newScale / scale);
          ty = localY - (localY - ty) * (newScale / scale);
          scale = newScale;
          applyTransform();
        }
        lastDist = dist;
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) lastDist = 0;
      if (pointers.size === 0) panStart = null;
      if (pointers.size === 1) {
        const p = [...pointers.values()][0];
        panStart = { x: p.x, y: p.y, tx, ty };
      }
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);

    function cleanup() {
      window.removeEventListener('resize', fitImage);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      overlay.remove();
    }

    cancelBtn.addEventListener('click', () => {
      cleanup();
      reject(new Error('cancelled'));
    });

    okBtn.addEventListener('click', () => {
      // Map frame rect back into image pixel coordinates
      const imgX = (frameRect.x - tx) / scale;
      const imgY = (frameRect.y - ty) / scale;
      const imgW = frameRect.w / scale;
      const imgH = frameRect.h / scale;

      const sx = Math.max(0, Math.floor(imgX));
      const sy = Math.max(0, Math.floor(imgY));
      const sw = Math.min(canvas.width - sx, Math.ceil(imgW));
      const sh = Math.min(canvas.height - sy, Math.ceil(imgH));

      if (sw < 8 || sh < 8) {
        return; // ignore tiny crops
      }

      const out = document.createElement('canvas');
      // Upscale small crops a bit for OCR
      const up = sw < 900 ? Math.min(2, 900 / sw) : 1;
      out.width = Math.round(sw * up);
      out.height = Math.round(sh * up);
      const octx = out.getContext('2d');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);

      out.toBlob((blob) => {
        cleanup();
        if (!blob) {
          reject(new Error('برش تصویر ناموفق بود.'));
          return;
        }
        resolve(new File([blob], `crop-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.93);
    });
  });
}

/**
 * Free-form crop: drag any edge or corner of the frame independently
 * (not a locked square). Used before sending photos to the AI chat.
 * @param {File|Blob|string} source
 * @returns {Promise<File>}
 */
export function showFreeCropper(source) {
  return new Promise(async (resolve, reject) => {
    let objectUrl = null;
    let src;
    if (typeof source === 'string') src = source;
    else {
      objectUrl = URL.createObjectURL(source);
      src = objectUrl;
    }
    let img;
    try {
      img = await loadImageFromSrc(src);
    } catch (e) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(e);
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0a0a0a;display:flex;flex-direction:column;direction:ltr;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top,0px));color:#fff;font-weight:700;font-size:15px;gap:8px;';
    header.innerHTML = '<span style="opacity:0.95">برش آزاد تصویر</span><span style="font-size:12px;font-weight:600;opacity:0.65">گوشه‌ها و لبه‌ها را بکشید</span>';
    overlay.appendChild(header);

    const stage = document.createElement('div');
    stage.style.cssText = 'flex:1;position:relative;overflow:hidden;touch-action:none;background:#111;';
    overlay.appendChild(stage);

    const imgEl = document.createElement('img');
    imgEl.src = src;
    imgEl.alt = '';
    imgEl.style.cssText = 'position:absolute;user-select:none;-webkit-user-drag:none;pointer-events:none;';
    stage.appendChild(imgEl);

    const frame = document.createElement('div');
    frame.style.cssText = 'position:absolute;z-index:3;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,0.55);box-sizing:border-box;touch-action:none;';
    stage.appendChild(frame);

    const handleDefs = [
      ['nw', 'left:-9px;top:-9px;cursor:nwse-resize;'],
      ['ne', 'right:-9px;top:-9px;cursor:nesw-resize;'],
      ['sw', 'left:-9px;bottom:-9px;cursor:nesw-resize;'],
      ['se', 'right:-9px;bottom:-9px;cursor:nwse-resize;'],
      ['n', 'left:50%;top:-9px;transform:translateX(-50%);cursor:ns-resize;'],
      ['s', 'left:50%;bottom:-9px;transform:translateX(-50%);cursor:ns-resize;'],
      ['w', 'left:-9px;top:50%;transform:translateY(-50%);cursor:ew-resize;'],
      ['e', 'right:-9px;top:50%;transform:translateY(-50%);cursor:ew-resize;'],
    ];
    const handles = {};
    for (const [id, extra] of handleDefs) {
      const h = document.createElement('div');
      h.dataset.handle = id;
      h.style.cssText = 'position:absolute;width:18px;height:18px;background:#fff;border-radius:4px;' + extra + 'z-index:4;';
      frame.appendChild(h);
      handles[id] = h;
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:10px;padding:14px 16px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));background:#111;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'انصراف';
    cancelBtn.style.cssText = 'flex:1;padding:14px;border:none;border-radius:14px;background:#2a2a2a;color:#fff;font-weight:700;font-size:14px;';
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.textContent = 'بدون برش';
    skipBtn.style.cssText = 'flex:1;padding:14px;border:none;border-radius:14px;background:#333;color:#fff;font-weight:700;font-size:14px;';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = 'تأیید برش';
    okBtn.style.cssText = 'flex:1.4;padding:14px;border:none;border-radius:14px;background:var(--color-primary,#475569);color:#fff;font-weight:800;font-size:14px;';
    footer.append(cancelBtn, skipBtn, okBtn);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    let disp = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
    let crop = { x: 0, y: 0, w: 0, h: 0 };

    function layoutImage() {
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const pad = 16;
      const s = Math.min((sw - pad * 2) / iw, (sh - pad * 2) / ih);
      disp.scale = s;
      disp.w = iw * s;
      disp.h = ih * s;
      disp.x = (sw - disp.w) / 2;
      disp.y = (sh - disp.h) / 2;
      imgEl.style.left = disp.x + 'px';
      imgEl.style.top = disp.y + 'px';
      imgEl.style.width = disp.w + 'px';
      imgEl.style.height = disp.h + 'px';
    }

    function applyFrame() {
      const minS = 24;
      crop.w = Math.max(minS, crop.w);
      crop.h = Math.max(minS, crop.h);
      crop.x = Math.max(disp.x, Math.min(crop.x, disp.x + disp.w - crop.w));
      crop.y = Math.max(disp.y, Math.min(crop.y, disp.y + disp.h - crop.h));
      if (crop.x + crop.w > disp.x + disp.w) crop.w = disp.x + disp.w - crop.x;
      if (crop.y + crop.h > disp.y + disp.h) crop.h = disp.y + disp.h - crop.y;
      frame.style.left = crop.x + 'px';
      frame.style.top = crop.y + 'px';
      frame.style.width = crop.w + 'px';
      frame.style.height = crop.h + 'px';
    }

    function resetCropFull() {
      layoutImage();
      crop = { x: disp.x, y: disp.y, w: disp.w, h: disp.h };
      applyFrame();
    }

    resetCropFull();
    window.addEventListener('resize', resetCropFull);

    let drag = null;
    function startDrag(kind, clientX, clientY) {
      drag = { kind, x: clientX, y: clientY, cx: crop.x, cy: crop.y, cw: crop.w, ch: crop.h };
    }

    frame.addEventListener('pointerdown', (e) => {
      if (e.target.dataset.handle) return;
      e.preventDefault();
      frame.setPointerCapture(e.pointerId);
      startDrag('move', e.clientX, e.clientY);
    });
    Object.values(handles).forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        h.setPointerCapture(e.pointerId);
        startDrag(h.dataset.handle, e.clientX, e.clientY);
      });
    });

    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const k = drag.kind;
      let { cx, cy, cw, ch } = drag;
      if (k === 'move') { cx += dx; cy += dy; }
      if (k.includes('w')) { cx += dx; cw -= dx; }
      if (k.includes('e')) { cw += dx; }
      if (k.includes('n')) { cy += dy; ch -= dy; }
      if (k.includes('s')) { ch += dy; }
      if (cw < 24) { if (k.includes('w')) cx = drag.cx + drag.cw - 24; cw = 24; }
      if (ch < 24) { if (k.includes('n')) cy = drag.cy + drag.ch - 24; ch = 24; }
      crop = { x: cx, y: cy, w: cw, h: ch };
      applyFrame();
    };
    const onUp = () => { drag = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    function cleanup() {
      window.removeEventListener('resize', resetCropFull);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      overlay.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }

    function emitFile(blob) {
      cleanup();
      if (!blob) { reject(new Error('برش تصویر ناموفق بود.')); return; }
      resolve(new File([blob], `crop-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }

    cancelBtn.addEventListener('click', () => { cleanup(); reject(new Error('cancelled')); });

    skipBtn.addEventListener('click', () => {
      if (source instanceof File) { cleanup(); resolve(source); return; }
      const c = document.createElement('canvas');
      c.width = iw; c.height = ih;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => emitFile(b), 'image/jpeg', 0.93);
    });

    okBtn.addEventListener('click', () => {
      const sx = Math.max(0, Math.round((crop.x - disp.x) / disp.scale));
      const sy = Math.max(0, Math.round((crop.y - disp.y) / disp.scale));
      const sw = Math.min(iw - sx, Math.round(crop.w / disp.scale));
      const sh = Math.min(ih - sy, Math.round(crop.h / disp.scale));
      if (sw < 8 || sh < 8) return;
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      const octx = out.getContext('2d');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      out.toBlob((b) => emitFile(b), 'image/jpeg', 0.93);
    });
  });
}
