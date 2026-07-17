// Clause expression language.
//
// Clauses in .pkl are authored as compact function-call strings, e.g.
//   implies(isApprovedOrPosted(entry), eq(debitTotal(entry), creditTotal(entry)))
// This module parses that surface syntax into a normalized expression AST used
// by the Core IR and every backend emitter. Keeping clause expressions out of
// the Pkl object layer means the AST has a single, well-defined shape.
//
// AST node kinds:
//   { kind: "call", op, args: [expr...] }   logical / arithmetic / quantifier ops
//   { kind: "ref",  path: [seg...] }        variable or field access (entry.tenantId)
//   { kind: "lit",  value }                 integer or string literal

export const LOGICAL = new Set(["not", "and", "or", "implies"]);
export const COMPARISON = new Set(["eq", "neq", "gt", "gte", "lt", "lte"]);
export const ARITHMETIC = new Set(["add", "sub", "sum"]);
export const QUANTIFIER = new Set(["forall", "exists"]);
// Domain functions the expression layer recognizes as opaque applications.
export const DOMAIN_FN = new Set([
  "debitTotal", "creditTotal", "isApprovedOrPosted", "periodClosed", "periodOf",
  "create", "update", "delete", "success", "balanced",
]);

const T = /\s+|[A-Za-z_][A-Za-z0-9_]*|"(?:\\.|[^"\\])*"|-?\d+|[(),.]/y;

function lex(src) {
  const out = [];
  let pos = 0;
  while (pos < src.length) {
    T.lastIndex = pos;
    const m = T.exec(src);
    if (!m || m.index !== pos) throw new Error(`expr: bad token near "${src.slice(pos, pos + 16)}"`);
    pos = T.lastIndex;
    if (/^\s+$/.test(m[0])) continue;
    out.push(m[0]);
  }
  return out;
}

class EParser {
  constructor(toks) {
    this.t = toks;
    this.i = 0;
  }
  peek() {
    return this.t[this.i];
  }
  next() {
    return this.t[this.i++];
  }
  parse() {
    const e = this.expr();
    if (this.i !== this.t.length) throw new Error(`expr: trailing tokens after ${JSON.stringify(e)}`);
    return e;
  }
  expr() {
    const tok = this.next();
    if (tok === undefined) throw new Error("expr: unexpected end");
    if (/^-?\d+$/.test(tok)) return { kind: "lit", value: parseInt(tok, 10) };
    if (tok.startsWith('"')) return { kind: "lit", value: JSON.parse(tok) };
    if (!/^[A-Za-z_]/.test(tok)) throw new Error(`expr: unexpected "${tok}"`);
    // identifier — maybe a call, maybe a dotted ref
    if (this.peek() === "(") {
      this.next();
      const args = [];
      if (this.peek() !== ")") {
        args.push(this.expr());
        while (this.peek() === ",") {
          this.next();
          args.push(this.expr());
        }
      }
      if (this.next() !== ")") throw new Error(`expr: missing ) in call ${tok}`);
      return { kind: "call", op: tok, args };
    }
    // dotted reference path
    const path = [tok];
    while (this.peek() === ".") {
      this.next();
      const seg = this.next();
      if (!/^[A-Za-z_]/.test(seg || "")) throw new Error(`expr: bad field after "."`);
      path.push(seg);
    }
    return { kind: "ref", path };
  }
}

export function parseExpr(src) {
  return new EParser(lex(src)).parse();
}

// Human-readable, stable rendering (used in reports and digests).
export function renderExpr(e) {
  switch (e.kind) {
    case "lit":
      return typeof e.value === "string" ? JSON.stringify(e.value) : String(e.value);
    case "ref":
      return e.path.join(".");
    case "call":
      return `${e.op}(${e.args.map(renderExpr).join(", ")})`;
    default:
      throw new Error(`expr: cannot render ${JSON.stringify(e)}`);
  }
}

// Free variables referenced by an expression (first path segment), excluding
// quantifier-bound names.
export function freeVars(e, bound = new Set()) {
  const acc = new Set();
  const walk = (node, b) => {
    if (node.kind === "ref") {
      if (!b.has(node.path[0])) acc.add(node.path[0]);
      return;
    }
    if (node.kind === "call") {
      if (QUANTIFIER.has(node.op)) {
        const [v, domain, body] = node.args;
        walk(domain, b);
        const nb = new Set(b);
        if (v.kind === "ref") nb.add(v.path[0]);
        walk(body, nb);
        return;
      }
      node.args.forEach((a) => walk(a, b));
    }
  };
  walk(e, bound);
  return acc;
}
