// Rule classification, primary verification strategy, and assurance levels.
//
// Each rule carries exactly one classification and one primary strategy. The
// mapping below is the routing policy: it decides which backend "owns" a rule
// so the same rule is NOT redundantly projected onto every backend.

export const CLASSIFICATIONS = [
  "pure-invariant",
  "numeric-invariant",
  "relational-invariant",
  "state-transition",
  "temporal-property",
  "authorization-policy",
  "runtime-obligation",
];

export const STRATEGIES = [
  "lean",
  "tla",
  "alloy",
  "property-test",
  "implementation-test",
  "runtime-evidence",
];

// Default primary strategy per classification. A rule may override this, but the
// override must still satisfy backend applicability for its clauses.
export const PRIMARY_BY_CLASS = {
  "pure-invariant": "lean",
  "numeric-invariant": "lean",
  "relational-invariant": "alloy",
  "state-transition": "tla",
  "temporal-property": "tla",
  "authorization-policy": "alloy",
  "runtime-obligation": "runtime-evidence",
};

// Which backend a strategy runs on (for applicability checks). property-test and
// implementation-test both exercise the JS "property" backend semantics.
export const STRATEGY_BACKEND = {
  lean: "lean",
  tla: "tla",
  alloy: "alloy",
  "property-test": "property",
  "implementation-test": "property",
  "runtime-evidence": null,
};

// Assurance ladder, weakest → strongest. Each level names a distinct epistemic
// claim; the toolchain refuses to let a weaker activity satisfy a stronger
// requirement.
export const ASSURANCE = ["reference", "executed", "mutation-tested", "bounded", "proved"];
export const ASSURANCE_RANK = Object.fromEntries(ASSURANCE.map((a, i) => [a, i]));

// What kind of evidence legitimately establishes each assurance level.
export const ASSURANCE_EVIDENCE_KIND = {
  reference: ["source-link"],            // spec points at an implementation/test anchor
  executed: ["test-run", "property-run"], // a check actually ran and passed
  "mutation-tested": ["mutation-run"],    // injected faults were caught
  bounded: ["model-check", "relational-check"], // finite-scope exhaustive check
  proved: ["proof", "decision-procedure"], // machine-checked proof
};

export function primaryStrategy(rule) {
  return rule.primaryStrategy || PRIMARY_BY_CLASS[rule.classification];
}
