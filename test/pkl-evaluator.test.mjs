// Real-Pkl ↔ subset-parser consistency.
//
// When the real Pkl evaluator is installed (devDependency @pkl-community/pkl),
// it becomes authoritative for loading models. These tests pin the contract
// that makes that switch safe: both evaluators must produce byte-identical
// canonical model digests, so evidence recorded under one stays valid under
// the other. Skipped when the pkl binary is unavailable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { findPklBinary, loadModel } from "../src/core/loader.mjs";
import { parsePkl } from "../src/core/pkl.mjs";
import { digest } from "../src/core/digest.mjs";

const PKL = findPklBinary();
const MODELS = [
  "examples/accounting-core.pkl",
  "fixtures/uncovered-clause.pkl",
  "fixtures/missing-anchor.pkl",
  "fixtures/proved-without-proof.pkl",
  "fixtures/bounded-without-model-check.pkl",
  "fixtures/unmapped-strong-assurance.pkl",
];

test("all dspec .pkl files evaluate under the real Pkl evaluator", { skip: !PKL }, () => {
  for (const f of [...MODELS, "dspec/Schema.pkl", "dspec/domains/Accounting.pkl"]) {
    execFileSync(PKL, ["eval", f], { stdio: "ignore" }); // throws on type error
  }
});

test("real pkl and subset parser produce identical model digests", { skip: !PKL }, () => {
  for (const f of MODELS) {
    const viaPkl = JSON.parse(execFileSync(PKL, ["eval", "-f", "json", f], { encoding: "utf8" }));
    const viaSubset = parsePkl(readFileSync(f, "utf8"));
    delete viaSubset.__module;
    assert.equal(digest(viaPkl), digest(viaSubset), `evaluator divergence on ${f}`);
  }
});

test("loadModel reports which evaluator was used", () => {
  const { evaluator, errors } = loadModel("examples/accounting-core.pkl");
  assert.equal(errors.length, 0);
  assert.equal(evaluator, PKL ? "pkl" : "subset-parser");
});

test("real pkl rejects an invalid .pkl file instead of falling back", { skip: !PKL }, () => {
  // A file that the real evaluator must reject (unclosed brace).
  const dir = "/tmp/dspec-pkltest";
  mkdirSync(dir, { recursive: true });
  const bad = `${dir}/bad.pkl`;
  writeFileSync(bad, 'id = "x"\nterms = new Listing {\n');
  try {
    const { errors } = loadModel(bad);
    assert.ok(errors.length > 0, "invalid pkl must produce errors");
    assert.match(errors[0], /pkl eval failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

