/**
 * Downstream (FL-Penly/ovis): fork a Claude Code or Codex session into a new tab or split, from its
 * latest state or from the end of any finished reply. The work is quick-fork's
 * (integrations/quick-fork/fork.ts, also a herdr plugin of its own): it cuts a copy of the transcript
 * at the fork point, keeps the session's flags and environment, and starts the copy in the new pane.
 * This file only turns a reply the chat shows into quick-fork's fork point. A turn carries no record
 * id, only its `end_ts`, which is the timestamp of the record that ended it, so the point is looked
 * up by that timestamp in the pane's own transcript. See DOWNSTREAM.md.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { ForkError, forkSession } from "../integrations/quick-fork/fork.ts";
import { ConversationUnavailable, paneTranscript } from "./conversation.ts";
import { badRequest, conflictResponse, errorResponse, jsonResponse, readJsonObject, setRequestRoute } from "./http.ts";
import type { PaneStores } from "./pane-routes.ts";

export type ForkMode = "tab" | "right" | "down";
const MODES = new Set<string>(["tab", "right", "down"]);

/** Bigger transcripts are not scanned for a fork point; a whole-session fork (no end_ts) still works. */
const MAX_SCAN_BYTES = 256 * 1024 * 1024;

function readText(path: string): string {
  const size = statSync(path).size;
  if (size > MAX_SCAN_BYTES) throw new ForkError(`transcript is over ${MAX_SCAN_BYTES} bytes, too big to search for this reply`, "bad_fork_point");
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const n = readSync(fd, buffer, read, size - read, read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function parse(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null; // a torn tail line while the agent is mid-append
  }
}

/**
 * The uuid of the Claude record a reply ended with: the last main-thread assistant record written at
 * `endTs`. A record with text wins over one without, as the reply's words are where it ends.
 */
export function claudeForkPoint(text: string, endTs: string): string | null {
  let any: string | null = null;
  let withText: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes(endTs)) continue;
    const row = parse(line);
    if (row === null || row.type !== "assistant" || row.timestamp !== endTs || row.isSidechain === true || typeof row.uuid !== "string") continue;
    any = row.uuid;
    const content = (row.message as { content?: unknown } | undefined)?.content;
    if (Array.isArray(content) && content.some((block) => (block as { type?: unknown } | null)?.type === "text")) withText = row.uuid;
  }
  return withText ?? any;
}

/** `<rollout>#<byte offset>` just past the `task_complete` (or `turn_aborted`) record written at `endTs`. */
export function codexForkPoint(path: string, text: string, endTs: string): string | null {
  const total = Buffer.byteLength(text, "utf8");
  let offset = 0;
  let found: number | null = null;
  for (const line of text.split("\n")) {
    const end = offset + Buffer.byteLength(line, "utf8") + 1;
    if (line.includes(endTs)) {
      const row = parse(line);
      const type = row?.type === "event_msg" ? (row.payload as { type?: unknown } | undefined)?.type : undefined;
      if (row?.timestamp === endTs && (type === "task_complete" || type === "turn_aborted") && end <= total) found = end;
    }
    offset = end;
  }
  return found === null ? null : `${path}#${found}`;
}

export async function forkPointOf(paneId: string, endTs: string, stores: PaneStores): Promise<{ at: string; codexHome?: string }> {
  const transcript = await paneTranscript(paneId, stores.codexHome);
  if (transcript.source === "claude-transcript") {
    const at = claudeForkPoint(readText(transcript.path), endTs);
    if (at !== null) return { at };
  } else if (transcript.source === "codex-transcript") {
    const at = codexForkPoint(transcript.path, readText(transcript.path), endTs);
    if (at !== null) return { at, ...(transcript.codexHome ? { codexHome: transcript.codexHome } : {}) };
  } else {
    throw new ForkError(`a ${transcript.source} pane cannot be forked`, "not_agent");
  }
  throw new ForkError("that reply is no longer in this session's transcript", "bad_fork_point");
}

export async function handleForkRequest(request: Request, pathname: string, stores: PaneStores): Promise<Response | null> {
  if (pathname !== "/api/pane/fork") return null;
  setRequestRoute(pathname);
  if (request.method !== "POST") return badRequest("method_not_allowed", "use POST");
  const payload = await readJsonObject<{ pane_id?: unknown; mode?: unknown; end_ts?: unknown }>(request);
  if (payload instanceof Response) return payload;
  if (typeof payload.pane_id !== "string" || payload.pane_id.length === 0) return badRequest("missing_pane_id", "pane_id is required");
  const mode = payload.mode ?? "tab";
  if (typeof mode !== "string" || !MODES.has(mode)) return badRequest("invalid_mode", "mode is tab, right or down");
  const endTs = payload.end_ts;
  if (endTs !== undefined && (typeof endTs !== "string" || endTs.length === 0 || endTs.length > 64)) return badRequest("invalid_end_ts", "end_ts is a reply's end timestamp");
  try {
    const point = endTs === undefined ? null : await forkPointOf(payload.pane_id, endTs, stores);
    // No overall timeout: every herdr call inside forkSession has its own, and racing one would not stop it.
    const made = await forkSession({
      pane: payload.pane_id,
      mode: mode as ForkMode,
      ...(point ? { at: point.at } : {}),
      codexHome: point?.codexHome ?? stores.codexHome,
      herdrBin: process.env.OVIS_HERDR_BIN || undefined,
    });
    return jsonResponse({ pane_id: made.pane });
  } catch (error) {
    if (error instanceof ConversationUnavailable) return conflictResponse("no_transcript", "this pane has no transcript to fork from");
    // herdr's failures are ours (502); quick-fork's other codes describe the request
    if (error instanceof ForkError) return jsonResponse({ error: { code: error.code, message: error.message } }, error.code === "herdr" ? 502 : 400);
    return errorResponse(error);
  }
}
