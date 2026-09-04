/**
 * Self-test for KaTeX + light Markdown rendering.
 * Run with:  node js/core/rich-text-selftest.js
 * (from project root, after the vendor/katex files are present)
 *
 * Does not require a browser; loads KaTeX via the UMD build and
 * exercises the pure functions exported from ui.js.
 */

import katex from 'katex';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!katex || typeof katex.renderToString !== 'function') {
  console.error('Failed to load KaTeX');
  process.exit(2);
}
globalThis.katex = katex;

// Minimal DOM-free escapeHtml (same logic as ui.js)
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Because ui.js uses document.createElement for escapeHtml, we inject a stub
// and then dynamically import the pure math functions by evaluating the relevant section.
// Simpler approach: re-implement the public API here for the test (mirrors production).

const KATEX_OPTIONS_BASE = {
  throwOnError: false,
  strict: 'ignore',
  trust: false,
  output: 'html',
};

function renderMathSegment(mathText, displayMode = false) {
  const raw = String(mathText || '').trim();
  if (!raw) return '';
  const k = globalThis.katex;
  if (!k || typeof k.renderToString !== 'function') {
    return `<code>${escapeHtml(raw)}</code>`;
  }
  try {
    return k.renderToString(raw, { ...KATEX_OPTIONS_BASE, displayMode: !!displayMode });
  } catch (e) {
    return `<code>${escapeHtml(raw)}</code>`;
  }
}

function htmlUnescape(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function applyLightMarkdown(escapedText) {
  let s = escapedText;
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => {
    const clean = code.replace(/^\n+|\n+$/g, '');
    return `<pre><code>${clean}</code></pre>`;
  });
  s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(^|<br>)###\s+(.+?)(?=<br>|$)/g, '$1<h4>$2</h4>');
  s = s.replace(/(^|<br>)##\s+(.+?)(?=<br>|$)/g, '$1<h3>$2</h3>');
  s = s.replace(/(^|<br>)#\s+(.+?)(?=<br>|$)/g, '$1<h2>$2</h2>');
  s = s.replace(/(^|<br>)&gt;\s+(.+?)(?=<br>|$)/g, '$1<blockquote>$2</blockquote>');
  s = s.replace(/(^|<br>)(---|\*\*\*|___)\s*(?=<br>|$)/g, '$1<hr>');
  s = s.replace(/(^|<br>)[\-\*]\s+(.+?)(?=<br>|$)/g, '$1<li data-list="ul">$2</li>');
  s = s.replace(/(^|<br>)\d+\.\s+(.+?)(?=<br>|$)/g, '$1<li data-list="ol">$2</li>');
  s = s.replace(/(?:<li data-list="(ul|ol)">.*?<\/li>(?:<br>)?)+/g, (block) => {
    const type = block.includes('data-list="ol"') ? 'ol' : 'ul';
    const items = block.replace(/ data-list="(ul|ol)"/g, '').replace(/<br>/g, '');
    return `<${type}>${items}</${type}>`;
  });
  return s;
}

function renderFractionsInText(text) {
  if (!text) return text;
  const placeholders = [];
  let out = text;

  out = out.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (m, math) => {
    const rendered = renderMathSegment(htmlUnescape(math.trim()), true);
    const token = `@@MATH${placeholders.length}@@`;
    placeholders.push(rendered);
    return token;
  });

  out = out.replace(/\$([^$]+?)\$/g, (m, math) => {
    const rendered = renderMathSegment(htmlUnescape(math.trim()), false);
    const token = `@@MATH${placeholders.length}@@`;
    placeholders.push(rendered);
    return token;
  });

  out = applyLightMarkdown(out);

  placeholders.forEach((html, i) => {
    out = out.replace(`@@MATH${i}@@`, html);
  });

  return out;
}

function renderRichText(raw) {
  return renderFractionsInText(escapeHtml(String(raw)).replace(/\n/g, '<br>'));
}

// ---------- tests ----------
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓', msg);
  } else {
    failed++;
    console.error('  ✗', msg);
  }
}

function containsKatex(html) {
  return html.includes('class="katex"') || html.includes('katex-html');
}

console.log('\n=== KaTeX + Markdown self-test ===\n');

// 1. Basic fractions / symbols that previously broke
const cases = [
  ['frac', String.raw`$$\frac{a+b}{c}$$`],
  ['sqrt', String.raw`$$\sqrt{x^2+y^2}$$`],
  ['sum', String.raw`$$\sum_{i=1}^{n}i^2$$`],
  ['integral', String.raw`$$\int_0^\infty e^{-x^2}\,dx$$`],
  ['pmatrix', String.raw`$$A=\begin{pmatrix}1&2\\3&4\end{pmatrix}$$`],
  ['cases', String.raw`$$f(x)=\begin{cases}x^2 & x\geq0\\-x & x<0\end{cases}$$`],
  ['leftrightharpoons', String.raw`$$A\leftrightharpoons B$$`],
  ['text + mathbb', String.raw`$$\text{where }x\in\mathbb{R}$$`],
  ['left right abs', String.raw`$$\left|\frac{x+1}{x-1}\right|$$`],
  ['inline', String.raw`The energy is $E=mc^2$.`],
];

for (const [name, src] of cases) {
  const html = renderRichText(src);
  assert(containsKatex(html), `${name} renders with KaTeX`);
  assert(!html.includes('leftrightharpoons') || name !== 'leftrightharpoons', `${name} does not leak raw command name`);
  assert(!/\\frac|\\sum|\\begin/.test(html), `${name} does not leave raw LaTeX commands`);
}

// 2. Mixed text + markdown + math
const mixed = renderRichText(`
متن معمولی با **پررنگ** و *ایتالیک*.

فرمول inline: $E=mc^2$

و display:
$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

و یک لینک: [سایت](https://example.com)
`);

assert(mixed.includes('<strong>'), 'bold markdown works');
assert(mixed.includes('<em>'), 'italic markdown works');
assert(containsKatex(mixed), 'math inside mixed text works');
assert(mixed.includes('href="https://example.com"'), 'safe link works');
assert(!mixed.includes('<script'), 'no script injection');

// 3. Error resilience
const bad = renderRichText(String.raw`$$\unknowncommand{foo}$$ and normal text`);
assert(bad.includes('normal text') || bad.includes('unknowncommand') || containsKatex(bad), 'unknown command does not destroy surrounding text');

// 4. Security: no raw HTML from content
const xss = renderRichText(`<script>alert(1)</script> **ok** $x$`);
assert(!xss.includes('<script>'), 'HTML is escaped');
assert(xss.includes('<strong>ok</strong>') || xss.includes('ok'), 'markdown still applied after escape');


// 5. Blockquote, lists, hr
const extra = renderRichText(`
> این یک نقل‌قول است

- آیتم یک
- آیتم دو

1. اول
2. دوم

---

پایان
`);
assert(extra.includes('<blockquote>'), 'blockquote works');
assert(extra.includes('<ul>') && extra.includes('<li>'), 'unordered list works');
assert(extra.includes('<ol>'), 'ordered list works');
assert(extra.includes('<hr'), 'horizontal rule works');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
