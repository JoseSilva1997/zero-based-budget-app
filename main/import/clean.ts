/* ============================================================
   Descriptor cleaning: the bank's descriptor made fit to read and to
   classify. The generic rules here apply to every bank; a preset adds its
   own on top. The bank's casing is kept, because the cleaned descriptor is
   also the entry's default name.
   ============================================================ */

export function cleanDescriptor(text: string): string {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
}
