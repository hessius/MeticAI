import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedMachine } from "../mockPlatform";
import type { MockMachine } from "../mockPlatform";
import type { PlatformAI } from "../../src/platform";
import { handle } from "../../src/handler";

const VALID_PROFILE = {
  name: "Test Gen Profile",
  temperature: 93,
  final_weight: 36,
  variables: [],
  stages: [
    {
      name: "Infusion",
      type: "pressure",
      exit_triggers: [{ type: "time", value: 30 }],
      limits: [{ type: "flow", value: 8 }],
    },
  ],
};

const VALID_REPLY = `Here is your profile.\n\n\`\`\`json\n${JSON.stringify(
  VALID_PROFILE,
  null,
  2,
)}\n\`\`\`\n\nEnjoy!`;

/** Machine that accepts /profile/save and records the saved body. */
function savingMachine(): { machine: MockMachine; saved: () => Record<string, unknown> | null } {
  let savedBody: Record<string, unknown> | null = null;
  const machine: MockMachine = {
    getBaseUrl: () => "http://machine.test:8080",
    fetch: async (path: string, init?: RequestInit) => {
      const pathname = path.startsWith("http") ? new URL(path).pathname : path.split("?")[0];
      if (pathname === "/api/v1/profile/save") {
        savedBody = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
    },
  };
  return { machine, saved: () => savedBody };
}

/** AI double that records the contents it was called with. */
function capturingAI(text: string): { ai: PlatformAI; calls: () => unknown[] } {
  const calls: unknown[] = [];
  return {
    ai: {
      isConfigured: () => true,
      generateText: async (req) => {
        calls.push(req.contents);
        return { text };
      },
    },
    calls: () => calls,
  };
}

function multipart(fields: Record<string, string>, file?: { name: string; bytes: Uint8Array; type: string }): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) {
    form.set("file", new Blob([file.bytes as unknown as BlobPart], { type: file.type }), file.name);
  }
  return new Request("http://core.test/api/analyze_and_profile", { method: "POST", body: form });
}

describe("POST /api/analyze_and_profile", () => {
  test("returns an error when AI is not configured", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) }); // default unconfigured AI
    const res = await handle(multipart({ user_prefs: "fruity" }), p);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.analysis).toBe("");
    expect(body.reply).toContain("AI features are unavailable");
  });

  test("generates a profile, saves OEPF to the machine, and caches the description", async () => {
    const { machine, saved } = savingMachine();
    const { ai } = capturingAI(VALID_REPLY);
    const p = makeMockPlatform({ machine, ai });
    const res = await handle(multipart({ user_prefs: "bright and fruity" }), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.reply).toBe(VALID_REPLY);
    // No image was provided -> analysis is suppressed.
    expect(body.analysis).toBe("");
    // A valid OEPF profile was saved to the machine.
    const savedBody = saved();
    expect(savedBody).not.toBeNull();
    expect(savedBody!.name).toBe("Test Gen Profile");
    expect(Array.isArray(savedBody!.stages)).toBe(true);
    expect(typeof savedBody!.id).toBe("string");
    // The cleaned analysis is cached under the generated profile id.
    const cached = await p.storage.descriptions.read(String(savedBody!.id));
    expect(typeof cached).toBe("string");
    expect(cached).not.toContain("```json");
  });

  test("includes the cleaned analysis and forwards image bytes when a file is provided", async () => {
    const { machine } = savingMachine();
    const { ai, calls } = capturingAI(VALID_REPLY);
    const p = makeMockPlatform({ machine, ai });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11]);
    const res = await handle(
      multipart({ user_prefs: "espresso" }, { name: "bean.jpg", bytes, type: "image/jpeg" }),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("success");
    // With an image, the human-readable analysis is returned (json stripped).
    expect(body.analysis.length).toBeGreaterThan(0);
    expect(body.analysis).not.toContain("```json");
    // The image was forwarded to the model as inlineData in the first call.
    const firstContents = calls()[0] as Array<{ parts: Array<Record<string, unknown>> }>;
    const parts = firstContents[0].parts;
    expect(parts.some((part) => "inlineData" in part)).toBe(true);
  });

  test("retries once when the first output is invalid, then uses the corrected profile", async () => {
    const invalidReply = "```json\n{\"name\":\"Broken\"}\n```"; // no stages -> invalid
    let call = 0;
    const ai: PlatformAI = {
      isConfigured: () => true,
      generateText: async () => {
        call += 1;
        // First call: the invalid profile. Subsequent (fix) calls: the valid one.
        return { text: call === 1 ? invalidReply : VALID_REPLY };
      },
    };
    const { machine, saved } = savingMachine();
    const p = makeMockPlatform({ machine, ai });
    const res = await handle(multipart({ user_prefs: "x" }), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(call).toBeGreaterThan(1); // a fix pass ran
    expect(saved()!.name).toBe("Test Gen Profile");
  });

  test("returns an error reply when the AI call throws", async () => {
    const ai: PlatformAI = {
      isConfigured: () => true,
      generateText: async () => {
        throw new Error("Gemini exploded");
      },
    };
    const p = makeMockPlatform({ machine: scriptedMachine({}), ai });
    const res = await handle(multipart({ user_prefs: "x" }), p);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.reply).toBe("Gemini exploded");
    expect(body.analysis).toBe("");
  });

  test("is served under the bare /analyze_and_profile alias", async () => {
    const { machine } = savingMachine();
    const { ai } = capturingAI(VALID_REPLY);
    const p = makeMockPlatform({ machine, ai });
    const form = new FormData();
    form.set("user_prefs", "x");
    const req = new Request("http://core.test/analyze_and_profile", { method: "POST", body: form });
    const res = await handle(req, p);
    expect((await res.json()).status).toBe("success");
  });
});
