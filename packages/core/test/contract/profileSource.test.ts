import { describe, test, expect } from "vitest";
import {
  parseMetprofilesId,
  metprofilesDownloadUrl,
  classifyProfileSource,
  resolveProfileFromSource,
  ProfileSourceError,
} from "../../src/logic/profileSource";

const PROFILE = { name: "Slay-ish", temperature: 88, final_weight: 40, stages: [] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("profileSource: parseMetprofilesId", () => {
  test("extracts the id from /profile/{id}", () => {
    expect(
      parseMetprofilesId(
        "https://metprofiles.link/profile/cd10c990-2185-4633-b883-f3fa4ed7dbfd",
      ),
    ).toBe("cd10c990-2185-4633-b883-f3fa4ed7dbfd");
  });

  test("accepts www and trailing segments", () => {
    expect(
      parseMetprofilesId(
        "https://www.metprofiles.link/profile/cd10c990-2185-4633-b883-f3fa4ed7dbfd/json",
      ),
    ).toBe("cd10c990-2185-4633-b883-f3fa4ed7dbfd");
  });

  test("rejects other hosts and non-urls", () => {
    expect(parseMetprofilesId("https://example.com/profile/x")).toBeNull();
    expect(parseMetprofilesId("not a url")).toBeNull();
    expect(parseMetprofilesId("https://metprofiles.link/about")).toBeNull();
  });
});

describe("profileSource: classifyProfileSource", () => {
  test("classifies metprofiles, url, and json", () => {
    expect(
      classifyProfileSource(
        "https://metprofiles.link/profile/cd10c990-2185-4633-b883-f3fa4ed7dbfd",
      ),
    ).toBe("metprofiles");
    expect(classifyProfileSource("https://example.com/p.json")).toBe("url");
    expect(classifyProfileSource('{"name":"x"}')).toBe("json");
    expect(classifyProfileSource("  \n {\"name\":\"x\"} ")).toBe("json");
  });
});

describe("profileSource: metprofilesDownloadUrl", () => {
  test("builds the public download endpoint", () => {
    expect(metprofilesDownloadUrl("abc")).toBe(
      "https://metprofiles.link/api/profiles/abc/download",
    );
  });
});

describe("profileSource: resolveProfileFromSource", () => {
  test("resolves a metprofiles link via the download endpoint", async () => {
    const seen: string[] = [];
    const fetchFn = async (u: string) => {
      seen.push(u);
      return jsonResponse(PROFILE);
    };
    const res = await resolveProfileFromSource(
      "https://metprofiles.link/profile/cd10c990-2185-4633-b883-f3fa4ed7dbfd",
      fetchFn,
    );
    expect(seen).toEqual([
      "https://metprofiles.link/api/profiles/cd10c990-2185-4633-b883-f3fa4ed7dbfd/download",
    ]);
    expect(res.sourceKind).toBe("metprofiles");
    expect(res.convertedFromDecent).toBe(false);
    expect(res.profile.name).toBe("Slay-ish");
  });

  test("resolves a direct JSON link as-is", async () => {
    const fetchFn = async (u: string) => {
      expect(u).toBe("https://example.com/p.json");
      return jsonResponse(PROFILE);
    };
    const res = await resolveProfileFromSource("https://example.com/p.json", fetchFn);
    expect(res.sourceKind).toBe("url");
    expect(res.profile.name).toBe("Slay-ish");
  });

  test("parses raw JSON text without any fetch", async () => {
    const fetchFn = async () => {
      throw new Error("should not fetch");
    };
    const res = await resolveProfileFromSource(JSON.stringify(PROFILE), fetchFn);
    expect(res.sourceKind).toBe("json");
    expect(res.profile.name).toBe("Slay-ish");
  });

  test("auto-detects and converts a Decent profile", async () => {
    const decent = {
      title: "Decent One",
      author: "me",
      steps: [{ name: "s", pump: "pressure", pressure: 9, seconds: 30 }],
    };
    const res = await resolveProfileFromSource(JSON.stringify(decent), async () => {
      throw new Error("no fetch");
    });
    expect(res.convertedFromDecent).toBe(true);
    expect(res.profile.name).toBe("Decent One");
  });

  test("empty input throws 'empty'", async () => {
    await expect(
      resolveProfileFromSource("   ", async () => jsonResponse(PROFILE)),
    ).rejects.toMatchObject({ code: "empty" });
  });

  test("garbage text throws 'invalid_input'", async () => {
    await expect(
      resolveProfileFromSource("just some words", async () => jsonResponse(PROFILE)),
    ).rejects.toBeInstanceOf(ProfileSourceError);
    await expect(
      resolveProfileFromSource("just some words", async () => jsonResponse(PROFILE)),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("fetch error throws 'fetch_failed'", async () => {
    await expect(
      resolveProfileFromSource("https://example.com/p.json", async () => {
        throw new Error("network");
      }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });

  test("non-ok response throws 'fetch_failed'", async () => {
    await expect(
      resolveProfileFromSource("https://example.com/p.json", async () =>
        jsonResponse({ detail: "nope" }, 404),
      ),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });

  test("non-json response throws 'invalid_json'", async () => {
    await expect(
      resolveProfileFromSource(
        "https://example.com/p.json",
        async () => new Response("<html></html>", { status: 200 }),
      ),
    ).rejects.toMatchObject({ code: "invalid_json" });
  });

  test("valid json that is not a profile throws 'not_a_profile'", async () => {
    await expect(
      resolveProfileFromSource('{"foo":"bar"}', async () => jsonResponse(PROFILE)),
    ).rejects.toMatchObject({ code: "not_a_profile" });
  });
});
