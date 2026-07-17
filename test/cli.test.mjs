// CLI + drift / coverage / evidence failure-mode tests.
//
// Positive paths: check / drift / coverage / render / emit / verify-generated /
// evidence on examples/accounting-core.pkl all succeed.
// Negative paths (each REQUIRED by the spec of dspec itself):
//   - deleting a test anchor breaks drift
//   - renaming the Lean theorem / TLA+ invariant / Alloy assertion breaks drift
//   - removing check targets from an approved rule breaks coverage
//   - requiring `proved` without proof evidence breaks coverage
//   - requiring `bounded` without model-check evidence breaks coverage
//   - requiring strong assurance on an unmapped backend is rejected
//   - changing the model / generated artifacts makes stored evidence stale

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "examples/accounting-core.pkl";
const CLI = "src/cli.mjs";

function run(args, opts = {}) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8", ...opts });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: (e.stdout || "") + (e.stderr || "") };
  }
}

// Snapshot generated artifacts so mutation of them can be restored.
const GENERATED = [
  "generated/lean/AccountingJournal.lean",
  "generated/accounting/AccountingPeriod.tla",
  "generated/accounting/ExternalSync.tla",
  "generated/alloy/AccountingTenant.als",
];
const snapshots = new Map();

before(() => {
  // ensure artifacts + evidence exist and are fresh
  const g = run(["generate", MODEL]);
  assert.equal(g.code, 0, g.stdout);
  for (const p of GENERATED) snapshots.set(p, readFileSync(p, "utf8"));
});

after(() => {
  for (const [p, text] of snapshots) writeFileSync(p, text);
});

const restore = (p) => writeFileSync(p, snapshots.get(p));

// ---------- positive paths ----------

test("check passes on the accounting model", () => {
  const r = run(["check", MODEL]);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /ACC-JOURNAL-001.*proved/);
  assert.match(r.stdout, /ACC-PERIOD-003.*bounded/);
  assert.match(r.stdout, /ACC-TENANT-001.*bounded/);
  assert.match(r.stdout, /ACC-SYNC-001.*bounded/);
});

test("drift passes on the accounting model", () => {
  assert.equal(run(["drift", MODEL]).code, 0);
});

test("coverage passes on the accounting model", () => {
  assert.equal(run(["coverage", MODEL]).code, 0);
});

test("domain-coverage passes and covers all four entities", () => {
  const r = run(["domain-coverage", MODEL]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /entities: 4\/4/);
});

test("render produces ja and en markdown", () => {
  assert.equal(run(["render", "--locale", "ja", MODEL]).code, 0);
  assert.equal(run(["render", "--locale", "en", MODEL]).code, 0);
  const ja = readFileSync("generated/examples/ja/accounting-core.md", "utf8");
  const en = readFileSync("generated/examples/en/accounting-core.md", "utf8");
  assert.match(ja, /仕訳の貸借一致/);
  assert.match(ja, /証明\/検査されない範囲/);
  assert.match(en, /Journal debit\/credit balance/);
  assert.match(en, /What is NOT proved \/ checked/);
});

test("verify-generated --json passes on fresh artifacts", () => {
  const r = run(["verify-generated", "--json", MODEL]);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
});

test("generated check passes on fresh artifacts", () => {
  assert.equal(run(["generated", "check", MODEL]).code, 0);
});

test("mutation catalog: every mutant is caught", () => {
  const r = run(["mutation", "--json"]);
  assert.equal(r.code, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.score, 1);
  assert.equal(parsed.total, 12);
});

test("evidence create + verify round-trips", () => {
  assert.equal(run(["evidence", "create", MODEL]).code, 0);
  assert.equal(run(["evidence", "verify", MODEL]).code, 0);
});

test("source map is bidirectional for all four rules", async () => {
  const sm = JSON.parse(readFileSync("generated/accounting/source-map.json", "utf8"));
  const { findByGeneratedSelector, findByClause } = await import("../src/backends/sourceMap.mjs");
  for (const [sel, ruleId] of [
    ["trial_balance_preserved", "ACC-JOURNAL-001"],
    ["ClosedPeriodImmutable", "ACC-PERIOD-003"],
    ["TenantIsolation", "ACC-TENANT-001"],
    ["IdempotentExternalSync", "ACC-SYNC-001"],
  ]) {
    const hit = findByGeneratedSelector(sm, sel);
    assert.ok(hit, `generated selector ${sel} must map back to a rule`);
    assert.equal(hit.ruleId, ruleId);
    const clause = findByClause(sm, ruleId, hit.clause);
    assert.ok(clause, "clause lookup must succeed");
    assert.ok(clause.coreIRNode.startsWith(`clause:${ruleId}#`));
  }
  // implementation references reachable from each rule
  for (const r of sm.rules) assert.ok(r.implementationRefs.length > 0, `${r.ruleId} has impl refs`);
});

test("counterexample normalization matches the report fixtures' shape", async () => {
  const { periodSystem, syncSystem, modelCheck } = await import("../src/verify/model-check.mjs");
  const { normalizePeriodCounterexample, normalizeSyncCounterexample } = await import("../src/verify/counterexample.mjs");
  const expectedPeriod = JSON.parse(readFileSync("fixtures/reports/period-counterexample.json", "utf8"));
  const pr = modelCheck(periodSystem({ mutation: "allow-update" }));
  const pce = normalizePeriodCounterexample(pr.counterexample);
  for (const k of ["ruleId", "selector", "backend", "generatedSelector", "assurance", "message"]) {
    assert.equal(pce[k], expectedPeriod[k], `period counterexample field ${k}`);
  }
  assert.ok(Array.isArray(pce.trace) && pce.trace.includes("ClosePeriod"));

  const expectedSync = JSON.parse(readFileSync("fixtures/reports/sync-counterexample.json", "utf8"));
  const sr = modelCheck(syncSystem({ mutation: "drop-guard" }));
  const sce = normalizeSyncCounterexample(sr.counterexample);
  for (const k of ["ruleId", "selector", "backend", "generatedSelector", "message"]) {
    assert.equal(sce[k], expectedSync[k], `sync counterexample field ${k}`);
  }
});

