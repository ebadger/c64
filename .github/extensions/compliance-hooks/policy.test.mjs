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
    isShellTool,
} from "./policy.mjs";

test("recognizes current shell and PR tool names", () => {
    assert.equal(isShellTool("powershell"), true);
    assert.equal(isCreatePullRequest({ toolName: "create_pull_request" }), true);
    assert.equal(isCreatePullRequest({ toolName: "apply_patch" }), false);
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
                "*** Update File: specs/MEDIA.md",
                "@@",
                "-old",
                "+new",
                "*** Add File: src/core/machine.cpp",
                "+int machine = 0;",
                "*** Update File: gallery.json",
                "@@",
                "-[]",
                "+[{}]",
                "*** Update File: docs/MISSION.md",
                "@@",
                "-old",
                "+new",
                "*** End Patch",
            ].join("\n"),
        },
    };

    assert.deepEqual(changedPaths(input), [
        "specs/MEDIA.md",
        "src/core/machine.cpp",
        "gallery.json",
        "docs/MISSION.md",
    ]);
    assert.deepEqual(changedLayerPaths(input), [
        "specs/MEDIA.md",
        "src/core/machine.cpp",
        "gallery.json",
    ]);
});

test("recognizes c64 implementation and build surfaces", () => {
    assert.deepEqual(
        changedLayerPaths({
            toolName: "edit",
            toolArgs: { path: "web\\emulator.js" },
        }),
        ["web/emulator.js"],
    );
    assert.deepEqual(
        changedLayerPaths({
            toolName: "apply_patch",
            toolArgs: {
                patch: [
                    "*** Begin Patch",
                    "*** Update File: CMakeLists.txt",
                    "@@",
                    "-old",
                    "+new",
                    "*** Update File: .github/workflows/pages.yml",
                    "@@",
                    "-old",
                    "+new",
                    "*** End Patch",
                ].join("\n"),
            },
        }),
        ["CMakeLists.txt", ".github/workflows/pages.yml"],
    );
});
