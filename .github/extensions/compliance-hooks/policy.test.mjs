import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
    changedLayerPaths,
    changedPaths,
    hooksPathIsActive,
    isCommitAttempt,
    isCreatePullRequest,
    isInstructionRefreshAttempt,
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

test("fails closed for shell commands containing a merge token sequence", () => {
    const input = (command) => ({
        toolName: "powershell",
        toolArgs: { command },
    });

    assert.equal(
        isSelfMergeAttempt(input('Write-Host "do not run gh pr merge"')),
        true,
    );
    assert.equal(
        isSelfMergeAttempt(input('node -e "console.log(\'gh pr merge\')"')),
        true,
    );
    assert.equal(isSelfMergeAttempt(input("# gh pr merge 42")), true);
    assert.equal(
        isSelfMergeAttempt(input("git status; gh pr merge 42 --merge")),
        true,
    );
    assert.equal(
        isSelfMergeAttempt(input("gh done#; gh pr merge 42 --merge")),
        true,
    );
    assert.equal(
        isSelfMergeAttempt(
            input('echo "C:\\Users\\test\\"; gh pr merge 42 --merge'),
        ),
        true,
    );
    assert.equal(
        isSelfMergeAttempt(input("Write-Host noop & gh pr merge 42 --merge")),
        true,
    );
    assert.equal(isSelfMergeAttempt(input("(gh pr merge 42 --merge)")), true);
    assert.equal(isSelfMergeAttempt(input('gh pr "merge" 42 --merge')), true);
    assert.equal(isSelfMergeAttempt(input("gh pr `merge` 42 --merge")), true);
});

test("recognizes relative and absolute active hooks paths", () => {
    const root = process.cwd();
    assert.equal(hooksPathIsActive(".githooks", root), true);
    assert.equal(hooksPathIsActive(resolve(root, ".githooks"), root), true);
    assert.equal(hooksPathIsActive(".git-hooks", root), false);
});

test("classifies git lifecycle commands", () => {
    const input = (command) => ({
        toolName: "powershell",
        toolArgs: { command },
    });

    assert.equal(isCommitAttempt(input("git commit -m test")), true);
    assert.equal(
        isCommitAttempt(input("git -c user.name=bot commit -m test")),
        true,
    );
    assert.equal(isInstructionRefreshAttempt(input("git pull --ff-only")), true);
    assert.equal(
        isInstructionRefreshAttempt(input("git reset --soft HEAD~1")),
        true,
    );
    assert.equal(isInstructionRefreshAttempt(input("git checkout main")), true);
    assert.equal(isInstructionRefreshAttempt(input("git switch feature")), true);
    assert.equal(isCommitAttempt(input("git commit-tree HEAD")), false);
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
