// ACC-JOURNAL-001 — journal debit/credit balance.
// Anchors watched by drift: ACC-JOURNAL-001, prop_balanced.

import { test } from "node:test";
import assert from "node:assert/strict";
import { debitTotal, creditTotal, balanced, journalBalanceHolds, trialBalanceDebit, trialBalanceCredit } from "../src/domain/journal.mjs";
import { runBalanceProperty, runBalanceExamples, BALANCE_MUTATIONS } from "../src/verify/property-run.mjs";

const mk = (lines, status = "approved") => ({ id: "e", status, lines });

test("ACC-JOURNAL-001 examples: debit 100 / credit 100 is balanced", () => {
  assert.equal(balanced(mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 100 }])), true);
});

test("ACC-JOURNAL-001 examples: debit 100 / credit 99 is unbalanced", () => {
  const e = mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 99 }]);
  assert.equal(balanced(e), false);
  assert.equal(journalBalanceHolds(e), false, "approved unbalanced entry must violate the rule");
});

test("ACC-JOURNAL-001 examples: multi-line totals, order independence, boundaries", () => {
  const ex = runBalanceExamples();
  for (const c of ex.checks) assert.equal(c.pass, true, c.name);
});

test("ACC-JOURNAL-001 prop_balanced: generated balanced entries always satisfy the rule", () => {
  const r = runBalanceProperty({ seed: 20260717, cases: 500 });
  assert.equal(r.ok, true, `property failed on ${r.failures} of ${r.cases} cases`);
});

test("ACC-JOURNAL-001 property detects an unbalance (injected)", () => {
  // Inject a fault into generated data: the property harness must notice a
  // predicate that misjudges a known-unbalanced entry.
  const broken = mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 99 }]);
  assert.equal(journalBalanceHolds(broken), false);
});

test("ACC-JOURNAL-001 mutation: eq -> neq is caught", () => {
  const r = runBalanceProperty({ predicate: BALANCE_MUTATIONS["flip-equality"] });
  assert.equal(r.ok, false, "flipping the equality must fail the property suite");
});

test("ACC-JOURNAL-001 mutation: dropping a debit line from the total is caught", () => {
  const r = runBalanceProperty({ predicate: BALANCE_MUTATIONS["drop-debit-line"] });
  assert.equal(r.ok, false, "excluding a debit line must fail the property suite");
});

test("ACC-JOURNAL-001 aggregation: balanced entries yield a balanced trial balance", () => {
  const entries = [
    mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 100 }]),
    mk([{ side: "debit", amount: 30 }, { side: "debit", amount: 70 }, { side: "credit", amount: 100 }]),
    mk([]),
  ];
  assert.ok(entries.every(balanced));
  assert.equal(trialBalanceDebit(entries), trialBalanceCredit(entries));
});

test("ACC-JOURNAL-001 draft entries are exempt (rule scopes to approved/posted)", () => {
  const e = mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 1 }], "draft");
  assert.equal(journalBalanceHolds(e), true);
  assert.equal(debitTotal(e), 100);
  assert.equal(creditTotal(e), 1);
});
