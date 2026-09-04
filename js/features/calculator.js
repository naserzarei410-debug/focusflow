import { router } from '../core/router.js';
import $ from 'jquery';

// Guard against a bundler/order issue where `$` resolves to something that
// isn't a real jQuery instance (e.g. an empty module shim). MathQuill reads
// window.jQuery/window.$ internally, so if this silently fails the calculator
// screen ends up blank with no error shown to the user — better to log it
// clearly than to fail invisibly.
if ($ && typeof $ === 'function' && $.fn) {
  window.$ = window.jQuery = $;
} else {
  console.error('jQuery به‌درستی بارگذاری نشد؛ MathQuill (و در نتیجه ماشین‌حساب) کار نخواهد کرد.');
}


/* ============================================================
   SECTION 1 — CONFIG / CONSTANTS
   ------------------------------------------------------------
   Every tolerance, iteration cap, and search range used by the
   parser, evaluator, and solvers lives here — nowhere else in
   this file should a bare numeric tolerance/iteration-count
   literal appear.
   ============================================================
*/
const CONFIG = Object.freeze({
  // --- real-number / complex policy ---
  // Real-number only: Complex results raise DomainError instead of being displayed.
  ALLOW_COMPLEX: false,

  // --- formatting ---
  ZERO_SNAP_ABS: 1e-10,     // |x| below this displays as exactly 0
  ROUND_DECIMALS: 10,       // rounding applied before display to kill fp noise
  DISPLAY_PRECISION: 12,    // significant digits passed to mathjs format()

  // --- trig pole/domain tolerances ---
  TRIG_POLE_EPS: 1e-9,      // |cos|/|sin| below this near tan/cot/sec/csc -> domain error
  ASIN_ACOS_DOMAIN_EPS: 1e-9, // slack allowed just outside [-1,1] before erroring (fp noise)

  // --- root finding (single variable) ---
  ROOT_SCAN_STEPS: 6000,
  ROOT_SCAN_RANGE_DEG: [-720, 720],
  ROOT_SCAN_RANGE_RAD: [-4 * Math.PI, 4 * Math.PI],
  BISECTION_ITERS: 60,
  ROOT_DEDUPE_TOL: 1e-4,
  ROOT_RESIDUAL_CHECK_TOL: 1e-3,      // absolute cap
  ROOT_RESIDUAL_CHECK_REL_SCALE: 1e-4, // relative-to-jump-scale cap

  // --- LM / Gauss-Newton (multi-variable) ---
  LM_ITERS: 60,
  LM_JACOBIAN_H: 1e-6,
  LM_LAMBDA_INIT: 1e-3,
  LM_LAMBDA_GROW: 4,
  LM_LAMBDA_SHRINK: 3,
  LM_LAMBDA_MAX: 1e8,
  LM_LAMBDA_MIN: 1e-8,
  LM_CONVERGE_NORM: 1e-9,
  LM_ACCEPT_NORM: 1e-4,
  LM_MAX_STEP_ABS: 1e6,
  LM_STACKED_CONVERGE_NORM: 1e-8,

  // --- multi-start search ---
  MULTISTART_MAX_SOLUTIONS: 30,
  MULTISTART_DUP_TOL: 1e-3,
  MULTISTART_BUDGET_BY_DIM: { 1: 400, 2: 400, 3: 700, default: 1000 },
  MAX_UNKNOWNS: 4,

  // --- constraint filtering ---
  CONSTRAINT_TOL: 1e-4,
  CONSTRAINT_EQ_TOL_NO_SYMBOLS: 1e-6,

  // --- identity sampling ---
  IDENTITY_FIT_SAMPLE_MIN_EXTRA: 3,
  IDENTITY_FIT_SAMPLE_MIN: 5,
  IDENTITY_DRAW_ATTEMPTS: 80,
  IDENTITY_ALG_SOLVE_ATTEMPTS: 60,
  IDENTITY_ALG_MAX_SOLUTIONS: 6,
  IDENTITY_VERIFY_SAMPLES: 8,
  IDENTITY_VERIFY_RESIDUAL_TOL: 1e-3,
  IDENTITY_NEUTRAL_PROBE_VALUE: 1.3,
  IDENTITY_ALG_GUESS_RANGE: [-3, 3],

  // --- "this is basically an identity, stop root-scanning" heuristic ---
  DENSE_ROOTS_IS_IDENTITY_THRESHOLD: 40,
  IDENTITY_PROBE_TARGET_COUNT: 12,
  IDENTITY_PROBE_MAX_ATTEMPTS: 200,
  IDENTITY_PROBE_MIN_VALID: 3,

  MAX_REPORTED_VALUES: 6,

  // --- factorial ---
  FACTORIAL_MAX_ARG: 170, // beyond this, double overflows to Infinity anyway
});

/* ============================================================
   SECTION 2 — ERROR TYPES
   ------------------------------------------------------------
   Formal error taxonomy. Every error the engine raises is one
   of these, each carrying a machine-readable `code` (for
   tests/logging) and a ready-to-display Persian `message`. UI
   code should show `.message` and never a raw math.js error
   string to the user.
   ============================================================
*/
const ErrorCodes = Object.freeze({
  PARSE_ERROR: 'PARSE_ERROR',
  DOMAIN_ERROR: 'DOMAIN_ERROR',
  DIVISION_BY_ZERO: 'DIVISION_BY_ZERO',
  UNKNOWN_SYMBOL: 'UNKNOWN_SYMBOL',
  UNSUPPORTED_FUNCTION: 'UNSUPPORTED_FUNCTION',
  COMPLEX_NOT_SUPPORTED: 'COMPLEX_NOT_SUPPORTED',
  SOLVER_NO_SOLUTION: 'SOLVER_NO_SOLUTION',
  SOLVER_INCOMPLETE: 'SOLVER_INCOMPLETE',
  SOLVER_NON_CONVERGENCE: 'SOLVER_NON_CONVERGENCE',
  STORAGE_ERROR: 'STORAGE_ERROR',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

class LatexSyntaxError extends Error {
  constructor(message, position) {
    super(message);
    this.name = 'LatexSyntaxError';
    this.code = ErrorCodes.PARSE_ERROR;
    this.position = position;
  }
}

// Thrown by our own math-scope wrapper functions (sin/asin/sqrt/log/
// factorial/...) BEFORE math.js gets a chance to silently return
// Infinity/NaN/Complex. Always carries a specific ErrorCodes value.
class DomainError extends Error {
  constructor(message, code = ErrorCodes.DOMAIN_ERROR) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/* ============================================================
   SECTION 3 — TOKENIZER
   ============================================================ */
const GREEK = new Set([
  'alpha','beta','gamma','delta','epsilon','varepsilon','zeta','eta','theta',
  'vartheta','iota','kappa','lambda','mu','nu','xi','omicron','pi','varpi',
  'rho','varrho','sigma','varsigma','tau','upsilon','phi','varphi','chi','psi',
  'omega','Gamma','Delta','Theta','Lambda','Xi','Pi','Sigma','Upsilon','Phi',
  'Psi','Omega'
]);

const TRIG = new Set(['sin','cos','tan','cot','sec','csc']);
const INV_TRIG_MAP = { sin: 'asin', cos: 'acos', tan: 'atan', cot: 'acot', sec: 'asec', csc: 'acsc' };
const ARC_TRIG_MAP = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', arccot: 'acot', arcsec: 'asec', arccsc: 'acsc' };

// Commands that carry no math meaning by themselves (spacing / styling)
const IGNORABLE_CMDS = new Set([',', ';', '!', ' ', 'quad', 'qquad', 'displaystyle']);

// Relational/comparison commands (\le, \ge, \ne, \neq). These must never be
// treated as the start of an implicit-multiplication factor.
const REL_CMDS = new Set(['le', 'ge', 'ne', 'neq']);

// Reserved multi-letter function keywords (see tokenizer comment above
// for why these are safe against the "several 1-letter variables typed
// back to back" case). floor/ceil take one argument; mod/ncr/npr take two.
const RESERVED_FN_KEYWORDS = ['floor', 'ceil', 'mod', 'ncr', 'npr'];
const RESERVED_FN_ARITY = { floor: 1, ceil: 1, mod: 2, ncr: 2, npr: 2 };
// Maps to the actual math.js function name used in the compiled output.
const RESERVED_FN_TARGET = { floor: 'floor', ceil: 'ceil', mod: 'mod', ncr: 'combinations', npr: 'permutations' };

function tokenize(latex) {
  const tokens = [];
  let i = 0;
  const n = latex.length;
  while (i < n) {
    const c = latex[i];
    if (/\s/.test(c)) { i++; continue; }

    if (c === '\\') {
      let j = i + 1;
      if (j < n && /[a-zA-Z]/.test(latex[j])) {
        let k = j;
        while (k < n && /[a-zA-Z]/.test(latex[k])) k++;
        tokens.push({ type: 'CMD', name: latex.slice(j, k), pos: i });
        i = k;
      } else if (j < n) {
        tokens.push({ type: 'CMD', name: latex[j], pos: i });
        i = j + 1;
      } else {
        i = n;
      }
      continue;
    }

    if (c === '{') { tokens.push({ type: 'LBRACE', pos: i }); i++; continue; }
    if (c === '}') { tokens.push({ type: 'RBRACE', pos: i }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'LPAREN', pos: i }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'RPAREN', pos: i }); i++; continue; }
    if (c === '[') { tokens.push({ type: 'LBRACK', pos: i }); i++; continue; }
    if (c === ']') { tokens.push({ type: 'RBRACK', pos: i }); i++; continue; }
    if (c === '|') { tokens.push({ type: 'PIPE', pos: i }); i++; continue; }
    if (c === '^') { tokens.push({ type: 'CARET', pos: i }); i++; continue; }
    if (c === '_') { tokens.push({ type: 'UNDERSCORE', pos: i }); i++; continue; }
    if (c === '!') { tokens.push({ type: 'BANG', pos: i }); i++; continue; }
    // Comma, needed only for the two-argument reserved functions
    // (mod, ncr, npr) added above.
    if (c === ',') { tokens.push({ type: 'COMMA', pos: i }); i++; continue; }
    if (c === '%') { tokens.push({ type: 'PERCENT', pos: i }); i++; continue; }
    if ('+-*/'.includes(c)) { tokens.push({ type: 'OP', value: c, pos: i }); i++; continue; }
    if (c === '<') {
      if (latex[i + 1] === '=') { tokens.push({ type: 'CMP', value: '<=', pos: i }); i += 2; }
      else { tokens.push({ type: 'CMP', value: '<', pos: i }); i++; }
      continue;
    }
    if (c === '>') {
      if (latex[i + 1] === '=') { tokens.push({ type: 'CMP', value: '>=', pos: i }); i += 2; }
      else { tokens.push({ type: 'CMP', value: '>', pos: i }); i++; }
      continue;
    }
    if (c === '=') { tokens.push({ type: 'CMP', value: '==', pos: i }); i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(latex[i + 1] || ''))) {
      let k = i;
      let seenDot = false;
      while (k < n && (/[0-9]/.test(latex[k]) || (latex[k] === '.' && !seenDot))) {
        if (latex[k] === '.') seenDot = true;
        k++;
      }
      // Scientific-notation input ("3e5", "1.5e-10"). Only consumed as
      // part of the number when a digit-run was already scanned above AND
      // the 'e'/'E' is immediately followed by a valid exponent — so bare
      // "e" (Euler's constant) and "e5" (= e * 5 via implicit
      // multiplication, unchanged existing behavior) are NOT affected;
      // this only fires when 'e' is glued directly onto a preceding
      // digit run, e.g. typing digits then the "EXP" keypad button.
      // mathjs's own expression grammar accepts this exact "3e5" literal
      // form natively, so the token's raw text is passed through as-is.
      if (k < n && (latex[k] === 'e' || latex[k] === 'E')) {
        let m = k + 1;
        if (m < n && (latex[m] === '+' || latex[m] === '-')) m++;
        if (m < n && /[0-9]/.test(latex[m])) {
          let expEnd = m;
          while (expEnd < n && /[0-9]/.test(latex[expEnd])) expEnd++;
          k = expEnd;
        }
      }
      tokens.push({ type: 'NUM', value: latex.slice(i, k), pos: i });
      i = k;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      // A small set of reserved multi-letter function keywords
      // (floor, ceil, mod, ncr, npr) recognized WITHOUT any new MathQuill
      // command — they're just typed as ordinary letters via the existing
      // letter keyboard. To avoid any collision with the (much more
      // common) case of several one-letter variables typed back-to-back
      // via implicit multiplication (e.g. "ncr" possibly meaning n*c*r),
      // the keyword is only recognized when it is IMMEDIATELY followed by
      // "(" — otherwise every letter still tokenizes one-at-a-time exactly
      // as before (so "ncr" with no following "(" still means n*c*r,
      // unchanged).
      const rest = latex.slice(i);
      const kwMatch = RESERVED_FN_KEYWORDS.find((kw) => rest.startsWith(kw) && rest[kw.length] === '(');
      if (kwMatch) {
        tokens.push({ type: 'IDENT', value: kwMatch, pos: i, reservedFn: true });
        i += kwMatch.length;
        continue;
      }
      tokens.push({ type: 'IDENT', value: c, pos: i });
      i++;
      continue;
    }

    throw new LatexSyntaxError(`نویسه ناشناخته «${c}»`, i);
  }
  tokens.push({ type: 'EOF', pos: n });
  return tokens;
}

