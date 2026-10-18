/* ============================================================
   The built-in bank presets, one per bank. A fifth bank gets a fifth
   module here.
   ============================================================ */
import { lloyds } from './lloyds';
import { monzo } from './monzo';
import type { Preset, PresetKey } from './types';

export const PRESETS: Preset[] = [monzo, lloyds];

export function getPreset(key: PresetKey): Preset | undefined {
  return PRESETS.find((p) => p.key === key);
}

/** The preset whose header this is, or null for a statement no preset
 *  recognises. */
export function detectPreset(header: string[]): Preset | null {
  return PRESETS.find((p) => p.detect(header)) ?? null;
}
