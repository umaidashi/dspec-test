// Property-test runner for ACC-JOURNAL-001.
//
// A small deterministic (seeded) generator — no external QuickCheck dependency,
// no Math.random — so runs are reproducible and produce `executed` evidence.
// The same harness supports mutation: a mutated balance predicate must FAIL at
// least one generated case, which yields `mutation-tested` evidence.

import { debitTotal, creditTotal, isApprovedOrPosted, balanced, journalBalanceHolds } from "../domain/journal.mjs";

// Mulberry32 PRNG — deterministic given a seed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = ["draft", "submitted", "approved", "posted"];

// Generate a random *balanced* entry: split a total across debit/credit lines.
function genBalancedEntry(r) {
  const nPairs = 1 + Math.floor(r() * 4);
  const lines = [];
  let id = 0;
  for (let i = 0; i < nPairs; i++) {
    const amt = Math.floor(r() * 1_000_000);
    lines.push({ id: `l${id++}`, side: "debit", amount: amt });
    lines.push({ id: `l${id++}`, side: "credit", amount: amt });
  }
  const status = STATUSES[Math.floor(r() * STATUSES.length)];
  return { id: "e", status, lines: shuffle(lines, r) };
}

function shuffle(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The property, parameterized by a balance predicate so mutations can be tested.
function balanceProperty(entry, holds) {
  // For approved/posted entries the predicate must hold; else vacuously true.
  return !isApprovedOrPosted(entry) || holds(entry);
}

// Run the generative property suite. Returns { ok, cases, failures }.
export function runBalanceProperty({ seed = 20260717, cases = 500, predicate = balanced } = {}) {
  const r = rng(seed);
  const holds = (e) => predicate(e) === true;
  let failures = 0;
  const witnesses = [];
  for (let i = 0; i < cases; i++) {
    const entry = genBalancedEntry(r);
    // force approved/posted for half so the property is non-vacuous
    if (i % 2 === 0) entry.status = "approved";
    if (!balanceProperty(entry, holds)) {
      failures++;
      if (witnesses.length < 3) witnesses.push({ debit: debitTotal(entry), credit: creditTotal(entry), status: entry.status });
    }
  }
  return { ok: failures === 0, cases, failures, witnesses };
}

// Concrete example-based checks the task enumerates.
export function runBalanceExamples() {
  const mk = (lines, status = "approved") => ({ id: "e", status, lines });
  const checks = [
    { name: "debit100/credit100 balanced", pass: balanced(mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 100 }])) === true },
    { name: "debit100/credit99 unbalanced", pass: balanced(mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 99 }])) === false },
    { name: "multi-line sum matches", pass: balanced(mk([{ side: "debit", amount: 30 }, { side: "debit", amount: 70 }, { side: "credit", amount: 100 }])) === true },
    { name: "order independence", pass: balanced(mk([{ side: "credit", amount: 100 }, { side: "debit", amount: 100 }])) === balanced(mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 100 }])) },
    { name: "adding equal debit+credit preserves", pass: balanced(mk([{ side: "debit", amount: 100 }, { side: "credit", amount: 100 }, { side: "debit", amount: 5 }, { side: "credit", amount: 5 }])) === true },
    { name: "zero lines balanced (vacuous approved)", pass: journalBalanceHolds(mk([])) === true },
    { name: "single pair", pass: balanced(mk([{ side: "debit", amount: 1 }, { side: "credit", amount: 1 }])) === true },
    { name: "large amounts", pass: balanced(mk([{ side: "debit", amount: 999999999 }, { side: "credit", amount: 999999999 }])) === true },
    { name: "boundary zero", pass: balanced(mk([{ side: "debit", amount: 0 }, { side: "credit", amount: 0 }])) === true },
  ];
  return { ok: checks.every((c) => c.pass), checks };
}

// Mutations of the balance predicate, per the task's mutation catalog.
export const BALANCE_MUTATIONS = {
  // debitTotal == creditTotal  ->  !=
  "flip-equality": (e) => debitTotal(e) !== creditTotal(e),
  // drop one debit line from the total (exclude the first debit line)
  "drop-debit-line": (e) => {
    let seenDebit = false;
    const d = e.lines.filter((l) => {
      if (l.side === "debit" && !seenDebit) {
        seenDebit = true;
        return false;
      }
      return l.side === "debit";
    }).reduce((a, l) => a + l.amount, 0);
    return d === creditTotal(e);
  },
};
