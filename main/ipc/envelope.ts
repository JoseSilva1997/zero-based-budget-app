/* ============================================================
   Consistent IPC result envelope: { data } on success, { error } on
   failure. `guard` wraps a handler body and converts thrown errors into
   the error envelope.
   ============================================================ */
import type { IpcResult } from '../../shared/types';

export function ok<T>(data: T): IpcResult<T> {
  return { data };
}

export function fail(err: unknown): IpcResult<never> {
  return { error: err instanceof Error ? err.message : String(err) };
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
