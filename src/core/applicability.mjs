// Backend applicability table.
//
// The central claim of dspec is that a single Core IR expression does NOT mean
// the same thing to every backend. Each operator declares, per backend, how far
// its meaning is preserved:
//
//   semantic   — the backend expresses the operator with its intended meaning
//   structural — the backend can represent the shape but not the full meaning
//   textual    — emitted only as a comment / annotation, not machine-checked
//   unmapped   — the backend cannot represent it; emitting would change meaning
//
// The router refuses to project a rule onto a backend that returns `unmapped`
// or `textual` for an operator the rule depends on. This is what prevents
// "meaning-changing" cross-compilation.

export const BACKENDS = ["lean", "tla", "alloy", "property"];

const TABLE = {
  // logical
  not: { lean: "semantic", tla: "semantic", alloy: "semantic", property: "semantic" },
  and: { lean: "semantic", tla: "semantic", alloy: "semantic", property: "semantic" },
  or: { lean: "semantic", tla: "semantic", alloy: "semantic", property: "semantic" },
  implies: { lean: "semantic", tla: "semantic", alloy: "semantic", property: "semantic" },
  // comparison
  eq: { lean: "semantic", tla: "semantic", alloy: "semantic", property: "semantic" },
  neq: { lean: "semantic", tla: "semantic", alloy: "semantic", property: "semantic" },
  gt: { lean: "semantic", tla: "semantic", alloy: "structural", property: "semantic" },
  gte: { lean: "semantic", tla: "semantic", alloy: "structural", property: "semantic" },
  lt: { lean: "semantic", tla: "semantic", alloy: "structural", property: "semantic" },
  lte: { lean: "semantic", tla: "semantic", alloy: "structural", property: "semantic" },
  // arithmetic
  add: { lean: "semantic", tla: "semantic", alloy: "unmapped", property: "semantic" },
  sub: { lean: "semantic", tla: "semantic", alloy: "unmapped", property: "semantic" },
  sum: { lean: "semantic", tla: "structural", alloy: "unmapped", property: "semantic" },
  // quantifiers
  forall: { lean: "semantic", tla: "structural", alloy: "semantic", property: "structural" },
  exists: { lean: "semantic", tla: "structural", alloy: "semantic", property: "structural" },
};

// Domain function applications are opaque; they are semantic wherever their
// defining operators are, and default to structural where a backend only sees
// them as uninterpreted symbols.
const DOMAIN_FN_DEFAULT = { lean: "semantic", tla: "structural", alloy: "structural", property: "semantic" };

export function operatorApplicability(op) {
  return TABLE[op] || DOMAIN_FN_DEFAULT;
}

export function applicabilityFor(op, backend) {
  return operatorApplicability(op)[backend] || "unmapped";
}

// Collect the applicability of every operator used in an expression, for a
// given backend. Returns the worst (least-preserving) level found plus the map.
const RANK = { unmapped: 0, textual: 1, structural: 2, semantic: 3 };

export function exprApplicability(expr, backend) {
  const perOp = {};
  let worst = "semantic";
  const walk = (n) => {
    if (n.kind === "call") {
      const lvl = applicabilityFor(n.op, backend);
      perOp[n.op] = lvl;
      if (RANK[lvl] < RANK[worst]) worst = lvl;
      n.args.forEach(walk);
    }
  };
  walk(expr);
  return { worst, perOp };
}

// Is `backend` able to carry `expr` with meaning intact (semantic/structural)?
export function backendSupports(expr, backend, { allowStructural = true } = {}) {
  const { worst } = exprApplicability(expr, backend);
  if (worst === "unmapped" || worst === "textual") return false;
  if (worst === "structural" && !allowStructural) return false;
  return true;
}
