import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedMachine } from "../mockPlatform";
import type { Platform } from "../../src/platform";
import { handle } from "../../src/handler";

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: "GET" });
}

function jsonReq(path: string, method: string, body?: unknown): Request {
  return new Request(`http://x${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

function formPost(path: string, fields: Record<string, string>): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request(`http://x${path}`, { method: "POST", body: fd });
}

const SAMPLE_STAGE = {
  name: "Ramp",
  type: "pressure",
  dynamics: { points: [[0, 6]], over: "time", interpolation: "linear" },
  exit_triggers: [{ type: "time", value: 30 }],
};

describe("profiles-crud: machine/profiles list", () => {
  test("normalises with derived_tags, ai_tags, in_history and has_description", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/list": [
          { id: "p1", name: "Turbo Bloom", display: { description: "Nice" } },
          { id: "p2", name: "Plain" },
        ],
      }),
    });
    await p.storage.aiTags.write("Turbo Bloom", ["fruity", "bright"]);
    const body = await (await handle(get("/api/machine/profiles"), p)).json();
    expect(body.profiles).toHaveLength(2);
    const turbo = body.profiles.find((x: { name: string }) => x.name === "Turbo Bloom");
    expect(turbo.in_history).toBe(true);
    expect(turbo.has_description).toBe(true);
    expect(turbo.ai_tags).toEqual(["fruity", "bright"]);
    expect(Array.isArray(turbo.derived_tags)).toBe(true);
    const plain = body.profiles.find((x: { name: string }) => x.name === "Plain");
    expect(plain.has_description).toBe(false);
    expect(plain.ai_tags).toEqual([]);
  });

  test("returns an empty list when the machine is unreachable", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const body = await (await handle(get("/api/machine/profiles"), p)).json();
    expect(body).toEqual({ profiles: [] });
  });
});

describe("profiles-crud: profile/{name} GET", () => {
  test("returns success with the summary shape", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/list": [
          { id: "p1", name: "Turbo", temperature: 93, final_weight: 40, display: { accentColor: "#f00" } },
        ],
      }),
    });
    const body = await (await handle(get("/api/profile/Turbo"), p)).json();
    expect(body.status).toBe("success");
    expect(body.profile.id).toBe("p1");
    expect(body.profile.accent_color).toBe("#f00");
    expect(body.profile.stages).toBeUndefined();
  });

  test("include_stages=true attaches stages and variables", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/list": [
          { id: "p1", name: "Turbo", stages: [SAMPLE_STAGE], variables: [{ key: "v", value: 1 }] },
        ],
      }),
    });
    const body = await (await handle(get("/api/profile/Turbo?include_stages=true"), p)).json();
    expect(body.profile.stages).toHaveLength(1);
    expect(body.profile.variables).toEqual([{ key: "v", value: 1 }]);
  });

  test("not_found when the profile is absent", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({ "/api/v1/profile/list": [{ id: "p1", name: "Other" }] }),
    });
    const body = await (await handle(get("/api/profile/Missing"), p)).json();
    expect(body.status).toBe("not_found");
    expect(body.profile).toBeNull();
  });
});

describe("profiles-crud: target-curves", () => {
  test("returns estimated curves for a known profile", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/list": [{ id: "p1", name: "Turbo", stages: [SAMPLE_STAGE], variables: [] }],
      }),
    });
    const res = await handle(get("/api/profile/Turbo/target-curves"), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(Array.isArray(body.target_curves)).toBe(true);
  });

  test("404 for an unknown profile", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({ "/api/v1/profile/list": [] }),
    });
    const res = await handle(get("/api/profile/Ghost/target-curves"), p);
    expect(res.status).toBe(404);
  });

  test("fetches the full profile when the list entry lacks stages", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/list": [{ id: "p1", name: "Turbo", variables: [] }],
        "/api/v1/profile/get/p1": { id: "p1", name: "Turbo", stages: [SAMPLE_STAGE], variables: [] },
      }),
    });
    const body = await (await handle(get("/api/profile/Turbo/target-curves"), p)).json();
    expect(body.status).toBe("success");
    expect(body.target_curves.length).toBeGreaterThan(0);
  });
});

