// Domain coverage — is the declared domain vocabulary actually exercised by
// rules? Flags vocabulary terms and domain entities that no rule references, so
// the model doesn't accumulate unused ceremony or leave core entities unchecked.

import { freeVars } from "../core/expr.mjs";

// Heuristic references: an entity is referenced if a rule clause mentions a
// variable or field path rooted at (a lower-cased form of) its id, or a domain
// function that operates on it.
const ENTITY_HINTS = {
  AccountingPeriod: ["period", "periodOf", "periodClosed", "periodId"],
  JournalEntry: ["entry", "entries", "debitTotal", "creditTotal", "balanced", "isApprovedOrPosted"],
  JournalLine: ["line", "lines"],
  ExternalSyncRecord: ["sync", "success", "externalId", "idempotencyKey"],
};

function clauseTokens(rule) {
  const toks = new Set();
  for (const c of rule.clauses) {
    for (const v of c.freeVars) toks.add(v);
    const walk = (e) => {
      if (e.kind === "call") {
        toks.add(e.op);
        e.args.forEach(walk);
      } else if (e.kind === "ref") {
        e.path.forEach((p) => toks.add(p));
      }
    };
    walk(c.expr);
  }
  return toks;
}

export function computeDomainCoverage(ir) {
  const ruleTokens = ir.rules.map((r) => ({ id: r.id, toks: clauseTokens(r) }));

  const entities = ir.domainTypes.map((t) => {
    const hints = ENTITY_HINTS[t.id] || [t.id.toLowerCase()];
    const byRules = ruleTokens.filter((rt) => hints.some((h) => rt.toks.has(h))).map((rt) => rt.id);
    return { id: t.id, kind: t.irKind, coveredByRules: byRules, covered: byRules.length > 0 };
  });

  // vocabulary term coverage: a term is covered if some entity hint or rule
  // classification touches its concept (best-effort, reported not enforced hard).
  const terms = ir.vocabulary.map((term) => {
    const tail = term.id.split(".").pop();
    const covered = ruleTokens.some((rt) => [...rt.toks].some((tok) => tok.toLowerCase().includes(tail.replace(/-/g, ""))));
    return { id: term.id, covered };
  });

  const uncoveredEntities = entities.filter((e) => !e.covered);
  return {
    ok: uncoveredEntities.length === 0,
    entities,
    terms,
    summary: {
      entities: entities.length,
      coveredEntities: entities.filter((e) => e.covered).length,
      terms: terms.length,
      coveredTerms: terms.filter((t) => t.covered).length,
    },
  };
}
