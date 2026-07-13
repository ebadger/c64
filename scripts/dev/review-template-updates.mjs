#!/usr/bin/env node
// Review canonical AIProjectTemplate changes without merging them.
import { spawnSync } from "node:child_process";
import {
    closeSync,
    copyFileSync,
    existsSync,
    openSync,
    renameSync,
    unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const sourceFile = resolve(repositoryRoot, ".template-source");
const sourceLockFile = `${sourceFile}.lock`;

function usage() {
    console.log(`Usage:
  node scripts/dev/review-template-updates.mjs check
  node scripts/dev/review-template-updates.mjs acknowledge <upstream-commit>

check fetches and summarizes canonical template changes since .template-source's
checkpoint. acknowledge advances that checkpoint only after every reported change
has been dispositioned according to specs/TEMPLATE-INHERITANCE.md.`);
}

function runGit(args, { timeout = 10000 } = {}) {
    const result = spawnSync("git", args, {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        maxBuffer: 2 * 1024 * 1024,
        timeout,
        windowsHide: true,
    });
    return {
        status: result.status,
        stdout: (result.stdout || "").trim(),
        stderr: (result.stderr || result.error?.message || "").trim(),
    };
}

function configGet(key) {
    const result = runGit(["config", "--file", sourceFile, "--get", key]);
    return result.status === 0 ? result.stdout : "";
}

function normalizeGitHubRepository(value) {
    return value
        .replace(/^https:\/\/github\.com\//, "")
        .replace(/^git@github\.com:/, "")
        .replace(/^ssh:\/\/git@github\.com\//, "")
        .replace(/\.git$/, "")
        .replace(/\/$/, "");
}

function fail(message) {
    console.error(`ERROR: ${message}`);
    return 2;
}

function isFullCommitId(value) {
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function remoteHead(repository, branch, failOpen) {
    const result = runGit([
        "ls-remote",
        "--",
        repository,
        `refs/heads/${branch}`,
    ]);
    const head = result.stdout.split(/\s+/)[0] || "";
    if (result.status !== 0 || !head) {
        const detail = result.stderr ? ` (${result.stderr})` : "";
        const message =
            `Could not resolve ${repository} branch ${branch}${detail}.`;
        if (failOpen) {
            console.warn(`WARNING: ${message} Template check skipped (fail-open).`);
            return null;
        }
        throw new Error(message);
    }
    return head;
}

function fetchTemplate(repository, branch, trackingRef, failOpen) {
    const result = runGit(
        [
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-write-fetch-head",
            "--",
            repository,
            `+refs/heads/${branch}:${trackingRef}`,
        ],
        { timeout: 15000 }
    );
    if (result.status !== 0) {
        const detail = result.stderr ? ` (${result.stderr})` : "";
        const message =
            `Could not fetch ${repository} branch ${branch}${detail}.`;
        if (failOpen) {
            console.warn(`WARNING: ${message} Template check skipped (fail-open).`);
            return false;
        }
        throw new Error(message);
    }
    return true;
}

function commitExists(ref) {
    return (
        runGit(["rev-parse", "--verify", `${ref}^{commit}`]).status === 0
    );
}

function resolveCommit(ref) {
    const result = runGit(["rev-parse", "--verify", `${ref}^{commit}`]);
    return result.status === 0 ? result.stdout : null;
}

function isAncestor(ancestor, descendant) {
    return (
        runGit(["merge-base", "--is-ancestor", ancestor, descendant]).status ===
        0
    );
}

function loadLineage() {
    const repository = configGet("template.repository");
    const branch = configGet("template.branch");
    const lastReviewedRef = configGet("template.lastReviewedRef");
    const lastReviewedAt = configGet("template.lastReviewedAt");

    if (!repository || !branch || !lastReviewedRef) {
        return {
            error:
                ".template-source must define repository, branch, and lastReviewedRef.",
        };
    }

    if (lastReviewedRef.includes("{{") || lastReviewedRef.includes("}}")) {
        const origin = runGit(["remote", "get-url", "origin"]).stdout;
        if (
            origin &&
            normalizeGitHubRepository(origin) ===
                normalizeGitHubRepository(repository)
        ) {
            return { canonical: true };
        }
        return {
            error:
                ".template-source has not been instantiated. Set TEMPLATE_BASE_REF and rerun scripts/dev/instantiate.sh.",
        };
    }
    if (!isFullCommitId(lastReviewedRef)) {
        return {
            error:
                ".template-source lastReviewedRef must be a full upstream commit ID.",
        };
    }
    if (
        lastReviewedAt &&
        !lastReviewedAt.includes("{{") &&
        !/^\d{4}-\d{2}-\d{2}$/.test(lastReviewedAt)
    ) {
        return {
            error:
                ".template-source lastReviewedAt must use YYYY-MM-DD format.",
        };
    }

    const branchCheck = runGit(["check-ref-format", "--branch", branch]);
    if (branchCheck.status !== 0) {
        return { error: `Invalid template branch in .template-source: ${branch}` };
    }

    return {
        repository,
        branch,
        lastReviewedRef,
        lastReviewedAt,
        trackingRef: `refs/template-review/${branch}`,
    };
}

function checkUpdates(lineage) {
    const head = remoteHead(lineage.repository, lineage.branch, true);
    if (!head) {
        return 0;
    }
    if (head === lineage.lastReviewedRef) {
        const reviewed = lineage.lastReviewedAt
            ? ` (reviewed ${lineage.lastReviewedAt})`
            : "";
        console.log(`Template is current at ${head}${reviewed}.`);
        return 0;
    }

    if (
        !fetchTemplate(
            lineage.repository,
            lineage.branch,
            lineage.trackingRef,
            true
        )
    ) {
        return 0;
    }
    if (!commitExists(lineage.lastReviewedRef)) {
        return fail(
            `Reviewed template commit is not available: ${lineage.lastReviewedRef}\n` +
                "Restore a valid checkpoint before acknowledging further updates."
        );
    }
    if (!isAncestor(lineage.lastReviewedRef, lineage.trackingRef)) {
        return fail(
            `The recorded checkpoint is not an ancestor of ${lineage.branch}.\n` +
                "The template may have rewritten history; inspect and repair lineage manually."
        );
    }

    const log = runGit([
        "--no-pager",
        "log",
        "--reverse",
        "--format=  %h %s",
        `${lineage.lastReviewedRef}..${lineage.trackingRef}`,
    ]);
    const stat = runGit([
        "--no-pager",
        "diff",
        "--stat",
        lineage.lastReviewedRef,
        lineage.trackingRef,
    ]);
    if (log.status !== 0 || stat.status !== 0) {
        return fail(
            `Could not summarize template updates: ${log.stderr || stat.stderr}`
        );
    }
    const reviewed = lineage.lastReviewedAt
        ? ` (${lineage.lastReviewedAt})`
        : "";

    console.log(`Template updates available:
  repository:    ${lineage.repository}
  branch:        ${lineage.branch}
  reviewed:      ${lineage.lastReviewedRef}${reviewed}
  upstream HEAD: ${head}

Upstream commits:
${log.stdout}

Changed files:
${stat.stdout || "  (no file changes)"}

Inspect the full patch:
  git --no-pager diff ${lineage.lastReviewedRef} ${lineage.trackingRef}

After every change is adopted, adapted, deferred, or marked not applicable:
  node scripts/dev/review-template-updates.mjs acknowledge ${head}`);
    return 0;
}

function acknowledgeWithLock(lineage, requestedRef) {
    const currentCheckpoint = configGet("template.lastReviewedRef");
    if (currentCheckpoint !== lineage.lastReviewedRef) {
        return fail(
            "The template checkpoint changed during acknowledgement; rerun the review."
        );
    }
    let head;
    try {
        head = remoteHead(lineage.repository, lineage.branch, false);
        fetchTemplate(
            lineage.repository,
            lineage.branch,
            lineage.trackingRef,
            false
        );
    } catch (error) {
        return fail(error.message);
    }

    const target = resolveCommit(requestedRef);
    if (!target) {
        return fail(`Not a fetched template commit: ${requestedRef}`);
    }
    if (!commitExists(lineage.lastReviewedRef)) {
        return fail(
            `Cannot verify the previous checkpoint ${lineage.lastReviewedRef}; repair lineage before acknowledging updates.`
        );
    }
    if (!isAncestor(target, lineage.trackingRef)) {
        return fail(
            `${target} is not on canonical branch ${lineage.branch}.`
        );
    }
    if (!isAncestor(lineage.lastReviewedRef, target)) {
        return fail(
            "Refusing to move the template checkpoint backward or across histories."
        );
    }

    const reviewedAt = new Date().toISOString().slice(0, 10);
    const temporarySource = `${sourceFile}.tmp-${process.pid}-${Date.now()}`;
    try {
        copyFileSync(sourceFile, temporarySource);
        const refUpdate = runGit([
            "config",
            "--file",
            temporarySource,
            "template.lastReviewedRef",
            target,
        ]);
        const dateUpdate = runGit([
            "config",
            "--file",
            temporarySource,
            "template.lastReviewedAt",
            reviewedAt,
        ]);
        if (refUpdate.status !== 0 || dateUpdate.status !== 0) {
            return fail(
                `Could not update .template-source: ${refUpdate.stderr || dateUpdate.stderr}`
            );
        }
        renameSync(temporarySource, sourceFile);
    } catch (error) {
        return fail(
            `Could not atomically update .template-source: ${error.message}`
        );
    } finally {
        if (existsSync(temporarySource)) {
            unlinkSync(temporarySource);
        }
    }

    console.log(
        `Recorded template review through ${target} (${reviewedAt}).`
    );
    if (target !== head) {
        console.log(
            `Note: canonical HEAD is ${head}; newer changes remain for a later review.`
        );
    }
    console.log(
        "Commit .template-source with the reconciliation decisions in the same PR."
    );
    return 0;
}

function acknowledgeUpdates(lineage, requestedRef) {
    if (!isFullCommitId(requestedRef || "")) {
        return fail("acknowledge requires the full reviewed upstream commit.");
    }

    let lockHandle;
    try {
        lockHandle = openSync(sourceLockFile, "wx");
    } catch (error) {
        if (error.code === "EEXIST") {
            return fail(
                "Another acknowledgement is in progress, or .template-source.lock is stale."
            );
        }
        return fail(`Could not lock .template-source: ${error.message}`);
    }

    try {
        return acknowledgeWithLock(lineage, requestedRef);
    } finally {
        closeSync(lockHandle);
        unlinkSync(sourceLockFile);
    }
}

function main() {
    const command = process.argv[2] || "check";
    if (["-h", "--help", "help"].includes(command)) {
        usage();
        return 0;
    }
    if (!["check", "acknowledge"].includes(command)) {
        console.error(`ERROR: Unknown command: ${command}`);
        usage();
        return 2;
    }
    if (
        (command === "check" && process.argv.length !== 3) ||
        (command === "acknowledge" && process.argv.length !== 4)
    ) {
        usage();
        return 2;
    }

    const lineage = loadLineage();
    if (lineage.error) {
        return fail(lineage.error);
    }
    if (lineage.canonical) {
        console.log(
            "Canonical AIProjectTemplate checkout detected; this repository is the upstream source of truth."
        );
        return 0;
    }

    return command === "check"
        ? checkUpdates(lineage)
        : acknowledgeUpdates(lineage, process.argv[3]);
}

process.exitCode = main();