// ---------- drift failure modes ----------

test("drift fails when a referenced test anchor is deleted", () => {
  const r = run(["drift", "fixtures/missing-anchor.pkl"]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /missing-anchor|THIS-ANCHOR-DOES-NOT-EXIST/);
});

test("drift fails when the Lean theorem is renamed", () => {
  const p = "generated/lean/AccountingJournal.lean";
  writeFileSync(p, snapshots.get(p).replaceAll("trial_balance_preserved", "trial_balance_renamed"));
  try {
    const r = run(["drift", MODEL]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /trial_balance_preserved/);
  } finally {
    restore(p);
  }
});

test("drift fails when the TLA+ invariant is renamed", () => {
  const p = "generated/accounting/AccountingPeriod.tla";
  writeFileSync(p, snapshots.get(p).replaceAll("ClosedPeriodImmutable", "ClosedPeriodMutable"));
  try {
    const r = run(["drift", MODEL]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ClosedPeriodImmutable/);
  } finally {
    restore(p);
  }
});

test("drift fails when the Alloy assertion is renamed", () => {
  const p = "generated/alloy/AccountingTenant.als";
  writeFileSync(p, snapshots.get(p).replaceAll("TenantIsolation", "TenantMixing"));
  try {
    const r = run(["drift", MODEL]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /TenantIsolation/);
  } finally {
    restore(p);
  }
});

// ---------- coverage failure modes ----------

test("coverage fails when check targets are removed from an approved rule", () => {
  const r = run(["coverage", "--json", "fixtures/uncovered-clause.pkl"]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /uncovered-clause|missing-assurance/);
});

test("coverage fails when `proved` is required without proof evidence", () => {
  const r = run(["coverage", "--json", "fixtures/proved-without-proof.pkl"]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /"assurance": "proved"/);
});

test("coverage fails when `bounded` is required without model-check evidence", () => {
  const r = run(["coverage", "--json", "fixtures/bounded-without-model-check.pkl"]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /"assurance": "bounded"/);
});

test("strong assurance on an unmapped backend is rejected by check and coverage", () => {
  const c = run(["check", "fixtures/unmapped-strong-assurance.pkl"]);
  assert.equal(c.code, 1, "check must reject unmapped routing");
  assert.match(c.stdout, /unmapped/);
  const cov = run(["coverage", "--json", "fixtures/unmapped-strong-assurance.pkl"]);
  assert.equal(cov.code, 1);
  assert.match(cov.stdout, /over-claim|missing-assurance/);
});

// ---------- verify-generated / evidence failure modes ----------

test("verify-generated fails when a generated artifact is hand-edited", () => {
  const p = "generated/accounting/ExternalSync.tla";
  writeFileSync(p, snapshots.get(p) + "\n\\* sneaky edit\n");
  try {
    const r = run(["verify-generated", "--json", MODEL]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /modified/);
  } finally {
    restore(p);
  }
});

test("evidence verify fails after the Pkl model changes (rule/clause/IR digests)", () => {
  // stored evidence was created for MODEL; verifying against a modified copy
  // of the model must report staleness.
  assert.equal(run(["evidence", "create", MODEL]).code, 0);
  const dir = join(tmpdir(), "dspec-evtest");
  mkdirSync(dir, { recursive: true });
  const modified = readFileSync(MODEL, "utf8").replace(
    'ast = "implies(isApprovedOrPosted(entry), eq(debitTotal(entry), creditTotal(entry)))"',
    'ast = "implies(isApprovedOrPosted(entry), eq(creditTotal(entry), debitTotal(entry)))"',
  );
  assert.notEqual(modified, readFileSync(MODEL, "utf8"), "fixture replacement must apply");
  const tmpModel = join(dir, "accounting-core-modified.pkl");
  writeFileSync(tmpModel, modified);
  try {
    const r = run(["evidence", "verify", "--json", tmpModel]);
    assert.equal(r.code, 1, "clause AST change must invalidate stored evidence");
    assert.match(r.stdout, /stale/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evidence verify fails when a generated artifact on disk is modified", () => {
  assert.equal(run(["evidence", "create", MODEL]).code, 0);
  const p = "generated/lean/AccountingJournal.lean";
  writeFileSync(p, snapshots.get(p) + "\n-- drifted\n");
  try {
    const r = run(["evidence", "verify", "--json", MODEL]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /artifact-modified/);
  } finally {
    restore(p);
  }
});

test("check fails on an unparseable clause expression", () => {
  const dir = join(tmpdir(), "dspec-badclause");
  mkdirSync(dir, { recursive: true });
  const bad = readFileSync("fixtures/uncovered-clause.pkl", "utf8").replace(
    'ast = "eq(debitTotal(entry), creditTotal(entry))"',
    'ast = "eq(debitTotal(entry), "',
  );
  const tmpModel = join(dir, "bad.pkl");
  writeFileSync(tmpModel, bad);
  try {
    const r = run(["check", tmpModel]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /unparseable|type error/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// keep cpSync referenced to avoid lint noise if unused later
void cpSync;
