
const BAR_COLORS = {
  light: '#FAF9F8',
  dark: '#121212',
};

function isNativeApp() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
}

export async function syncSystemBars(themeValue) {
  const isDark = themeValue === 'dark';
  const color = isDark ? BAR_COLORS.dark : BAR_COLORS.light;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);

  if (!isNativeApp()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // overlay: true → WebView goes edge-to-edge under the status bar.
    // CSS already applies the safe-area inset on .topbar so content is
    // padded correctly. With overlay: false, on some Android versions the
    // system-reserved space PLUS the CSS safe-area padding stacked into a
    // large double gap.
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setBackgroundColor({ color });
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
  } catch (err) {
  }

  try {
    const { NavigationBar } = await import('@capgo/capacitor-navigation-bar');
    await NavigationBar.setNavigationBarColor({ color, darkButtons: !isDark });
  } catch (err) {
  }
}
