import assert from "node:assert/strict";
import test from "node:test";

import {
    blockedPrStateDecision,
    changedLayerPaths,
    changedPaths,
    isCommitAttempt,
    isCreatePullRequest,
    isPullOrReset,
    isPushAttempt,
    isSelfMergeAttempt,
    isShellTool,
    selfMergeDecision,
} from "./policy.mjs";

test("recognizes current shell and PR tool names", () => {
    assert.equal(isShellTool("powershell"), true);
    assert.equal(isCreatePullRequest({ toolName: "create_pull_request" }), true);
    assert.equal(isCreatePullRequest({ toolName: "apply_patch" }), false);
});

test("denies every gh pr merge attempt without path exceptions", () => {
    const input = {
        toolName: "powershell",
        toolArgs: {
            command: "gh pr merge 42 --repo owner/repo # docs/learnings/archive/",
        },
    };
    assert.equal(isSelfMergeAttempt(input), true);
    assert.equal(selfMergeDecision(input)?.permissionDecision, "deny");
});

test("denies pushes only for confirmed dead PR states", () => {
    assert.equal(
        blockedPrStateDecision({ number: 7, state: "MERGED" })
            ?.permissionDecision,
        "deny",
    );
    assert.equal(
        blockedPrStateDecision({ number: 8, state: "CLOSED" })
            ?.permissionDecision,
        "deny",
    );
    assert.equal(
        blockedPrStateDecision({ number: 9, state: "OPEN" }),
        undefined,
    );
});

test("classifies git lifecycle commands", () => {
    const input = (command) => ({
        toolName: "powershell",
        toolArgs: { command },
    });

    assert.equal(isCommitAttempt(input("git commit -m test")), true);
    assert.equal(isPushAttempt(input("git push origin feature")), true);
    assert.equal(isPullOrReset(input("git pull --ff-only")), true);
    assert.equal(isPullOrReset(input("git reset --soft HEAD~1")), true);
});

test("extracts layer paths from current apply_patch calls", () => {
    const input = {
        toolName: "apply_patch",
        toolArgs: {
            patch: [
                "*** Begin Patch",
                "*** Update File: specs/API.md",
                "@@",
                "-old",
                "+new",
                "*** Add File: src/service.ts",
                "+export {};",
                "*** Update File: docs/MISSION.md",
                "@@",
                "-old",
                "+new",
                "*** End Patch",
            ].join("\n"),
        },
    };

    assert.deepEqual(changedPaths(input), [
        "specs/API.md",
        "src/service.ts",
        "docs/MISSION.md",
    ]);
    assert.deepEqual(changedLayerPaths(input), [
        "specs/API.md",
        "src/service.ts",
    ]);
});

test("retains compatibility with structured legacy edit calls", () => {
    assert.deepEqual(
        changedLayerPaths({
            toolName: "edit",
            toolArgs: { path: "client\\pages\\home.tsx" },
        }),
        ["client/pages/home.tsx"],
    );
});