/* ============================================================
   SECTION 4 — RECURSIVE-DESCENT PARSER (LaTeX -> math.js expr string)
   ------------------------------------------------------------
   Precedence (tightest to loosest):
     1. grouping: (), {}, |...|, \left...\right
     2. postfix: ! (factorial), % (percent)   [parsePostfix]
     3. power: ^  (right operand re-enters via parseExponentAtom,
        which itself allows a leading sign, e.g. 2^-2)          [parsePower]
     4. unary +/-  (chainable, WRAPS the power above it)        [parseUnary]
     5. * / (incl. \cdot \times \div) and implicit multiplication [parseTerm]
     6. binary + -                                              [parseExpr]
     7. comparisons ==, !=, <=, >=, <, >                        [parseComparison]

   parsePower() takes its BASE from parsePostfix (not parseUnary), so a
   leading minus is NOT consumed as part of the base — this is what makes
   "-2^2" mean "-(2^2)" = -4, matching standard mathematical convention
   (rather than "(-2)^2" = 4).
   ============================================================
*/
class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.pipeDepth = 0;
  }
  peek(offset = 0) { return this.tokens[this.pos + offset]; }
  next() { return this.tokens[this.pos++]; }
  expect(type) {
    const t = this.next();
    if (t.type !== type) {
      throw new LatexSyntaxError(`عبارت ناقص است — انتظار «${type}» می‌رفت`, t.pos);
    }
    return t;
  }

  parseProgram() {
    const e = this.parseComparison();
    const t = this.peek();
    if (t.type !== 'EOF') {
      throw new LatexSyntaxError('نویسه یا پرانتز اضافی در انتهای عبارت', t.pos);
    }
    return e;
  }

  parseComparison() {
    let left = this.parseExpr();
    const t = this.peek();
    if (t.type === 'CMP') {
      this.next();
      const right = this.parseExpr();
      return `(${left}) ${t.value} (${right})`;
    }
    if (t.type === 'CMD' && (t.name === 'le' || t.name === 'ge' || t.name === 'neq' || t.name === 'ne')) {
      this.next();
      const right = this.parseExpr();
      const map = { le: '<=', ge: '>=', neq: '!=', ne: '!=' };
      return `(${left}) ${map[t.name]} (${right})`;
    }
    return left;
  }

  // Chained comparisons for conditional-mode ranges like "0 <= theta <= 90".
  parseConditionProgram() {
    const parts = [];
    let left = this.parseExpr();
    for (;;) {
      const t = this.peek();
      let op = null;
      if (t.type === 'CMP') { this.next(); op = t.value; }
      else if (t.type === 'CMD' && (t.name === 'le' || t.name === 'ge' || t.name === 'neq' || t.name === 'ne')) {
        this.next();
        op = { le: '<=', ge: '>=', neq: '!=', ne: '!=' }[t.name];
      } else {
        break;
      }
      const right = this.parseExpr();
      parts.push({ lhs: left, rhs: right, op });
      left = right;
    }
    if (!parts.length) {
      throw new LatexSyntaxError('شرط باید شامل یک علامت تساوی یا نامساوی باشد', this.peek().pos);
    }
    const end = this.peek();
    if (end.type !== 'EOF') {
      throw new LatexSyntaxError('نویسه یا پرانتز اضافی در انتهای شرط', end.pos);
    }
    return parts;
  }

  parseExpr() {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        this.next();
        const right = this.parseTerm();
        left = `${left} ${t.value} ${right}`;
      } else break;
    }
    return left;
  }

  parseTerm() {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'OP' && (t.value === '*' || t.value === '/')) {
        this.next();
        const right = this.parseUnary();
        left = `(${left}) ${t.value} (${right})`;
      } else if (t.type === 'CMD' && (t.name === 'cdot' || t.name === 'times')) {
        this.next();
        const right = this.parseUnary();
        left = `(${left}) * (${right})`;
      } else if (t.type === 'CMD' && t.name === 'div') {
        this.next();
        const right = this.parseUnary();
        left = `(${left}) / (${right})`;
      } else if (this.startsImplicitFactor(t)) {
        const right = this.parseUnary();
        left = `(${left}) * (${right})`;
      } else break;
    }
    return left;
  }

  startsImplicitFactor(t) {
    if (t.type === 'NUM' || t.type === 'IDENT' || t.type === 'LPAREN' || t.type === 'LBRACE') return true;
    if (t.type === 'PIPE') return this.pipeDepth === 0;
    if (t.type === 'CMD') {
      if (IGNORABLE_CMDS.has(t.name) || REL_CMDS.has(t.name) || t.name === 'right') return false;
      return true;
    }
    return false;
  }

  // Unary +/- : chainable, and wraps a full (unsigned) power expression —
  // this is what makes "-2^2" mean "-(2^2)" rather than "(-2)^2".
  parseUnary() {
    const t = this.peek();
    if (t.type === 'OP' && (t.value === '-' || t.value === '+')) {
      this.next();
      const operand = this.parseUnary();
      return t.value === '-' ? `-(${operand})` : `(${operand})`;
    }
    return this.parsePower();
  }

  // Power: UNSIGNED base (parsePostfix, not parseUnary) ^ exponent.
  parsePower() {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t.type === 'CARET') {
      this.next();
      const exp = this.parseExponentAtom();
      return `(${base}) ^ (${exp})`;
    }
    return base;
  }

  // exponent binds tightly: either a {group}, a leading-signed atom
  // (2^-2), or a single (possibly postfixed) atom.
  parseExponentAtom() {
    const t = this.peek();
    if (t.type === 'LBRACE') {
      this.next();
      const e = this.parseComparison();
      this.expect('RBRACE');
      return e;
    }
    if (t.type === 'OP' && t.value === '-') {
      this.next();
      return `-(${this.parseExponentAtom()})`;
    }
    return this.parseUnary();
  }

  // Postfix operators (factorial, percent) bind directly to the
  // preceding primary, tighter than power — so "5!^2" = (5!)^2, and
  // "2^3!" (inside an exponent atom) = 2^(3!), each per the grammar
  // above. Chainable left-to-right: "5!!" = factorial(factorial(5))
  // (ordinary factorial applied twice — deliberately NOT the
  // mathematical "double factorial" operator).
  parsePostfix() {
    let atom = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'BANG') { this.next(); atom = `factorial(${atom})`; }
      else if (t.type === 'PERCENT') { this.next(); atom = `((${atom}) / 100)`; }
      // MathQuill may serialize a written '%' keystroke as the LaTeX
      // command "\%" (percent must be escaped in real LaTeX) rather than
      // a bare '%' character — support both forms defensively so the
      // percent key can't silently break again depending on MathQuill's
      // internal escaping (see raw-PERCENT handling above).
      else if (t.type === 'CMD' && t.name === '%') { this.next(); atom = `((${atom}) / 100)`; }
      else break;
    }
    return atom;
  }

  // Reads one "argument" for a function/command: {group} | (expr) | \left(...\right) | single (signed/postfixed) atom
  parseArgumentGroup() {
    const t = this.peek();
    if (t.type === 'CMD' && t.name === 'left') {
      this.next();
      return this.parseDelimited();
    }
    if (t.type === 'LBRACE') {
      this.next();
      const e = this.parseComparison();
      this.expect('RBRACE');
      return e;
    }
    if (t.type === 'LPAREN') {
      this.next();
      const e = this.parseComparison();
      this.expect('RPAREN');
      return e;
    }
    return this.parseUnary();
  }

  parseDelimited() {
    const openTok = this.next();
    let closerType, wrap;
    if (openTok.type === 'LPAREN') { closerType = 'RPAREN'; wrap = (x) => `(${x})`; }
    else if (openTok.type === 'LBRACK') { closerType = 'RBRACK'; wrap = (x) => `(${x})`; }
    else if (openTok.type === 'PIPE') { closerType = 'PIPE'; wrap = (x) => `abs(${x})`; }
    else if (openTok.type === 'CMD' && openTok.name === '{') { closerType = 'BRACE'; wrap = (x) => `(${x})`; }
    else {
      throw new LatexSyntaxError('علامت باز پس از \\left ناشناخته است', openTok.pos);
    }
    const inner = this.parseComparison();
    const closeLeft = this.next();
    if (closeLeft.type !== 'CMD' || closeLeft.name !== 'right') {
      throw new LatexSyntaxError('برای \\left متناظر \\right یافت نشد', closeLeft.pos);
    }
    const closer = this.next();
    const ok =
      (closerType === 'RPAREN' && (closer.type === 'RPAREN' || (closer.type === 'CMD' && closer.name === '.'))) ||
      (closerType === 'RBRACK' && (closer.type === 'RBRACK' || (closer.type === 'CMD' && closer.name === '.'))) ||
      (closerType === 'PIPE' && closer.type === 'PIPE') ||
      (closerType === 'BRACE' && closer.type === 'CMD' && closer.name === '}');
    if (!ok) {
      throw new LatexSyntaxError('براکت \\right با \\left هم‌خوانی ندارد', closer.pos);
    }
    return wrap(inner);
  }

  parsePrimary() {
    const t = this.peek();

    if (t.type === 'NUM') { this.next(); return t.value; }

    if (t.type === 'LPAREN') {
      this.next();
      const e = this.parseComparison();
      this.expect('RPAREN');
      return `(${e})`;
    }
    if (t.type === 'LBRACE') {
      this.next();
      const e = this.parseComparison();
      this.expect('RBRACE');
      return `(${e})`;
    }
    if (t.type === 'PIPE') {
      this.next();
      this.pipeDepth++;
      const e = this.parseComparison();
      this.pipeDepth--;
      const close = this.next();
      if (close.type !== 'PIPE') throw new LatexSyntaxError('قدر مطلق بسته نشد', close.pos);
      return `abs(${e})`;
    }

    if (t.type === 'IDENT') {
      this.next();
      // Reserved multi-letter function keyword (floor/ceil/mod/ncr/npr)
      // — tokenizer only ever sets reservedFn:true when '(' immediately
      // follows, so this is always a genuine function call, never a
      // 1-letter-variable false match.
      if (t.reservedFn) {
        this.expect('LPAREN');
        const args = [this.parseComparison()];
        const arity = RESERVED_FN_ARITY[t.value];
        while (args.length < arity) {
          this.expect('COMMA');
          args.push(this.parseComparison());
        }
        this.expect('RPAREN');
        return `${RESERVED_FN_TARGET[t.value]}(${args.join(', ')})`;
      }
      return this.maybeSubscript(t.value);
    }

    if (t.type === 'CMD') {
      return this.parseCommand();
    }

    throw new LatexSyntaxError('عبارت نامعتبر یا ناقص است', t.pos);
  }

  // Shared by IDENT (x_1) and Greek-letter CMD names (\theta_1, \phi_2, \pi_0)
  // so subscript handling lives in exactly one place.
  maybeSubscript(name) {
    if (this.peek().type === 'UNDERSCORE') {
      this.next();
      return `${name}_${this.parseSubscriptAtom()}`;
    }
    return name;
  }

  parseSubscriptAtom() {
    const t = this.peek();
    if (t.type === 'LBRACE') {
      this.next();
      let s = '';
      while (this.peek().type !== 'RBRACE') {
        const tok = this.next();
        if (tok.type === 'EOF') throw new LatexSyntaxError('براکت زیرنویس بسته نشد', tok.pos);
        s += tok.value !== undefined ? tok.value : (tok.name || '');
      }
      this.next();
      return s.replace(/[^a-zA-Z0-9]/g, '') || '1';
    }
    const tok = this.next();
    return (tok.value !== undefined ? tok.value : tok.name || '1').toString().replace(/[^a-zA-Z0-9]/g, '') || '1';
  }

  parseCommand() {
    const t = this.next();
    const name = t.name;

    if (name === 'left') return this.parseDelimited();

    if (IGNORABLE_CMDS.has(name)) return this.parsePrimary();

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      this.expect('LBRACE');
      const num = this.parseComparison();
      this.expect('RBRACE');
      this.expect('LBRACE');
      const den = this.parseComparison();
      this.expect('RBRACE');
      return `((${num})/(${den}))`;
    }

    if (name === 'sqrt') {
      if (this.peek().type === 'LBRACK') {
        this.next();
        const idx = this.parseComparison();
        this.expect('RBRACK');
        this.expect('LBRACE');
        const content = this.parseComparison();
        this.expect('RBRACE');
        return `nthRoot(${content}, ${idx})`;
      }
      this.expect('LBRACE');
      const content = this.parseComparison();
      this.expect('RBRACE');
      return `sqrt(${content})`;
    }

    // NthRoot is MathQuill's own command name for the "nth root" keypad
    // button; it renders as \sqrt[n]{x} in .latex() output on MathQuill
    // 0.10, so it reaches the `sqrt` branch above under normal operation.
    // This explicit branch is a defensive fallback in case a MathQuill
    // build ever emits \nthroot{idx}{content} directly instead.
    if (name === 'nthroot') {
      this.expect('LBRACE');
      const idx = this.parseComparison();
      this.expect('RBRACE');
      this.expect('LBRACE');
      const content = this.parseComparison();
      this.expect('RBRACE');
      return `nthRoot(${content}, ${idx})`;
    }

    if (name === 'ln') return `log(${this.parseArgumentGroup()})`;
    if (name === 'log') {
      let base = null;
      if (this.peek().type === 'UNDERSCORE') {
        this.next();
        base = this.parseSubscriptAtom();
      }
      const arg = this.parseArgumentGroup();
      return base ? `log(${arg}, ${base})` : `log10(${arg})`;
    }
    if (name === 'exp') return `exp(${this.parseArgumentGroup()})`;

    if (TRIG.has(name) || ARC_TRIG_MAP[name]) {
      const fnBase = ARC_TRIG_MAP[name] || name;
      let power = null;
      if (this.peek().type === 'CARET') {
        this.next();
        power = this.parseExponentAtom();
      }
      const arg = this.parseArgumentGroup();
      const powerNormalized = power !== null ? power.replace(/[()\s]/g, '') : null;
      if (powerNormalized === '-1' && TRIG.has(name)) {
        return `${INV_TRIG_MAP[name]}(${arg})`;
      }
      const call = `${fnBase}(${arg})`;
      return power !== null ? `(${call}) ^ (${power})` : call;
    }

    if (name === 'infty') return 'Infinity';
    if (name === 'pi') return this.maybeSubscript('pi');
    // 'phi' is offered as a dedicated Greek keypad
    // button alongside theta/alpha/beta/gamma/lambda/Delta, all of which
    // are ordinary free variables. 'phi' was the sole exception: math.js
    // defines a built-in `phi` constant (golden ratio), which silently
    // shadowed it as an unknown in conditional/solver mode. Since phi is
    // commonly used as an angle variable in this app's trig-identity
    // context (as common as theta), and unlike pi/e/tau/i has its own
    // dedicated angle-labelled keypad button, we return a scope-safe
    // identifier for it instead of the bare math.js constant name, so it
    // always behaves as an ordinary variable. See MATH SCOPE section for
    // how normal-mode evaluation still lets users get the golden ratio
    // via an explicit scope constant if they type `phi` with no other
    // definition in scope.
    if (name === 'phi') return this.maybeSubscript('phi');
    // Subscripts on Greek letters (\theta_1, \theta_{12}) go through the
    // same shared maybeSubscript() helper used for plain identifiers (x_1),
    // so multi-variable systems can use theta_1/theta_2 etc. for several
    // angle unknowns.
    if (GREEK.has(name)) return this.maybeSubscript(name);
    if (name === '.') return '0';

    throw new LatexSyntaxError(`دستور «\\${name}» پشتیبانی نمی‌شود`, t.pos);
  }
}

