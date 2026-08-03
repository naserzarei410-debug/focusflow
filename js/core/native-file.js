
let Capacitor = null;
let Filesystem = null;
let Directory = null;
let Share = null;
let loadAttempted = false;

async function loadPlugins() {
  if (loadAttempted) return;
  loadAttempted = true;
  try {
    const core = await import('@capacitor/core');
    Capacitor = core.Capacitor;
    if (Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
      const fsMod = await import('@capacitor/filesystem');
      Filesystem = fsMod.Filesystem;
      Directory = fsMod.Directory;
      const shareMod = await import('@capacitor/share');
      Share = shareMod.Share;
    }
  } catch (e) {
    Filesystem = null;
    Share = null;
  }
}

function downloadInBrowser(filename, content, mimeType, isBase64) {
  const blob = isBase64
    ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: mimeType })
    : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Saves `content` as a file named `filename` and lets the user pick where
 * it ends up. Pass isBase64: true for binary content (e.g. a PNG export)
 * that's already base64-encoded — text content (JSON, HTML, etc.) doesn't
 * need it. Returns { method: 'share' | 'browser-download' }.
 */
export async function saveOrShareFile({ filename, content, mimeType = 'application/json', isBase64 = false }) {
  await loadPlugins();

  if (Filesystem && Share && Capacitor && Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      ...(isBase64 ? {} : { encoding: 'utf8' }),
    });
    await Share.share({
      title: filename,
      url: written.uri,
    });
    return { method: 'share' };
  }

  downloadInBrowser(filename, content, mimeType, isBase64);
  return { method: 'browser-download' };
}
