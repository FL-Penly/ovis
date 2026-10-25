/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): a long run is a Claude Code session started with a wider
 * auto-compact window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`), so it compacts later. The new tab list
 * offers it; the window goes in as the new tab's environment, the only variable a request may set.
 */
export const LONG_RUN_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
export const LONG_RUN_WINDOW = 500_000;

/** The window a value names, in tokens: digits, or a `k` / `m` shorthand as Claude Code reads it. */
export function compactWindow(value: string | null | undefined): number | null {
  const match = value?.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)([km]?)$/);
  if (!match) return null;
  const size = Math.round(Number(match[1]) * (match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1));
  return Number.isFinite(size) && size > 0 ? size : null;
}

/** `500k`, `1m`, `1.2m`: the window as the list and the sidebar say it. */
export function windowLabel(size: number): string {
  if (size >= 1_000_000) return `${Number((size / 1_000_000).toFixed(1))}m`;
  if (size >= 1_000) return `${Math.round(size / 1_000)}k`;
  return String(size);
}

/** Why a request's `env` is refused, or null: absent, or the window alone, as a plain count. */
export function launchEnvFault(env: unknown): string | null {
  if (env === undefined || env === null) return null;
  if (typeof env !== "object" || Array.isArray(env)) return "env must be an object";
  const entries = Object.entries(env);
  if (entries.length !== 1 || entries[0]![0] !== LONG_RUN_ENV) return `env may only set ${LONG_RUN_ENV}`;
  const value = entries[0]![1];
  if (typeof value !== "string" || !/^\d{4,8}$/.test(value)) return `${LONG_RUN_ENV} must be a count of tokens`;
  return null;
}
