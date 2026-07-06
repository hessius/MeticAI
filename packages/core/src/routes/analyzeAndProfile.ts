/**
 * analyze_and_profile route: full AI profile generation.
 *
 * Generates a complete espresso profile from the user's stated preferences
 * (and an optional reference image), converts the model's JSON to OEPF, and
 * saves the new profile to the machine. Port of the two parity oracles:
 *   - server: apps/server/api/routes (profile generation service)
 *   - native: apps/web/src/services/interceptor/DirectModeInterceptor.ts
 *             (POST /api/analyze_and_profile) + BrowserAIService.generateProfile
 *
 * The AI orchestration (prompt building, validate/retry) is the shared core
 * profilePromptFull module; the model JSON -> OEPF conversion is the shared
 * core oepf module. Both stay host-free; the AI call and the machine write go
 * through the Platform seam.
 *
 * Route (also served under the bare /analyze_and_profile alias):
 *   POST /api/analyze_and_profile
 *     -> { status: "success"|"error", analysis, reply }
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";
import { buildFullProfilePrompt, validateAndRetryProfile } from "../ai/profilePromptFull";
import { convertGeminiToOEPF } from "../logic/oepf";

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Portable base64 encoder (no btoa/Buffer) so the core stays host-free. */
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

interface UploadedFile {
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

function formString(form: { get(key: string): unknown }, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function resolveAuthorName(platform: Platform): Promise<string> {
  try {
    const settings = await platform.storage.settings.read("settings");
    if (settings && typeof settings === "object") {
      const record = settings as Record<string, unknown>;
      const candidate = record.author_name ?? record.authorName;
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  } catch {
    // fall through to the default
  }
  return "Metic";
}

export async function handleAnalyzeAndProfileRoute(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const normalized = pathname.startsWith("/api/") ? pathname.slice(4) : pathname;
  if (normalized !== "/analyze_and_profile" || req.method !== "POST") return null;

  try {
    if (!platform.ai.isConfigured()) {
      return jsonResponse({
        status: "error",
        reply:
          "AI features are unavailable. Please configure a Gemini API key in Settings.",
        analysis: "",
      });
    }

    const form = await req.formData();
    const fileValue = form.get("file");
    const image = isUploadedFile(fileValue) ? fileValue : null;
    const preferences = [
      formString(form, "user_prefs"),
      formString(form, "advanced_customization"),
      formString(form, "detailed_knowledge"),
    ]
      .filter(Boolean)
      .join("\n\n");

    const authorName = await resolveAuthorName(platform);
    const systemPrompt = buildFullProfilePrompt(authorName, preferences, [], !!image);

    const parts: Array<Record<string, unknown>> = [];
    if (image) {
      const buffer = new Uint8Array(await image.arrayBuffer());
      parts.push({
        inlineData: { mimeType: image.type || "image/jpeg", data: toBase64(buffer) },
      });
    }
    parts.push({ text: systemPrompt });

    const response = await platform.ai.generateText({
      contents: [{ role: "user", parts }],
    });

    const generateFix = async (fixPrompt: string): Promise<string> => {
      const fixResponse = await platform.ai.generateText({
        contents: [{ role: "user", parts: [{ text: fixPrompt }] }],
      });
      return fixResponse.text;
    };

    const { reply: validatedReply } = await validateAndRetryProfile(
      response.text,
      generateFix,
    );
    const text = validatedReply;

    const cleanAnalysis = text
      .replace(/```json\s*[\s\S]*?```/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Save the generated profile to the machine (best-effort, matching native).
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const raw = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
        const oepf = convertGeminiToOEPF(raw);
        const saveResponse = await platform.machine.fetch("/api/v1/profile/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(oepf),
        });
        if (saveResponse.ok && oepf.id && cleanAnalysis) {
          await platform.storage.descriptions.write(String(oepf.id), cleanAnalysis);
        }
      } catch (err) {
        platform.logger.debug("analyze_and_profile: failed to save profile", err);
      }
    }

    return jsonResponse({
      status: "success",
      analysis: image ? cleanAnalysis : "",
      reply: text,
    });
  } catch (err) {
    const reply = err instanceof Error ? err.message : "Failed to generate profile";
    return jsonResponse({ status: "error", reply, analysis: "" });
  }
}
