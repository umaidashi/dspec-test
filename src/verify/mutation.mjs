// Mutation score runner.
//
// Loads fixtures/mutations/catalog.json and injects each fault into the
// corresponding verification subject. A mutant is CAUGHT when the rule's
// primary verifier fails (property suite fails / counterexample found).
// Surviving mutants mean the verification would not notice that fault class —
// `dspec mutation` exits non-zero in that case, and `mutation-tested` evidence
// is only recorded when the score is 100%.

import { readFileSync } from "node:fs";
import { runBalanceProperty, BALANCE_MUTATIONS } from "./property-run.mjs";
import { periodSystem, syncSystem, modelCheck } from "./model-check.mjs";
import { relationalCheck } from "./relational-check.mjs";
import { normalizePeriodCounterexample, normalizeSyncCounterexample, normalizeTenantCounterexample } from "./counterexample.mjs";

export const CATALOG_PATH = "fixtures/mutations/catalog.json";

function runOne(m) {
  switch (`${m.ruleId}:${m.engine}`) {
    case "ACC-JOURNAL-001:property": {
      const mut = BALANCE_MUTATIONS[m.name];
      if (!mut) return { caught: false, error: `unknown balance mutation ${m.name}` };
      const r = runBalanceProperty({ predicate: mut });
      return { caught: r.ok === false, detail: { failures: r.failures, cases: r.cases } };
    }
    case "ACC-PERIOD-003:model-check": {
      const r = modelCheck(periodSystem({ mutation: m.name }));
      return {
        caught: r.invariantHeld === false,
        counterexample: r.invariantHeld ? null : normalizePeriodCounterexample(r.counterexample),
      };
    }
    case "ACC-TENANT-001:relational-check": {
      const r = relationalCheck({ mutation: m.name });
      return {
        caught: r.invariantHeld === false,
        counterexample: r.invariantHeld ? null : normalizeTenantCounterexample(r.counterexample, r.scope),
      };
    }
    case "ACC-SYNC-001:model-check": {
      const r = modelCheck(syncSystem({ mutation: m.name }));
      return {
        caught: r.invariantHeld === false,
        counterexample: r.invariantHeld ? null : normalizeSyncCounterexample(r.counterexample),
      };
    }
    default:
      return { caught: false, error: `no engine for ${m.ruleId}:${m.engine}` };
  }
}

export function runMutationCatalog(catalogPath = CATALOG_PATH) {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const results = catalog.mutations.map((m) => ({ ...m, ...runOne(m) }));
  const caught = results.filter((r) => r.caught).length;
  return {
    ok: caught === results.length,
    score: results.length ? caught / results.length : 0,
    total: results.length,
    caught,
    results,
  };
}
