/**
 * Downstream (DOWNSTREAM.md): the message box's attachment marks (lib/attachmentTokens.ts). useComposerTokens keeps
 * a box's marks with its draft; TokenLayer draws each mark in the text as a pill, under the textarea that still
 * holds and types every character, so the keyboard, IME and dictation work as they did.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useT } from "../lib/i18n.ts";
import { fileUrl } from "../lib/api.ts";
import { drivenByTests } from "../lib/upstreamTests.ts";
import { caretOutsideTokens, composerTokens, expandTokens, nextTokenNumber, tokenRanges, unplacedTokens, withoutToken, type TokenEntry } from "../lib/attachmentTokens.ts";
import "./AttachmentTokens.css";

type Translate = ReturnType<typeof useT>;

/**
 * Marks are this fork's default. Upstream's browser scripts check its paths at the start of the message, so under
 * them (lib/upstreamTests.ts) a pick keeps upstream's way unless the page turned marks on.
 */
export const TOKENS_KEY = "ovis-downstream:attachment-marks";
const tokensOn = (() => { try { return !drivenByTests || localStorage.getItem(TOKENS_KEY) === "1"; } catch { return !drivenByTests; } })();

/** A mark's own name, without its brackets: what a tile says once its file is attached. */
export function tokenName(token: string): string {
  return token.slice(1, -1);
}

/** A stored mark's thumbnail, read back from where its upload put it; a file that is not a picture has none. */
export function tokenPreview(entry: TokenEntry, paneId: string, machineId: string): string {
  return entry.image && entry.path !== null ? fileUrl(entry.path, paneId, machineId) : "";
}

/** Said when the marks of a pick do not fit in the message, so the files are left out. */
export function tokenNoRoomNote(t: Translate): string {
  return t("No room in the message to mark these files. Shorten it, then attach them again.");
}

/** Said when the paths the marks are sent with make the message too long. */
export function tokenTooLongNote(t: Translate): string {
  return t("Too long with the attached files' paths: shorten the message or remove a file.");
}

export function useComposerTokens(draftKey: string) {
  const t = useT();
  const [entries, setEntries] = useState<TokenEntry[]>(() => composerTokens.read(draftKey));
  const entriesRef = useRef(entries);
  useEffect(() => {
    const next = composerTokens.read(draftKey);
    entriesRef.current = next;
    setEntries(next);
  }, [draftKey]);
  const write = useCallback((next: TokenEntry[]) => {
    composerTokens.write(draftKey, next);
    entriesRef.current = next;
    setEntries(next);
  }, [draftKey]);

  /** One new mark for each file, numbered past those in `text`: images and other files counted apart. */
  const reserve = useCallback((files: readonly { name: string; image: boolean }[], text: string): string[] => {
    const added: TokenEntry[] = [];
    for (const file of files) {
      const label = (n: string) => file.image ? t("Image {n}", { n }) : t("File {n}", { n });
      const n = nextTokenNumber(text, [...entriesRef.current, ...added], label);
      added.push({ token: `[${label(String(n))}]`, path: null, name: file.name, image: file.image });
    }
    write([...entriesRef.current, ...added]);
    return added.map((entry) => entry.token);
  }, [t, write]);

  const uploaded = useCallback((token: string, path: string) => {
    write(entriesRef.current.map((entry) => entry.token === token ? { ...entry, path } : entry));
  }, [write]);

  const remove = useCallback((token: string) => {
    write(entriesRef.current.filter((entry) => entry.token !== token));
  }, [write]);

  /** The marks no longer in `text` leave, and are returned: their tiles go with them. */
  const prune = useCallback((text: string): string[] => {
    const gone = entriesRef.current.filter((entry) => !text.includes(entry.token)).map((entry) => entry.token);
    if (gone.length > 0) write(entriesRef.current.filter((entry) => !gone.includes(entry.token)));
    return gone;
  }, [write]);

  /**
   * A box mounted on a draft that has marks: those with a file are returned to be drawn as tiles again, and
   * the text without the marks whose upload this page no longer runs (the box was left while it uploaded).
   */
  const restore = useCallback((text: string): { attached: TokenEntry[]; text: string } => {
    let rest = text;
    for (const entry of entriesRef.current) if (entry.path === null) rest = withoutToken(rest, entry.token) ?? rest;
    const attached = entriesRef.current.filter((entry) => entry.path !== null && rest.includes(entry.token));
    write(attached);
    return { attached, text: rest };
  }, [write]);

  return {
    on: tokensOn,
    entries,
    tokens: entries.map((entry) => entry.token),
    reserve,
    uploaded,
    remove,
    prune,
    restore,
    expand: useCallback((text: string) => expandTokens(text, entriesRef.current), []),
    unplaced: (text: string) => unplacedTokens(text, entries).length > 0,
  };
}

