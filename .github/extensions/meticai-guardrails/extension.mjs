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
    const content = loadConventions();
    if (!content) {
        return "PROJECT CONVENTIONS: Read .github/CONVENTIONS.md for all project rules.";
    }

    const lines = content.split("\n");
    const keySections = ["Quality Gates", "Branch Naming", "Testing", "Commits", "Internationalization"];
    const summary = ["PROJECT CONVENTIONS (auto-injected from .github/CONVENTIONS.md):"];

    let inKeySection = false;
    let bulletCount = 0;
    const maxBullets = 3;

    for (const line of lines) {
        if (line.startsWith("## ")) {
            const sectionName = line.replace("## ", "").trim();
            inKeySection = keySections.some(s => sectionName.includes(s));
            bulletCount = 0;
            if (inKeySection) {
                summary.push("");
                summary.push(line);
            }
        } else if (inKeySection && line.startsWith("- ") && bulletCount < maxBullets) {
            summary.push(line);
            bulletCount++;
        } else if (inKeySection && line.startsWith("```")) {
            inKeySection = false; // skip code blocks
        }
    }

    summary.push("");
    summary.push("Full conventions: .github/CONVENTIONS.md");
    return summary.join("\n");
}

function getVerificationChecklist() {
    return `VERIFICATION CHECKLIST — Complete ALL before marking task done:
1. Backend tests pass: cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -q
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
                    backend: "cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -q 2>&1",
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
