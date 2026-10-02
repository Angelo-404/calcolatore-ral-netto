/* ====================================================================
   FORMATTING
   ==================================================================== */

/* In Italian, Intl does not group thousands below 10,000: "1802 €" next to
   "23.426 €". `useGrouping: 'always'` always groups them. */
export const fmtEuro = new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: 'always'
});
export const fmtEuro2 = new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always'
});
export const fmtPct = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 1, maximumFractionDigits: 1
});
// Contribution rates are shown with the legal precision (9.19%)
export const fmtPct2 = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
export const ratePct = (n) => fmtPct2.format((n || 0) * 100) + '%';

export const euro = (n) => fmtEuro.format(Math.round(n || 0));
export const euro2 = (n) => fmtEuro2.format(n || 0);
export const pct = (n) => fmtPct.format(n || 0) + ' %';

// Text that comes from data (municipality names) is escaped before going into innerHTML.
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