describe("profiles-crud: edit", () => {
  test("merges fields, saves to the machine and writes a description", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/list": [{ id: "p1", name: "Turbo", temperature: 90 }],
        "/api/v1/profile/get/p1": {
          id: "p1",
          name: "Turbo",
          temperature: 90,
          final_weight: 36,
          stages: [SAMPLE_STAGE],
          variables: [{ key: "flow", value: 2 }],
        },
        "/api/v1/profile/save": {},
      }),
    });
    const res = await handle(
      jsonReq("/api/profile/Turbo/edit", "PUT", {
        temperature: 94,
        final_weight: 40,
        variables: [{ key: "flow", value: 3 }],
      }),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.profile.temperature).toBe(94);
    expect(body.profile.final_weight).toBe(40);
    expect(body.profile.variables).toContainEqual({ key: "flow", value: 3 });
    expect(body.profile.change_id).toBeUndefined();
    expect(await p.storage.descriptions.read("Turbo")).toBeTruthy();
  });

  test("404 when the profile is not on the machine", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({ "/api/v1/profile/list": [] }) });
    const res = await handle(jsonReq("/api/profile/Ghost/edit", "PUT", { temperature: 94 }), p);
    expect(res.status).toBe(404);
  });

  test("400 on an empty name", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/list": [{ id: "p1", name: "Turbo" }],
        "/api/v1/profile/get/p1": { id: "p1", name: "Turbo" },
      }),
    });
    const res = await handle(jsonReq("/api/profile/Turbo/edit", "PUT", { name: "  " }), p);
    expect(res.status).toBe(400);
  });
});

describe("profiles-crud: rename (PATCH)", () => {
  test("renames and reports the old and new names", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/get/p1": { id: "p1", name: "Old" },
        "/api/v1/profile/save": {},
      }),
    });
    const res = await handle(jsonReq("/api/machine/profile/p1", "PATCH", { name: "New" }), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.old_name).toBe("Old");
    expect(body.new_name).toBe("New");
  });

  test("400 when no name is supplied", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(jsonReq("/api/machine/profile/p1", "PATCH", {}), p);
    expect(res.status).toBe(400);
  });

  test("404 when the profile is unknown", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(jsonReq("/api/machine/profile/p1", "PATCH", { name: "New" }), p);
    expect(res.status).toBe(404);
  });
});

describe("profiles-crud: delete", () => {
  test("deletes via the machine endpoint", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({ "/api/v1/profile/delete/p1": {} }),
    });
    const res = await handle(jsonReq("/api/machine/profile/p1", "DELETE"), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  test("502 when the machine rejects the delete", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(jsonReq("/api/machine/profile/p1", "DELETE"), p);
    expect(res.status).toBe(502);
  });
});

describe("profiles-crud: order", () => {
  test("rejects a non-array order", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(jsonReq("/api/machine/profiles/order", "POST", { order: "x" }), p);
    expect(res.status).toBe(400);
  });

  test("saves a valid order to the machine settings", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({ "/api/v1/settings": {} }) });
    const res = await handle(
      jsonReq("/api/machine/profiles/order", "POST", { order: ["a", "b"] }),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.order).toEqual(["a", "b"]);
  });
});

describe("profiles-crud: load", () => {
  test("loads a profile by id", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({ "/api/v1/profile/load/p1": {} }),
    });
    const res = await handle(jsonReq("/api/machine/profile/load", "POST", { profile_id: "p1" }), p);
    expect(await res.json()).toEqual({ success: true });
  });

  test("400 without a profile_id", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(jsonReq("/api/machine/profile/load", "POST", {}), p);
    expect(res.status).toBe(400);
  });
});

describe("profiles-crud: run-profile", () => {
  test("loads and starts the profile", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/load/p1": {},
        "/api/v1/action/start": {},
      }),
    });
    const res = await handle(jsonReq("/api/machine/run-profile/p1", "POST"), p);
    const body = await res.json();
    expect(body.status).toBe("success");
  });
});

