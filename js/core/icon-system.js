import { ICONS } from './icons-data.js';

function replaceIcon(el) {
  if (el.firstElementChild && el.firstElementChild.tagName.toLowerCase() === 'svg') return;
  
  if (el.children.length > 0 && !(el.children.length === 1 && el.children[0].tagName.toLowerCase() === 'svg')) {
      return;
  }
  
  const iconName = el.textContent.trim();
  if (!iconName) return;

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

// Visible placeholder when an icon name is not in icons-data.js (was a tiny dot).
const FALLBACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 -960 960 960"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Zm-40 160h80v80h-80v-80Zm0-320h80v240h-80v-240Z"/></svg>';

document.querySelectorAll('.material-symbols-rounded').forEach(replaceIcon);

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

window.replaceMaterialIcons = () => {
    document.querySelectorAll('.material-symbols-rounded').forEach(replaceIcon);
};
