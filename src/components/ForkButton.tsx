/**
 * Downstream (FL-Penly/ovis): a finished reply's Fork button. The session is forked as it stood at the
 * end of that reply into a new tab of the same workspace, by server/fork-routes.ts. Only this PC's
 * panes offer it: another PC runs the published bundle, which has no fork route. See DOWNSTREAM.md.
 */
import { Check, GitFork, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { LOCAL_MACHINE, machinePath } from "../../shared/machines.ts";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineId } from "../lib/machineContext.tsx";

type ForkState = "idle" | "busy" | "done";

export function ForkButton({ paneId, endTs }: { paneId: string; endTs: string }) {
  const t = useT();
  const machineId = useMachineId();
  const [state, setState] = useState<ForkState>("idle");
  const [error, setError] = useState<string | null>(null);
  if (machineId !== LOCAL_MACHINE) return null;
  const fork = async (): Promise<void> => {
    if (state === "busy") return;
    setState("busy");
    setError(null);
    try {
      const url = machinePath(machineId, "pane/fork");
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pane_id: paneId, end_ts: endTs, mode: "tab" }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new ApiError(url, response.status, body?.error?.message ?? response.statusText, null);
      }
      setState("done");
      window.setTimeout(() => setState("idle"), 2000);
    } catch (reason) {
      setState("idle");
      setError(reason instanceof ApiError ? reason.detail : String(reason));
    }
  };
  const label = state === "busy" ? t("Forking…") : state === "done" ? t("Forked into a new tab") : t("Fork into a new tab");
  return <>
    <button type="button" className="icon-button chat-copy chat-fork" aria-label={label} title={label} disabled={state === "busy"} onClick={() => void fork()}>
      {state === "busy" ? <LoaderCircle aria-hidden="true" /> : state === "done" ? <Check aria-hidden="true" /> : <GitFork aria-hidden="true" />}
    </button>
    {error !== null && <span className="chat-copy-error" role="alert">{t("Couldn't fork: {reason}", { reason: error })}</span>}
  </>;
}