describe("profiles-crud: run-profile-with-overrides", () => {
  const machine = () =>
    scriptedMachine({
      "/api/v1/profile/get/p1": {
        id: "p1",
        name: "Turbo",
        variables: [{ key: "flow", value: 2 }],
      },
      "/api/v1/profile/save": {},
      "/api/v1/profile/load": {},
      "/api/v1/action/start": {},
    });

  test("rejects an invalid save_mode", async () => {
    const p = makeMockPlatform({ machine: machine() });
    const res = await handle(
      formPost("/api/machine/run-profile-with-overrides/p1", {
        overrides_json: "{}",
        save_mode: "bogus",
      }),
      p,
    );
    expect(res.status).toBe(422);
  });

  test("rejects overriding info_ variables", async () => {
    const p = makeMockPlatform({ machine: machine() });
    const res = await handle(
      formPost("/api/machine/run-profile-with-overrides/p1", {
        overrides_json: JSON.stringify({ info_note: 1 }),
        save_mode: "none",
      }),
      p,
    );
    expect(res.status).toBe(422);
  });

  test("requires new_name when save_mode is save_new", async () => {
    const p = makeMockPlatform({ machine: machine() });
    const res = await handle(
      formPost("/api/machine/run-profile-with-overrides/p1", {
        overrides_json: JSON.stringify({ flow: 3 }),
        save_mode: "save_new",
      }),
      p,
    );
    expect(res.status).toBe(422);
  });

  test("applies overrides and starts (save_new) and sets the active override", async () => {
    const p = makeMockPlatform({ machine: machine() });
    const res = await handle(
      formPost("/api/machine/run-profile-with-overrides/p1", {
        overrides_json: JSON.stringify({ flow: 3 }),
        save_mode: "save_new",
        new_name: "Turbo Plus",
      }),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.profile_name).toBe("Turbo Plus");
    expect(body.overrides_applied).toBe(1);
    // The active override should now drive the target curves for the new name.
    const curves = await (await handle(get("/api/profile/Turbo Plus/target-curves"), p)).json();
    expect(curves.status).toBe("success");
  });
});

describe("profiles-crud: import + convert", () => {
  test("import saves a file-source profile to the machine", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({ "/api/v1/profile/save": {} }) });
    const res = await handle(
      jsonReq("/api/profile/import", "POST", {
        source: "file",
        profile: { name: "Imported" },
      }),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.profile_name).toBe("Imported");
    expect(body.uploaded_to_machine).toBe(true);
  });

  test("import-all is a no-op success envelope", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const body = await (await handle(jsonReq("/api/profile/import-all", "POST"), p)).json();
    expect(body.status).toBe("success");
  });

  test("convert-decent rejects a non-Decent body", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(jsonReq("/api/convert-decent", "POST", { not: "decent" }), p);
    expect(res.status).toBe(400);
  });
});

describe("profiles-crud: import-from-url", () => {
  test("400 when no URL is given", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(jsonReq("/api/import-from-url", "POST", {}), p);
    expect(res.status).toBe(400);
  });

  test("fetches, validates the name and saves", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/remote.json": { name: "Remote Profile", stages: [] },
        "/api/v1/profile/save": {},
      }),
    });
    const res = await handle(
      jsonReq("/api/import-from-url", "POST", { url: "http://machine.test:8080/remote.json" }),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.profile_name).toBe("Remote Profile");
  });
});

describe("profiles-crud: sync + orphaned + profile json", () => {
  test("sync/status reports zero counts", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const body = await (await handle(get("/api/profiles/sync/status"), p)).json();
    expect(body).toEqual({ new_count: 0, updated_count: 0, orphaned_count: 0 });
  });

  test("sync returns empty buckets", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const body = await (await handle(jsonReq("/api/profiles/sync", "POST"), p)).json();
    expect(body).toEqual({ status: "success", new: [], updated: [], orphaned: [] });
  });

  test("sync/accept/{id} returns a benign success (no notFound leak)", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(jsonReq("/api/profiles/sync/accept/prof-1", "POST"), p);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "success",
      profile_name: "prof-1",
      content_hash: "",
      ai_description_generated: false,
    });
  });

  test("sync/accept decodes an encoded profile id", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const body = await (
      await handle(jsonReq("/api/profiles/sync/accept/My%20Profile", "POST"), p)
    ).json();
    expect(body.profile_name).toBe("My Profile");
  });

  test("orphaned returns an empty list", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const body = await (await handle(get("/api/machine/profiles/orphaned"), p)).json();
    expect(body).toEqual({ orphaned: [] });
  });

  test("profile/{id}/json wraps the machine payload", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({ "/api/v1/profile/get/p1": { id: "p1", name: "Turbo" } }),
    });
    const body = await (await handle(get("/api/machine/profile/p1/json"), p)).json();
    expect(body.profile).toEqual({ id: "p1", name: "Turbo" });
  });
});

