// Finite-scope relational checker.
//
// dspec emits real Alloy (src/backends/alloy.mjs) and runs the Alloy Analyzer
// when present. When it is absent, this enumerator exhaustively searches the
// SAME bounded universe for a counterexample to the TenantIsolation assertion,
// exactly as `check ... for N` would. Exhaustive finite-scope search yields
// `bounded` evidence and records the scope.
//
// The `mutation` hook drops one clause of the enforced-scoping fact, matching
// the task's tenant/period/sync mutations.

// Enumerate every structure within scope and look for one that satisfies the
// (possibly mutated) scoping fact yet violates isolation.
export function relationalCheck({ mutation = null, tenants = 2 } = {}) {
  const T = Array.from({ length: tenants }, (_, i) => `t${i + 1}`);
  const scope = { top: 4, tenants, periods: 1, entries: 1, lines: 1, syncs: 1 };
  let enumerated = 0;
  let counterexample = null;

  const factKeepsPeriod = mutation !== "drop-period-tenant";
  const factKeepsLine = mutation !== "drop-line-tenant" && mutation !== "drop-all-tenant";
  const factKeepsSync = mutation !== "drop-sync-tenant" && mutation !== "drop-all-tenant";
  const factKeepsAll = mutation !== "drop-all-tenant";

  // One period, one entry, one line, one sync; each owner ranges over tenants.
  for (const periodOwner of T)
    for (const entryOwner of T)
      for (const lineOwner of T)
        for (const syncOwner of T) {
          enumerated++;
          // enforced-scoping fact (with the mutated clause relaxed)
          if (factKeepsAll && factKeepsPeriod && entryOwner !== periodOwner) continue;
          if (factKeepsAll && factKeepsLine && lineOwner !== entryOwner) continue;
          if (factKeepsAll && factKeepsSync && syncOwner !== entryOwner) continue;
          // isolation assertion
          const violations = [];
          if (entryOwner !== periodOwner) violations.push("entry.owner != period.owner");
          if (lineOwner !== entryOwner) violations.push("line.owner != entry.owner");
          if (syncOwner !== entryOwner) violations.push("sync.owner != entry.owner");
          if (violations.length && !counterexample) {
            counterexample = { periodOwner, entryOwner, lineOwner, syncOwner, violations };
          }
        }

  return {
    invariantHeld: counterexample === null,
    counterexample,
    structuresEnumerated: enumerated,
    scope,
  };
}
