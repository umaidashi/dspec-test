#!/usr/bin/env node
// dspec CLI.
//
//   check           validate a .pkl model + Core IR routing + assurance runs
//   drift           detect spec ↔ implementation / generated-artifact drift
//   coverage        required-assurance coverage per rule
//   domain-coverage vocabulary / entity coverage by rules
//   render          bilingual review Markdown (--locale ja|en)
//   emit <backend>  lean | tla | alloy | source-map | all → write generated/
//   generate        emit all backends + source map + evidence
//   generated       `generated check` re-verifies generated artifacts on disk
//   verify-generated (--json) same as `generated check`, JSON-friendly
//   evidence        create | verify | refresh stored evidence
//   applicability   print operator×backend applicability for each clause

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { loadModel, loadModelOrThrow } from "./core/loader.mjs";
import { toCoreIR } from "./core/ir.mjs";
import { emitAll } from "./backends/index.mjs";
import { buildSourceMap } from "./backends/sourceMap.mjs";
import { detectDrift } from "./report/drift.mjs";
import { computeCoverage } from "./report/coverage.mjs";
import { computeDomainCoverage } from "./report/domainCoverage.mjs";
import { renderMarkdown } from "./report/render.mjs";
import { createEvidence, verifyEvidence, EVIDENCE_FILE } from "./evidence/evidence.mjs";
import { runAllAssurance } from "./verify/run.mjs";
import { digestText } from "./core/digest.mjs";

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}

function load(path) {
  const { model, modelDigest, source } = loadModelOrThrow(path);
  const ir = toCoreIR(model);
  return { model, modelDigest, ir, source };
}

