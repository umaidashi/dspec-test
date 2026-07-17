// ACC-JOURNAL-001 implementation. Anchors watched by drift: debitTotal.

/** Sum of amounts on debit lines. */
export function debitTotal(entry) {
  return entry.lines.filter((l) => l.side === "debit").reduce((a, l) => a + l.amount, 0);
}

/** Sum of amounts on credit lines. */
export function creditTotal(entry) {
  return entry.lines.filter((l) => l.side === "credit").reduce((a, l) => a + l.amount, 0);
}

export function isApprovedOrPosted(entry) {
  return entry.status === "approved" || entry.status === "posted";
}

/** balanced predicate. */
export function balanced(entry) {
  return debitTotal(entry) === creditTotal(entry);
}

/** ACC-JOURNAL-001: approved/posted entries must balance. Returns true if OK. */
export function journalBalanceHolds(entry) {
  return !isApprovedOrPosted(entry) || balanced(entry);
}

/** Trial-balance aggregation over a set of entries. */
export function trialBalanceDebit(entries) {
  return entries.reduce((a, e) => a + debitTotal(e), 0);
}
export function trialBalanceCredit(entries) {
  return entries.reduce((a, e) => a + creditTotal(e), 0);
}
