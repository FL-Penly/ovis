import { describe, expect, it } from "bun:test";
import { handleLocalRequest } from "./localExtensions.ts";

// Downstream (DOWNSTREAM.md): the slot for local/server. Only answers that read or write nothing,
// whether or not this checkout has a local/ extension.
describe("local extension routes", () => {
  const request = (path: string): [Request, URL, string] => {
    const url = new URL(`http://localhost${path}`);
    return [new Request(url), url, url.pathname];
  };

  it("leaves every other path to the routes after it", async () => {
    expect(await handleLocalRequest(...request("/api/pane/fork"), false)).toBeNull();
  });

  it("refuses a watching device, reads included", async () => {
    const response = await handleLocalRequest(...request("/api/local/user-config"), true);
    expect(response?.status).toBe(403);
  });

  it("answers a path no extension knows with 404", async () => {
    const response = await handleLocalRequest(...request("/api/local/no-such-route"), false);
    expect(response?.status).toBe(404);
  });
});