function j(x) {
  return JSON.stringify(x, null, 2);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const pos = args.filter((a) => !a.startsWith("--") && !(args[args.indexOf(a) - 1] === "--locale"));
const locale = args.includes("--locale") ? args[args.indexOf("--locale") + 1] : "ja";
const cmd = pos[0];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

try {
  switch (cmd) {
    case "check": {
      const path = pos[1] || fail("usage: dspec check <model.pkl>");
      const { model, errors, evaluator } = loadModel(path);
      console.log(`evaluator: ${evaluator === "pkl" ? "pkl (real)" : "dspec subset parser"}`);
      if (errors.length) {
        console.error(`✗ ${errors.length} type error(s):`);
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }
      const ir = toCoreIR(model);
      const badRouting = ir.rules.filter((r) => !r.routing.ok);
      if (badRouting.length) {
        console.error("✗ routing errors:");
        for (const r of badRouting) console.error(`  - ${r.id}: ${r.routing.reason}`);
        process.exit(1);
      }
      const artifacts = emitAll(ir);
      const assurance = runAllAssurance(ir, artifacts);
      let ok = true;
      for (const rule of ir.rules) {
        const results = assurance[rule.id];
        const failures = results.filter((r) => r.result !== "pass");
        const achieved = [...new Set(results.filter((r) => r.result === "pass").map((r) => r.assuranceKind))];
        const line = `${failures.length ? "✗" : "✓"} ${rule.id} [${rule.classification} → ${rule.primaryStrategy}] achieved: ${achieved.join(", ")}`;
        console.log(line);
        for (const f of failures) {
          ok = false;
          console.error(`    ✗ ${f.assuranceKind} (${f.evidenceKind}) failed`);
          if (f.counterexample) console.error(`      ${j(f.counterexample)}`);
        }
      }
      console.log(ok ? `✓ check passed: ${ir.rules.length} rules, Core IR ${ir.digest}` : "✗ check failed");
      process.exit(ok ? 0 : 1);
    }

    case "drift": {
      const path = pos[1] || fail("usage: dspec drift <model.pkl>");
      const { ir } = load(path);
      const res = detectDrift(ir);
      if (flags.has("--json")) console.log(j(res));
      else {
        for (const f of res.findings) console.error(`✗ drift: ${j(f)}`);
        console.log(res.ok ? "✓ no drift" : `✗ ${res.findings.length} drift finding(s)`);
      }
      process.exit(res.ok ? 0 : 1);
    }

    case "coverage": {
      const path = pos[1] || fail("usage: dspec coverage <model.pkl>");
      const { ir } = load(path);
      const res = computeCoverage(ir, emitAll(ir));
      if (flags.has("--json")) console.log(j(res));
      else {
        for (const r of res.rules) {
          console.log(`${r.ok ? "✓" : "✗"} ${r.ruleId} required: [${r.requiredAssurances}] achieved: [${r.achieved}]`);
          for (const p of r.problems) console.error(`    ✗ ${j(p)}`);
        }
        console.log(res.ok ? "✓ coverage ok" : "✗ coverage failed");
      }
      process.exit(res.ok ? 0 : 1);
    }

    case "domain-coverage": {
      const path = pos[1] || fail("usage: dspec domain-coverage <model.pkl>");
      const { ir } = load(path);
      const res = computeDomainCoverage(ir);
      if (flags.has("--json")) console.log(j(res));
      else {
        console.log(`entities: ${res.summary.coveredEntities}/${res.summary.entities} covered, terms: ${res.summary.coveredTerms}/${res.summary.terms} referenced`);
        for (const e of res.entities) console.log(`  ${e.covered ? "✓" : "✗"} ${e.id} ← ${e.coveredByRules.join(", ") || "(none)"}`);
      }
      process.exit(res.ok ? 0 : 1);
    }

    case "render": {
      const path = pos[1] || fail("usage: dspec render --locale ja|en <model.pkl>");
      const { ir } = load(path);
      const md = renderMarkdown(ir, emitAll(ir), locale);
      const out = `generated/examples/${locale}/${ir.model.id}.md`;
      write(out, md);
      break;
    }

    case "emit": {
      const backend = pos[1];
      const path = pos[2] || fail("usage: dspec emit <lean|tla|alloy|source-map|all> <model.pkl>");
      const { ir, modelDigest } = load(path);
      const artifacts = emitAll(ir);
      const wanted = backend === "all" ? artifacts : artifacts.filter((a) => a.backend === backend);
      if (backend === "source-map" || backend === "all") {
        const sm = buildSourceMap(ir, artifacts);
        write("generated/accounting/source-map.json", j(sm));
        if (backend === "source-map") break;
      }
      if (!wanted.length && backend !== "source-map") fail(`no artifacts for backend "${backend}"`);
      for (const a of wanted) {
        write(a.path, a.text);
        if (a.cfg) write(a.cfgPath, a.cfg);
      }
      void modelDigest;
      break;
    }

    case "generate": {
      const path = pos[1] || fail("usage: dspec generate <model.pkl>");
      const { ir, modelDigest } = load(path);
      const artifacts = emitAll(ir);
      for (const a of artifacts) {
        write(a.path, a.text);
        if (a.cfg) write(a.cfgPath, a.cfg);
      }
      const sm = buildSourceMap(ir, artifacts);
      write("generated/accounting/source-map.json", j(sm));
      const ev = createEvidence({ ir, artifacts, sourceMap: sm, modelDigest });
      write(EVIDENCE_FILE, j(ev));
      console.log(`✓ generated ${artifacts.length} artifacts, source map, ${ev.length} evidence records`);
      break;
    }

    case "generated": {
      if (pos[1] !== "check") fail("usage: dspec generated check <model.pkl>");
      const path = pos[2] || fail("usage: dspec generated check <model.pkl>");
      verifyGenerated(path, false);
      break;
    }

    case "verify-generated": {
      const path = pos[1] || fail("usage: dspec verify-generated [--json] <model.pkl>");
      verifyGenerated(path, flags.has("--json"));
      break;
    }

    case "evidence": {
      const sub = pos[1];
      const path = pos[2] || fail("usage: dspec evidence <create|verify|refresh> <model.pkl>");
      const { ir, modelDigest } = load(path);
      const artifacts = emitAll(ir);
      const sm = buildSourceMap(ir, artifacts);
      if (sub === "create" || sub === "refresh") {
        const ev = createEvidence({ ir, artifacts, sourceMap: sm, modelDigest });
        write(EVIDENCE_FILE, j(ev));
        console.log(`✓ ${sub}: ${ev.length} evidence records`);
      } else if (sub === "verify") {
        if (!existsSync(EVIDENCE_FILE)) fail(`no stored evidence at ${EVIDENCE_FILE}; run \`evidence create\` first`);
        const stored = JSON.parse(readFileSync(EVIDENCE_FILE, "utf8"));
        const res = verifyEvidence({ stored, ir, artifacts, sourceMap: sm, modelDigest });
        if (flags.has("--json")) console.log(j({ ok: res.ok, findings: res.findings }));
        else {
          for (const f of res.findings) {
            if (f.status !== "current") console.error(`✗ ${f.ruleId} ${f.evidenceId}: ${f.status}${f.changed ? " (" + f.changed.join(", ") + ")" : ""}`);
          }
          console.log(res.ok ? `✓ ${res.findings.length} evidence records current` : "✗ stale evidence detected");
        }
        process.exit(res.ok ? 0 : 1);
      } else fail("usage: dspec evidence <create|verify|refresh> <model.pkl>");
      break;
    }

    case "mutation": {
      const { runMutationCatalog } = await import("./verify/mutation.mjs");
      const res = runMutationCatalog();
      if (flags.has("--json")) console.log(j(res));
      else {
        for (const r of res.results) {
          console.log(`${r.caught ? "✓ caught " : "✗ SURVIVED"} ${r.ruleId} ${r.name} (${r.engine}) — ${r.fault}`);
        }
        console.log(`mutation score: ${res.caught}/${res.total}`);
      }
      process.exit(res.ok ? 0 : 1);
    }

    case "applicability": {
      const path = pos[1] || fail("usage: dspec applicability <model.pkl>");
      const { ir } = load(path);
      const rows = [];
      for (const r of ir.rules)
        for (const c of r.clauses)
          rows.push({ rule: r.id, clause: c.selector, applicability: Object.fromEntries(Object.entries(c.applicability).map(([b, a]) => [b, a.worst])) });
      console.log(j(rows));
      break;
    }

    default:
      console.log(`dspec — Pkl domain specs routed to Lean / TLA+ / Alloy / tests

usage:
  dspec check <model.pkl>
  dspec drift [--json] <model.pkl>
  dspec coverage [--json] <model.pkl>
  dspec domain-coverage [--json] <model.pkl>
  dspec render --locale ja|en <model.pkl>
  dspec emit <lean|tla|alloy|source-map|all> <model.pkl>
  dspec generate <model.pkl>
  dspec generated check <model.pkl>
  dspec verify-generated [--json] <model.pkl>
  dspec evidence <create|verify|refresh> [--json] <model.pkl>
  dspec applicability <model.pkl>`);
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

// Re-verify generated artifacts on disk: digests must match a fresh emit, and
// pinned generated selectors must be present.
function verifyGenerated(path, json) {
  const { ir } = load(path);
  const artifacts = emitAll(ir);
  const results = [];
  let ok = true;
  for (const a of artifacts) {
    const entry = { backend: a.backend, ruleId: a.ruleId, path: a.path };
    if (!existsSync(a.path)) {
      entry.status = "missing";
      ok = false;
    } else {
      const onDisk = readFileSync(a.path, "utf8") + (a.cfgPath && existsSync(a.cfgPath) ? readFileSync(a.cfgPath, "utf8") : "");
      const d = digestText(onDisk);
      if (d !== a.digest) {
        entry.status = "modified";
        entry.expected = a.digest;
        entry.actual = d;
        ok = false;
      } else {
        const missing = a.generated.filter((g) => !onDisk.includes(g.selector));
        if (missing.length) {
          entry.status = "selector-missing";
          entry.missing = missing.map((g) => g.selector);
          ok = false;
        } else entry.status = "ok";
      }
    }
    results.push(entry);
  }
  if (json) console.log(j({ ok, results }));
  else {
    for (const r of results) console.log(`${r.status === "ok" ? "✓" : "✗"} ${r.backend} ${r.path} — ${r.status}`);
    console.log(ok ? "✓ generated artifacts verified" : "✗ generated artifacts out of date (run `dspec generate`)");
  }
  process.exit(ok ? 0 : 1);
}
