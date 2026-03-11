import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

const cwd = process.cwd();

function loadConventions() {
    const convPath = join(cwd, ".github", "CONVENTIONS.md");
    if (existsSync(convPath)) {
        return readFileSync(convPath, "utf-8");
    }
    return null;
}

function getConventionsSummary() {
    return `PROJECT CONVENTIONS (auto-injected by meticai-guardrails):
- CI must be completely green before claiming work is done
- Zero tech debt — address all issues immediately, never defer
- All code review comments must be addressed (including suppressed threads)
- VERSION and apps/web/package.json must be bumped together on releases
- Branch naming: version/X.Y.Z for milestones, feat/<name> for features
- All user-facing strings must use i18n t() function (6 locales: en, sv, de, es, fr, it)
- Conventional Commits format with Co-authored-by: Copilot trailer
- Run full test suite before pushing: backend pytest + frontend bun test + lint + build
- Dual route registration (/path + /api/path) is intentional — not a defect
- Read .github/CONVENTIONS.md for the complete set of project rules`;
}

function getVerificationChecklist() {
    return `VERIFICATION CHECKLIST — Complete ALL before marking task done:
1. Backend tests pass: cd apps/server && .venv/bin/python -m pytest test_main.py -q
2. Frontend tests pass: cd apps/web && bun run test:run
3. Lint is clean: cd apps/web && bun run lint
4. Build succeeds: cd apps/web && bun run build
5. CI is green (if pushed to GitHub)
6. No deferred tasks remain
7. PR description is up to date (if applicable)
8. All code review comments addressed`;
}

const session = await joinSession({
    onPermissionRequest: approveAll,
    hooks: {
        onSessionStart: async () => {
            await session.log("MeticAI guardrails active — conventions auto-injected");
            return {
                additionalContext: getConventionsSummary(),
            };
        },
        onUserPromptSubmitted: async (input) => {
            return {
                additionalContext: getConventionsSummary(),
            };
        },
        onPreToolUse: async (input) => {
            if (input.toolName === "task_complete") {
                return {
                    additionalContext: getVerificationChecklist(),
                };
            }
        },
    },
    tools: [
        {
            name: "meticai_conventions",
            description: "Read the full project conventions file (.github/CONVENTIONS.md). Use this to check specific rules or remind yourself of project standards.",
            parameters: {
                type: "object",
                properties: {},
            },
            handler: async () => {
                const content = loadConventions();
                if (content) {
                    return content;
                }
                return "CONVENTIONS.md not found at .github/CONVENTIONS.md";
            },
        },
        {
            name: "meticai_run_tests",
            description: "Run the full MeticAI test suite (backend pytest + frontend tests + lint + build). Returns a summary of pass/fail status.",
            parameters: {
                type: "object",
                properties: {
                    scope: {
                        type: "string",
                        description: "Which tests to run: 'all' (default), 'backend', 'frontend', 'lint', 'build'",
                    },
                },
            },
            handler: async (args) => {
                const scope = args.scope || "all";
                const commands = {
                    backend: "cd apps/server && .venv/bin/python -m pytest test_main.py -q 2>&1",
                    frontend: "cd apps/web && bun run test:run 2>&1",
                    lint: "cd apps/web && bun run lint 2>&1",
                    build: "cd apps/web && bun run build 2>&1",
                };

                const toRun = scope === "all" ? Object.keys(commands) : [scope];
                const results = [];

                for (const name of toRun) {
                    const cmd = commands[name];
                    if (!cmd) {
                        results.push(`${name}: unknown scope`);
                        continue;
                    }
                    const result = await new Promise((resolve) => {
                        execFile("bash", ["-c", cmd], { cwd, timeout: 300000 }, (err, stdout, stderr) => {
                            const output = stdout + stderr;
                            const lastLines = output.split("\n").slice(-10).join("\n");
                            resolve(`## ${name}\n${err ? "FAIL" : "PASS"}\n${lastLines}`);
                        });
                    });
                    results.push(result);
                }

                return results.join("\n\n");
            },
        },
    ],
});
