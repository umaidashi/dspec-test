// Bilingual review-document renderer. Produces the JA / EN Markdown a human
// reviewer reads: model boundary, vocabulary, entities, and per-rule spec,
// classification, primary strategy, clauses, required assurance, check targets,
// implementation references, and the proved / not-proved boundary.

import { runAllAssurance } from "../verify/run.mjs";

const L = {
  ja: {
    boundary: "モデル境界", vocab: "ドメイン用語", entities: "エンティティ", rules: "業務ルール",
    classification: "分類", strategy: "主要検証戦略", aux: "補助検証", clauses: "Clause",
    required: "必要な保証", targets: "検証対象", impl: "実装参照", proves: "証明/検査される範囲",
    notProven: "証明/検査されない範囲", nonGoals: "非目標", assured: "達成した保証",
    title: (m) => `# ${m.titleJa}（レビュー用）`, spec: "仕様",
  },
  en: {
    boundary: "Model boundary", vocab: "Domain vocabulary", entities: "Entities", rules: "Rules",
    classification: "Classification", strategy: "Primary strategy", aux: "Auxiliary", clauses: "Clauses",
    required: "Required assurance", targets: "Check targets", impl: "Implementation refs", proves: "What is proved / checked",
    notProven: "What is NOT proved / checked", nonGoals: "Non-goals", assured: "Achieved assurance",
    title: (m) => `# ${m.titleEn} (review)`, spec: "Spec",
  },
};

export function renderMarkdown(ir, artifacts, locale = "ja") {
  const t = L[locale];
  const pick = (ja, en) => (locale === "ja" ? ja : en);
  const assurance = runAllAssurance(ir, artifacts);
  const out = [];
  out.push(t.title(ir.model));
  out.push("");
  out.push(`> model: \`${ir.model.id}\` · Core IR digest: \`${ir.digest}\``);
  out.push("");
  out.push(`## ${t.boundary}`);
  out.push(pick(ir.model.boundaryJa, ir.model.boundaryEn));
  out.push("");

  out.push(`## ${t.vocab}`);
  for (const v of ir.vocabulary) out.push(`- \`${v.id}\` — ${pick(v.labelJa, v.labelEn)}`);
  out.push("");

  out.push(`## ${t.entities}`);
  for (const d of ir.domainTypes) {
    out.push(`### ${d.id} (${d.irKind}) — ${pick(d.labelJa, d.labelEn)}`);
    for (const f of d.fields) out.push(`- ${f.name}: ${f.type}`);
    out.push("");
  }

  out.push(`## ${t.rules}`);
  for (const r of ir.rules) {
    out.push(`### ${r.id} — ${pick(r.titleJa, r.titleEn)}`);
    out.push(`- **${t.spec}**: ${pick(r.specJa, r.specEn)}`);
    out.push(`- **${t.classification}**: \`${r.classification}\``);
    out.push(`- **${t.strategy}**: \`${r.primaryStrategy}\` (backend: \`${r.primaryBackend || "—"}\`)`);
    if (r.auxiliaryStrategies.length) out.push(`- **${t.aux}**: ${r.auxiliaryStrategies.map((s) => `\`${s}\``).join(", ")}`);
    out.push(`- **${t.required}**: ${r.requiredAssurances.map((a) => `\`${a}\``).join(", ")}`);
    const achieved = [...new Set((assurance[r.id] || []).filter((x) => x.result === "pass").map((x) => x.assuranceKind))];
    out.push(`- **${t.assured}**: ${achieved.map((a) => `\`${a}\``).join(", ") || "—"}`);
    out.push(`- **${t.clauses}**:`);
    for (const c of r.clauses) {
      out.push(`  - \`${c.selector}\` (${c.kind}, ${c.irKind}): \`${c.render}\` — ${pick(c.labelJa || "", c.labelEn || "")}`);
    }
    out.push(`- **${t.targets}**:`);
    for (const ct of r.checkTargets) {
      out.push(`  - \`${ct.backend}\` → \`${ct.generatedSelector || ""}\` covers ${ct.covers.map((s) => `\`${s}\``).join(", ")} (${ct.coverage})`);
    }
    out.push(`- **${t.impl}**:`);
    for (const ref of r.implementationRefs) out.push(`  - ${ref.kind}: \`${ref.file}#${ref.anchor}\``);
    out.push(`- **${t.proves}**: ${pick(r.proves.ja || "", r.proves.en || "")}`);
    out.push(`- **${t.notProven}**: ${pick(r.notProven.ja || "", r.notProven.en || "")}`);
    out.push("");
  }

  out.push(`## ${t.nonGoals}`);
  for (const g of ir.nonGoals) out.push(`- ${g}`);
  out.push("");
  return out.join("\n");
}
