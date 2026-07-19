import { parseRange } from './js/features/interval-plot.js';
console.log(parseRange('(2, +∞)'));
console.log(parseRange('(2, +infty)'));
console.log(parseRange('(2, inf)'));
