/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): server/index.ts in OVIS_LOCAL_DIR, when that is set and
 * the file exists, answers /api/local/*. It runs after the token check and the same-origin check; a
 * watching device gets none of it, reads included. Its default export takes the request and answers it, or null for a path it
 * does not know.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { jsonResponse, setRequestRoute } from "./http.ts";

type LocalHandler = (request: Request, url: URL, pathname: string) => Promise<Response | null> | Response | null;

/** read once: the extension is the one the server started with */
const LOCAL_DIR = process.env["OVIS_LOCAL_DIR"];
const ENTRY = LOCAL_DIR ? resolve(LOCAL_DIR, "server/index.ts") : null;
let handler: Promise<LocalHandler | null> | null = null;

export async function handleLocalRequest(request: Request, url: URL, pathname: string, readOnly: boolean): Promise<Response | null> {
  if (!pathname.startsWith("/api/local/")) return null;
  setRequestRoute("/api/local");
  if (readOnly) return jsonResponse({ error: { code: "read_only", message: "this device can only watch" } }, 403);
  handler ??= ENTRY !== null && existsSync(ENTRY) ? import(ENTRY).then((module: { default?: LocalHandler }) => module.default ?? null) : Promise.resolve(null);
  const local = await handler;
  const response = local ? await local(request, url, pathname) : null;
  return response ?? jsonResponse({ error: { code: "not_found", message: "not found" } }, 404);
}