function latexToMathJS(latex) {
  const tokens = tokenize(latex);
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

function latexToEquationParts(latex) {
  const tokens = tokenize(latex);
  const parser = new Parser(tokens);
  return parser.parseConditionProgram();
}

/* ============================================================
   SECTION 5 — CENTRALIZED MATH SCOPE (DEG/RAD)
   ------------------------------------------------------------
   buildMathScope(angleMode, mathjs) is the single function used
   by every evaluation path: normal evaluate, symbolic-simplify
   fallback, single-variable solver, multi-variable solver, and
   identity sampling. It redefines all six inverse trig functions
   for DEG mode so every path stays consistent.

   Domain policy (CONFIG.ALLOW_COMPLEX = false): this calculator is
   real-number-only. Every wrapped function below checks its domain
   BEFORE calling into math.js, and throws a DomainError with a
   specific ErrorCodes value and Persian message rather than letting
   math.js silently return Infinity/NaN/a Complex number. A final
   safety-net check (assertReal, used by the evaluation pipeline)
   catches any Complex value that slips through by another path
   (e.g. the literal `i` constant) so a Complex result can NEVER
   silently reach the user as if it were a normal real answer.
   ============================================================
*/
function toRad(x, angleMode) { return angleMode === 'DEG' ? (x * Math.PI) / 180 : x; }
function fromRad(x, angleMode) { return angleMode === 'DEG' ? (x * 180) / Math.PI : x; }

function buildMathScope(angleMode, mathjs) {
  const scope = {};

  // --- direct trig: domain-safe pole detection for tan/cot/sec/csc ---
  scope.sin = (x) => Math.sin(toRad(x, angleMode));
  scope.cos = (x) => Math.cos(toRad(x, angleMode));
  scope.tan = (x) => {
    const r = toRad(x, angleMode);
    if (Math.abs(Math.cos(r)) < CONFIG.TRIG_POLE_EPS) {
      throw new DomainError('tan در این نقطه تعریف نشده است (نزدیک تکینگی)', ErrorCodes.DOMAIN_ERROR);
    }
    return Math.tan(r);
  };
  scope.cot = (x) => {
    const r = toRad(x, angleMode);
    if (Math.abs(Math.sin(r)) < CONFIG.TRIG_POLE_EPS) {
      throw new DomainError('cot در این نقطه تعریف نشده است (نزدیک تکینگی)', ErrorCodes.DOMAIN_ERROR);
    }
    return Math.cos(r) / Math.sin(r);
  };
  scope.sec = (x) => {
    const r = toRad(x, angleMode);
    if (Math.abs(Math.cos(r)) < CONFIG.TRIG_POLE_EPS) {
      throw new DomainError('sec در این نقطه تعریف نشده است (نزدیک تکینگی)', ErrorCodes.DOMAIN_ERROR);
    }
    return 1 / Math.cos(r);
  };
  scope.csc = (x) => {
    const r = toRad(x, angleMode);
    if (Math.abs(Math.sin(r)) < CONFIG.TRIG_POLE_EPS) {
      throw new DomainError('csc در این نقطه تعریف نشده است (نزدیک تکینگی)', ErrorCodes.DOMAIN_ERROR);
    }
    return 1 / Math.sin(r);
  };

  // --- inverse trig: DEG conversion applied to ALL SIX ---
  scope.asin = (x) => {
    if (x < -1 - CONFIG.ASIN_ACOS_DOMAIN_EPS || x > 1 + CONFIG.ASIN_ACOS_DOMAIN_EPS) {
      throw new DomainError('asin فقط برای بازه‌ی [-1, 1] تعریف شده است', ErrorCodes.DOMAIN_ERROR);
    }
    return fromRad(Math.asin(Math.min(1, Math.max(-1, x))), angleMode);
  };
  scope.acos = (x) => {
    if (x < -1 - CONFIG.ASIN_ACOS_DOMAIN_EPS || x > 1 + CONFIG.ASIN_ACOS_DOMAIN_EPS) {
      throw new DomainError('acos فقط برای بازه‌ی [-1, 1] تعریف شده است', ErrorCodes.DOMAIN_ERROR);
    }
    return fromRad(Math.acos(Math.min(1, Math.max(-1, x))), angleMode);
  };
  scope.atan = (x) => fromRad(Math.atan(x), angleMode);
  scope.acot = (x) => fromRad(x === 0 ? Math.PI / 2 : Math.atan(1 / x), angleMode);
  scope.asec = (x) => {
    if (Math.abs(x) < 1 - CONFIG.ASIN_ACOS_DOMAIN_EPS) {
      throw new DomainError('asec فقط برای |x| >= 1 تعریف شده است', ErrorCodes.DOMAIN_ERROR);
    }
    return fromRad(Math.acos(Math.min(1, Math.max(-1, 1 / x))), angleMode);
  };
  scope.acsc = (x) => {
    if (Math.abs(x) < 1 - CONFIG.ASIN_ACOS_DOMAIN_EPS) {
      throw new DomainError('acsc فقط برای |x| >= 1 تعریف شده است', ErrorCodes.DOMAIN_ERROR);
    }
    return fromRad(Math.asin(Math.min(1, Math.max(-1, 1 / x))), angleMode);
  };

  // --- roots / logs: explicit real-domain checks ---
  scope.sqrt = (x) => {
    if (typeof x === 'number' && x < 0) {
      throw new DomainError('جذر عدد منفی در حالت اعداد حقیقی تعریف نشده است', ErrorCodes.DOMAIN_ERROR);
    }
    return mathjs.sqrt(x);
  };
  scope.nthRoot = (x, k) => {
    if (typeof x === 'number' && x < 0 && Math.round(k) % 2 === 0) {
      throw new DomainError('ریشه‌ی زوج عدد منفی در حالت اعداد حقیقی تعریف نشده است', ErrorCodes.DOMAIN_ERROR);
    }
    return mathjs.nthRoot(x, k);
  };
  scope.log = (x, base) => {
    if (typeof x === 'number' && x <= 0) {
      throw new DomainError('لگاریتم فقط برای اعداد مثبت تعریف شده است', ErrorCodes.DOMAIN_ERROR);
    }
    return base === undefined ? mathjs.log(x) : mathjs.log(x, base);
  };
  scope.log10 = (x) => {
    if (typeof x === 'number' && x <= 0) {
      throw new DomainError('لگاریتم فقط برای اعداد مثبت تعریف شده است', ErrorCodes.DOMAIN_ERROR);
    }
    return mathjs.log10(x);
  };

  // --- factorial: domain-checked wrapper around math.js's own
  // (gamma-function-based) implementation, so negative-integer /
  // out-of-range errors get a clear Persian message instead of a
  // raw math.js exception string ---
  scope.factorial = (x) => {
    if (typeof x === 'number') {
      if (Number.isInteger(x) && x < 0) {
        throw new DomainError('فاکتوریل برای اعداد صحیح منفی تعریف نشده است', ErrorCodes.DOMAIN_ERROR);
      }
      if (x > CONFIG.FACTORIAL_MAX_ARG) return Infinity;
    }
    try {
      return mathjs.factorial(x);
    } catch (e) {
      throw new DomainError('فاکتوریل برای این مقدار قابل محاسبه نیست', ErrorCodes.DOMAIN_ERROR);
    }
  };

  // Routes the parser's 'phi' identifier through an explicit scope entry
  // rather than math.js's built-in `phi` constant. In normal (non-solver)
  // evaluation, if the user hasn't supplied any other meaning for phi,
  // this still resolves to the golden ratio — but critically,
  // getFreeSymbols() (below) no longer excludes 'phi', so in
  // conditional/solver mode it is correctly treated as an unknown to
  // solve for, and this scope entry is simply never consulted for it
  // (the solver substitutes its own trial values into `phi` instead).
  scope.phi = mathjs.phi;

  return scope;
}

// Post-evaluation safety net (CONFIG.ALLOW_COMPLEX = false): catches
// ANY Complex value that reached this point via a path not covered by
// the explicit domain checks above (e.g. the literal `i` constant, or
// an edge case in a math.js function we didn't wrap) and converts it
// into an honest domain error instead of letting it render as if it
// were an ordinary real number.
function assertReal(mathjs, value) {
  if (!CONFIG.ALLOW_COMPLEX && mathjs.isComplex && mathjs.isComplex(value)) {
    throw new DomainError(
      'نتیجه‌ی این محاسبه یک عدد مختلط است؛ این ماشین‌حساب فقط از اعداد حقیقی پشتیبانی می‌کند',
      ErrorCodes.COMPLEX_NOT_SUPPORTED
    );
  }
  return value;
}

/* ============================================================
   SECTION 6 — SOLVERS
   ------------------------------------------------------------
   Algorithms: bisection, Levenberg–Marquardt/Gauss–Newton with
   numeric Jacobian, and identity sampling.
     - getFreeSymbols: 'phi' is not in the KNOWN-constant
       exclusion list, so it is treated as a solvable unknown.
     - passesAllConstraints (inside solveConditional): a constraint
       that fails to evaluate correctly INVALIDATES the candidate
       instead of silently passing it.
     - solveConditional takes a single shared `scope` (built by
       buildMathScope) instead of constructing its own degScope.
     - "no solution" messages explicitly name the searched range
       instead of reading as a mathematically absolute claim.
   ============================================================
*/

function getFreeSymbols(mathjsExpr, mathjs) {
  try {
    const node = mathjs.parse(mathjsExpr);
    const funcNames = new Set();
    node.traverse((n) => {
      if (n.type === 'FunctionNode' && n.fn && n.fn.name) funcNames.add(n.fn.name);
    });
    const symbols = new Set();
    node.traverse((n) => {
      if (n.type === 'SymbolNode' && !funcNames.has(n.name)) symbols.add(n.name);
    });
    // 'phi' is intentionally not in this list — see the matching note
    // in buildMathScope(). pi/e/tau/i/Infinity/NaN remain reserved: none
    // of them has a dedicated "use me as an unknown" keypad affordance the
    // way phi (angle variable) does, so keeping them reserved avoids
    // breaking their much more common use as constants.
    const KNOWN = new Set([
      'pi', 'e', 'i', 'Infinity', 'NaN', 'tau', 'true', 'false', 'null',
      'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2', 'version',
    ]);
    return [...symbols].filter((s) => !KNOWN.has(s));
  } catch (e) {
    return [];
  }
}

function tryConstantByProbing(mathjsExpr, mathjs, symbols, baseScope) {
  if (!symbols.length) return undefined;
  const seeds = [0.6180339887, 1.3027756377, 2.0946331569, 0.4142135624, 1.8477590650, 0.7320508076, 1.1755705046];
  const trialResults = [];
  for (let t = 0; t < 3; t++) {
    const scope = { ...baseScope };
    symbols.forEach((s, i) => {
      scope[s] = seeds[(i + t * 5) % seeds.length] + t * 0.08715;
    });
    try {
      const r = mathjs.evaluate(mathjsExpr, scope);
      if (typeof r !== 'number' || !Number.isFinite(r)) return undefined;
      trialResults.push(r);
    } catch (e) {
      return undefined;
    }
  }
  const ref = trialResults[0];
  const allClose = trialResults.every((r) => Math.abs(r - ref) < 1e-6 * Math.max(1, Math.abs(ref)));
  if (!allClose) return undefined;
  const v = Math.abs(ref) < 1e-8 ? 0 : ref;
  return Math.round(v * 1e9) / 1e9;
}

function evalSafeNum(mathjs, expr, scope) {
  try {
    const v = mathjs.evaluate(expr, scope);
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return v;
  } catch (e) {
    // Includes our own DomainError (pole, out-of-domain, etc.) — at a
    // solver sample point, "cannot evaluate here" simply means this point
    // is not usable, exactly like the original design intended.
    return null;
  }
}

function findRootsSingleVar(mathjs, residualExpr, varName, scope, range, steps) {
  const [lo, hi] = range;
  const dx = (hi - lo) / steps;
  const roots = [];
  let prevX = lo;
  let prevY = evalSafeNum(mathjs, residualExpr, { ...scope, [varName]: lo });
  for (let i = 1; i <= steps; i++) {
    const x = lo + i * dx;
    const y = evalSafeNum(mathjs, residualExpr, { ...scope, [varName]: x });
    if (prevY !== null && y !== null) {
      if (prevY === 0) {
        roots.push(prevX);
      } else if (prevY * y < 0) {
        let a = prevX, b = x, fa = prevY;
        for (let k = 0; k < CONFIG.BISECTION_ITERS; k++) {
          const m = (a + b) / 2;
          const fm = evalSafeNum(mathjs, residualExpr, { ...scope, [varName]: m });
          if (fm === null) break;
          if (fa * fm <= 0) { b = m; } else { a = m; fa = fm; }
        }
        const root = (a + b) / 2;
        const check = evalSafeNum(mathjs, residualExpr, { ...scope, [varName]: root });
        const scale = Math.max(Math.abs(prevY), Math.abs(y), 1);
        if (check !== null && Math.abs(check) < CONFIG.ROOT_RESIDUAL_CHECK_REL_SCALE * scale && Math.abs(check) < CONFIG.ROOT_RESIDUAL_CHECK_TOL) {
          roots.push(root);
        }
      }
    }
    prevX = x; prevY = y;
  }
  const uniq = [];
  roots.forEach((r) => {
    if (!uniq.some((u) => Math.abs(u - r) < CONFIG.ROOT_DEDUPE_TOL)) uniq.push(r);
  });
  return uniq;
}

function clusterValues(values) {
  const clusters = [];
  values.forEach((v) => {
    const c = clusters.find((c) => Math.abs(c - v) < CONFIG.ROOT_DEDUPE_TOL);
    if (c === undefined) clusters.push(Math.round(v * 1e8) / 1e8);
  });
  return clusters;
}

function evalResidualVector(mathjs, residualExprs, vars, point, scope) {
  const s = { ...scope };
  vars.forEach((v, i) => { s[v] = point[i]; });
  const out = [];
  for (const expr of residualExprs) {
    const val = evalSafeNum(mathjs, expr, s);
    if (val === null) return null;
    out.push(val);
  }
  return out;
}

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function gaussNewtonSolve(mathjs, residualExprs, vars, scope, initGuess, iters = CONFIG.LM_ITERS) {
  let x = initGuess.slice();
  const n = vars.length;
  const m = residualExprs.length;
  const h = CONFIG.LM_JACOBIAN_H;
  let lambda = CONFIG.LM_LAMBDA_INIT;
  let r = evalResidualVector(mathjs, residualExprs, vars, x, scope);
  if (r === null) return null;

  for (let it = 0; it < iters; it++) {
    let normR = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
    if (normR < CONFIG.LM_CONVERGE_NORM) return x;

    const J = [];
    let jacobianOk = true;
    for (let j = 0; j < n; j++) {
      const xp = x.slice(); xp[j] += h;
      const rp = evalResidualVector(mathjs, residualExprs, vars, xp, scope);
      if (rp === null) { jacobianOk = false; break; }
      J.push(rp.map((val, i) => (val - r[i]) / h));
    }
    if (!jacobianOk) return null;

    const JTJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const JTr = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[a][i] * J[b][i];
        JTJ[a][b] = s;
      }
      let s2 = 0;
      for (let i = 0; i < m; i++) s2 += J[a][i] * r[i];
      JTr[a] = s2;
    }
    for (let a = 0; a < n; a++) JTJ[a][a] += lambda * (JTJ[a][a] + 1e-6);

    const delta = solveLinearSystem(JTJ, JTr.map((v) => -v));
    if (!delta || delta.some((v) => !Number.isFinite(v))) { lambda *= CONFIG.LM_LAMBDA_GROW; continue; }

    const xNew = x.map((v, j) => v + delta[j]);
    if (xNew.some((v) => !Number.isFinite(v) || Math.abs(v) > CONFIG.LM_MAX_STEP_ABS)) { lambda *= CONFIG.LM_LAMBDA_GROW; continue; }
    const rNew = evalResidualVector(mathjs, residualExprs, vars, xNew, scope);
    if (rNew === null) { lambda *= CONFIG.LM_LAMBDA_GROW; continue; }
    const normNew = Math.sqrt(rNew.reduce((s, v) => s + v * v, 0));

    if (normNew < normR) {
      x = xNew; r = rNew; lambda = Math.max(lambda / CONFIG.LM_LAMBDA_SHRINK, CONFIG.LM_LAMBDA_MIN);
    } else {
      lambda *= CONFIG.LM_LAMBDA_GROW;
      if (lambda > CONFIG.LM_LAMBDA_MAX) break;
    }
  }

  const finalNorm = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
  if (finalNorm > CONFIG.LM_ACCEPT_NORM) return null;
  return x;
}

function multiStartSolve(mathjs, residualExprs, vars, scope, range, maxAttempts) {
  const solutions = [];
  for (let a = 0; a < maxAttempts; a++) {
    const guess = vars.map(() => range[0] + Math.random() * (range[1] - range[0]));
    const sol = gaussNewtonSolve(mathjs, residualExprs, vars, scope, guess);
    if (sol) {
      const dup = solutions.some((s) => s.every((val, i) => Math.abs(val - sol[i]) < CONFIG.MULTISTART_DUP_TOL));
      if (!dup) solutions.push(sol);
    }
    if (solutions.length >= CONFIG.MULTISTART_MAX_SOLUTIONS) break;
  }
  return solutions;
}

const KNOWN_FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'acot', 'asec', 'acsc', 'log', 'log10', 'ln', 'exp', 'sqrt', 'nthRoot', 'abs', 'factorial']);

function classifySymbolsInExpr(expr) {
  const bare = new Set();
  const insideFn = new Set();
  const n = expr.length;
  let i = 0;
  const contextStack = [];
  let currentInFn = false;
  while (i < n) {
    const ch = expr[i];
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_]/.test(expr[j])) j++;
      const ident = expr.slice(i, j);
      let k = j;
      while (k < n && expr[k] === ' ') k++;
      const isFuncCall = expr[k] === '(' && KNOWN_FUNCS.has(ident);
      if (isFuncCall) { i = j; continue; }
      if (currentInFn) insideFn.add(ident); else bare.add(ident);
      i = j;
      continue;
    }
    if (ch === '(') {
      let k = i - 1;
      while (k >= 0 && expr[k] === ' ') k--;
      let m = k;
      while (m >= 0 && /[a-zA-Z0-9_]/.test(expr[m])) m--;
      const precedingIdent = expr.slice(m + 1, k + 1);
      const opensFn = KNOWN_FUNCS.has(precedingIdent);
      contextStack.push(currentInFn);
      currentInFn = opensFn ? true : currentInFn;
      i++;
      continue;
    }
    if (ch === ')') {
      currentInFn = contextStack.length ? contextStack.pop() : false;
      i++;
      continue;
    }
    i++;
  }
  return { bare, insideFn };
}

function classifySymbolsAcrossResiduals(residualExprs, allSymbolsFilter) {
  const bareAll = new Set();
  const insideFnAll = new Set();
  residualExprs.forEach((expr) => {
    const { bare, insideFn } = classifySymbolsInExpr(expr);
    bare.forEach((s) => bareAll.add(s));
    insideFn.forEach((s) => insideFnAll.add(s));
  });
  const algebraic = [];
  const quantified = [];
  allSymbolsFilter.forEach((s) => {
    if (bareAll.has(s)) algebraic.push(s);
    else if (insideFnAll.has(s)) quantified.push(s);
    else algebraic.push(s);
  });
  return { algebraic, quantified };
}

function evalStackedResidualVector(mathjs, residualExprs, algebraicVars, quantifiedSamples, point, scope) {
  const out = [];
  for (const sample of quantifiedSamples) {
    const s = { ...scope, ...sample };
    algebraicVars.forEach((v, i) => { s[v] = point[i]; });
    for (const expr of residualExprs) {
      const val = evalSafeNum(mathjs, expr, s);
      if (val === null) return null;
      out.push(val);
    }
  }
  return out;
}

function gaussNewtonSolveStacked(mathjs, residualExprs, algebraicVars, quantifiedSamples, scope, initGuess, iters = CONFIG.LM_ITERS) {
  let x = initGuess.slice();
  const n = algebraicVars.length;
  const h = CONFIG.LM_JACOBIAN_H;
  let lambda = CONFIG.LM_LAMBDA_INIT;
  let r = evalStackedResidualVector(mathjs, residualExprs, algebraicVars, quantifiedSamples, x, scope);
  if (r === null) return null;
  const m = r.length;

  for (let it = 0; it < iters; it++) {
    let normR = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
    if (normR < CONFIG.LM_STACKED_CONVERGE_NORM) return x;

    const J = [];
    let jacobianOk = true;
    for (let j = 0; j < n; j++) {
      const xp = x.slice(); xp[j] += h;
      const rp = evalStackedResidualVector(mathjs, residualExprs, algebraicVars, quantifiedSamples, xp, scope);
      if (rp === null) { jacobianOk = false; break; }
      J.push(rp.map((val, i) => (val - r[i]) / h));
    }
    if (!jacobianOk) return null;

    const JTJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const JTr = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[a][i] * J[b][i];
        JTJ[a][b] = s;
      }
      let s2 = 0;
      for (let i = 0; i < m; i++) s2 += J[a][i] * r[i];
      JTr[a] = s2;
    }
    for (let a = 0; a < n; a++) JTJ[a][a] += lambda * (JTJ[a][a] + 1e-6);

    const delta = solveLinearSystem(JTJ, JTr.map((v) => -v));
    if (!delta || delta.some((v) => !Number.isFinite(v))) { lambda *= CONFIG.LM_LAMBDA_GROW; continue; }

    const xNew = x.map((v, j) => v + delta[j]);
    if (xNew.some((v) => !Number.isFinite(v) || Math.abs(v) > CONFIG.LM_MAX_STEP_ABS)) { lambda *= CONFIG.LM_LAMBDA_GROW; continue; }
    const rNew = evalStackedResidualVector(mathjs, residualExprs, algebraicVars, quantifiedSamples, xNew, scope);
    if (rNew === null) { lambda *= CONFIG.LM_LAMBDA_GROW; continue; }
    const normNew = Math.sqrt(rNew.reduce((s, v) => s + v * v, 0));

    if (normNew < normR) {
      x = xNew; r = rNew; lambda = Math.max(lambda / CONFIG.LM_LAMBDA_SHRINK, CONFIG.LM_LAMBDA_MIN);
    } else {
      lambda *= CONFIG.LM_LAMBDA_GROW;
      if (lambda > CONFIG.LM_LAMBDA_MAX) break;
    }
  }

  const finalNorm = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
  const scale = Math.max(1, Math.sqrt(r.length));
  if (finalNorm > CONFIG.LM_ACCEPT_NORM * 10 * scale) return null;
  return x;
}

function solveByIdentitySampling(mathjs, eqConditions, algebraicSymbols, quantifiedSymbols, targetExpr, scope, range, passesAllConstraints) {
  const kFit = Math.max(algebraicSymbols.length + CONFIG.IDENTITY_FIT_SAMPLE_MIN_EXTRA, CONFIG.IDENTITY_FIT_SAMPLE_MIN);
  const neutralProbe = {};
  algebraicSymbols.forEach((s) => { neutralProbe[s] = CONFIG.IDENTITY_NEUTRAL_PROBE_VALUE; });

  const drawSample = () => {
    for (let attempt = 0; attempt < CONFIG.IDENTITY_DRAW_ATTEMPTS; attempt++) {
      const sample = {};
      quantifiedSymbols.forEach((s) => { sample[s] = range[0] + Math.random() * (range[1] - range[0]); });
      const probeScope = { ...scope, ...sample, ...neutralProbe };
      if (!passesAllConstraints(probeScope, CONFIG.CONSTRAINT_TOL)) continue;
      const ok = eqConditions.every((r) => evalSafeNum(mathjs, r, probeScope) !== null);
      if (ok) return sample;
    }
    return null;
  };

  const fitSamples = [];
  for (let i = 0; i < kFit; i++) {
    const s = drawSample();
    if (s) fitSamples.push(s);
  }
  if (fitSamples.length < Math.max(2, algebraicSymbols.length)) return null;

  const algSolutions = [];
  for (let a = 0; a < CONFIG.IDENTITY_ALG_SOLVE_ATTEMPTS; a++) {
    const [glo, ghi] = CONFIG.IDENTITY_ALG_GUESS_RANGE;
    const guess = algebraicSymbols.map(() => glo + Math.random() * (ghi - glo));
    const sol = gaussNewtonSolveStacked(mathjs, eqConditions, algebraicSymbols, fitSamples, scope, guess);
    if (sol) {
      const dup = algSolutions.some((s) => s.every((val, i) => Math.abs(val - sol[i]) < CONFIG.MULTISTART_DUP_TOL));
      if (!dup) algSolutions.push(sol);
    }
    if (algSolutions.length >= CONFIG.IDENTITY_ALG_MAX_SOLUTIONS) break;
  }
  if (!algSolutions.length) return null;

  const verifiedTargetValues = [];
  for (const sol of algSolutions) {
    const algScope = {};
    algebraicSymbols.forEach((v, i) => { algScope[v] = sol[i]; });
    let allOk = true;
    const localVals = [];
    for (let i = 0; i < CONFIG.IDENTITY_VERIFY_SAMPLES; i++) {
      const qs = drawSample();
      if (!qs) { allOk = false; break; }
      const fullScope = { ...scope, ...qs, ...algScope };
      const residOk = eqConditions.every((r) => {
        const v = evalSafeNum(mathjs, r, fullScope);
        return v !== null && Math.abs(v) < CONFIG.IDENTITY_VERIFY_RESIDUAL_TOL;
      });
      if (!residOk) { allOk = false; break; }
      const tv = evalSafeNum(mathjs, targetExpr, fullScope);
      if (tv === null) { allOk = false; break; }
      localVals.push(tv);
    }
    if (!allOk) continue;
    const localClusters = clusterValues(localVals);
    if (localClusters.length === 1) verifiedTargetValues.push(localClusters[0]);
  }

  if (!verifiedTargetValues.length) return null;
  const clusters = clusterValues(verifiedTargetValues);
  if (clusters.length === 1) return { unique: true, value: clusters[0], derivedBy: 'heuristic-sampled' };
  return { unique: false, values: clusters.slice(0, CONFIG.MAX_REPORTED_VALUES), derivedBy: 'heuristic-sampled' };
}