/** What the layer copies from the textarea, so each character it draws lies under the one the textarea draws. */
const MIRRORED = [
  "box-sizing", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width",
  "border-bottom-width", "border-left-width", "font-family", "font-size", "font-weight", "font-style", "font-stretch",
  "font-feature-settings", "font-variant-ligatures", "font-kerning", "line-height", "letter-spacing", "word-spacing",
  "text-indent", "text-transform", "tab-size", "white-space", "overflow-wrap", "word-break", "line-break", "direction",
  "scrollbar-gutter", "scrollbar-width",
] as const;

/**
 * The marks of `text` drawn as pills under `textarea`, at the same place and scroll. A caret put inside a mark
 * (a click, an arrow key) moves to its edge: the arrows step over a mark, a click lands on its nearer side.
 */
export function TokenLayer({ textarea, text, tokens, hot }: { textarea: RefObject<HTMLTextAreaElement | null>; text: string; tokens: readonly string[]; hot: string | null }) {
  const layer = useRef<HTMLDivElement>(null);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const ranges = tokenRanges(text, tokens);

  useLayoutEffect(() => {
    const box = textarea.current;
    const view = layer.current;
    if (!box || !view) return;
    const style = getComputedStyle(box);
    for (const property of MIRRORED) view.style.setProperty(property, style.getPropertyValue(property));
    view.style.left = `${box.offsetLeft}px`;
    view.style.top = `${box.offsetTop}px`;
    view.style.width = `${box.offsetWidth}px`;
    view.style.height = `${box.offsetHeight}px`;
    view.scrollTop = box.scrollTop;
  });

  useEffect(() => {
    const box = textarea.current;
    if (!box) return;
    const follow = () => { if (layer.current) layer.current.scrollTop = box.scrollTop; };
    let key: string | null = null;
    const onKeyDown = (event: KeyboardEvent) => { key = event.key; };
    const snap = () => {
      if (box.selectionStart !== box.selectionEnd) return;
      const caret = box.selectionStart;
      const range = tokenRanges(box.value, tokensRef.current).find((candidate) => candidate.start < caret && caret < candidate.end);
      if (!range) return;
      const to = key === "ArrowLeft" || key === "ArrowUp" ? range.start : key === "ArrowRight" || key === "ArrowDown" ? range.end : caretOutsideTokens(box.value, caret, tokensRef.current);
      key = null;
      box.setSelectionRange(to, to);
    };
    box.addEventListener("scroll", follow);
    box.addEventListener("keydown", onKeyDown);
    box.addEventListener("keyup", snap);
    box.addEventListener("click", snap);
    return () => {
      box.removeEventListener("scroll", follow);
      box.removeEventListener("keydown", onKeyDown);
      box.removeEventListener("keyup", snap);
      box.removeEventListener("click", snap);
    };
  }, [textarea]);

  if (ranges.length === 0) return null;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const range of ranges) {
    parts.push(<Fragment key={`t${range.start}`}>{text.slice(at, range.start)}</Fragment>);
    parts.push(<mark key={`m${range.start}`} className={`composer-token${range.token === hot ? " is-hot" : ""}`}>{range.token}</mark>);
    at = range.end;
  }
  // a trailing line break is drawn by the textarea as an empty line: the layer keeps it with a character of no width
  parts.push(<Fragment key="end">{text.slice(at)}{"​"}</Fragment>);
  return <div ref={layer} className="composer-token-layer" aria-hidden="true">{parts}</div>;
}
