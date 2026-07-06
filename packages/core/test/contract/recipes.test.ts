import { describe, test, expect } from "vitest";
import { makeMockPlatform } from "../mockPlatform";
import { handle } from "../../src/handler";
import { POUR_OVER_RECIPES } from "../../src/data/recipes";

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: "GET" });
}

describe("recipes: GET /api/recipes", () => {
  test("returns the full bundled library, sorted by name", async () => {
    const body = await (await handle(get("/api/recipes"), makeMockPlatform())).json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(POUR_OVER_RECIPES.length);
    const names = body.map((r: { metadata: { name: string } }) => r.metadata.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(body[0]).toHaveProperty("slug");
    expect(body[0]).toHaveProperty("protocol");
  });
});

describe("recipes: GET /api/recipes/{slug}", () => {
  test("returns a single recipe by slug", async () => {
    const slug = POUR_OVER_RECIPES[0]!.slug;
    const body = await (await handle(get(`/api/recipes/${slug}`), makeMockPlatform())).json();
    expect(body.slug).toBe(slug);
  });

  test("404 for an unknown slug", async () => {
    const res = await handle(get("/api/recipes/does-not-exist"), makeMockPlatform());
    expect(res.status).toBe(404);
  });
});