function solveConditional(conditionLatexList, targetLatex, mathjs, angleMode) {
  const list = (Array.isArray(conditionLatexList) ? conditionLatexList : [conditionLatexList])
    .filter((l) => l && l.trim());
  if (!list.length) return { error: 'حداقل یک شرط وارد کنید' };

  const parsedConditions = [];
  for (const latex of list) {
    try {
      const parts = latexToEquationParts(latex);
      parts.forEach(({ lhs, rhs, op }) => {
        parsedConditions.push({ residual: `(${lhs}) - (${rhs})`, op: op || '==' });
      });
    } catch (err) {
      return { error: err instanceof LatexSyntaxError ? `خطا در شرط: ${err.message}` : 'شرط قابل تجزیه نیست' };
    }
  }

  let targetExpr;
  try {
    targetExpr = latexToMathJS(targetLatex);
  } catch (err) {
    return { error: err instanceof LatexSyntaxError ? `خطا در عبارت هدف: ${err.message}` : 'عبارت هدف قابل تجزیه نیست' };
  }

  // Single centralized scope, used for every evaluation in this function
  // — replaces a locally-built degScope that only existed for DEG mode
  // and never redefined the inverse trig functions.
  const scope = buildMathScope(angleMode, mathjs);

  const eqConditions = parsedConditions.filter((c) => c.op === '==').map((c) => c.residual);
  const constraintConditions = parsedConditions.filter((c) => c.op !== '==');

  const constraintHolds = (op, v, tol) => {
    switch (op) {
      case '!=': return Math.abs(v) >= tol;
      case '<=': return v <= tol;
      case '>=': return v >= -tol;
      case '<': return v < -tol;
      case '>': return v > tol;
      default: return Math.abs(v) < tol;
    }
  };

  // A constraint that CANNOT be evaluated at a candidate point must
  // invalidate that candidate, never silently pass it through. Domain
  // errors and other evaluation failures now correctly reject the candidate.
  const passesAllConstraints = (evalScope, tol) => constraintConditions.every((c) => {
    const v = evalSafeNum(mathjs, c.residual, evalScope);
    if (v === null) return false;
    return constraintHolds(c.op, v, tol);
  });

  const allResidualStrings = parsedConditions.map((c) => c.residual);
  const condSymbols = new Set();
  allResidualStrings.forEach((r) => getFreeSymbols(r, mathjs).forEach((s) => condSymbols.add(s)));
  const targetSymbols = getFreeSymbols(targetExpr, mathjs);
  const allSymbols = [...new Set([...condSymbols, ...targetSymbols])];

  if (allSymbols.length === 0) {
    const targetVal = evalSafeNum(mathjs, targetExpr, scope);
    if (targetVal === null) return { error: 'عبارت هدف قابل محاسبه نیست' };
    const allHold = parsedConditions.every((c) => {
      const v = evalSafeNum(mathjs, c.residual, scope);
      return v !== null && constraintHolds(c.op, v, CONFIG.CONSTRAINT_EQ_TOL_NO_SYMBOLS);
    });
    if (!allHold) {
      return { warning: 'شرط با این مقادیر برقرار نیست، اما عبارت هدف مستقل از شرط محاسبه شد', value: targetVal };
    }
    return { unique: true, value: targetVal, derivedBy: 'exact' };
  }

  if (allSymbols.length > CONFIG.MAX_UNKNOWNS) {
    return { error: `این حالت حداکثر ${CONFIG.MAX_UNKNOWNS} مجهول را پشتیبانی می‌کند` };
  }

  if (eqConditions.length === 0) {
    return { error: 'برای حل مجهول، حداقل یک شرط تساوی (=) لازم است — شرط‌های نامساوی به‌تنهایی کافی نیستند' };
  }

  const range = angleMode === 'DEG' ? CONFIG.ROOT_SCAN_RANGE_DEG : CONFIG.ROOT_SCAN_RANGE_RAD;
  const rangeLabel = `[${range[0]}, ${range[1]}]${angleMode === 'DEG' ? ' درجه' : ' رادیان'}`;

  // ---- Fast path: exactly one equality condition, one unknown overall.
  if (eqConditions.length === 1 && allSymbols.length === 1) {
    const v = allSymbols[0];
    const rawRoots = findRootsSingleVar(mathjs, eqConditions[0], v, scope, range, CONFIG.ROOT_SCAN_STEPS);
    // A finite numerical search finding nothing is NOT a mathematical proof
    // of no solution — say so explicitly.
    if (!rawRoots.length) return { error: `در بازه‌ی جست‌وجوی ${rangeLabel} جوابی یافت نشد` };

    const roots = constraintConditions.length
      ? rawRoots.filter((r) => passesAllConstraints({ ...scope, [v]: r }, CONFIG.CONSTRAINT_TOL))
      : rawRoots;
    if (!roots.length) {
      return { error: 'با اعمال شرط‌های نامساوی/عدم‌تساوی، هیچ جواب معتبری باقی نماند' };
    }

    if (roots.length > CONFIG.DENSE_ROOTS_IS_IDENTITY_THRESHOLD) {
      const probeValues = [];
      let guard = 0;
      while (probeValues.length < CONFIG.IDENTITY_PROBE_TARGET_COUNT && guard < CONFIG.IDENTITY_PROBE_MAX_ATTEMPTS) {
        guard++;
        const testX = range[0] + Math.random() * (range[1] - range[0]);
        if (!passesAllConstraints({ ...scope, [v]: testX }, CONFIG.CONSTRAINT_TOL)) continue;
        const val = evalSafeNum(mathjs, targetExpr, { ...scope, [v]: testX });
        if (val !== null) probeValues.push(val);
      }
      if (probeValues.length < CONFIG.IDENTITY_PROBE_MIN_VALID) return { error: 'عبارت هدف در بازه‌ی معتبر تعریف نشده است' };
      const clusters = clusterValues(probeValues);
      if (clusters.length === 1) return { unique: true, value: clusters[0], derivedBy: 'heuristic-sampled' };
      return { unique: false, values: clusters.slice(0, CONFIG.MAX_REPORTED_VALUES), derivedBy: 'heuristic-sampled' };
    }

    const values = [];
    roots.forEach((r) => {
      const val = evalSafeNum(mathjs, targetExpr, { ...scope, [v]: r });
      if (val !== null) values.push(val);
    });
    if (!values.length) return { error: 'عبارت هدف در نقاط جواب شرط تعریف نشده است (مانند تقسیم بر صفر)' };
    const clusters = clusterValues(values);
    if (clusters.length === 1) return { unique: true, value: clusters[0], derivedBy: 'numeric-verified' };
    return { unique: false, values: clusters.slice(0, CONFIG.MAX_REPORTED_VALUES), derivedBy: 'numeric-verified' };
  }

  const { algebraic: algebraicSymbols, quantified: quantifiedSymbols } =
    classifySymbolsAcrossResiduals(eqConditions.concat(constraintConditions.map((c) => c.residual)), allSymbols);

  if (
    quantifiedSymbols.length > 0 &&
    algebraicSymbols.length > 0 &&
    algebraicSymbols.length <= CONFIG.MAX_UNKNOWNS &&
    eqConditions.length < allSymbols.length
  ) {
    const identityResult = solveByIdentitySampling(
      mathjs, eqConditions, algebraicSymbols, quantifiedSymbols,
      targetExpr, scope, range, passesAllConstraints
    );
    if (identityResult) return identityResult;
  }

  const attemptBudget = CONFIG.MULTISTART_BUDGET_BY_DIM[allSymbols.length] || CONFIG.MULTISTART_BUDGET_BY_DIM.default;
  const rawSolutions = multiStartSolve(mathjs, eqConditions, allSymbols, scope, range, attemptBudget);
  if (!rawSolutions.length) {
    return { error: `در بازه‌ی جست‌وجوی ${rangeLabel} برای این دستگاه معادلات جوابی یافت نشد (ممکن است ناسازگار باشد یا خارج از بازه باشد)` };
  }

  const solutions = constraintConditions.length
    ? rawSolutions.filter((sol) => {
        const s = { ...scope };
        allSymbols.forEach((v, i) => { s[v] = sol[i]; });
        return passesAllConstraints(s, CONFIG.CONSTRAINT_TOL);
      })
    : rawSolutions;
  if (!solutions.length) {
    return { error: 'با اعمال شرط‌های نامساوی/عدم‌تساوی، هیچ جواب معتبری باقی نماند' };
  }

  const values = [];
  solutions.forEach((sol) => {
    const s = { ...scope };
    allSymbols.forEach((v, i) => { s[v] = sol[i]; });
    const val = evalSafeNum(mathjs, targetExpr, s);
    if (val !== null) values.push(val);
  });
  if (!values.length) return { error: 'عبارت هدف در نقاط جواب این دستگاه تعریف نشده است' };
  const clusters = clusterValues(values);
  if (clusters.length === 1) return { unique: true, value: clusters[0], derivedBy: 'numeric-verified' };
  return { unique: false, values: clusters.slice(0, CONFIG.MAX_REPORTED_VALUES), derivedBy: 'numeric-verified' };
}

/* ============================================================
   SECTION 7 — RESULT FORMATTING
   ============================================================ */
function formatResult(res, mathjs) {
  const { format, isComplex, isFraction } = mathjs;

  if (res === undefined || res === null) return null;

  if (typeof res === 'boolean') {
    return res ? 'درست ✓' : 'نادرست ✗';
  }

  if (typeof res === 'number') {
    if (Number.isNaN(res)) return 'نامعتبر (NaN)';
    if (!Number.isFinite(res)) return res > 0 ? '∞' : '-∞';
    let v = Math.abs(res) < CONFIG.ZERO_SNAP_ABS ? 0 : res;
    v = Math.round(v * Math.pow(10, CONFIG.ROUND_DECIMALS)) / Math.pow(10, CONFIG.ROUND_DECIMALS);
    return format(v, { precision: CONFIG.DISPLAY_PRECISION });
  }

  // Defensive: CONFIG.ALLOW_COMPLEX = false means assertReal() should have
  // already turned any Complex result into a DomainError before it gets
  // here. This branch is a formatting fallback only, not a supported path.
  if (isComplex && isComplex(res)) {
    return format(res, { precision: 10 });
  }

  if (isFraction && isFraction(res)) {
    return format(res);
  }

  return res.toString ? res.toString() : String(res);
}

/** Snap a mathjs value to a finite real number, or null. */
function coerceFiniteNumber(res, mathjs) {
  if (typeof res === 'number') {
    if (!Number.isFinite(res)) return null;
    let v = Math.abs(res) < CONFIG.ZERO_SNAP_ABS ? 0 : res;
    v = Math.round(v * Math.pow(10, CONFIG.ROUND_DECIMALS)) / Math.pow(10, CONFIG.ROUND_DECIMALS);
    return v;
  }
  if (mathjs && mathjs.isFraction && mathjs.isFraction(res)) {
    const n = Number(res.n);
    const d = Number(res.d);
    const s = (res.s < 0) ? -1 : 1;
    if (!d || !Number.isFinite(n) || !Number.isFinite(d)) return null;
    return s * n / d;
  }
  return null;
}

/**
 * Best simple rational approximation via continued fractions.
 * Returns { n, d, sign } with n,d > 0, or null if no nicer-than-decimal fraction.
 */
function niceFraction(x, maxDen = 1000) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (Math.abs(x) < CONFIG.ZERO_SNAP_ABS) return null;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  let n0 = 0, d0 = 1, n1 = 1, d1 = 0;
  let v = ax;
  let bestN = Math.round(ax), bestD = 1;
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(v + 1e-15);
    const n = a * n1 + n0;
    const d = a * d1 + d0;
    if (d > maxDen) break;
    n0 = n1; d0 = d1; n1 = n; d1 = d;
    bestN = n; bestD = d;
    if (Math.abs(ax - n / d) < 1e-12) break;
    const f = v - a;
    if (f < 1e-15) break;
    v = 1 / f;
  }
  if (!bestD) return null;
  const err = Math.abs(ax - bestN / bestD);
  if (err > 1e-9 && err > ax * 1e-12) return null;
  if (bestD === 1) return null; // integer — stacking a /1 is noise
  if (bestN > 1e7) return null;
  return { n: bestN, d: bestD, sign };
}

function stackedFracHtml(frac) {
  if (!frac) return '';
  const sign = frac.sign < 0 ? '−' : '';
  return `${sign}<span class="calc-frac"><span class="calc-frac-num">${frac.n}</span><span class="calc-frac-den">${frac.d}</span></span>`;
}

/** Join one or more stacked fractions with " یا " for multi-root results. */
function stackedFracListHtml(fracs) {
  if (!fracs || !fracs.length) return '';
  return fracs.map((f) => stackedFracHtml(f)).join(' <span class="calc-frac-or">یا</span> ');
}

/**
 * Build fraction payload from a single value or a list of values.
 * Returns { frac, fracs, parts } where:
 *   - frac  = first usable non-integer fraction (for canFrac)
 *   - fracs = array of usable fractions only
 *   - parts = parallel display parts for multi-root fraction mode:
 *            each entry is either { type:'frac', frac } or { type:'text', text }
 *            so integers / non-approximable roots still appear next to fractions.
 */
function buildFracPayload(values, mathjs) {
  const list = Array.isArray(values) ? values : [values];
  const fracs = [];
  const parts = [];
  for (const v of list) {
    const numeric = coerceFiniteNumber(v, mathjs);
    if (numeric == null) {
      parts.push({ type: 'text', text: formatResult(v, mathjs) });
      continue;
    }
    const f = niceFraction(numeric);
    if (f) {
      fracs.push(f);
      parts.push({ type: 'frac', frac: f });
    } else {
      // Integer or non-approximable — keep the decimal/integer form
      parts.push({ type: 'text', text: formatResult(numeric, mathjs) });
    }
  }
  return {
    frac: fracs.length ? fracs[0] : null,
    fracs: fracs.length ? fracs : null,
    parts: parts.length ? parts : null,
  };
}



// Render/destroy/re-render safety. `renderCalculator` can be invoked
// more than once for the same container (SPA navigation away and back,
// or a fast double-invocation) with no signal that an earlier,
// still-in-flight call should stop. `activeRenderId` lets each invocation
// recognize when a newer call has superseded it and bail out before
// doing any more (wasted, and potentially DOM-clobbering) work.
let activeRenderId = 0;

