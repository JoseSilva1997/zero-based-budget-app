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

export function cleanDescriptor(text: string): string {
  return String(text || '')
    // A card fragment: "*1234", "**1234*".
    .replace(/\*+\d{4}\b\*?/g, ' ')
    // What's left of a *: the separator in "SQ *SHOP" or "ZETTLE_*SHOP".
    .replace(/_?\*+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !isReference(token))
    .join(' ');
}
