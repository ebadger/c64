import { joinSession } from "@github/copilot-sdk/extension";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
    changedLayerPaths,
    hooksPathIsActive,
    isCommitAttempt,
    isCreatePullRequest,
    isInstructionRefreshAttempt,
    selfMergeDecision,
} from "./policy.mjs";

function repoRoot(workingDirectory) {
    return workingDirectory || process.cwd();
}

async function loadInstruction(workingDirectory, filename) {
    const path = join(
        repoRoot(workingDirectory),
        ".github",
        "instructions",
        filename,
    );
    try {
        return await readFile(path, "utf-8");
    } catch (error) {
        console.error(
            `[compliance-hooks] Could not load ${filename}: ${error.message}`,
        );
        return null;
    }
}

function hooksAreActive(workingDirectory) {
    try {
        const configured = execSync("git config --get core.hooksPath", {
            cwd: repoRoot(workingDirectory),
            encoding: "utf-8",
            timeout: 5000,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return hooksPathIsActive(configured, repoRoot(workingDirectory));
    } catch {
        return false;
    }
}

let crossLayerFiredThisTurn = false;

await joinSession({
    hooks: {
        onSessionStart: async (input) => {
            if (!hooksAreActive(input.workingDirectory)) {
                return {
                    additionalContext:
                        "Activate required git guards: `git config core.hooksPath .githooks`.",
                };
            }
        },

        onUserPromptSubmitted: async () => {
            crossLayerFiredThisTurn = false;
        },

        onPreToolUse: async (input) => {
            const mergeDecision = selfMergeDecision(input);
            if (mergeDecision) {
                return mergeDecision;
            }

            if (isCommitAttempt(input)) {
                const checklist = await loadInstruction(
                    input.workingDirectory,
                    "commit-checklist.md",
                );
                return checklist ? { additionalContext: checklist } : undefined;
            }

            if (isCreatePullRequest(input)) {
                const checklist = await loadInstruction(
                    input.workingDirectory,
                    "pr-checklist.md",
                );
                return checklist ? { additionalContext: checklist } : undefined;
            }
        },

        onPostToolUse: async (input) => {
            if (isInstructionRefreshAttempt(input)) {
                return {
                    additionalContext:
                        "Re-read repository instructions that may have changed before continuing.",
                };
            }

            const paths = changedLayerPaths(input);
            if (paths.length === 0 || crossLayerFiredThisTurn) {
                return;
            }

            crossLayerFiredThisTurn = true;
            const checklist = await loadInstruction(
                input.workingDirectory,
                "onposttooluse.md",
            );
            if (!checklist) {
                return;
            }

            return {
                additionalContext:
                    `${checklist}\n\nChanged layer paths: ${paths.join(", ")}`,
            };
        },
    },
});
