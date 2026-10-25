/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): `POST /api/pane/split-with {pane_id, direction, agent?, env?}`,
 * a split that runs what the new tab list picked: a shell, or an agent started in the new pane through
 * the one launch path a new tab uses, with a long run's window in its environment (shared/long-run.ts).
 */
import type { Server } from "bun";
import { launchEnvFault } from "../shared/long-run.ts";
import { agentFault, agentLaunch, type AgentPayload } from "./agent-launch.ts";
import { paneSplitWithEnv } from "./herdr/client.ts";
import { badRequest, errorResponse, jsonResponse, readJsonObject, setRequestRoute } from "./http.ts";
import type { ShellAgentLocator } from "./shell-agent.ts";

export async function handleSplitWith(request: Request, pathname: string, bunServer: Pick<Server<unknown>, "timeout">, shellAgents?: ShellAgentLocator): Promise<Response> {
  setRequestRoute(pathname);
  if (request.method !== "POST") return badRequest("method_not_allowed", "use POST");
  const payload = await readJsonObject<{ pane_id?: unknown; direction?: unknown; agent?: AgentPayload | null; env?: unknown }>(request);
  if (payload instanceof Response) return payload;
  if (typeof payload.pane_id !== "string" || !payload.pane_id.trim()) return badRequest("missing_pane_id", "pane_id is required");
  if (payload.direction !== "right" && payload.direction !== "down") return badRequest("invalid_direction", "direction must be right or down");
  const agent = payload.agent ?? undefined;
  const fault = agentFault(agent);
  if (fault !== null) return badRequest("invalid_agent", fault);
  const envFault = launchEnvFault(payload.env);
  if (envFault !== null) return badRequest("invalid_env", envFault);
  // agent.start can legitimately take a minute; Bun's default idle timeout is shorter
  if (agent) bunServer.timeout(request, 75);
  try {
    const pane = await paneSplitWithEnv(payload.pane_id, payload.direction, payload.env ? payload.env as Record<string, string> : undefined);
    if (!agent) return jsonResponse({ pane_id: pane.pane_id, agent_started: false });
    return jsonResponse({ pane_id: pane.pane_id, ...await agentLaunch(pane.pane_id, agent, undefined, shellAgents) });
  } catch (error) {
    return errorResponse(error);
  }
}
