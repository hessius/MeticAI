import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

const cwd = process.cwd();
const CONVENTIONS_PATH = join(cwd, ".github", "CONVENTIONS.md");

const CORRECTION_PATTERNS = [
    /\bdon'?t\b.*\b(do|use|add|create|make)\b/i,
    /\balways\b.*\b(use|include|add|run|check)\b/i,
    /\bnever\b.*\b(do|use|skip|forget|omit)\b/i,
    /\bremember\s+to\b/i,
    /\bstop\s+(doing|using|adding)\b/i,
    /\bI\s+told\s+you\b/i,
    /\bthat'?s\s+(wrong|incorrect|not right)\b/i,
    /\bupdate\s+(CLAUDE|conventions|rules)\b/i,
];

function detectCorrection(prompt) {
    return CORRECTION_PATTERNS.some((pattern) => pattern.test(prompt));
}

const session = await joinSession({
    onPermissionRequest: approveAll,
    hooks: {
        onUserPromptSubmitted: async (input) => {
            if (detectCorrection(input.prompt)) {
                return {
                    additionalContext:
                        "The user appears to be correcting a behavior or establishing a rule. " +
                        "After addressing their request, consider whether this correction should become a permanent convention. " +
                        "If so, use the `learn_convention` tool to append it to .github/CONVENTIONS.md so it persists across sessions.",
                };
            }
        },
        onPostToolUse: async (input) => {
            if (
                (input.toolName === "edit" || input.toolName === "create") &&
                String(input.toolArgs?.path || "").includes("CONVENTIONS.md")
            ) {
                await session.log("Convention file updated — rule will persist across sessions");
            }
        },
        onSessionEnd: async () => {
            return {
                sessionSummary:
                    "Check if any corrections from this session should be persisted as conventions in .github/CONVENTIONS.md",
            };
        },
    },
    tools: [
        {
            name: "learn_convention",
            description:
                "Add a new convention rule to .github/CONVENTIONS.md. Use this when the user establishes a new rule, corrects a behavior, or when you discover a pattern that should be remembered. The rule is appended to the specified section.",
            parameters: {
                type: "object",
                properties: {
                    section: {
                        type: "string",
                        description:
                            "The section header to append under (e.g., 'Quality Gates', 'Code Style', 'Testing', 'Architecture Patterns'). If the section doesn't exist, it will be created.",
                    },
                    rule: {
                        type: "string",
                        description:
                            "The convention rule to add. Should be a clear, concise statement starting with a verb or 'Do/Don't'. Example: 'Always run E2E tests after Docker container changes.'",
                    },
                },
                required: ["section", "rule"],
            },
            handler: async (args) => {
                if (!existsSync(CONVENTIONS_PATH)) {
                    return "Error: .github/CONVENTIONS.md not found";
                }

                let content = readFileSync(CONVENTIONS_PATH, "utf-8");

                // Find all existing section headers
                const headerRegex = /^## .+$/gm;
                const headers = [];
                let headerMatch;
                while ((headerMatch = headerRegex.exec(content)) !== null) {
                    headers.push({ text: headerMatch[0], index: headerMatch.index });
                }

                // Case-insensitive fuzzy match: find best matching header
                const inputLower = args.section.toLowerCase();
                const matchedHeader = headers.find(h =>
                    h.text.replace("## ", "").toLowerCase().includes(inputLower) ||
                    inputLower.includes(h.text.replace("## ", "").toLowerCase())
                );

                if (matchedHeader) {
                    const sectionStart = matchedHeader.index + matchedHeader.text.length;
                    const nextHeader = headers.find(h => h.index > matchedHeader.index);
                    const nextSection = nextHeader ? nextHeader.index : -1;
                    const lastFooter = content.lastIndexOf("\n---\n");
                    const insertAt =
                        nextSection !== -1
                            ? nextSection
                            : lastFooter !== -1 && lastFooter > sectionStart
                                ? lastFooter
                                : content.length;

                    const sectionContent = content.substring(sectionStart, insertAt);

                    // Detect list style: numbered (1. 2. 3.) vs bullet (- )
                    const numberedPattern = /\n\s*(\d+)\.\s/g;
                    const numberedMatches = [...sectionContent.matchAll(numberedPattern)];
                    let newRule;
                    if (numberedMatches.length > 0) {
                        const lastNum = Math.max(...numberedMatches.map(m => parseInt(m[1], 10)));
                        newRule = `\n${lastNum + 1}. ${args.rule}`;
                    } else {
                        newRule = `\n- ${args.rule}`;
                    }

                    content = content.substring(0, insertAt) + newRule + "\n" + content.substring(insertAt);
                } else {
                    const lastUpdated = content.lastIndexOf("\n---\n");
                    const insertAt = lastUpdated !== -1 ? lastUpdated : content.length;
                    content = content.substring(0, insertAt) + `\n\n## ${args.section}\n\n- ${args.rule}\n` + content.substring(insertAt);
                }

                const tmpPath = CONVENTIONS_PATH + ".tmp";
                writeFileSync(tmpPath, content, "utf-8");
                renameSync(tmpPath, CONVENTIONS_PATH);
                await session.log(`Learned new convention in "${args.section}": ${args.rule}`);
                return `Added to "${args.section}": ${args.rule}`;
            },
        },
        {
            name: "review_conventions",
            description:
                "Read and return the full .github/CONVENTIONS.md file for review. Use this to check what conventions are currently defined.",
            parameters: {
                type: "object",
                properties: {},
            },
            handler: async () => {
                if (!existsSync(CONVENTIONS_PATH)) {
                    return "Error: .github/CONVENTIONS.md not found";
                }
                return readFileSync(CONVENTIONS_PATH, "utf-8");
            },
        },
    ],
});
