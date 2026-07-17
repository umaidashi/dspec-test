import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parsePkl } from "./pkl.mjs";
import { validateModel } from "./schema.mjs";
import { digest } from "./digest.mjs";

// Model loading strategy: the REAL Pkl evaluator is authoritative whenever it
// is installed (devDependency @pkl-community/pkl, or a `pkl` on PATH); the
// constrained-subset parser in pkl.mjs is the fallback that keeps the toolchain
// self-contained. Both produce the same object shape, so model digests — and
// therefore evidence validity — are identical under either evaluator (this is
// pinned by test/pkl-evaluator.test.mjs).

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL_PKL = join(REPO_ROOT, "node_modules", ".bin", "pkl");

let pklBinCache; // undefined = not probed, null = unavailable
export function findPklBinary() {
  if (pklBinCache !== undefined) return pklBinCache;
  for (const bin of [LOCAL_PKL, "pkl"]) {
    try {
      if (bin === LOCAL_PKL && !existsSync(bin)) continue;
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      pklBinCache = bin;
      return pklBinCache;
    } catch {
      /* try next */
    }
  }
  pklBinCache = null;
  return pklBinCache;
}

function evalWithPkl(bin, path) {
  const out = execFileSync(bin, ["eval", "-f", "json", path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

// Load and validate a dspec model file.
// Returns { model, modelDigest, errors, source, evaluator }.
export function loadModel(path) {
  const source = readFileSync(path, "utf8");
  const bin = findPklBinary();
  let model;
  let evaluator;
  if (bin) {
    // Real Pkl is present: it is authoritative. An eval failure means the file
    // is genuinely invalid Pkl — surface it, never fall back and mask it.
    try {
      model = evalWithPkl(bin, path);
      evaluator = "pkl";
    } catch (e) {
      const detail = (e.stderr || e.message || "").toString().trim();
      return { model: null, modelDigest: null, source, evaluator: "pkl", errors: [`pkl eval failed: ${detail}`] };
    }
  } else {
    model = parsePkl(source);
    delete model.__module; // keep the object shape identical to `pkl eval` output
    evaluator = "subset-parser";
  }
  const errors = validateModel(model);
  return { model, modelDigest: digest(model), errors, source, evaluator };
}

export function loadModelOrThrow(path) {
  const { model, modelDigest, errors, source, evaluator } = loadModel(path);
  if (errors.length) {
    const e = new Error(`dspec: ${errors.length} type error(s) in ${path}:\n  ${errors.join("\n  ")}`);
    e.validationErrors = errors;
    throw e;
  }
  return { model, modelDigest, source, evaluator };
}