describe("profiles-crud: image-proxy", () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  /** A machine that serves the profile list plus a binary image at a path. */
  function imageMachine(
    list: unknown[],
    fullById: Record<string, unknown> = {},
    imageByPath: Record<string, { bytes: Uint8Array; contentType: string }> = {},
  ): Platform["machine"] {
    return {
      getBaseUrl: () => "http://machine.test:8080",
      fetch: async (path: string) => {
        const pathname = path.startsWith("http") ? new URL(path).pathname : path.split("?")[0]!;
        if (pathname === "/api/v1/profile/list") {
          return new Response(JSON.stringify(list), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const getMatch = pathname.match(/^\/api\/v1\/profile\/get\/(.+)$/);
        if (getMatch && fullById[getMatch[1]!]) {
          return new Response(JSON.stringify(fullById[getMatch[1]!]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (imageByPath[pathname]) {
          const { bytes, contentType } = imageByPath[pathname]!;
          return new Response(bytes as unknown as BodyInit, {
            status: 200,
            headers: { "content-type": contentType },
          });
        }
        return new Response(JSON.stringify({ detail: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      },
    };
  }

  test("fetches a machine-relative image and returns the bytes", async () => {
    const p = makeMockPlatform({
      machine: imageMachine(
        [{ id: "p1", name: "Turbo", display: { image: "/images/turbo.png" } }],
        {},
        { "/images/turbo.png": { bytes: PNG_BYTES, contentType: "image/png" } },
      ),
    });
    const res = await handle(get("/api/profile/Turbo/image-proxy"), p);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test("fetches the full profile when the list entry lacks an image", async () => {
    const p = makeMockPlatform({
      machine: imageMachine(
        [{ id: "p1", name: "Turbo" }],
        { p1: { id: "p1", name: "Turbo", display: { image: "/images/turbo.png" } } },
        { "/images/turbo.png": { bytes: PNG_BYTES, contentType: "image/png" } },
      ),
    });
    const res = await handle(get("/api/profile/Turbo/image-proxy"), p);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test("decodes a data: URI image", async () => {
    // "data:image/png;base64," + base64 of the PNG_BYTES signature
    const b64 = "iVBORw0KGgo=";
    const p = makeMockPlatform({
      machine: imageMachine([
        { id: "p1", name: "Turbo", display: { image: `data:image/png;base64,${b64}` } },
      ]),
    });
    const res = await handle(get("/api/profile/Turbo/image-proxy"), p);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test("returns a placeholder SVG when the profile is missing", async () => {
    const p = makeMockPlatform({ machine: imageMachine([]) });
    const res = await handle(get("/api/profile/Ghost/image-proxy"), p);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });

  test("returns a placeholder SVG when the profile has no image", async () => {
    const p = makeMockPlatform({
      machine: imageMachine([{ id: "p1", name: "Turbo" }], { p1: { id: "p1", name: "Turbo" } }),
    });
    const res = await handle(get("/api/profile/Turbo/image-proxy"), p);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  test("serves a cached image on the second request without refetching", async () => {
    let fetchCount = 0;
    const base = imageMachine(
      [{ id: "p1", name: "Turbo", display: { image: "/images/turbo.png" } }],
      {},
      { "/images/turbo.png": { bytes: PNG_BYTES, contentType: "image/png" } },
    );
    const counting: Platform["machine"] = {
      getBaseUrl: base.getBaseUrl,
      fetch: async (path, init) => {
        if (path.includes("/images/")) fetchCount++;
        return base.fetch(path, init);
      },
    };
    const p = makeMockPlatform({ machine: counting });
    await handle(get("/api/profile/Turbo/image-proxy"), p);
    await handle(get("/api/profile/Turbo/image-proxy"), p);
    expect(fetchCount).toBe(1);
  });
});

describe("profiles-crud: auto-sync", () => {
  test("auto-sync is a no-op success envelope (no notFound leak)", async () => {
    const res = await handle(jsonReq("/api/profiles/auto-sync", "POST", { ai_description: false }), makeMockPlatform());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.imported_count).toBe(0);
    expect(body.updated_count).toBe(0);
  });
});
