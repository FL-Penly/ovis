/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): a split that runs the new tab list's pick
 * (server/split-launch.ts). This PC only: another runs upstream's bundle, which splits to a shell.
 */
import { sendJson } from "./api.ts";

export async function splitPaneWith(paneId: string, direction: "right" | "down", agent: { kind: string; args?: string[] } | null, env?: Record<string, string>): Promise<{ pane_id: string }> {
  const response = await sendJson("/api/pane/split-with", "POST", { pane_id: paneId, direction, ...(agent ? { agent } : {}), ...(env ? { env } : {}) });
  return (await response.json()) as { pane_id: string };
}
