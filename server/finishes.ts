import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentStatus, HerdrPane, SessionSnapshot } from "../shared/protocol.ts";
import type { CompletionTracker } from "./completion.ts";
import { herdrSocketPath } from "./herdr/client.ts";

/**
 * The same socket identity evidence as CompletionTracker; include creation time against inode
 * reuse. Windows replaces the pid:start marker's contents, not necessarily its file identity.
 * An unreadable file is not proof of a restart.
 */
export function finishHerdrIdentity(path = herdrSocketPath(), platform = process.platform): string | null {
  try {
    if (platform === "win32") return readFileSync(path, "utf8").trim() || null;
    const stat = statSync(path, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
  } catch { return null; }
}

/**
 * A snapshot's `herdr_lifetime`: a digest of the identity above, so a browser can tell a herdr that
 * replaced the last one (and gives its pane IDs out again) without learning the socket's inode or a
 * Windows pid. Unlike the finish epoch it is the same for every server that reads the same herdr.
 */
export function herdrLifetime(identity: string): string {
  return createHash("sha256").update(`herdr-lifetime:${identity}`).digest("hex").slice(0, 32);
}

/**
 * Only final client-visible statuses enter here, never raw herdr statuses or activity counters.
 * Downstream (DOWNSTREAM.md): with a `file`, the epoch and each pane's counter outlive a restart of
 * this server while herdr keeps running, so a finish read before the restart is still read after
 * it (browsers key what they read by epoch and counter, shared/seen.ts). A new herdr starts afresh.
 */
export class Finishes {
  private generation: string = crypto.randomUUID();
  private identity: string | null;
  private readonly panes = new Map<string, { status: AgentStatus; id: number }>();
  /** what the file holds, so it is written only when that changes */
  private saved = "";

  constructor(private readonly herdr: () => string | null = finishHerdrIdentity, private readonly file: string | null = null) {
    this.identity = herdr();
    if (file === null || this.identity === null) return;
    try {
      const state = JSON.parse(readFileSync(file, "utf8")) as { herdr?: unknown; epoch?: unknown; panes?: unknown };
      if (state.herdr !== this.identity || typeof state.epoch !== "string" || state.epoch === "") return;
      const panes = state.panes && typeof state.panes === "object" && !Array.isArray(state.panes) ? state.panes as Record<string, unknown> : {};
      for (const [paneId, saved] of Object.entries(panes)) {
        const { id, done } = (saved ?? {}) as { id?: unknown; done?: unknown };
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) continue;
        // only DONE decides the next count; any other status is restored as one that is not DONE
        this.panes.set(paneId, { status: done === true ? "done" : "unknown", id });
      }
      this.generation = state.epoch;
      this.saved = this.serialize();
    } catch { /* none yet, or unreadable: a new epoch, as before */ }
  }

  /** herdr's identity read now; null proves nothing */
  herdrIdentity(): string | null { return this.herdr(); }

  get epoch(): string {
    const identity = this.herdr();
    if (identity !== null && identity !== this.identity) {
      if (this.identity !== null) {
        this.generation = crypto.randomUUID();
        this.panes.clear();
      }
      this.identity = identity;
      this.save();
    }
    return this.generation;
  }

  private serialize(): string {
    const panes = Object.fromEntries([...this.panes].map(([paneId, { status, id }]) => [paneId, { id, done: status === "done" }]));
    return JSON.stringify({ herdr: this.identity, epoch: this.generation, panes });
  }

  /** Written whole, and only on a change; a failed write costs only the epoch after a restart. */
  private save(): void {
    if (this.file === null || this.identity === null) return;
    const state = this.serialize();
    if (state === this.saved) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temporary, state, { mode: 0o600 });
      renameSync(temporary, this.file);
      this.saved = state;
    } catch (error) {
      console.error(`finish state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  status(paneId: string, status: AgentStatus): { finish_epoch: string; finish_id: number } {
    const finish_epoch = this.epoch;
    return { finish_epoch, finish_id: this.observe(paneId, status) };
  }

  private observe(paneId: string, status: AgentStatus): number {
    const before = this.panes.get(paneId);
    const finish_id = (before?.id ?? 0) + (status === "done" && before?.status !== "done" ? 1 : 0);
    this.panes.set(paneId, { status, id: finish_id });
    if (before?.id !== finish_id || (before.status === "done") !== (status === "done")) this.save();
    return finish_id;
  }

  snapshot(snapshot: SessionSnapshot, completions: CompletionTracker): SessionSnapshot {
    const finish_epoch = this.epoch;
    const live = new Set(snapshot.panes.map((pane) => pane.pane_id));
    // readSnapshot retains observations newer than its read, including panes absent from an
    // older roster. Only an absence reconciled by that tracker is an authoritative ending.
    for (const paneId of this.panes.keys()) {
      if (!live.has(paneId) && completions.current(paneId) === undefined) this.ended(paneId);
    }
    return { ...snapshot, finish_epoch, panes: snapshot.panes.map((pane) => ({
      ...pane, finish_id: this.observe(pane.pane_id, pane.agent_status),
    })) };
  }

  /** The collector's authoritative recovery observations, before any pending refresh can finish. */
  resync(completions: CompletionTracker, panes: readonly HerdrPane[], newer: ReadonlySet<string>): void {
    completions.resync(panes, newer);
    for (const pane of panes) if (!newer.has(pane.pane_id)) {
      this.status(pane.pane_id, completions.current(pane.pane_id) ?? pane.agent_status);
    }
  }

  /** Keep the counter if herdr reuses an ended pane's ID within this epoch. */
  ended(paneId: string): void {
    const before = this.panes.get(paneId);
    if (before) this.panes.set(paneId, { ...before, status: "unknown" });
    if (before?.status === "done") this.save();
  }
}