export async function renderCalculator(container) {
  const myRenderId = ++activeRenderId;
  const isStale = () => myRenderId !== activeRenderId;
  // Every MutationObserver created during this render is tracked here so
  // destroy() (returned below) can disconnect all of them when navigating
  // away from the calculator screen.
  const observers = [];

  container.innerHTML = `
    <div class="calc-loading">
      <span class="material-symbols-rounded calc-loading-icon">hourglass_empty</span>
      <h2>در حال بارگذاری ماشین‌حساب...</h2>
    </div>
  `;

  // MathQuill's CSS/JS are loaded dynamically. In some build/packaging
  // contexts (in particular an offline APK/Cordova/Capacitor shell serving
  // from file://) a misresolved path here throws instead of silently
  // succeeding — without this guard that leaves the user staring at a blank
  // or stuck-on-"loading" screen with no explanation.
  try {
    await import('mathquill/build/mathquill.css');
    await import('mathquill/build/mathquill.js');
  } catch (err) {
    if (isStale()) return undefined;
    console.error('MathQuill failed to load:', err);
    container.innerHTML = `
      <div class="calc-loading calc-load-error">
        <span class="material-symbols-rounded calc-loading-icon calc-load-error-icon">error</span>
        <h2>بارگذاری ماشین‌حساب ناموفق بود</h2>
        <p>یکی از فایل‌های مورد نیاز (MathQuill) لود نشد. لطفاً برنامه را دوباره باز کنید؛ اگر مشکل ادامه داشت، به‌روزرسانی برنامه را بررسی کنید.</p>
      </div>
    `;
    const errStyle = document.createElement('style');
    errStyle.textContent = `
      .calc-load-error { gap: var(--space-3); }
      .calc-load-error-icon { color: var(--color-danger); animation: none; }
      .calc-load-error p { color: var(--text-secondary); font-size: 0.85rem; max-width: 320px; margin: 0; }
    `;
    container.appendChild(errStyle);
    return undefined;
  }
  // A newer render call has already started (and already overwrote
  // container.innerHTML with its own loading state) — stop here instead
  // of continuing to build a second, competing MathQuill instance on top
  // of it.
  if (isStale()) return undefined;

  if (!window.MathQuill) {
    console.error('window.MathQuill is unavailable after import.');
    container.innerHTML = `
      <div class="calc-loading calc-load-error">
        <span class="material-symbols-rounded calc-loading-icon calc-load-error-icon">error</span>
        <h2>بارگذاری ماشین‌حساب ناموفق بود</h2>
        <p>موتور فرمول‌نویسی در دسترس نیست. لطفاً صفحه را دوباره بارگذاری کنید.</p>
      </div>
    `;
    return undefined;
  }

  const mathjs = await import('mathjs');
  if (isStale()) return undefined;
  const { evaluate } = mathjs;

  const MQ = window.MathQuill.getInterface(2);
  let angleMode = 'DEG'; // DEG or RAD
  let conditionalMode = false;
  // Ans and the memory registers only ever hold a plain finite number. If
  // the last result was something Ans can't cleanly represent as typed
  // input (∞, a symbolic/simplified expression, a boolean), lastAnswerValue
  // stays null and the Ans/M+/M- buttons no-op with a brief inline notice
  // rather than inserting something misleading.
  let lastAnswerValue = null;
  let memoryValue = 0;
  let activePanel = 'numbers'; // 'numbers' | 'symbols'

  const LETTER_ROWS = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m'],
  ];

  const letterKeyboardHTML = LETTER_ROWS.map((row, ri) => `
    <div class="letter-row letter-row-${ri}">
      ${row.map(l => `<button class="calc-btn letter-btn" data-write="${l}">${l}</button>`).join('')}
    </div>
  `).join('');

  // ---------- calculation history (localStorage) ----------
  const HISTORY_KEY = 'ds_calc_history_v1';
  const HISTORY_ITEM_VERSION = 2; // Items also carry compiledExpression/resultType/angleMode. Old items
  // (version absent or 1) are still read and displayed fine — every
  // reader below treats these new fields as optional.
  const MAX_HISTORY = 50;
  // Two DISTINCT problem states, surfaced with two distinct messages:
  //   - historyStorageUnavailable: localStorage itself is inaccessible
  //     (private-mode WebView, quota exceeded, disabled). Persistent
  //     until a write succeeds.
  //   - historyDataWasCorrupted: storage IS accessible, but the JSON we
  //     read back this one time didn't parse / wasn't shaped like a
  //     history list. One-time, informational, not alarming.
  let historyStorageUnavailable = false;
  let historyDataWasCorrupted = false;

  function isValidHistoryItem(it) {
    return it && typeof it === 'object' &&
      typeof it.id === 'string' &&
      typeof it.latex === 'string' &&
      typeof it.result === 'string' &&
      (it.mode === 'normal' || it.mode === 'conditional');
  }

  function loadHistory() {
    let raw;
    try {
      raw = localStorage.getItem(HISTORY_KEY);
    } catch (e) {
      // localStorage.getItem threw: real unavailability (private mode /
      // disabled storage), not a data problem.
      historyStorageUnavailable = true;
      return [];
    }
    historyStorageUnavailable = false;
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Storage works fine; this one stored value just wasn't valid JSON
      // (e.g. truncated write, manual tampering). Quarantine it under a
      // separate key instead of silently discarding, so it's at least
      // inspectable/recoverable rather than gone with no trace, then
      // start fresh.
      try { localStorage.setItem(HISTORY_KEY + '_corrupted_' + Date.now(), raw); } catch (e2) { /* best effort */ }
      historyDataWasCorrupted = true;
      return [];
    }
    if (!Array.isArray(parsed)) {
      historyDataWasCorrupted = true;
      return [];
    }
    // Defensive per-item validation: a partially-malformed array (e.g. one
    // bad entry from a future version, or manual edits) no longer takes
    // down the whole list — just the bad entries are dropped.
    const valid = parsed.filter(isValidHistoryItem);
    if (valid.length !== parsed.length) historyDataWasCorrupted = true;
    return valid;
  }
  function saveHistoryList(items) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
      historyStorageUnavailable = false;
    } catch (e) {
      historyStorageUnavailable = true;
    }
  }
  function addHistoryItem(entry) {
    const items = loadHistory();
    items.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      timestamp: Date.now(),
      version: HISTORY_ITEM_VERSION,
      angleMode,
      ...entry,
    });
    saveHistoryList(items);
  }
  function clearHistory() {
    saveHistoryList([]);
  }
  function removeHistoryItem(id) {
    saveHistoryList(loadHistory().filter((it) => it.id !== id));
  }
  function haptic(ms = 8) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  container.innerHTML = `
    <div class="calc-container">

      <!-- Header bar -->
      <div class="calc-header">
        <div class="calc-header-title">
          <div class="calc-header-icon">
            <span class="material-symbols-rounded">calculate</span>
          </div>
          <h1>ماشین‌حساب مهندسی</h1>
        </div>
        <div class="calc-header-actions">
          <button id="calc-history-btn" class="calc-chip-icon" type="button" title="تاریخچه محاسبات" aria-label="تاریخچه محاسبات">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
          </button>
          <button id="calc-conditional-toggle" class="calc-chip" title="حل مسائل شرطی (اگر ... آنگاه ...)" type="button">
            <span class="material-symbols-rounded">route</span>
            حل شرطی
          </button>
          <button id="calc-angle-toggle" class="calc-chip calc-chip-solid" type="button">DEG</button>
        </div>
      </div>

      <!-- Normal single-expression mode -->
      <div id="calc-normal-block" class="calc-display-screen">
        <div id="math-field" class="calc-math-field"></div>
        <div class="calc-result-wrap">
          <button id="calc-frac-toggle" type="button" class="calc-frac-toggle" hidden aria-pressed="false" title="نمایش کسری">کسر</button>
          <div id="math-result" class="calc-result-line" role="status" aria-live="polite"></div>
        </div>
      </div>

      <!-- Conditional "if ... then ...?" mode -->
      <div id="calc-conditional-block" class="calc-conditional-block">
        <div id="calc-conditions-list" class="calc-conditions-list"></div>
        <button id="calc-add-condition" type="button" class="calc-add-condition-btn">
          <span class="material-symbols-rounded">add_circle</span>
          شرط هم‌زمان دیگر
        </button>
        <div class="cond-field-wrap cond-target-wrap">
          <div class="cond-label">
            <span class="material-symbols-rounded cond-label-icon cond-label-icon-target">help</span>
            مقدار عبارت زیر را بیابید (Find):
          </div>
          <div id="math-field-target" class="calc-math-field calc-math-field-sm"></div>
          <div class="calc-result-wrap">
            <button id="calc-cond-frac-toggle" type="button" class="calc-frac-toggle" hidden aria-pressed="false" title="نمایش کسری">کسر</button>
            <div id="cond-result" class="calc-result-line calc-result-line-sm" role="status" aria-live="polite"></div>
          </div>
        </div>
      </div>

      <!-- Keypad -->
      <div class="calc-keypad-card">
        <!-- Cursor tools: works on whichever field is currently focused
             (main expression, a condition, or the target) — kept as its
             own slim strip instead of eating into the main number pad,
             since it's used far less often than the digits themselves. -->
        <div class="calc-cursor-toolbar">
          <button class="calc-btn calc-cursor-btn" data-key="Left" title="یک نویسه به عقب" aria-label="یک نویسه به عقب">
            <span class="material-symbols-rounded">chevron_left</span>
          </button>
          <span class="calc-cursor-hint">جابه‌جایی مکان‌نما</span>
          <button class="calc-btn calc-cursor-btn" data-key="Right" title="یک نویسه به جلو" aria-label="یک نویسه به جلو">
            <span class="material-symbols-rounded">chevron_right</span>
          </button>
        </div>
        <div class="calc-panel-body">

          <!-- Panel 1: everyday keypad — digits, basic arithmetic, equals -->
          <div id="panel-numbers" class="calc-keypad-grid calc-keypad-grid-4col">
            <button class="calc-btn op-btn tab-btn calc-tab" data-panel="symbols" title="تغییر به توابع، حروف و نمادها">
              <span class="material-symbols-rounded">functions</span> f(x)
            </button>
            <button class="calc-btn op-btn danger-btn" data-key="Clear" title="پاک‌سازی کامل">AC</button>
            <button class="calc-btn op-btn" data-key="SmartParen" title="پرانتز باز/بسته">( )</button>
            <button class="calc-btn op-btn" data-write="/">÷</button>

            <button class="calc-btn num-btn" data-write="7">7</button>
            <button class="calc-btn num-btn" data-write="8">8</button>
            <button class="calc-btn num-btn" data-write="9">9</button>
            <button class="calc-btn op-btn" data-write="*">×</button>

            <button class="calc-btn num-btn" data-write="4">4</button>
            <button class="calc-btn num-btn" data-write="5">5</button>
            <button class="calc-btn num-btn" data-write="6">6</button>
            <button class="calc-btn op-btn" data-write="-">−</button>

            <button class="calc-btn num-btn" data-write="1">1</button>
            <button class="calc-btn num-btn" data-write="2">2</button>
            <button class="calc-btn num-btn" data-write="3">3</button>
            <button class="calc-btn op-btn" data-write="+">+</button>

            <button class="calc-btn num-btn" data-write="0">0</button>
            <button class="calc-btn num-btn" data-write=".">.</button>
            <button class="calc-btn op-btn" data-write="%">%</button>
            <button class="calc-btn op-btn danger-btn" data-key="Backspace" title="پاک کردن قبلی" aria-label="پاک کردن نویسه قبلی">
              <span class="material-symbols-rounded">backspace</span>
            </button>

            <button class="calc-btn equal-btn calc-equal-4col" data-key="Equal">
              <span class="material-symbols-rounded">calculate</span>
              <span>محاسبه</span>
            </button>
          </div>

          <!-- Panel 2: scientific functions, relations, greek letters & the
               english-letter keyboard for variables -->
          <div id="panel-symbols" class="calc-keypad-grid calc-keypad-grid-hidden">
            <button class="calc-btn op-btn tab-btn calc-tab" data-panel="numbers" title="تغییر به اعداد و عملگرهای پایه">
              <span class="material-symbols-rounded">dialpad</span> 123
            </button>
            <button class="calc-btn op-btn danger-btn" data-key="Clear" title="پاک‌سازی کامل">AC</button>
            <button class="calc-btn op-btn danger-btn" data-key="Backspace" title="پاک کردن قبلی" aria-label="پاک کردن نویسه قبلی">
              <span class="material-symbols-rounded">backspace</span>
            </button>
            <button class="calc-btn op-btn" data-type="cmd" data-cmd="\\sqrt">√</button>
            <button class="calc-btn op-btn" data-type="cmd" data-cmd="\\nthroot">∛</button>

            <button class="calc-btn op-btn" data-type="cmd" data-cmd="^">xⁿ</button>
            <!-- ADDED (audit #8 / P0-2): factorial had no keypad affordance
                 at all, even though the parser is now expected to support
                 it — without this button "!" is still typable via the
                 letter keyboard, but this is the natural, discoverable
                 place for it next to the other scientific operators. -->
            <button class="calc-btn op-btn" data-write="!" title="فاکتوریل">x!</button>
            <button class="calc-btn op-btn" data-type="cmd" data-cmd="/">x/y</button>
            <button class="calc-btn op-btn" data-key="SmartAbs" title="قدرمطلق |x|">|x|</button>
            <button class="calc-btn op-btn" data-cmd="sin">sin</button>
            <button class="calc-btn op-btn" data-cmd="cos">cos</button>

            <button class="calc-btn op-btn" data-cmd="tan">tan</button>
            <button class="calc-btn op-btn" data-cmd="cot">cot</button>
            <button class="calc-btn op-btn" data-cmd="sec">sec</button>
            <button class="calc-btn op-btn" data-cmd="csc">csc</button>
            <button class="calc-btn op-btn" data-cmd="ln">ln</button>

            <button class="calc-btn op-btn" data-cmd="log">log</button>
            <button class="calc-btn op-btn rel-btn" data-write="\\le">≤</button>
            <button class="calc-btn op-btn rel-btn" data-write="\\ge">≥</button>
            <button class="calc-btn op-btn rel-btn" data-write="\\neq">≠</button>
            <button class="calc-btn op-btn rel-btn" data-write="<"><</button>

            <button class="calc-btn op-btn rel-btn" data-write=">">></button>
            <button class="calc-btn op-btn rel-btn eq-sym-btn" data-write="=" title="درج علامت تساوی در کادر">=</button>
            <button class="calc-btn op-btn" data-write="(">(</button>
            <button class="calc-btn op-btn" data-write=")">)</button>
            <button class="calc-btn op-btn" data-write="[">[</button>

            <button class="calc-btn op-btn" data-write="]">]</button>
            <button class="calc-btn op-btn" data-cmd="\\pi">π</button>
            <button class="calc-btn op-btn" data-cmd="\\alpha">α</button>
            <button class="calc-btn op-btn" data-cmd="\\beta">β</button>
            <button class="calc-btn op-btn" data-cmd="\\gamma">γ</button>

            <button class="calc-btn op-btn" data-cmd="\\theta">θ</button>
            <button class="calc-btn op-btn" data-cmd="\\lambda">λ</button>
            <button class="calc-btn op-btn" data-cmd="\\Delta">Δ</button>
            <button class="calc-btn op-btn" data-cmd="\\phi">φ</button>
            <button class="calc-btn equal-btn" data-key="Equal" title="محاسبه">
              <span class="material-symbols-rounded">calculate</span>
            </button>

            <!-- ADDED (P1: "Ans, MC / MR / M+ / M-") — a dedicated row so
                 these don't crowd out the existing, already-tight function
                 grid above. Ans/M+/M- read lastAnswerValue/memoryValue
                 (see renderCalculator state + formatAnsForInsertion). -->
            <button class="calc-btn op-btn" data-key="Ans" title="آخرین پاسخ">Ans</button>
            <button class="calc-btn op-btn" data-key="MC" title="پاک کردن حافظه">MC</button>
            <button class="calc-btn op-btn" data-key="MR" title="فراخوانی حافظه">MR</button>
            <button class="calc-btn op-btn" data-key="MPlus" title="افزودن آخرین پاسخ به حافظه">M+</button>
            <button class="calc-btn op-btn" data-key="MMinus" title="کم کردن آخرین پاسخ از حافظه">M−</button>

            <!-- ADDED (P2: floor/ceil/mod/nCr/nPr, scientific notation).
                 These write plain characters via data-write (exactly like
                 the existing letter keyboard / % / digit buttons) rather
                 than a MathQuill \command — see the tokenizer's
                 RESERVED_FN_KEYWORDS handling above for why this is safe
                 without needing to register any new MathQuill command. -->
            <button class="calc-btn op-btn" data-write="floor(" title="جزء صحیح (floor)">⌊x⌋</button>
            <button class="calc-btn op-btn" data-write="ceil(" title="سقف (ceil)">⌈x⌉</button>
            <button class="calc-btn op-btn" data-write="mod(" title="باقیمانده (mod)">mod</button>
            <button class="calc-btn op-btn" data-write="ncr(" title="ترکیب nCr">nCr</button>
            <button class="calc-btn op-btn" data-write="npr(" title="تبدیل nPr">nPr</button>
            <button class="calc-btn op-btn" data-write="e" title="نماد علمی (مثال: 3e5 = 300000)">×10ⁿ</button>

            <div class="letter-keyboard-wrap">
              <div class="letter-keyboard-label">صفحه‌کلید حروف انگلیسی (مجهولات x, y, a, b, ...)</div>
              <div class="letter-keyboard">
                ${letterKeyboardHTML}
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>

    <!-- History bottom sheet -->
    <div id="calc-history-backdrop" class="calc-sheet-backdrop"></div>
    <div id="calc-history-sheet" class="calc-history-sheet" role="dialog" aria-label="تاریخچه محاسبات">
      <div class="calc-sheet-handle"></div>
      <div class="calc-sheet-header">
        <h3>تاریخچه محاسبات</h3>
        <div class="calc-sheet-header-actions">
          <button id="calc-history-clear" class="calc-chip-icon" type="button" title="پاک کردن همه" aria-label="پاک کردن همه‌ی تاریخچه">
            <span class="material-symbols-rounded">delete</span>
          </button>
          <button id="calc-history-close" class="calc-chip-icon" type="button" title="بستن" aria-label="بستن تاریخچه">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      </div>
      <div id="calc-history-storage-warning" class="calc-history-storage-warning" style="display:none;">
        <span class="material-symbols-rounded">warning</span>
        <span id="calc-history-storage-warning-text">ذخیره‌سازی تاریخچه در این دستگاه در دسترس نیست؛ آیتم‌ها پس از بستن صفحه از بین می‌روند.</span>
      </div>
      <div id="calc-history-corrupted-notice" class="calc-history-storage-warning" style="display:none;">
        <span class="material-symbols-rounded">info</span>
        <span>داده‌ی تاریخچه‌ی قبلی خراب بود و پاک‌سازی شد؛ ذخیره‌سازی سالم است و از این پس دوباره کار می‌کند.</span>
      </div>
      <!-- FIX (missing-confirmation bug): clicking the trash icon used to
           wipe the entire history immediately with no way back, despite a
           code comment claiming a confirmation step existed. This inline
           prompt (styled like the sheet itself, not a native confirm(),
           which some embedded WebView shells don't reliably show) is now
           shown first and only clears once the user explicitly agrees. -->
      <div id="calc-history-clear-confirm" class="calc-history-clear-confirm" style="display:none;" role="alertdialog" aria-label="تأیید پاک‌کردن تاریخچه">
        <div class="calc-history-clear-confirm-head">
          <span class="material-symbols-rounded">warning</span>
          <span>کل تاریخچه پاک شود؟ این کار قابل بازگشت نیست.</span>
        </div>
        <div class="calc-history-clear-confirm-actions">
          <button id="calc-history-clear-cancel" type="button" class="calc-history-clear-btn-cancel">انصراف</button>
          <button id="calc-history-clear-confirm-btn" type="button" class="calc-history-clear-btn-confirm">پاک کردن همه</button>
        </div>
      </div>
      <div id="calc-history-list" class="calc-history-list"></div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    .calc-loading {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: var(--space-8); text-align: center; gap: var(--space-2);
    }
    .calc-loading-icon {
      font-size: 44px; color: var(--color-primary);
      animation: calc-spin 1.1s linear infinite;
    }
    @keyframes calc-spin { to { transform: rotate(360deg); } }

    .calc-container {
      width: 100%;
      max-width: 560px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      overflow-x: hidden;
      padding: var(--space-2) 2px var(--space-4) 2px;
      box-sizing: border-box;
    }

    /* ---------- header ---------- */
    .calc-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 var(--space-1); flex-wrap: wrap; gap: var(--space-2);
    }
    .calc-header-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .calc-header-icon {
      width: 40px; height: 40px; border-radius: 14px;
      background: var(--color-primary-soft); color: var(--color-primary);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .calc-header-icon .material-symbols-rounded { font-size: 22px; }
    .calc-header-title h1 {
      font-family: var(--font-heading, inherit);
      color: var(--text-primary); margin: 0; font-size: 1.05rem; font-weight: 800;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .calc-header-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

    .calc-chip-icon, .calc-chip {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      background: var(--bg-sunken); color: var(--text-secondary);
      border: 1px solid var(--border-soft); font-weight: 700;
      border-radius: 20px; cursor: pointer;
      transition: transform 0.15s cubic-bezier(0.2,0,0,1), background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
      -webkit-tap-highlight-color: transparent; user-select: none;
    }
    .calc-chip-icon { width: 38px; height: 38px; padding: 0; }
    .calc-chip-icon .material-symbols-rounded { font-size: 20px; }
    .calc-chip { padding: 8px 14px; font-size: 0.82rem; }
    .calc-chip .material-symbols-rounded { font-size: 18px; color: var(--color-primary); }
    .calc-chip:active, .calc-chip-icon:active { transform: scale(0.94); }
    .calc-chip-solid {
      background: var(--color-primary); color: #fff; border-color: transparent;
      box-shadow: var(--shadow-xs);
    }
    .calc-chip-solid .material-symbols-rounded { color: #fff; }
    #calc-conditional-toggle.active {
      background: var(--color-primary); color: #fff; border-color: var(--color-primary);
      box-shadow: 0 2px 10px color-mix(in srgb, var(--color-primary) 35%, transparent);
    }
    #calc-conditional-toggle.active .material-symbols-rounded { color: #fff; }

    /* ---------- display screen ---------- */
    .calc-display-screen {
      background: var(--bg-sunken);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-card, 20px);
      padding: var(--space-4);
      display: flex; flex-direction: column; justify-content: space-between;
      gap: var(--space-2);
      min-height: 128px;
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.05), var(--shadow-sm);
      position: relative;
      flex-shrink: 0;
      transition: box-shadow 0.2s ease;
    }
    .calc-math-field {
      width: 100%; font-size: 27px; color: var(--text-primary);
      direction: ltr; overflow-x: auto; overflow-y: hidden;
      min-height: 46px; display: block; padding: 6px 4px; box-sizing: border-box; touch-action: pan-x pan-y;
    }
    .calc-math-field .mq-root-block {
      width: auto !important;
      min-width: 100%;
      overflow: visible !important;
    }
    .calc-math-field.calc-math-expanded {
      overflow-x: hidden; overflow-y: auto;
    }
    .calc-math-field-sm { font-size: 20px; min-height: 32px; }
    .calc-result-wrap {
      display: flex; align-items: flex-start; gap: 8px;
      width: 100%; min-width: 0;
    }
    .calc-frac-toggle {
      flex-shrink: 0; margin-top: 6px; height: 28px; padding: 0 10px;
      border-radius: 14px; border: 1px solid var(--border-soft);
      background: var(--bg-card); color: var(--color-primary);
      font-size: 12px; font-weight: 800; cursor: pointer;
      font-family: inherit; line-height: 1;
    }
    .calc-frac-toggle[hidden] { display: none !important; }
    .calc-frac-toggle[aria-pressed="true"] {
      background: var(--color-primary); color: #fff; border-color: transparent;
    }
    .calc-frac {
      display: inline-flex; flex-direction: column; align-items: center;
      vertical-align: middle; line-height: 1.05; margin: 0 2px;
    }
    .calc-frac-num { padding: 0 5px 1px; font-size: 0.82em; }
    .calc-frac-den { padding: 1px 5px 0; border-top: 1.6px solid currentColor; font-size: 0.82em; }
    .calc-frac-or {
      display: inline-block; margin: 0 6px; font-size: 0.75em; font-weight: 600;
      color: var(--text-secondary); vertical-align: middle; font-family: inherit;
    }
    .calc-result-line {
      text-align: right; font-family: var(--font-mono, monospace);
      font-size: 22px; font-weight: 700; color: var(--color-primary);
      direction: ltr; min-height: 34px; max-height: 110px;
      overflow-x: auto; overflow-y: auto; -webkit-overflow-scrolling: touch;
      white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
      display: block; line-height: 1.35; flex: 1; min-width: 0;
      padding-top: 6px; border-top: 1px dashed var(--border-soft);
      transition: color 0.15s ease;
    }
    .calc-result-line-sm { font-size: 17px; min-height: 22px; padding-top: 3px; }
    .calc-result-line:empty { border-top-color: transparent; }
    #math-result.calc-error, #cond-result.calc-error {
      color: var(--color-danger) !important; font-size: 14.5px; white-space: pre-wrap !important;
      text-align: right; direction: rtl;
    }
    #cond-result.calc-warning {
      color: var(--color-accent) !important; font-size: 14px; white-space: pre-wrap !important;
      text-align: right; direction: rtl;
    }

    /* ---------- conditional block ---------- */
    .calc-conditional-block {
      display: none; flex-direction: column; gap: 8px; flex-shrink: 0;
      animation: calc-fade-slide 0.25s cubic-bezier(0.2,0,0,1);
    }
    @keyframes calc-fade-slide {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .calc-conditions-list { display: flex; flex-direction: column; gap: 8px; }
    .calc-add-condition-btn {
      align-self: flex-start; background: var(--bg-card);
      border: 1px dashed var(--color-primary); color: var(--color-primary);
      font-weight: 700; font-size: 0.75rem; padding: 5px 12px; border-radius: 12px;
      cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; gap: 4px;
    }
    .calc-add-condition-btn:hover { background: var(--color-primary-soft); border-style: solid; }
    .calc-add-condition-btn .material-symbols-rounded { font-size: 16px; }

    .cond-field-wrap {
      background: var(--bg-sunken); border: 1px solid var(--border-strong);
      border-inline-start: 4px solid var(--color-primary);
      border-radius: 12px; padding: 8px 12px; box-shadow: var(--shadow-xs);
      display: flex; flex-direction: column; gap: 3px; flex-shrink: 0;
      position: relative; animation: calc-fade-slide 0.2s cubic-bezier(0.2,0,0,1);
    }
    .cond-target-wrap { border-inline-start-color: var(--color-success); }
    .cond-label {
      font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);
      display: flex; align-items: center; gap: 4px;
    }
    .cond-label-icon { font-size: 14px; color: var(--color-primary); }
    .cond-label-icon-target { color: var(--color-success); }
    .cond-badge {
      width: 17px; height: 17px; border-radius: 50%; flex-shrink: 0;
      background: var(--color-primary); color: #fff;
      font-size: 10px; font-weight: 800; font-family: var(--font-mono, monospace);
      display: flex; align-items: center; justify-content: center;
    }
    .cond-badge-hidden .cond-badge { display: none; }
    .calc-range-hint {
      font-size: 0.7rem; color: var(--text-secondary); display: flex;
      align-items: center; gap: 4px; padding: 0 2px; opacity: 0.85;
    }
    .calc-range-hint .material-symbols-rounded { font-size: 14px; color: var(--color-primary); flex-shrink: 0; }
    .calc-range-hint b { font-family: var(--font-mono, monospace); font-weight: 700; direction: ltr; unicode-bidi: embed; color: var(--text-primary); }
    .cond-remove-btn {
      position: absolute; top: 6px; inset-inline-end: 6px;
      background: var(--color-danger-soft); border: none; color: var(--color-danger);
      font-weight: 700; font-size: 0.85rem; cursor: pointer; line-height: 1;
      padding: 3px 7px; border-radius: 8px; transition: all 0.2s ease;
    }
    .cond-remove-btn:hover { background: color-mix(in srgb, var(--color-danger) 20%, transparent); }

    /* ---------- keypad ---------- */
    .calc-keypad-card {
      background: var(--bg-card); border-radius: var(--radius-card, 20px);
      border: 1px solid var(--border-soft); box-shadow: var(--shadow-md);
      padding: 12px; overflow: hidden; flex-shrink: 0;
    }
    .calc-cursor-toolbar {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px dashed var(--border-soft);
      direction: ltr;
    }
    .calc-cursor-btn {
      min-height: 32px !important; width: 44px; flex: 0 0 auto;
      background: var(--bg-sunken) !important; color: var(--color-primary) !important;
      border-color: var(--border-soft) !important; border-radius: 10px !important;
    }
    .calc-cursor-btn .material-symbols-rounded { font-size: 19px; }
    .calc-cursor-hint {
      font-size: 0.68rem; color: var(--text-secondary); font-weight: 600;
      direction: rtl; unicode-bidi: embed;
    }
    .calc-panel-body { direction: ltr; }
    .calc-keypad-grid {
      display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px;
    }
    /* The everyday numbers panel: fewer, larger, more important keys —
       a classic 4-column phone-calculator grid reads faster at a glance
       and gives bigger touch targets than cramming relations/brackets in. */
    .calc-keypad-grid-4col {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px;
    }
    .calc-keypad-grid-hidden { display: none; }

    .calc-btn {
      border: 1px solid var(--border-soft);
      border-radius: 14px;
      font-size: 1rem; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.12s cubic-bezier(0.2,0,0,1), background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      padding: 6px 0; color: var(--text-primary); background: var(--bg-card);
      min-height: 46px; user-select: none; -webkit-tap-highlight-color: transparent;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .calc-keypad-grid-4col .calc-btn { min-height: 54px; border-radius: 16px; }
    .calc-btn:hover { border-color: var(--border-strong); }
    .calc-btn:active { transform: scale(0.94); box-shadow: none !important; }

    .num-btn {
      background: var(--bg-card); font-weight: 700; font-size: 1.35rem;
      color: var(--text-primary); border-color: var(--border-strong);
    }
    .op-btn {
      background: var(--color-primary-soft); color: var(--color-primary);
      border-color: transparent; font-size: 0.92rem;
    }
    .calc-keypad-grid-4col .op-btn { font-size: 1.15rem; font-weight: 700; }
    .op-btn:hover { background: color-mix(in srgb, var(--color-primary) 18%, var(--color-primary-soft)); }
    .rel-btn { font-size: 1.05rem; font-weight: 700; }
    .tab-btn {
      background: var(--color-primary-soft); color: var(--color-primary);
      font-weight: 800; font-size: 0.75rem; border: 1px solid var(--color-primary);
      gap: 3px; flex-direction: column;
    }
    .tab-btn .material-symbols-rounded { font-size: 18px; }
    .eq-sym-btn { font-weight: 700; font-size: 1.2rem; color: var(--color-primary); }

    .danger-btn {
      background: var(--color-danger-soft) !important; color: var(--color-danger) !important;
      font-weight: 700; border-color: transparent !important;
    }
    .danger-btn:hover { background: color-mix(in srgb, var(--color-danger) 22%, transparent) !important; }
    .danger-btn .material-symbols-rounded { font-size: 19px; }

    .equal-btn {
      background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover, var(--color-primary))) !important;
      color: #fff !important; font-weight: 700 !important; font-size: 1rem !important;
      border: none !important; gap: 6px;
      box-shadow: 0 4px 14px color-mix(in srgb, var(--color-primary) 35%, transparent) !important;
    }
    .calc-equal-4col {
      grid-column: 1 / -1; min-height: 52px !important; font-size: 1.05rem !important;
      margin-top: 2px;
    }
    .equal-btn:hover { box-shadow: 0 6px 18px color-mix(in srgb, var(--color-primary) 45%, transparent) !important; }
    .equal-btn .material-symbols-rounded { font-size: 20px; }

    .letter-keyboard-wrap {
      grid-column: 1 / -1; margin-top: 6px; padding-top: 8px;
      border-top: 1px dashed var(--border-soft);
    }
    .letter-keyboard-label {
      font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);
      margin-bottom: 6px; text-align: center; direction: rtl;
    }
    .letter-keyboard { display: flex; flex-direction: column; gap: 5px; }
    .letter-row { display: flex; gap: 5px; justify-content: center; }
    .letter-row-1 { margin-inline: 14px; }
    .letter-row-2 { margin-inline: 28px; }
    .letter-btn {
      flex: 1; max-width: 38px; min-height: 36px;
      background: var(--bg-sunken); border-color: var(--border-soft);
      font-size: 0.88rem; font-weight: 700; color: var(--text-primary);
      text-transform: lowercase; border-radius: 9px;
    }
    .letter-btn:hover { background: var(--color-primary-soft); color: var(--color-primary); border-color: var(--color-primary); }

    /* ---------- MathQuill overrides ---------- */
    .mq-editable-field { border: none !important; box-shadow: none !important; }
    .mq-editable-field.mq-focused { box-shadow: none !important; outline: none !important; }
    .mq-cursor { border-left: 2px solid var(--color-primary) !important; }

    /* ---------- history bottom sheet ---------- */
    .calc-sheet-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      opacity: 0; pointer-events: none; transition: opacity 0.25s ease; z-index: 998;
    }
    .calc-sheet-backdrop.open { opacity: 1; pointer-events: auto; }
    .calc-history-sheet {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 999;
      max-width: 560px; margin: 0 auto;
      background: var(--bg-card); border: 1px solid var(--border-soft);
      border-bottom: none;
      border-radius: 22px 22px 0 0;
      box-shadow: 0 -8px 32px rgba(0,0,0,0.18);
      transform: translateY(102%);
      transition: transform 0.28s cubic-bezier(0.2,0,0,1);
      display: flex; flex-direction: column;
      max-height: 72vh;
      padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
    }
    .calc-history-sheet.open { transform: translateY(0); }
    .calc-sheet-handle {
      width: 40px; height: 4px; border-radius: 2px; background: var(--border-strong);
      margin: 10px auto 4px auto; flex-shrink: 0;
    }
    .calc-sheet-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }
    .calc-sheet-header h3 { margin: 0; font-size: 1rem; font-weight: 800; color: var(--text-primary); }
    .calc-sheet-header-actions { display: flex; gap: 6px; }
    .calc-history-list { overflow-y: auto; padding: var(--space-2) var(--space-3) var(--space-4) var(--space-3); }
    .calc-history-storage-warning {
      display: flex; align-items: center; gap: 6px; margin: var(--space-2) var(--space-3) 0 var(--space-3);
      padding: var(--space-2) var(--space-3); border-radius: 12px;
      background: var(--color-accent-soft, var(--bg-sunken)); color: var(--color-accent, var(--text-secondary));
      font-size: 12px; font-weight: 600; flex-shrink: 0;
    }
    .calc-history-storage-warning .material-symbols-rounded { font-size: 16px; flex-shrink: 0; }
    .calc-history-clear-confirm {
      display: flex; flex-direction: column; gap: 8px;
      margin: var(--space-2) var(--space-3) 0 var(--space-3);
      padding: var(--space-3); border-radius: 12px;
      background: var(--color-danger-soft); flex-shrink: 0;
      animation: calc-fade-slide 0.2s ease;
    }
    .calc-history-clear-confirm-head {
      display: flex; align-items: center; gap: 6px;
      color: var(--color-danger); font-size: 12.5px; font-weight: 700;
    }
    .calc-history-clear-confirm-head .material-symbols-rounded { font-size: 17px; flex-shrink: 0; }
    .calc-history-clear-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .calc-history-clear-btn-cancel, .calc-history-clear-btn-confirm {
      border: none; border-radius: 10px; padding: 6px 14px; font-size: 12.5px; font-weight: 700;
      cursor: pointer; -webkit-tap-highlight-color: transparent;
      transition: transform 0.12s cubic-bezier(0.2,0,0,1);
    }
    .calc-history-clear-btn-cancel {
      background: var(--bg-card); color: var(--text-secondary); border: 1px solid var(--border-soft);
    }
    .calc-history-clear-btn-confirm { background: var(--color-danger); color: #fff; }
    .calc-history-clear-btn-cancel:active, .calc-history-clear-btn-confirm:active { transform: scale(0.95); }
    .calc-history-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--space-2); padding: var(--space-6) var(--space-3); color: var(--text-secondary);
      text-align: center;
    }
    .calc-history-empty .material-symbols-rounded { font-size: 40px; color: var(--border-strong); }
    .calc-history-item {
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
      padding: var(--space-3); border-radius: 14px; cursor: pointer;
      transition: background 0.15s ease; animation: calc-fade-slide 0.2s ease;
    }
    .calc-history-item:hover { background: var(--bg-sunken); }
    .calc-history-item + .calc-history-item { border-top: 1px solid var(--border-subtle); }
    .calc-history-item-main { min-width: 0; flex: 1; text-align: right; }
    .calc-history-item-expr {
      font-size: 12.5px; color: var(--text-secondary); direction: ltr; text-align: right;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .calc-history-item-result {
      font-family: var(--font-mono, monospace); font-size: 15px; font-weight: 700;
      color: var(--color-primary); direction: ltr; text-align: right;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .calc-history-item-time { font-size: 10.5px; color: var(--text-secondary); flex-shrink: 0; }
    .calc-history-item-del {
      background: transparent; border: none; color: var(--text-secondary);
      width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0; cursor: pointer; transition: all 0.15s ease;
    }
    .calc-history-item-del:hover { background: var(--color-danger-soft); color: var(--color-danger); }
    .calc-history-item-del .material-symbols-rounded { font-size: 17px; }

    @media (max-width: 600px) {
      .calc-btn { min-height: 40px !important; font-size: 0.9rem !important; border-radius: 12px !important; padding: 3px 0 !important; }
      .num-btn { font-size: 1.1rem !important; }
      .calc-keypad-grid { gap: 4px !important; }
      .calc-keypad-grid-4col { gap: 6px !important; }
      .calc-keypad-grid-4col .calc-btn { min-height: 48px !important; }
      .calc-keypad-grid-4col .num-btn { font-size: 1.25rem !important; }
      .calc-equal-4col { min-height: 46px !important; }
      .calc-display-screen { min-height: 100px !important; padding: 12px !important; }
      .calc-math-field { min-height: 38px !important; font-size: 21px !important; }
      .calc-result-line { min-height: 30px !important; font-size: 17px !important; }
      .letter-keyboard-wrap { margin-top: 4px !important; padding-top: 6px !important; }
      .letter-row { margin-inline: 0 !important; gap: 3px !important; }
      .letter-btn { max-width: 28px !important; min-height: 30px !important; font-size: 0.8rem !important; border-radius: 7px !important; }
      .calc-keypad-card { padding: 6px !important; border-radius: 16px !important; }
      .cond-field-wrap { padding: 6px 10px !important; }
    }

    @media (max-height: 720px) {
      .calc-btn { min-height: 36px !important; }
      .calc-display-screen { min-height: 84px !important; }
    }
  `;
  container.appendChild(style);

  // ---------- angle mode toggle ----------
  const angleToggleBtn = document.getElementById('calc-angle-toggle');
  angleToggleBtn.addEventListener('click', () => {
    angleMode = angleMode === 'DEG' ? 'RAD' : 'DEG';
    angleToggleBtn.textContent = angleMode;
    haptic();
  });

  // ---------- panel (tab) switching ----------
  const panelNumbers = document.getElementById('panel-numbers');
  const panelSymbols = document.getElementById('panel-symbols');
  const tabs = container.querySelectorAll('.calc-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activePanel = tab.getAttribute('data-panel');
      panelNumbers.classList.toggle('calc-keypad-grid-hidden', activePanel !== 'numbers');
      panelSymbols.classList.toggle('calc-keypad-grid-hidden', activePanel !== 'symbols');
      haptic();
    });
  });

  // ---------- math fields ----------
  const normalBlock = document.getElementById('calc-normal-block');
  const conditionalBlock = document.getElementById('calc-conditional-block');
  const conditionalToggleBtn = document.getElementById('calc-conditional-toggle');

  const mathFieldSpan = document.getElementById('math-field');
  const resultDiv = document.getElementById('math-result');
  const fracToggleBtn = document.getElementById('calc-frac-toggle');
  const targetFieldSpan = document.getElementById('math-field-target');
  const condResultDiv = document.getElementById('cond-result');
  const condFracToggleBtn = document.getElementById('calc-cond-frac-toggle');
  const conditionsListEl = document.getElementById('calc-conditions-list');
  const addConditionBtn = document.getElementById('calc-add-condition');
  const MAX_CONDITIONS = 4;

  let preferFraction = false;
  const paintedResults = {
    normal: { formatted: '', frac: null, fracs: null, suffix: '', numeric: null },
    cond: { formatted: '', frac: null, fracs: null, suffix: '', numeric: null },
  };

  function paintResultEl(el, btn, slot, payload) {
    if (!el) return;
    if (payload) {
      // Accept either a single `frac` or a `fracs` array (or both).
      const fracs = payload.fracs
        || (payload.frac ? [payload.frac] : null);
      paintedResults[slot] = {
        formatted: payload.formatted || '',
        frac: (fracs && fracs[0]) || payload.frac || null,
        fracs: fracs && fracs.length ? fracs : null,
        parts: payload.parts || null,
        suffix: payload.suffix || '',
        numeric: payload.numeric != null ? payload.numeric : null,
      };
    }
    const state = paintedResults[slot];
    const suffix = state.suffix || '';
    const canFrac = !!(state.fracs && state.fracs.length) || !!state.frac;
    if (btn) {
      btn.hidden = !canFrac;
      btn.textContent = preferFraction ? 'اعشار' : 'کسر';
      btn.setAttribute('aria-pressed', preferFraction && canFrac ? 'true' : 'false');
      btn.title = preferFraction ? 'نمایش اعشاری' : 'نمایش کسری';
    }
    if (!state.formatted && !canFrac) {
      el.textContent = '';
      return;
    }
    if (preferFraction && canFrac) {
      let body = '';
      if (state.parts && state.parts.length) {
        body = state.parts.map((p) => {
          if (p.type === 'frac') return stackedFracHtml(p.frac);
          return `<span class="calc-frac-text">${p.text}</span>`;
        }).join(' <span class="calc-frac-or">یا</span> ');
      } else {
        const list = (state.fracs && state.fracs.length) ? state.fracs : (state.frac ? [state.frac] : []);
        body = list.length > 1 ? stackedFracListHtml(list) : stackedFracHtml(list[0]);
      }
      const multiPrefix = (state.formatted && state.formatted.startsWith('چند مقدار'))
        ? 'چند مقدار ممکن است: '
        : '';
      el.innerHTML = (multiPrefix ? multiPrefix : '= ') + body + suffix;
    } else {
      const prefixed = /^(=|خطا|چند)/.test(state.formatted) || state.formatted.includes('پاسخ:');
      el.textContent = (prefixed ? state.formatted : ('= ' + state.formatted)) + suffix;
    }
  }

  function syncFracButtons() {
    paintResultEl(resultDiv, fracToggleBtn, 'normal', null);
    paintResultEl(condResultDiv, condFracToggleBtn, 'cond', null);
  }

  function toggleFractionMode() {
    preferFraction = !preferFraction;
    syncFracButtons();
    haptic();
  }
  if (fracToggleBtn) fracToggleBtn.addEventListener('click', toggleFractionMode);
  if (condFracToggleBtn) condFracToggleBtn.addEventListener('click', toggleFractionMode);

  // MathQuill creates a hidden textarea (and sometimes recreates it, e.g. on
  // refocus) to capture native key events. We only want our own virtual
  // keypad to drive input, never the system keyboard — so every such
  // input/textarea gets marked non-interactive, and a MutationObserver keeps
  // re-applying this to any element MathQuill creates later, not just the
  // ones present at wireField() time.
  const suppressKeyboard = (span) => {
    span.querySelectorAll('textarea, input').forEach((el) => {
      el.setAttribute('inputmode', 'none');
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('spellcheck', 'false');
    });
  };

  // Tracks whichever field the virtual keypad should type into.
  let activeField = null;

  // Returns the field the virtual keypad should fall back to when nothing
  // is explicitly focused — the visible mode's primary field, not always
  // the normal-mode mathField (which may be hidden while in conditional mode).
  const getDefaultField = () => (conditionalMode
    ? (conditionFields[0] ? conditionFields[0].field : mathField)
    : mathField);

  const wireField = (span, field, onEdit, anchorToOuterBox) => {
    // Captured before the wrapper is inserted: the field's real containing
    // box (e.g. the whole display screen), used only when anchorToOuterBox
    // is true, so the resize handle can sit at the box's actual bottom edge
    // instead of the field wrapper's edge (which sits higher up whenever
    // there's a result line, or extra flex space, beneath the field).
    const outerBox = span.parentNode;

    // create wrapper for resizing
    const wrapper = document.createElement('div');
    wrapper.className = 'calc-math-wrapper';
    wrapper.style.cssText = 'position:relative; width:100%;';
    span.parentNode.insertBefore(wrapper, span);
    wrapper.appendChild(span);
    
    const handle = document.createElement('div');
    handle.className = 'calc-resize-handle';
    handle.style.cssText = 'position:absolute; left:-6px; bottom:-6px; width:44px; height:44px; cursor:ns-resize; touch-action:none; display:flex; align-items:flex-end; justify-content:flex-start; z-index:10;';
    handle.innerHTML = `
        <div style="position:absolute; left:6px; bottom:13px; width:17px; height:2.2px; background:var(--text-tertiary, #8b877f); border-radius:1px; transform:rotate(45deg); pointer-events:none;"></div>
        <div style="position:absolute; left:6px; bottom:10px; width:11px; height:2.2px; background:var(--text-tertiary, #8b877f); border-radius:1px; transform:rotate(45deg); pointer-events:none;"></div>
    `;
    (anchorToOuterBox ? outerBox : wrapper).appendChild(handle);
    
    let startY = 0;
    let startHeight = 0;
    
    handle.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      startHeight = span.getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    
    handle.addEventListener('pointermove', (e) => {
      if (handle.hasPointerCapture(e.pointerId)) {
        const newHeight = startHeight + (e.clientY - startY);
        span.style.height = Math.max(46, newHeight) + 'px';
        e.preventDefault();
      }
    });
    
    handle.addEventListener('pointerup', (e) => {
      if (handle.hasPointerCapture(e.pointerId)) {
        handle.releasePointerCapture(e.pointerId);
      }
    });
    
    suppressKeyboard(span);
    const observer = new MutationObserver(() => suppressKeyboard(span));
    observer.observe(span, { childList: true, subtree: true });
    
    span.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') suppressKeyboard(span);
    });
    span.addEventListener('click', () => {
      suppressKeyboard(span);
      activeField = field;
    });
    
    const ro = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (span.style.height) {
          const height = parseInt(span.style.height, 10);
          if (height > 55) {
            span.classList.add('calc-math-expanded');
            continue;
          }
        }
        span.classList.remove('calc-math-expanded');
      }
    });
    ro.observe(span);
    if (onEdit) {
      // MathQuill handlers must be set at construction time; onEdit is
      // invoked from within the handlers.edit callback passed to MQ.MathField.
    }
  };

  const mathField = MQ.MathField(mathFieldSpan, {
    spaceBehavesLikeTab: true,
    handlers: {
      edit: function () {
        resultDiv.textContent = '';
        resultDiv.classList.remove('calc-error');
        resultDiv.setAttribute('role', 'status'); // a11y: back to polite status once no longer an error
        suppressKeyboard(mathFieldSpan);
      },
    },
  });
  wireField(mathFieldSpan, mathField, undefined, true);
  activeField = mathField;

  const targetField = MQ.MathField(targetFieldSpan, {
    spaceBehavesLikeTab: true,
    handlers: {
      edit: function () {
        condResultDiv.textContent = '';
        condResultDiv.classList.remove('calc-error', 'calc-warning');
        condResultDiv.setAttribute('role', 'status'); // a11y: back to polite status once no longer an error
        suppressKeyboard(targetFieldSpan);
      },
    },
  });
  wireField(targetFieldSpan, targetField, undefined, true);

  // ---------- dynamic list of simultaneous condition fields ----------
  // conditionFields: array of { wrapEl, span, field }
  const conditionFields = [];

  function makeConditionEdit() {
    return function () {
      condResultDiv.textContent = '';
      condResultDiv.classList.remove('calc-error', 'calc-warning');
      condResultDiv.setAttribute('role', 'status'); // a11y: back to polite status once no longer an error
    };
  }

  function relabelConditions() {
    conditionFields.forEach((c, i) => {
      const badge = c.wrapEl.querySelector('.cond-badge');
      if (badge) badge.textContent = String(i + 1);
      c.wrapEl.classList.toggle('cond-badge-hidden', conditionFields.length <= 1);
    });
    addConditionBtn.style.display = conditionFields.length >= MAX_CONDITIONS ? 'none' : 'inline-flex';
  }

  function addConditionField() {
    if (conditionFields.length >= MAX_CONDITIONS) return;
    const idx = conditionFields.length;
    const wrapEl = document.createElement('div');
    wrapEl.className = 'cond-field-wrap cond-item';
    wrapEl.innerHTML = `
      <div class="cond-label">
        <span class="cond-badge">${idx + 1}</span>
        <span class="material-symbols-rounded cond-label-icon">verified</span>
        <span class="cond-label-text">به شرط آنکه (Given):</span>
      </div>
      <div class="math-field-condition calc-math-field calc-math-field-sm"></div>
      ${idx > 0 ? '<button type="button" class="cond-remove-btn" title="حذف این شرط"><span class="material-symbols-rounded" style="font-size: 16px;">close</span></button>' : ''}
    `;
    conditionsListEl.appendChild(wrapEl);
    const span = wrapEl.querySelector('.math-field-condition');
    const field = MQ.MathField(span, {
      spaceBehavesLikeTab: true,
      handlers: { edit: makeConditionEdit() },
    });
    wireField(span, field);

    const entry = { wrapEl, span, field };
    conditionFields.push(entry);

    const removeBtn = wrapEl.querySelector('.cond-remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        const pos = conditionFields.indexOf(entry);
        if (pos === -1) return;
        conditionFields.splice(pos, 1);
        wrapEl.remove();
        if (activeField === field) activeField = conditionFields[0] ? conditionFields[0].field : mathField;
        relabelConditions();
      });
    }
    relabelConditions();
    return field;
  }

  // start with exactly one condition field
  addConditionField();
  addConditionBtn.addEventListener('click', () => {
    const field = addConditionField();
    if (field) { activeField = field; field.focus(); }
    haptic();
  });

  // ---------- conditional mode toggle ----------
  function setConditionalMode(on) {
    conditionalMode = !!on;
    conditionalToggleBtn.classList.toggle('active', conditionalMode);
    if (conditionalMode) {
      normalBlock.style.display = 'none';
      conditionalBlock.style.display = 'flex';
      activeField = conditionFields[0] ? conditionFields[0].field : targetField;
      if (activeField) activeField.focus();
    } else {
      conditionalBlock.style.display = 'none';
      normalBlock.style.display = 'flex';
      activeField = mathField;
      mathField.focus();
    }
  }
  conditionalToggleBtn.addEventListener('click', () => {
    setConditionalMode(!conditionalMode);
    haptic();
  });

  // ---------- evaluate a single expression (normal mode) ----------
  function evaluateSingleExpression(latex) {
    resultDiv.classList.remove('calc-error');
    resultDiv.setAttribute('role', 'status'); // a11y: back to polite status once no longer an error
    if (!latex || !latex.trim()) return;

    let mathjsExpr;
    try {
      mathjsExpr = latexToMathJS(latex);
    } catch (err) {
      console.error('LaTeX parse error:', err, 'latex:', latex);
      resultDiv.textContent = err instanceof LatexSyntaxError
        ? `خطا: ${err.message}`
        : 'عبارت قابل تجزیه نیست';
      resultDiv.classList.add('calc-error');
      resultDiv.setAttribute('role', 'alert'); // a11y: errors interrupt (assertive), not just polite status
      fracToggleBtn.hidden = true;
      return;
    }

    try {
      let res;
      // Single centralized scope shared with the conditional solver — see
      // buildMathScope() above, which also covers acot/asec/acsc.
      const degScope = buildMathScope(angleMode, mathjs);

      try {
        res = evaluate(mathjsExpr, degScope);
        // Reject any Complex result that reached here via a path not covered
        // by an explicit domain check (e.g. the literal `i` constant) instead
        // of silently displaying it as if it were an ordinary real answer.
        assertReal(mathjs, res);
      } catch (numericErr) {
        // A DomainError means evaluate() actually ran the numbers and hit a
        // genuine real-number domain violation (sqrt of a negative, log of
        // zero, asin out of range, a trig pole, factorial of a negative
        // integer, ...) — NOT "this expression has free symbols that need
        // simplifying". Show the specific domain message directly rather than
        // falling through to the generic simplify path.
        if (numericErr instanceof DomainError) {
          resultDiv.textContent = `خطا: ${numericErr.message}`;
          resultDiv.classList.add('calc-error');
          resultDiv.setAttribute('role', 'alert'); // a11y: errors interrupt (assertive), not just polite status
          fracToggleBtn.hidden = true;
          return;
        }

        const freeSymbols = getFreeSymbols(mathjsExpr, mathjs);
        const constant = tryConstantByProbing(mathjsExpr, mathjs, freeSymbols, degScope);

        if (constant !== undefined) {
          res = constant;
        } else {
          const { simplify } = mathjs;
          const customRules = [
            ...simplify.rules,
            'sin(n1)/cos(n1) -> tan(n1)',
            'cos(n1)/sin(n1) -> cot(n1)',
            '1/cos(n1) -> sec(n1)',
            '1/sin(n1) -> csc(n1)',
            '1/tan(n1) -> cot(n1)',
            '1/cot(n1) -> tan(n1)',
            '1/sec(n1) -> cos(n1)',
            '1/csc(n1) -> sin(n1)',
            'sin(n1)^2 + cos(n1)^2 -> 1',
            'cos(n1)^2 + sin(n1)^2 -> 1',
            '1 - cos(n1)^2 -> sin(n1)^2',
            '1 - sin(n1)^2 -> cos(n1)^2',
            '1 + tan(n1)^2 -> sec(n1)^2',
            'tan(n1)^2 + 1 -> sec(n1)^2',
            'sec(n1)^2 - tan(n1)^2 -> 1',
            '1 + cot(n1)^2 -> csc(n1)^2',
            'cot(n1)^2 + 1 -> csc(n1)^2',
            'csc(n1)^2 - cot(n1)^2 -> 1',
            'tan(n1) * cos(n1) -> sin(n1)',
            'cos(n1) * tan(n1) -> sin(n1)',
            'cot(n1) * sin(n1) -> cos(n1)',
            'sin(n1) * cot(n1) -> cos(n1)',
            'tan(n1) * cot(n1) -> 1',
            'cot(n1) * tan(n1) -> 1',
            'sin(n1) * csc(n1) -> 1',
            'csc(n1) * sin(n1) -> 1',
            'cos(n1) * sec(n1) -> 1',
            'sec(n1) * cos(n1) -> 1',
          ];
          try {
            res = simplify(mathjsExpr, customRules).toString();
          } catch (simplifyErr) {
            throw numericErr;
          }
        }
      }

      const formatted = formatResult(res, mathjs);
      const numeric = coerceFiniteNumber(res, mathjs);
      const frac = numeric != null ? niceFraction(numeric) : (
        mathjs.isFraction && mathjs.isFraction(res)
          ? { n: Math.abs(Number(res.n)), d: Number(res.d), sign: res.s < 0 ? -1 : 1 }
          : null
      );
      resultDiv.classList.remove('calc-error');
      paintResultEl(resultDiv, fracToggleBtn, 'normal', {
        formatted: formatted !== null ? formatted : '',
        frac: (frac && frac.d > 1) ? frac : null,
        suffix: '',
        numeric,
      });
      if (formatted !== null) {
        // Ans only ever stores a plain finite number — a symbolic/simplify
        // fallback result (a string) or a boolean isn't something the Ans
        // button can meaningfully re-insert as typed digits.
        lastAnswerValue = numeric != null ? numeric : null;
        addHistoryItem({ mode: 'normal', latex, result: formatted, compiledExpression: mathjsExpr, resultType: 'exact' });
      }
    } catch (evalErr) {
      console.error('Evaluation error:', evalErr, 'expr:', mathjsExpr);
      resultDiv.textContent = 'خطا در محاسبه عبارت';
      resultDiv.classList.add('calc-error');
      resultDiv.setAttribute('role', 'alert'); // a11y: errors interrupt (assertive), not just polite status
      fracToggleBtn.hidden = true;
    }
  }

  // ---------- evaluate a condition + target pair (conditional mode) ----------
  function evaluateConditional() {
    condResultDiv.classList.remove('calc-error', 'calc-warning');
    condResultDiv.setAttribute('role', 'status'); // a11y: back to polite status once no longer an error
    const condLatexList = conditionFields.map((c) => c.field.latex());
    const targetLatex = targetField.latex();
    const hasAnyCondition = condLatexList.some((l) => l && l.trim());
    if (!hasAnyCondition || !targetLatex || !targetLatex.trim()) {
      condResultDiv.textContent = 'ابتدا شرط و عبارت هدف را وارد کنید';
      condResultDiv.classList.add('calc-error');
      condResultDiv.setAttribute('role', 'alert'); // a11y: errors interrupt (assertive), not just polite status
      condFracToggleBtn.hidden = true;
      return;
    }

    const result = solveConditional(condLatexList, targetLatex, mathjs, angleMode);
    const condSummary = condLatexList.filter((l) => l && l.trim()).join('  ,  ');
    const filledConds = condLatexList.filter((l) => l && l.trim());

    // Make clear when an answer came from a finite numeric search or from
    // repeated-sample verification rather than an exact/algebraic solve,
    // so it is never visually indistinguishable from a proven result.
    const derivedByLabel = (derivedBy) => {
      if (derivedBy === 'numeric-verified') return ' (با جست‌وجوی عددی یافت شد)';
      if (derivedBy === 'heuristic-sampled') return ' (با نمونه‌برداری عددی بررسی شد، نه اثبات جبری)';
      return '';
    };

    const packHistory = (formatted, resultType) => addHistoryItem({
      mode: 'conditional',
      latex: `${condSummary}  ⟹  ${targetLatex}`,
      conditions: filledConds,
      target: targetLatex,
      result: formatted,
      resultType: resultType || 'unknown',
    });

    if (result.error) {
      condResultDiv.textContent = result.error;
      condResultDiv.classList.add('calc-error');
      condResultDiv.setAttribute('role', 'alert'); // a11y: errors interrupt (assertive), not just polite status
      condFracToggleBtn.hidden = true;
      return;
    }
    if (result.warning) {
      const formatted = formatResult(result.value, mathjs);
      const numeric = coerceFiniteNumber(result.value, mathjs);
      const fracPayload = buildFracPayload(result.value, mathjs);
      condResultDiv.classList.add('calc-warning');
      paintResultEl(condResultDiv, condFracToggleBtn, 'cond', {
        formatted: `${result.warning} — پاسخ: ${formatted}`,
        frac: fracPayload.frac,
        fracs: fracPayload.fracs,
        parts: fracPayload.parts,
        suffix: '',
        numeric,
      });
      packHistory(formatted, result.derivedBy);
      return;
    }
    if (result.unique) {
      const formatted = formatResult(result.value, mathjs);
      const numeric = coerceFiniteNumber(result.value, mathjs);
      const fracPayload = buildFracPayload(result.value, mathjs);
      lastAnswerValue = numeric != null ? numeric : null;
      paintResultEl(condResultDiv, condFracToggleBtn, 'cond', {
        formatted,
        frac: fracPayload.frac,
        fracs: fracPayload.fracs,
        parts: fracPayload.parts,
        suffix: derivedByLabel(result.derivedBy),
        numeric,
      });
      packHistory(formatted, result.derivedBy);
      return;
    }
    const values = result.values || [];
    const formattedList = values.map((v) => formatResult(v, mathjs)).join('  یا  ');
    const fracPayload = buildFracPayload(values, mathjs);
    const firstNum = values.length ? coerceFiniteNumber(values[0], mathjs) : null;
    condResultDiv.classList.add('calc-warning');
    paintResultEl(condResultDiv, condFracToggleBtn, 'cond', {
      formatted: 'چند مقدار ممکن است: ' + formattedList,
      frac: fracPayload.frac,
      fracs: fracPayload.fracs,
      parts: fracPayload.parts,
      suffix: derivedByLabel(result.derivedBy),
      numeric: firstNum,
    });
    packHistory(formattedList, result.derivedBy);
  }

  // Ans/Memory insertion: writes the stored number back into the field as
  // literal digits. Wrapped in parens when negative so it composes safely
  // with whatever the user types next to it (e.g. "Ans^2" on a negative
  // Ans should mean "(-3)^2", not "-3^2" — see the P0 precedence fix).
  function formatAnsForInsertion(v) {
    const rounded = Math.round(v * 1e10) / 1e10;
    const s = String(rounded);
    return rounded < 0 ? `(${s})` : s;
  }

  // ---------- keypad button wiring ----------
  const buttons = container.querySelectorAll('.calc-btn');
  buttons.forEach((btn) => {
    // Tapping a <button> normally moves DOM focus onto that button, which
    // blurs whichever MathQuill field the user was typing into. The click
    // handler below then calls field.focus() to bring focus back — and that
    // focus change triggers the browser's built-in "scroll the newly-focused
    // element into view" behavior, so every keypress produced a jarring
    // scroll jump. Preventing the default mousedown/touchstart action stops
    // the button from ever taking focus in the first place, so the field
    // simply stays focused (and the page stays put) across taps. This only
    // changes focus handling — every click handler below fires normally.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    btn.addEventListener('click', () => {
      const write = btn.getAttribute('data-write');
      const cmd = btn.getAttribute('data-cmd');
      const key = btn.getAttribute('data-key');

      const field = activeField || getDefaultField();
      field.focus();
      haptic();

      if (write) {
        field.write(write);
      } else if (cmd === '/') {
        // The generic fraction command has MathQuill's built-in "smart"
        // behavior: it greedily absorbs whatever sits immediately before
        // the cursor into the numerator. That's often surprising — e.g. it
        // can swallow an entire unfinished "\sin x(" back to the start of
        // an open, unclosed group instead of giving a fresh blank fraction.
        // Writing an explicit empty template instead always produces a
        // predictable blank numerator/denominator pair, with the cursor
        // landing in the numerator ready to type.
        field.write('\\frac{}{}');
        field.keystroke('Left');
        field.keystroke('Left');
      } else if (cmd) {
        field.cmd(cmd);
      } else if (key === 'SmartParen') {
        // One button for both "(" and ")" — most people don't want to
        // track which one they still owe. Counts unmatched opens in the
        // current field and picks the sensible one automatically.
        const latex = field.latex();
        const openCount = (latex.match(/\(/g) || []).length;
        const closeCount = (latex.match(/\)/g) || []).length;
        field.write(openCount > closeCount ? ')' : '(');
      } else if (key === 'SmartAbs') {
        // Same "give a clean empty template" idea as the fraction button:
        // write both bars at once and land the cursor in between, rather
        // than making the person track which bar they've already placed.
        field.write('||');
        field.keystroke('Left');
      } else if (key === 'Ans') {
        if (lastAnswerValue === null) {
          haptic(20); // distinct longer buzz = "no numeric Ans available" feedback
        } else {
          field.write(formatAnsForInsertion(lastAnswerValue));
        }
      } else if (key === 'MC') {
        memoryValue = 0;
      } else if (key === 'MR') {
        field.write(formatAnsForInsertion(memoryValue));
      } else if (key === 'MPlus') {
        if (lastAnswerValue !== null) memoryValue += lastAnswerValue;
        else haptic(20);
      } else if (key === 'MMinus') {
        if (lastAnswerValue !== null) memoryValue -= lastAnswerValue;
        else haptic(20);
      } else if (key === 'Backspace') {
        field.keystroke('Backspace');
      } else if (key === 'Left') {
        field.keystroke('Left');
      } else if (key === 'Right') {
        field.keystroke('Right');
      } else if (key === 'Clear') {
        field.latex('');
        if (field === mathField) {
          resultDiv.textContent = '';
          resultDiv.classList.remove('calc-error');
          resultDiv.setAttribute('role', 'status'); // a11y: back to polite status once no longer an error
        } else {
          condResultDiv.textContent = '';
          condResultDiv.classList.remove('calc-error', 'calc-warning');
          condResultDiv.setAttribute('role', 'status'); // a11y: back to polite status once no longer an error
        }
      } else if (key === 'Equal') {
        if (conditionalMode) {
          evaluateConditional();
        } else {
          evaluateSingleExpression(mathField.latex());
        }
      }
    });
  });

  // ---------- history sheet ----------
  const historyBtn = document.getElementById('calc-history-btn');
  const historySheet = document.getElementById('calc-history-sheet');
  const historyBackdrop = document.getElementById('calc-history-backdrop');
  const historyCloseBtn = document.getElementById('calc-history-close');
  const historyClearBtn = document.getElementById('calc-history-clear');
  const historyClearConfirmEl = document.getElementById('calc-history-clear-confirm');
  const historyClearCancelBtn = document.getElementById('calc-history-clear-cancel');
  const historyClearConfirmBtn = document.getElementById('calc-history-clear-confirm-btn');
  const historyListEl = document.getElementById('calc-history-list');
  const historyStorageWarningEl = document.getElementById('calc-history-storage-warning');
  const historyCorruptedNoticeEl = document.getElementById('calc-history-corrupted-notice');

  function formatHistoryTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function setConditionCount(n) {
    n = Math.max(1, Math.min(MAX_CONDITIONS, n | 0));
    while (conditionFields.length < n) addConditionField();
    while (conditionFields.length > n) {
      const last = conditionFields.pop();
      if (last && last.wrapEl) last.wrapEl.remove();
    }
    relabelConditions();
  }

  function parseConditionalHistory(item) {
    if (Array.isArray(item.conditions) && item.conditions.length) {
      return {
        conditions: item.conditions.map((s) => String(s || '').trim()).filter(Boolean),
        target: String(item.target || ''),
      };
    }
    const raw = String(item.latex || '');
    const seps = ['  ⟹  ', ' ⟹ ', '⟹', ' ⇒ ', '⇒', ' => ', '==>'];
    let left = raw, right = '';
    for (const s of seps) {
      const i = raw.indexOf(s);
      if (i !== -1) {
        left = raw.slice(0, i).trim();
        right = raw.slice(i + s.length).trim();
        break;
      }
    }
    const conditions = left.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    return { conditions: conditions.length ? conditions : (left ? [left] : ['']), target: right };
  }

  function tryFracFromResultString(str) {
    if (!str) return { numeric: null, frac: null };
    const m = String(str).replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
    if (!m) return { numeric: null, frac: null };
    const numeric = Number(m[0]);
    if (!Number.isFinite(numeric)) return { numeric: null, frac: null };
    return { numeric, frac: niceFraction(numeric) };
  }

  function restoreHistoryItem(item) {
    if (!item) return;
    if (item.mode === 'conditional') {
      setConditionalMode(true);
      const parsed = parseConditionalHistory(item);
      setConditionCount(Math.max(1, parsed.conditions.length));
      parsed.conditions.forEach((latex, i) => {
        if (conditionFields[i]) conditionFields[i].field.latex(latex);
      });
      targetField.latex(parsed.target || '');
      condResultDiv.classList.remove('calc-error', 'calc-warning');
      const { numeric, frac } = tryFracFromResultString(item.result);
      paintResultEl(condResultDiv, condFracToggleBtn, 'cond', {
        formatted: item.result || '',
        frac,
        suffix: '',
        numeric,
      });
      lastAnswerValue = numeric;
      activeField = conditionFields[0] ? conditionFields[0].field : targetField;
      if (activeField) activeField.focus();
    } else {
      setConditionalMode(false);
      mathField.latex(item.latex || '');
      resultDiv.classList.remove('calc-error');
      const { numeric, frac } = tryFracFromResultString(item.result);
      paintResultEl(resultDiv, fracToggleBtn, 'normal', {
        formatted: item.result || '',
        frac,
        suffix: '',
        numeric,
      });
      lastAnswerValue = numeric;
      mathField.focus();
    }
    haptic();
  }

  function renderHistoryList() {
    const items = loadHistory();
    // Two independent, correctly-worded notices instead of one banner that
    // conflated "storage is broken" with "one stored value happened to be
    // corrupted" (see loadHistory()).
    historyStorageWarningEl.style.display = historyStorageUnavailable ? 'flex' : 'none';
    historyCorruptedNoticeEl.style.display = (!historyStorageUnavailable && historyDataWasCorrupted) ? 'flex' : 'none';
    if (!items.length) {
      historyListEl.innerHTML = `
        <div class="calc-history-empty">
          <span class="material-symbols-rounded">history_toggle_off</span>
          <span>هنوز محاسبه‌ای ثبت نشده است</span>
        </div>
      `;
      return;
    }
    historyListEl.innerHTML = '';
    items.forEach((item) => {
      // Built with DOM APIs / textContent instead of interpolating
      // item.result / item.latex into innerHTML. Those values come from
      // localStorage, which is not a trusted source going forward — a future
      // input path, a MathQuill paste, or another script on the same WebView
      // origin could put arbitrary content there. textContent can never be
      // interpreted as markup, so this closes that class of risk regardless
      // of what ends up in the stored string.
      const row = document.createElement('div');
      row.className = 'calc-history-item';

      const main = document.createElement('div');
      main.className = 'calc-history-item-main';
      const resultEl = document.createElement('div');
      resultEl.className = 'calc-history-item-result';
      resultEl.textContent = '= ' + item.result;
      const exprEl = document.createElement('div');
      exprEl.className = 'calc-history-item-expr';
      exprEl.textContent = item.latex;
      main.appendChild(resultEl);
      main.appendChild(exprEl);

      const timeEl = document.createElement('div');
      timeEl.className = 'calc-history-item-time';
      timeEl.textContent = formatHistoryTime(item.timestamp);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'calc-history-item-del';
      delBtn.title = 'حذف';
      delBtn.setAttribute('aria-label', 'حذف این مورد از تاریخچه');
      const delIcon = document.createElement('span');
      delIcon.className = 'material-symbols-rounded';
      delIcon.textContent = 'close';
      delBtn.appendChild(delIcon);

      row.appendChild(main);
      row.appendChild(timeEl);
      row.appendChild(delBtn);
      row.addEventListener('click', (e) => {
        if (e.target.closest('.calc-history-item-del')) return;
        restoreHistoryItem(item);
        closeHistorySheet();
      });
      row.querySelector('.calc-history-item-del').addEventListener('click', () => {
        removeHistoryItem(item.id);
        renderHistoryList();
        haptic();
      });
      historyListEl.appendChild(row);
    });
  }

  // showHistoryClearConfirm/hideHistoryClearConfirm show and hide a real
  // inline confirmation prompt (see the matching HTML/CSS above) before
  // the clear button deletes anything.
  function showHistoryClearConfirm() {
    if (!loadHistory().length) return; // nothing to clear, nothing to confirm
    historyClearConfirmEl.style.display = 'flex';
  }
  function hideHistoryClearConfirm() {
    historyClearConfirmEl.style.display = 'none';
  }

  function openHistorySheet() {
    renderHistoryList();
    hideHistoryClearConfirm();
    historySheet.classList.add('open');
    historyBackdrop.classList.add('open');
  }
  function closeHistorySheet() {
    historySheet.classList.remove('open');
    historyBackdrop.classList.remove('open');
    hideHistoryClearConfirm();
  }

  historyBtn.addEventListener('click', () => { openHistorySheet(); haptic(); });
  historyCloseBtn.addEventListener('click', () => { closeHistorySheet(); haptic(); });
  historyBackdrop.addEventListener('click', closeHistorySheet);
  historyClearBtn.addEventListener('click', () => {
    showHistoryClearConfirm();
    haptic();
  });
  historyClearCancelBtn.addEventListener('click', () => {
    hideHistoryClearConfirm();
    haptic();
  });
  historyClearConfirmBtn.addEventListener('click', () => {
    clearHistory();
    hideHistoryClearConfirm();
    renderHistoryList();
    haptic();
  });

  getDefaultField().focus();

  // Exposes a cleanup handle. If the router calls this when navigating
  // away from the calculator screen, every MutationObserver created above
  // is disconnected. Event listeners need no separate cleanup here: every
  // one added above is attached to an element inside `container`, and the
  // next renderCalculator() call replaces `container.innerHTML` wholesale,
  // so those elements (and their listeners) become collectible together.
  // KNOWN LIMITATION: whether this actually gets called on navigation
  // depends on router.js's contract, which is outside this file.
  return function destroy() {
    observers.forEach((o) => { try { o.disconnect(); } catch (e) { /* already gone */ } });
    observers.length = 0;
  };
}
