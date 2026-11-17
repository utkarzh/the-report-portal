// Optional profile/invitation columns added by migrations that a deployment's
// database may not have run yet. Naming a missing column makes the whole
// PostgREST query fail — and the middleware's profile lookup would read that
// as "no profile" and sign every user out. These helpers retry without the
// missing column(s) instead, so sign-in, user admin and every other module
// keep working and the new module simply reads as "off" until its migration
// runs. Generalises the Knowledge Base fallback (knowledge/schema-compat.ts).
//
// Pure functions only: imported by the Edge middleware.

export const OPTIONAL_PROFILE_FLAG_COLUMNS = [
  "can_access_knowledge_base", // migration 034
  "can_access_commercial_presentations", // migration 046
  "can_approve_commercial_presentations", // migration 046
] as const;

export type OptionalProfileFlag = (typeof OPTIONAL_PROFILE_FLAG_COLUMNS)[number];

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

// PostgREST answers 42703 when a SELECT names a column that doesn't exist and
// PGRST204 when an INSERT/UPDATE payload does. Returns the first candidate
// column the error is about, or null when it's some other error.
export function missingOptionalColumn(
  error: PostgrestLikeError | null | undefined,
  candidates: readonly string[],
): string | null {
  if (!error) return null;
  const message = error.message ?? "";
  const isMissing =
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /does not exist|could not find/i.test(message);
  if (!isMissing) return null;
  return candidates.find((c) => message.includes(c)) ?? null;
}

// Runs `attempt`, and while it fails because one of `columns` doesn't exist,
// retries with that column left out. `omit` tells the attempt which columns
// to leave out of its select / payload.
export async function withOptionalColumns<R extends { error: PostgrestLikeError | null }>(
  columns: readonly string[],
  attempt: (omit: ReadonlySet<string>) => PromiseLike<R>,
): Promise<{ result: R; omitted: ReadonlySet<string> }> {
  const omit = new Set<string>();
  let result = await attempt(omit);
  for (let i = 0; i < columns.length; i++) {
    const missing = missingOptionalColumn(
      result.error,
      columns.filter((c) => !omit.has(c)),
    );
    if (!missing) break;
    omit.add(missing);
    result = await attempt(omit);
  }
  return { result, omitted: omit };
}

// A copy of `row` without the given keys (for retrying a write).
export function omitKeys<T extends Record<string, unknown>>(
  row: T,
  keys: Iterable<string>,
): T {
  const copy: Record<string, unknown> = { ...row };
  for (const k of keys) delete copy[k];
  return copy as T;
}
