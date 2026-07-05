import { describe, it, expect } from "vitest";
import { handle } from "../src/handler";
import { makeMockPlatform } from "./mockPlatform";

describe("core handler contract", () => {
  const platform = makeMockPlatform();

  it("answers the health probe", async () => {
    const res = await handle(
      new Request("http://local/api/health"),
      platform,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for an unknown route", async () => {
    const res = await handle(
      new Request("http://local/api/does-not-exist"),
      platform,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("/api/does-not-exist");
  });
});
