// Bounded model checker.
//
// dspec emits real TLA+ (src/backends/tla.mjs) and runs TLC when it is present.
// When TLC is absent, this explicit-state BFS explores the SAME finite state
// space the TLA+ module defines and checks the same invariant. Exhaustive
// enumeration over a bounded scope is a genuine bounded model check, so the
// evidence it produces is `bounded` — never `proved`.
//
// Each system exposes a `mutation` hook so the mutation-testing harness can
// inject the faults listed in the task and confirm a counterexample appears.

function bfs(system) {
  const { init, actions, invariant, key } = system;
  const seen = new Map(); // stateKey -> { depth, prev, via }
  const queue = [];
  for (const s of init) {
    const k = key(s);
    if (!seen.has(k)) {
      seen.set(k, { depth: 0, prev: null, via: "Init", state: s });
      queue.push(s);
    }
  }
  let explored = 0;
  let maxDepth = 0;
  let counterexample = null;
  while (queue.length) {
    const s = queue.shift();
    const sk = key(s);
    const info = seen.get(sk);
    explored++;
    maxDepth = Math.max(maxDepth, info.depth);
    if (!invariant(s)) {
      // reconstruct trace
      const trace = [];
      let cur = sk;
      while (cur) {
        const n = seen.get(cur);
        trace.unshift({ via: n.via, state: n.state });
        cur = n.prev;
      }
      counterexample = trace;
      break;
    }
    for (const { label, next } of actions(s)) {
      const nk = key(next);
      if (!seen.has(nk)) {
        seen.set(nk, { depth: info.depth + 1, prev: sk, via: label, state: next });
        queue.push(next);
      }
    }
  }
  return {
    states: explored,
    distinct: seen.size,
    depth: maxDepth,
    invariantHeld: counterexample === null,
    counterexample,
  };
}

// ---- ACC-PERIOD-003: closed period immutable ------------------------------

export function periodSystem({ mutation = null, versionCap = 2 } = {}) {
  const key = (s) => `${s.periodStatus}|${s.journalExists}|${s.journalVersion}|${s.lastOperation}|${s.illegal}`;
  // A mutation may permit a normally-open-only action while closed.
  const closedAllows = (op) => {
    if (mutation === "drop-closed-guard") return true;
    if (mutation === "allow-delete" && op === "delete") return true;
    if (mutation === "allow-update" && op === "update") return true;
    return false;
  };
  const canMutate = (s, op) => s.periodStatus === "open" || closedAllows(op);
  return {
    scope: { versionCap, actions: ["CreateJournal", "UpdateJournal", "DeleteJournal", "ClosePeriod"] },
    key,
    init: [{ periodStatus: "open", journalExists: false, journalVersion: 0, lastOperation: "none", illegal: false }],
    invariant: (s) => s.illegal === false,
    actions: (s) => {
      const out = [];
      const mut = (s2, op) => ({ ...s2, illegal: s2.illegal || (s.periodStatus === "closed" && closedAllows(op)) });
      if (!s.journalExists && canMutate(s, "create")) {
        out.push({ label: "CreateJournal", next: mut({ ...s, journalExists: true, journalVersion: 1, lastOperation: "create" }, "create") });
      }
      if (s.journalExists && s.journalVersion < versionCap && canMutate(s, "update")) {
        out.push({ label: "UpdateJournal", next: mut({ ...s, journalVersion: s.journalVersion + 1, lastOperation: "update" }, "update") });
      }
      if (s.journalExists && canMutate(s, "delete")) {
        out.push({ label: "DeleteJournal", next: mut({ ...s, journalExists: false, lastOperation: "delete" }, "delete") });
      }
      if (s.periodStatus === "open") {
        out.push({ label: "ClosePeriod", next: { ...s, periodStatus: "closed" } });
      }
      return out;
    },
  };
}

// ---- ACC-SYNC-001: idempotent external sync -------------------------------

// Fixed attempt contexts covering: an idempotent pair (A,B same context) and
// attempts differing in exactly one of tenant / provider / key.
const SYNC_ATTEMPTS = [
  { name: "A", t: "t1", p: "p1", k: "k1" },
  { name: "B", t: "t1", p: "p1", k: "k1" },
  { name: "C", t: "t2", p: "p1", k: "k1" },
  { name: "D", t: "t1", p: "p2", k: "k1" },
  { name: "E", t: "t1", p: "p1", k: "k2" },
];
const SYNC_IDS = ["e1", "e2"];

export function syncSystem({ mutation = null } = {}) {
  // Guard comparison: which fields define "same context" when deciding to reuse.
  const guardSame = (a, b) => {
    if (mutation === "drop-guard") return false; // never forces reuse => allows rebind
    return a.t === b.t && a.p === b.p && a.k === b.k;
  };
  // Invariant comparison: which fields define "same context" for the property.
  const invSame = (a, b) => {
    const t = mutation === "drop-tenant-compare" ? true : a.t === b.t;
    const p = mutation === "drop-provider-compare" ? true : a.p === b.p;
    const k = mutation === "drop-key-compare" ? true : a.k === b.k;
    return t && p && k;
  };
  const key = (s) => s.map((x) => x.id ?? "-").join("");
  const init = [SYNC_ATTEMPTS.map((a) => ({ ...a, id: null }))];
  return {
    scope: { attempts: SYNC_ATTEMPTS.length, externalIds: SYNC_IDS, contexts: SYNC_ATTEMPTS.map((a) => `${a.t}/${a.p}/${a.k}`) },
    key,
    init,
    invariant: (s) => {
      for (let i = 0; i < s.length; i++)
        for (let j = i + 1; j < s.length; j++)
          if (s[i].id && s[j].id && invSame(s[i], s[j]) && s[i].id !== s[j].id) return false;
      return true;
    },
    actions: (s) => {
      const out = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i].id) continue; // already succeeded
        for (const x of SYNC_IDS) {
          // guard: reuse existing id for a guard-same succeeded attempt
          const forced = s.find((o) => o.id && guardSame(o, s[i]));
          if (forced && forced.id !== x) continue;
          const next = s.map((o, idx) => (idx === i ? { ...o, id: x } : o));
          out.push({ label: `CompleteSync(${s[i].name},${x})`, next });
        }
      }
      return out;
    },
  };
}

export function modelCheck(system) {
  const result = bfs(system);
  return { ...result, scope: system.scope };
}
