import { resolve } from "node:path";

const SHELL_TOOLS = new Set(["powershell", "bash", "shell"]);
const LEGACY_FILE_TOOLS = new Set(["edit", "create"]);

const LAYER_PATTERNS = [
    /(^|\/)specs\//i,
    /(^|\/)schema/i,
    /(^|\/)migrations?\//i,
    /(^|\/)api\//i,
    /(^|\/)server\//i,
    /(^|\/)src\//i,
    /(^|\/)web\//i,
    /(^|\/)client\//i,
    /(^|\/)wwwroot\//i,
];

export function isShellTool(toolName) {
    return SHELL_TOOLS.has(toolName);
}

export function getShellCommand(input) {
    if (!isShellTool(input?.toolName)) {
        return "";
    }
    if (typeof input.toolArgs === "string") {
        return input.toolArgs;
    }
    return typeof input.toolArgs?.command === "string"
        ? input.toolArgs.command
        : "";
}

function commandSegments(command) {
    const segments = [];
    let current = "";
    let quote = null;

    for (let index = 0; index < command.length; index += 1) {
        const character = command[index];
        const previous = command[index - 1];

        if (quote) {
            current += character;
            if (
                character === quote &&
                previous !== "\\" &&
                previous !== "`"
            ) {
                quote = null;
            }
            continue;
        }

        if (character === "'" || character === '"') {
            quote = character;
            current += character;
            continue;
        }

        if (character === "#") {
            segments.push(current.trim());
            current = "";
            while (index + 1 < command.length && command[index + 1] !== "\n") {
                index += 1;
            }
            continue;
        }

        const next = command[index + 1];
        if (
            character === "\n" ||
            character === ";" ||
            character === "|" ||
            (character === "&" && next === "&")
        ) {
            segments.push(current.trim());
            current = "";
            if ((character === "|" && next === "|") || next === "&") {
                index += 1;
            }
            continue;
        }

        current += character;
    }

    segments.push(current.trim());
    return segments.filter(Boolean);
}

export function isSelfMergeAttempt(input) {
    const invocation =
        /^(?:(?:&|command|sudo|env)\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:["']?gh(?:\.exe)?["']?)\s+pr\s+merge\b/i;
    return commandSegments(getShellCommand(input)).some((segment) =>
        invocation.test(segment),
    );
}

export function selfMergeDecision(input) {
    if (!isSelfMergeAttempt(input)) {
        return undefined;
    }
    return {
        permissionDecision: "deny",
        permissionDecisionReason:
            "Self-merge is forbidden. Open the PR for the human owner and stop.",
    };
}

export function blockedPrStateDecision(pr) {
    if (pr?.state !== "MERGED" && pr?.state !== "CLOSED") {
        return undefined;
    }
    return {
        permissionDecision: "deny",
        permissionDecisionReason:
            `Push blocked: PR #${pr.number} is ${pr.state}. ` +
            "Move the work to a fresh branch from the default branch.",
    };
}

export function isCommitAttempt(input) {
    return /\bgit(?:\.exe)?\s+commit\b/i.test(getShellCommand(input));
}

export function isPushAttempt(input) {
    return /\bgit(?:\.exe)?\s+push\b/i.test(getShellCommand(input));
}

export function isPullOrReset(input) {
    return /\bgit(?:\.exe)?\s+(?:pull|reset)\b/i.test(getShellCommand(input));
}

export function isCreatePullRequest(input) {
    return input?.toolName === "create_pull_request";
}

export function hooksPathIsActive(configuredPath, workingDirectory) {
    if (typeof configuredPath !== "string" || configuredPath.trim() === "") {
        return false;
    }
    const expected = resolve(workingDirectory, ".githooks");
    const configured = resolve(workingDirectory, configuredPath.trim());
    if (process.platform === "win32") {
        return configured.toLowerCase() === expected.toLowerCase();
    }
    return configured === expected;
}

function normalizePath(path) {
    return path.trim().replace(/^["']|["']$/g, "").replaceAll("\\", "/");
}

export function isLayerPath(path) {
    const normalized = normalizePath(path);
    return LAYER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function patchText(toolArgs) {
    if (typeof toolArgs === "string") {
        return toolArgs;
    }
    if (!toolArgs || typeof toolArgs !== "object") {
        return "";
    }
    for (const key of ["patch", "patchText", "input"]) {
        if (typeof toolArgs[key] === "string") {
            return toolArgs[key];
        }
    }
    return JSON.stringify(toolArgs);
}

export function changedPaths(input) {
    if (input?.toolName === "apply_patch") {
        const paths = [];
        const pattern = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm;
        for (const match of patchText(input.toolArgs).matchAll(pattern)) {
            paths.push(normalizePath(match[1]));
        }
        return paths;
    }

    if (
        LEGACY_FILE_TOOLS.has(input?.toolName) &&
        typeof input.toolArgs?.path === "string"
    ) {
        return [normalizePath(input.toolArgs.path)];
    }

    return [];
}

export function changedLayerPaths(input) {
    return changedPaths(input).filter(isLayerPath);
}
