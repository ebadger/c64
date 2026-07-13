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

export function isSelfMergeAttempt(input) {
    return /\bgh(?:\.exe)?\s+pr\s+merge\b/i.test(getShellCommand(input));
}

export function selfMergeDecision(input) {
    if (!isSelfMergeAttempt(input)) {
        return undefined;
    }
    return {
        permissionDecision: "deny",
        permissionDecisionReason:
            "Self-merge is forbidden. Open the PR for {{CEO}} and stop.",
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
