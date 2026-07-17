// Minimal parser for the constrained Pkl subset used by dspec domain files.
//
// The real `pkl` binary is the intended evaluator for these files. This parser
// implements the exact subset our authoring format relies on so the toolchain
// is self-contained: `module`, doc/line comments, scalar props, `new { ... }`
// objects, `new Listing { ... }`, `new Mapping { ... }`, and `[key] { ... }`
// mapping entries. Clause expressions are authored as strings and parsed
// separately by src/core/expr.mjs — the Pkl layer never interprets them.
//
// It is deliberately small. Anything outside the subset is a parse error rather
// than being silently mis-evaluated, which keeps `.pkl` authoring honest.

const TOKEN = /\s+|\/\/\/[^\n]*|\/\/[^\n]*|"(?:\\.|[^"\\])*"|-?\d+|[A-Za-z_][A-Za-z0-9_.]*|[{}\[\]=]/y;

function tokenize(src) {
  const tokens = [];
  let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m || m.index !== pos) {
      const around = src.slice(pos, pos + 24).replace(/\n/g, "\\n");
      throw new Error(`pkl: unexpected token near "${around}" at offset ${pos}`);
    }
    const text = m[0];
    pos = TOKEN.lastIndex;
    if (/^\s+$/.test(text) || text.startsWith("//")) continue; // whitespace + comments
    tokens.push(text);
  }
  return tokens;
}

function parseString(tok) {
  return JSON.parse(tok.replace(/\\'/g, "'"));
}

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.i = 0;
  }
  peek(o = 0) {
    return this.t[this.i + o];
  }
  next() {
    return this.t[this.i++];
  }
  expect(v) {
    const got = this.next();
    if (got !== v) throw new Error(`pkl: expected "${v}" but got "${got}"`);
    return got;
  }
  atEnd() {
    return this.i >= this.t.length;
  }

  parseModule() {
    const out = {};
    if (this.peek() === "module") {
      this.next();
      out.__module = this.next();
    }
    while (!this.atEnd()) {
      const name = this.next();
      if (!/^[A-Za-z_]/.test(name)) throw new Error(`pkl: expected property name, got "${name}"`);
      if (this.peek() === "=") {
        this.next();
        out[name] = this.parseValue();
      } else if (this.peek() === "{") {
        out[name] = this.parseObject();
      } else {
        throw new Error(`pkl: expected "=" or "{" after "${name}"`);
      }
    }
    return out;
  }

  parseValue() {
    const tok = this.peek();
    if (tok === "new") {
      this.next();
      const kind = this.peek();
      if (kind === "Listing") {
        this.next();
        return this.parseListing();
      }
      if (kind === "Mapping") {
        this.next();
        return this.parseMapping();
      }
      // `new { ... }` anonymous object
      return this.parseObject();
    }
    if (tok === "{") return this.parseObject();
    if (tok === "true") return this.next(), true;
    if (tok === "false") return this.next(), false;
    if (tok?.startsWith('"')) return parseString(this.next());
    if (/^-?\d+$/.test(tok)) return parseInt(this.next(), 10);
    throw new Error(`pkl: unexpected value token "${tok}"`);
  }

  parseObject() {
    this.expect("{");
    const obj = {};
    while (this.peek() !== "}") {
      if (this.atEnd()) throw new Error("pkl: unterminated object");
      const name = this.next();
      if (!/^[A-Za-z_]/.test(name)) throw new Error(`pkl: expected property in object, got "${name}"`);
      if (this.peek() === "=") {
        this.next();
        obj[name] = this.parseValue();
      } else if (this.peek() === "{") {
        obj[name] = this.parseObject();
      } else if (this.peek() === "new") {
        obj[name] = this.parseValue();
      } else {
        throw new Error(`pkl: expected "=" or "{" after "${name}"`);
      }
    }
    this.expect("}");
    return obj;
  }

  parseListing() {
    this.expect("{");
    const list = [];
    while (this.peek() !== "}") {
      if (this.atEnd()) throw new Error("pkl: unterminated Listing");
      list.push(this.parseValue());
    }
    this.expect("}");
    return list;
  }

  parseMapping() {
    this.expect("{");
    const map = {};
    while (this.peek() !== "}") {
      if (this.atEnd()) throw new Error("pkl: unterminated Mapping");
      this.expect("[");
      const key = parseString(this.next());
      this.expect("]");
      if (this.peek() === "=") {
        this.next();
        map[key] = this.parseValue();
      } else {
        map[key] = this.parseObject();
      }
    }
    this.expect("}");
    return map;
  }
}

export function parsePkl(src) {
  const tokens = tokenize(src);
  return new Parser(tokens).parseModule();
}
