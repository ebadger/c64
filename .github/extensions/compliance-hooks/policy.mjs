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

function isEscaped(command, index, toolName) {
    const escapeCharacter = toolName === "powershell" ? "`" : "\\";
    let escapeCount = 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (command[cursor] !== escapeCharacter) {
            break;
        }
        escapeCount += 1;
    }
    return escapeCount % 2 === 1;
}

function commandSegments(command, toolName) {
    const segments = [];
    let current = "";
    let quote = null;

    for (let index = 0; index < command.length; index += 1) {
        const character = command[index];
        if (quote) {
            current += character;
            const singleQuotedPosix =
                toolName !== "powershell" && quote === "'";
            if (
                character === quote &&
                (singleQuotedPosix ||
                    !isEscaped(command, index, toolName))
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

        const previous = command[index - 1];
        const startsComment =
            character === "#" &&
            !isEscaped(command, index, toolName) &&
            (index === 0 || /[\s;&|()]/.test(previous));
        if (startsComment) {
            segments.push(current.trim());
            current = "";
            while (index + 1 < command.length && command[index + 1] !== "\n") {
                index += 1;
            }
            continue;
        }

        const next = command[index + 1];
        const escaped = isEscaped(command, index, toolName);
        const separator =
            character === "\n" ||
            character === ";" ||
            character === "|" ||
            (character === "&" && next === "&");
        if (!escaped && separator) {
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
    return commandSegments(getShellCommand(input), input?.toolName).some((segment) =>
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
    return hasGitInvocation(input, "commit");
}

export function isPushAttempt(input) {
    return hasGitInvocation(input, "push");
}

export function isPullOrReset(input) {
    return hasGitInvocation(input, "pull") || hasGitInvocation(input, "reset");
}

function hasGitInvocation(input, subcommand) {
    const invocation = new RegExp(
        `^(?:(?:&|command|sudo|env)\\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\\S+\\s+)*(?:["']?git(?:\\.exe)?["']?)\\s+${subcommand}(?=\\s|$)`,
        "i",
    );
    return commandSegments(getShellCommand(input), input?.toolName).some(
        (segment) => invocation.test(segment),
    );
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
