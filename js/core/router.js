

const routes = {};
let currentRoute = null;
let currentParam = null;

const PAGE_TITLES = {
  home: 'خانه',
  library: 'کتابخانه',
  ai: 'هوش مصنوعی',
  stats: 'آمار',
  settings: 'تنظیمات',
  category: 'دسته', // overridden dynamically by the render function itself
  study: 'مرور فلش‌کارت‌ها',
  practice: 'تمرین هوشمند',
  exam: 'آزمون شبیه‌ساز',
  search: 'جستجو',
  pomodoro: 'تایمر پومودورو',
};

// Routes that are not one of the 5 bottom-nav destinations get a back
// button in the topbar instead of a highlighted nav item, and each
// knows which route to return to.
const SECONDARY_ROUTES = new Set(['category', 'study', 'practice', 'exam', 'search', 'pomodoro']);
const BACK_TARGETS = { category: 'library', study: 'library', practice: 'library', exam: 'library', search: 'home', pomodoro: 'home' };

function registerRoute(name, renderFn) {
  routes[name] = renderFn;
}

function navigate(routeName, param = null) {
  if (!routes[routeName]) return;
  currentRoute = routeName;
  currentParam = param;
  const newHash = param ? `${routeName}/${encodeURIComponent(param)}` : routeName;
  if (window.location.hash === '#' + newHash || window.location.hash === newHash) {
    render(routeName, param);
  } else {
    window.location.hash = newHash;
  }
}

function goBack() {
  if ((currentRoute === 'study' || currentRoute === 'practice' || currentRoute === 'exam') && currentParam) {
    navigate('category', currentParam);
  } else {
    navigate(BACK_TARGETS[currentRoute] || 'home');
  }
}

function parseHash() {
  const raw = window.location.hash.replace('#', '');
  if (!raw) return { name: 'home', param: null };
  const [name, param] = raw.split('/');
  return { name, param: param ? decodeURIComponent(param) : null };
}

function render(routeName, param) {
  const content = document.getElementById('page-content');
  const title = document.getElementById('page-title');

  content.innerHTML = '';
  content.classList.remove('page-fade');
  // force reflow so the fade-in animation replays on every navigation
  void content.offsetWidth;
  content.classList.add('page-fade');

  // Create a safe wrapper that is discarded if render is called again.
  // Since render clears content.innerHTML, any ongoing async rendering
  // to a previous page's wrapper will be safely discarded (orphaned).
  const pageWrapper = document.createElement('div');
  pageWrapper.style.cssText = 'width:100%; height:100%; display:contents;';
  content.appendChild(pageWrapper);

  const renderFn = routes[routeName];
  if (title) title.textContent = PAGE_TITLES[routeName] || '';
  if (renderFn) {
    renderFn(pageWrapper, param);
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.route === routeName);
  });

  const backBtn = document.getElementById('back-btn');
  const themeBtn = document.getElementById('theme-toggle');
  const isSecondary = SECONDARY_ROUTES.has(routeName);
  if (backBtn) backBtn.classList.toggle('hidden', !isSecondary);
  if (themeBtn) themeBtn.classList.toggle('hidden', isSecondary);
}

function initRouter() {
  const { name, param } = parseHash();
  currentRoute = routes[name] ? name : 'home';
  currentParam = param;
  window.addEventListener('hashchange', () => {
    const parsed = parseHash();
    currentRoute = routes[parsed.name] ? parsed.name : 'home';
    currentParam = parsed.param;
    render(currentRoute, currentParam);
  });
  render(currentRoute, currentParam);
}

/** Lets a page update the topbar title after fetching async data (e.g. a category's name). */
function setTitle(text) {
  const title = document.getElementById('page-title');
  if (title) title.textContent = text;
}

export const router = { registerRoute, navigate, goBack, initRouter, setTitle };
