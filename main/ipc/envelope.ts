/* ============================================================
   Consistent IPC result envelope: { data } on success, { error } on
   failure. `guard` wraps a handler body and converts thrown errors into
   the error envelope. An error that carries both a string `code` and a
   `detail` (NeedsBankError: 'needs_bank') passes them on, so the renderer
   can act on the refusal rather than only show it. System errors have a
   `code` too (SQLITE_..., ENOENT) but no `detail`, and stay plain.
   ============================================================ */
import type { IpcResult } from '../../shared/types';

export function ok<T>(data: T): IpcResult<T> {
  return { data };
}

export function fail(err: unknown): IpcResult<never> {
  const error = err instanceof Error ? err.message : String(err);
  const coded = err as { code?: unknown; detail?: unknown } | null;
  if (err instanceof Error && typeof coded?.code === 'string' && 'detail' in err) {
    return { error, code: coded.code, detail: coded.detail };
  }
  return { error };
}

export function guard<T>(body: () => T): IpcResult<T> {
  try {
    return ok(body());
  } catch (err) {
    return fail(err);
  }
}

export async function guardAsync<T>(body: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return ok(await body());
  } catch (err) {
    return fail(err);
  }
}
