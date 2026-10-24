/**
 * Downstream (FL-Penly/ovis): a finished reply's Fork button. The session is forked as it stood at the
 * end of that reply, into a new tab of the same workspace or a split beside the pane, by
 * server/fork-routes.ts. Only this PC's panes offer it: another PC runs the published bundle, which
 * has no fork route. See DOWNSTREAM.md.
 */
import { AppWindow, Check, Columns2, GitFork, LoaderCircle, Rows2 } from "lucide-react";
import { useState } from "react";
import { LOCAL_MACHINE, machinePath } from "../../shared/machines.ts";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import { RowMenu } from "./RowMenu.tsx";
import "./ForkButton.css";

type ForkState = "idle" | "busy" | "done";
type ForkMode = "tab" | "right" | "down";

export function ForkButton({ paneId, endTs }: { paneId: string; endTs: string }) {
  const t = useT();
  const machineId = useMachineId();
  const [state, setState] = useState<ForkState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  if (machineId !== LOCAL_MACHINE) return null;
  const fork = async (mode: ForkMode): Promise<void> => {
    if (state === "busy") return;
    setState("busy");
    setError(null);
    try {
      const url = machinePath(machineId, "pane/fork");
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pane_id: paneId, end_ts: endTs, mode }),
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
  const label = state === "busy" ? t("Forking…") : state === "done" ? t("Forked") : t("Fork from this reply");
  return <>
    <button type="button" className="icon-button chat-copy chat-fork" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={menu !== null}
      disabled={state === "busy"} onClick={(event) => setMenu(menu ? null : event.currentTarget)}>
      {state === "busy" ? <LoaderCircle aria-hidden="true" /> : state === "done" ? <Check aria-hidden="true" /> : <GitFork aria-hidden="true" />}
    </button>
    {menu && <RowMenu anchor={menu} title={t("Fork from this reply")} align="end" onClose={() => setMenu(null)} items={[
      { id: "fork-tab", label: t("Fork into a new tab"), icon: AppWindow, run: () => void fork("tab") },
      { id: "fork-right", label: t("Fork into a split on the right"), icon: Columns2, run: () => void fork("right") },
      { id: "fork-down", label: t("Fork into a split below"), icon: Rows2, run: () => void fork("down") },
    ]} />}
    {error !== null && <span className="chat-copy-error" role="alert">{t("Couldn't fork: {reason}", { reason: error })}</span>}
  </>;
}
