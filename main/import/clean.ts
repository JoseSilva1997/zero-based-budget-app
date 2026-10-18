/* ============================================================
   Descriptor cleaning: the bank's descriptor made fit to read and to
   classify. The generic rules here apply to every bank; a preset adds its
   own on top. The bank's casing is kept, because the cleaned descriptor is
   also the entry's default name.
   ============================================================ */

/** A payment reference rather than a word: a long run of digits, or a long
 *  letters-and-digits code with several digits in it ("AB123456C"). */
function isReference(token: string): boolean {
  if (/^\d{5,}$/.test(token)) return true;
  return /^[A-Z0-9]{8,}$/i.test(token) && /[A-Z]/i.test(token) && (token.match(/\d/g) || []).length >= 3;
}

/** A date: 03/09/26, 03/09/2026, 2026-09-03 or 03SEP26. */
function isDate(token: string): boolean {
  return (
    /^\d{2}\/\d{2}\/(\d{2}|\d{4})$/.test(token) ||
    /^\d{4}-\d{2}-\d{2}$/.test(token) ||
    /^\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}$/i.test(token)
  );
}

export function cleanDescriptor(text: string): string {
  return String(text || '')
    // A card fragment: "*1234", "**1234*".
    .replace(/\*+\d{4}\b\*?/g, ' ')
    // What's left of a *: the separator in "SQ *SHOP" or "ZETTLE_*SHOP".
    .replace(/_?\*+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !isReference(token) && !isDate(token))
    .join(' ');
}
