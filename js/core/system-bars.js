
const BAR_COLORS = {
  light: '#F6F5F0',
  dark: '#17161A',
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
    await StatusBar.setOverlaysWebView({ overlay: false });
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
