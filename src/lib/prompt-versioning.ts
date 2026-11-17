// ── Major.minor version labels for admin-managed content ─────────────────
// Shared by the Copywriting stage prompts (migration 032) and the Commercial
// Presentation master content (migration 046). Client-safe, pure.
//
// Every item starts at 0.0. A minor update bumps the minor number (0.0 →
// 0.1 → 0.2); a major version bumps the major and resets minor (0.2 → 1.0),
// after which minor updates continue on it (1.1, 1.2…). The admin picks the
// kind of change at save time; the server computes the actual number.
export type PromptVersionBump = "major" | "minor";

export const INITIAL_PROMPT_VERSION = "0.0";

const PROMPT_VERSION_RE = /^(\d+)\.(\d+)$/;

export function parsePromptVersion(
  v: string | null | undefined,
): { major: number; minor: number } {
  const m = PROMPT_VERSION_RE.exec((v || "").trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : { major: 0, minor: 0 };
}

export function comparePromptVersions(a: string, b: string): number {
  const pa = parsePromptVersion(a);
  const pb = parsePromptVersion(b);
  return pa.major - pb.major || pa.minor - pb.minor;
}

// Next label after the HIGHEST existing one (live + every snapshot), so a
// restore or a deleted snapshot can never make a new save reuse a label.
export function nextPromptVersion(
  existing: (string | null | undefined)[],
  bump: PromptVersionBump,
): string {
  const labels = existing.filter((v): v is string => !!v && PROMPT_VERSION_RE.test(v));
  const highest = labels.sort(comparePromptVersions).pop() || INITIAL_PROMPT_VERSION;
  const { major, minor } = parsePromptVersion(highest);
  return bump === "major" ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

export function isPromptVersionBump(v: unknown): v is PromptVersionBump {
  return v === "major" || v === "minor";
}
