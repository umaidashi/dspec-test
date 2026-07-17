import { readFileSync } from "node:fs";
import { parsePkl } from "./pkl.mjs";
import { validateModel } from "./schema.mjs";
import { digest } from "./digest.mjs";

// Load and validate a dspec model file. Returns { model, modelDigest, errors }.
// `model` is the raw parsed object; Core IR normalization happens in ir.mjs.
export function loadModel(path) {
  const src = readFileSync(path, "utf8");
  const model = parsePkl(src);
  const errors = validateModel(model);
  return { model, modelDigest: digest(model), errors, source: src };
}

export function loadModelOrThrow(path) {
  const { model, modelDigest, errors, source } = loadModel(path);
  if (errors.length) {
    const e = new Error(`dspec: ${errors.length} type error(s) in ${path}:\n  ${errors.join("\n  ")}`);
    e.validationErrors = errors;
    throw e;
  }
  return { model, modelDigest, source };
}
