/**
 * Exact comparison of decimal STRINGS (money amounts) without parseFloat.
 * Used only for sorting / "best in row" highlighting — never for price arithmetic.
 */
const RE = /^(-?)(\d+)(?:\.(\d+))?$/;

export function compareDecimal(a: string, b: string): number {
  const ma = RE.exec(a.trim());
  const mb = RE.exec(b.trim());
  if (!ma || !mb) return 0;
  const negA = ma[1] === '-' && /[1-9]/.test(ma[2] + (ma[3] ?? ''));
  const negB = mb[1] === '-' && /[1-9]/.test(mb[2] + (mb[3] ?? ''));
  if (negA !== negB) return negA ? -1 : 1;
  const intA = ma[2].replace(/^0+(?=\d)/, '');
  const intB = mb[2].replace(/^0+(?=\d)/, '');
  let cmp = 0;
  if (intA.length !== intB.length) cmp = intA.length < intB.length ? -1 : 1;
  else if (intA !== intB) cmp = intA < intB ? -1 : 1;
  else {
    const len = Math.max((ma[3] ?? '').length, (mb[3] ?? '').length);
    const fa = (ma[3] ?? '').padEnd(len, '0');
    const fb = (mb[3] ?? '').padEnd(len, '0');
    cmp = fa === fb ? 0 : fa < fb ? -1 : 1;
  }
  return negA ? -cmp : cmp;
}

/** Score strings ("83.0") are small decimals shown to the user; converting for display/bars is safe. */
export function scoreNumber(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
