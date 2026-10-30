/**
 * Downstream (DOWNSTREAM.md): an attached file is a short mark where it was pasted (`[Image 1]`), not its
 * path at the start of the message. The mark is placed at the caret the moment the file is picked, so it
 * stays where the user meant it however long the upload takes, and each mark is written out as
 * `[Image 1] @<path>` only when the message is sent: the agent reads every file beside the words about it.
 */

export interface TokenEntry {
  /** the mark as it stands in the text, brackets included */
  token: string;
  /** where the upload put the file; null while it uploads (or after it failed) */
  path: string | null;
  name: string;
  image: boolean;
}

export interface TokenRange { token: string; start: number; end: number }

/** Every place one of `tokens` stands in `text`, in text order. */
export function tokenRanges(text: string, tokens: readonly string[]): TokenRange[] {
  const ranges: TokenRange[] = [];
  for (const token of new Set(tokens)) {
    if (token === "") continue;
    for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + token.length)) ranges.push({ token, start: at, end: at + token.length });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * The next number for a mark drawn by `label`: one past the highest the text or the entries already use, so a
 * mark is never named twice, also beside a `[Image 1]` left in the text as words (a message put back from the
 * queue, typed by hand).
 */
export function nextTokenNumber(text: string, entries: readonly TokenEntry[], label: (n: string) => string): number {
  const [before, after] = label("\u0000").split("\u0000") as [string, string?];
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`\\[${escape(before)}(\\d+)${escape(after ?? "")}\\]`, "gu");
  let highest = 0;
  for (const source of [text, ...entries.map((entry) => entry.token)]) {
    for (const match of source.matchAll(pattern)) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

/** `marks` put in place of the selection, one space between them; the caret lands after the last. */
export function insertTokens(text: string, start: number, end: number, marks: readonly string[]): { text: string; caret: number } {
  const inserted = marks.join(" ");
  return { text: text.slice(0, start) + inserted + text.slice(end), caret: start + inserted.length };
}

/**
 * A mark is one piece: an edit that cut part of one (a Backspace at its end, a selection across its edge,
 * a phone keyboard's delete) takes the whole mark, and text typed inside one goes after it. The edit is read
 * as the one change between `before` and `after`; null when it left every mark whole.
 */
export function repairTokenEdit(before: string, after: string, tokens: readonly string[]): { text: string; caret: number } | null {
  if (before === after) return null;
  let prefix = 0;
  const shortest = Math.min(before.length, after.length);
  while (prefix < shortest && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shortest - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  let from = prefix;
  let to = before.length - suffix;
  const inserted = after.slice(prefix, after.length - suffix);
  let changed = false;
  for (const range of tokenRanges(before, tokens)) {
    if (from === to) {
      // typed inside a mark: the words go after it
      if (range.start < from && from < range.end) { from = to = range.end; changed = true; }
      continue;
    }
    const overlaps = from < range.end && to > range.start;
    const whole = from <= range.start && to >= range.end;
    if (overlaps && !whole) { from = Math.min(from, range.start); to = Math.max(to, range.end); changed = true; }
  }
  if (!changed) return null;
  return { text: before.slice(0, from) + inserted + before.slice(to), caret: from + inserted.length };
}

/** A caret inside a mark moves to its nearer edge: a mark is never typed into. */
export function caretOutsideTokens(text: string, caret: number, tokens: readonly string[]): number {
  const range = tokenRanges(text, tokens).find((candidate) => candidate.start < caret && caret < candidate.end);
  if (!range) return caret;
  return caret - range.start < range.end - caret ? range.start : range.end;
}

/** `text` without `token`, and the space it left doubled; null when the token is not there. */
export function withoutToken(text: string, token: string): string | null {
  const at = text.indexOf(token);
  if (at < 0) return null;
  const before = text.slice(0, at);
  let after = text.slice(at + token.length);
  if ((before === "" || / $/u.test(before)) && after.startsWith(" ")) after = after.slice(1);
  return before + after;
}

/** The message as sent: each mark whose file has a path is followed by `@<path>`, so the agent reads it where it is named. */
export function expandTokens(text: string, entries: readonly TokenEntry[]): string {
  const placed = entries.filter((entry): entry is TokenEntry & { path: string } => entry.path !== null);
  const ranges = tokenRanges(text, placed.map((entry) => entry.token));
  let out = "";
  let last = 0;
  for (const range of ranges) {
    const path = placed.find((entry) => entry.token === range.token)!.path;
    const next = text[range.end];
    out += `${text.slice(last, range.end)} @${path}${next === undefined || /\s/u.test(next) ? "" : " "}`;
    last = range.end;
  }
  return out + text.slice(last);
}

/** The marks still in the text whose file has no path yet: the message cannot go until they do. */
export function unplacedTokens(text: string, entries: readonly TokenEntry[]): TokenEntry[] {
  return entries.filter((entry) => entry.path === null && text.includes(entry.token));
}

/**
 * A sent mark as the chat draws it (`[Image 1] @/abs/path.png` → `[Image 1](/abs/path.png)`): a link the
 * Markdown renders as the file's own button. Only an absolute path the upload wrote is taken, so a link
 * with spaces or a path typed by hand stays the words it was.
 */
const SENT_TOKEN = /\[([^\]\n]{1,40})\] @(\/\S+)(?=\s|$)/gu;
export function tokenLinks(text: string): string {
  return text.replace(SENT_TOKEN, (_whole, label: string, path: string) => `[${label}](${path})`);
}

/** A sent message as words alone: each mark without the path it was sent with. */
export function tokenText(text: string): string {
  return text.replace(SENT_TOKEN, (_whole, label: string) => `[${label}]`);
}

/** The label each sent file was named by, by its path: the gallery of the message's pictures shows them. */
export function tokenLabels(text: string): Map<string, string> {
  return new Map([...text.matchAll(SENT_TOKEN)].map((match) => [match[2]!, match[1]!]));
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const PREFIX = "ovis-downstream:composer-tokens:";

/**
 * The marks of each message box, by its draft key. Those that have a path are stored, so a draft that
 * comes back (another pane and back, a reload) still writes out its files; one still uploading lives in
 * this page alone, and a box mounted without its upload drops it (ComposerTokens).
 */
export class TokenStore {
  private memory = new Map<string, TokenEntry[]>();
  constructor(private storage: () => Storage | null = () => { try { return localStorage; } catch { return null; } }) {}
  read(key: string): TokenEntry[] {
    const held = this.memory.get(key);
    if (held) return held;
    let entries: TokenEntry[] = [];
    try {
      const raw = this.storage()?.getItem(PREFIX + key);
      const value: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(value)) entries = value.filter((entry): entry is TokenEntry => typeof entry === "object" && entry !== null
        && typeof entry.token === "string" && entry.token !== "" && typeof entry.path === "string" && typeof entry.name === "string" && typeof entry.image === "boolean");
    } catch { /* unreadable: no marks */ }
    this.memory.set(key, entries);
    return entries;
  }
  write(key: string, entries: readonly TokenEntry[]): void {
    this.memory.set(key, [...entries]);
    const kept = entries.filter((entry) => entry.path !== null);
    try {
      if (kept.length === 0) this.storage()?.removeItem(PREFIX + key);
      else this.storage()?.setItem(PREFIX + key, JSON.stringify(kept));
    } catch { /* storage refused: kept for this page */ }
  }
}

export const composerTokens = new TokenStore();
