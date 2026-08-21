/**
 * index.js — Unified entry for all interactive widgets.
 *
 * Usage from pages.js:
 *   import { initInteractiveWidgets } from './interactive/index.js';
 *   initInteractiveWidgets(container, {
 *     saveFile: (f) => import('../core/native-file.js').then(m => m.saveOrShareFile(f)),
 *     renderMath: renderMarkdownAndMath,
 *   });
 */

import { injectCss, setupWidgets, getTheme } from './theme.js';
import { initPlots } from './plot.js';
import { initVennDiagrams } from './venn.js';
import { initInteractiveGeometry } from './geometry.js';
import { initMindmaps } from './mindmap.js';
import { initPhysicsSimulations } from './physics.js';
import { initLewisStructures } from './lewis.js';

export { initPlots, initVennDiagrams, initInteractiveGeometry, initMindmaps, initPhysicsSimulations, initLewisStructures };

export { setupWidgets } from './theme.js';
export { parsePlotSpec } from './plot.js';
export { parseVennSpec } from './venn.js';
export { parseGeometrySpec } from './geometry.js';
export { parseMindmapSpec } from './mindmap.js';
export { parsePhysicsSpec } from './physics.js';
export { parseLewisSpec, buildLewisSvg } from './lewis.js';

export function initInteractiveWidgets(parent, opts = {}) {
  injectCss();
  setupWidgets(opts);
  getTheme();
  initPlots(parent, opts);
  initVennDiagrams(parent, opts);
  initInteractiveGeometry(parent, opts);
  initMindmaps(parent, opts);
  initPhysicsSimulations(parent, opts);
  initLewisStructures(parent, opts);
}
