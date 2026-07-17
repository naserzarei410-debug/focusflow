import { ICONS } from './icons-data.js';

function replaceIcon(el) {
  // If it already has an svg child, do nothing
  if (el.firstElementChild && el.firstElementChild.tagName.toLowerCase() === 'svg') return;
  
  // Only process if it has no elements (just text) or is empty
  if (el.children.length > 0 && !(el.children.length === 1 && el.children[0].tagName.toLowerCase() === 'svg')) {
      return;
  }
  
  const iconName = el.textContent.trim();
  if (!iconName) return;

  // Fallback glyph used when an icon name isn't in ICONS (e.g. a typo, or
  // a name added in the UI code that was never added to icons-data.js).
  // Without this, the raw icon name (e.g. "account_tree") was left as
  // literal on-screen text instead of an icon.
  const svgMarkup = ICONS[iconName] || FALLBACK_ICON;

  el.innerHTML = svgMarkup;
  el.style.display = 'inline-flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  const svg = el.querySelector('svg');
  if (svg) {
      svg.style.width = '1em';
      svg.style.height = '1em';
      svg.setAttribute('fill', 'currentColor');
  }
}

const FALLBACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 -960 960 960"><circle cx="480" cy="-480" r="60"/></svg>';

// Initial replacement
document.querySelectorAll('.material-symbols-rounded').forEach(replaceIcon);

// Observe DOM for dynamic icons
const observer = new MutationObserver((mutations) => {
  for (const mut of mutations) {
    if (mut.type === 'childList') {
      if (mut.target.nodeType === 1 && mut.target.classList.contains('material-symbols-rounded')) {
        replaceIcon(mut.target);
      }
      mut.addedNodes.forEach(node => {
        if (node.nodeType === 1) { // Element
          if (node.classList.contains('material-symbols-rounded')) {
            replaceIcon(node);
          }
          const icons = node.querySelectorAll('.material-symbols-rounded');
          icons.forEach(replaceIcon);
        }
      });
    } else if (mut.type === 'characterData') {
        if (mut.target.nodeType === 1 && mut.target.classList.contains('material-symbols-rounded')) {
             replaceIcon(mut.target);
        } else if (mut.target.parentNode && mut.target.parentNode.nodeType === 1 && mut.target.parentNode.classList.contains('material-symbols-rounded')) {
             replaceIcon(mut.target.parentNode);
        }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true, characterData: true });

// Expose globally just in case
window.replaceMaterialIcons = () => {
    document.querySelectorAll('.material-symbols-rounded').forEach(replaceIcon);
};
