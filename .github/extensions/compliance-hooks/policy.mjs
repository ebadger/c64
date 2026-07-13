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

function normalizedCommand(input) {
    return getShellCommand(input)
        .replaceAll('"', "")
        .replaceAll("'", "")
        .replaceAll("`", "");
}

export function isCommitAttempt(input) {
    return hasGitSubcommand(input, "commit");
}

export function isInstructionRefreshAttempt(input) {
    return ["pull", "reset", "checkout", "switch"].some((subcommand) =>
        hasGitSubcommand(input, subcommand),
    );
}

function hasGitSubcommand(input, subcommand) {
    const invocation = new RegExp(
        `\\bgit(?:\\.exe)?\\b[\\s\\S]*?[\\s;&|(){}]${subcommand}(?=$|[\\s;&|(){}])`,
        "i",
    );
    return invocation.test(normalizedCommand(input));
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
