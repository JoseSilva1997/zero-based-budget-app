/* ============================================================
   The arithmetic behind an amount field.

   Money fields take small sums ("40+12.50"), so their text has to be evaluated.
   It is parsed by hand rather than handed to Function(): an eval of whatever a
   user typed is a code path worth not owning at all, allowlist or no allowlist.
   Every failure carries a reason, because a field that rejects a value without
   saying why is indistinguishable from one that dropped a keystroke.

   Three exports, and each answers a different question a field asks:
     parseMoney   what is this text worth, and if it is worth nothing, why?
     evalMoney    the same, flattened to a number or null for callers that
                  only branch on "did it read".
     isExpr       is this text a sum rather than a plain figure, so the field
                  should show a preview of what it works out to?
   ============================================================ */

const MONEY_ERRORS = {
  number: "That isn't a number I can read.",
  chars: "Numbers and + - * / only.",
  comma: "That comma is unclear. Use a full stop for decimals.",
  incomplete: "That sum isn't finished.",
  zero: "Can't divide by zero.",
  range: "That works out too large to store.",
};
const moneyFail = (reason) => ({ ok: false, reason: MONEY_ERRORS[reason] || MONEY_ERRORS.number });
function moneyOk(v) {
  if (!Number.isFinite(v)) return moneyFail("range");
  const r = Math.round(v * 100) / 100;
  return Number.isFinite(r) ? { ok: true, value: r } : moneyFail("range");
}

/* Half the world writes 12,50 for twelve and a half, and the app offers €, ¥
   and ₹, so a comma has to mean something. Thousands grouping wins where the
   digits say so (1,234); a trailing one- or two-digit group is decimal; and
   anything that could honestly be read either way is refused, not guessed. */
function normalizeNumber(lex) {
  if (lex.indexOf(",") === -1) return /^(\d+(\.\d+)?|\.\d+)$/.test(lex) ? lex : null;
  const dot = lex.indexOf(".");
  if (dot !== -1) {
    // Alongside a decimal point a comma can only be grouping.
    const head = lex.slice(0, dot), tail = lex.slice(dot);
    if (!/^\d{1,3}(,\d{3})+$/.test(head) || !/^\.\d+$/.test(tail)) return null;
    return head.replace(/,/g, "") + tail;
  }
  if (/^\d{1,3}(,\d{3})+$/.test(lex)) return lex.replace(/,/g, "");
  if (/^\d+,\d{1,2}$/.test(lex)) return lex.replace(",", ".");
  return null;
}

const NUM_CHAR = /[0-9.,]/;
function tokenizeMoney(s) {
  const out = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === " " || c === "\t") { i++; continue; }
    if ("+-*/()".indexOf(c) !== -1) { out.push({ t: c }); i++; continue; }
    if (NUM_CHAR.test(c)) {
      let j = i;
      while (j < s.length && NUM_CHAR.test(s[j])) j++;
      const lex = s.slice(i, j);
      const norm = normalizeNumber(lex);
      if (norm === null) return { err: lex.indexOf(",") !== -1 ? "comma" : "number" };
      out.push({ t: "n", v: parseFloat(norm) });
      i = j;
      continue;
    }
    // Anything else, including the 'e' of 1e5, which must never quietly become 15.
    return { err: "chars" };
  }
  return { tokens: out };
}

/* Recursive descent: expr → term → factor, so * and / bind tighter than + and -
   and unary minus binds tighter still. */
function parseMoneyTokens(tokens) {
  let i = 0, err = null;
  const peek = () => tokens[i];
  const factor = () => {
    const tk = peek();
    if (!tk) { err = "incomplete"; return 0; }
    if (tk.t === "+" || tk.t === "-") { i++; const v = factor(); return tk.t === "-" ? -v : v; }
    if (tk.t === "n") { i++; return tk.v; }
    if (tk.t === "(") {
      i++;
      const v = expr();
      if (err) return 0;
      if (!peek() || peek().t !== ")") { err = "incomplete"; return 0; }
      i++;
      return v;
    }
    err = "incomplete"; return 0;
  };
  const term = () => {
    let v = factor();
    if (err) return 0;
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = tokens[i++].t;
      const r = factor();
      if (err) return 0;
      if (op === "/") { if (r === 0) { err = "zero"; return 0; } v = v / r; }
      else v = v * r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    if (err) return 0;
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = tokens[i++].t;
      const r = term();
      if (err) return 0;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const val = expr();
  if (err) return { err };
  if (i < tokens.length) return { err: "incomplete" }; // trailing junk: "2 3", "1)"
  return { value: val };
}

function parseMoney(raw) {
  if (raw == null) return moneyFail("number");
  const s = String(raw).trim();
  if (s === "") return { ok: true, value: 0 };
  const lexed = tokenizeMoney(s);
  if (lexed.err) return moneyFail(lexed.err);
  const tokens = lexed.tokens;
  if (tokens.length === 0) return moneyFail("number");
  // A plain number is the overwhelmingly common case: no need to walk the grammar.
  if (tokens.length === 1) return tokens[0].t === "n" ? moneyOk(tokens[0].v) : moneyFail("incomplete");
  const out = parseMoneyTokens(tokens);
  return out.err ? moneyFail(out.err) : moneyOk(out.value);
}

/* null for anything unparseable, which is the shape every caller branches on. */
function evalMoney(raw) {
  const r = parseMoney(raw);
  return r.ok ? r.value : null;
}

function isExpr(s) { return /[+\-*/]/.test(String(s).replace(/^\s*-/, "")); }

export { parseMoney, evalMoney, isExpr };
