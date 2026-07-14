# compliance-hooks

This Copilot CLI extension injects short, best-effort context at useful moments.
It is not an enforcement boundary for host tools.

| Event | Behavior |
|-------|----------|
| Session start with inactive hooks | Remind once how to activate `.githooks` |
| Shell appears to attempt `git commit` | Request the concise commit checklist |
| `create_pull_request` | Request the concise PR/review checklist |
| `apply_patch` changes a spec/layer path | Load one cross-layer reminder per turn |
| Shell completes `git pull`, `reset`, `checkout`, or `switch` | Remind the session to re-read changed instructions |

The current Copilot app host may execute `powershell` and other host tools even when an
`onPreToolUse` hook returns `permissionDecision: "deny"` or `modifiedArgs`. Therefore this
extension makes no blocking claim. Pre-tool context is host-dependent defense in depth;
hard controls belong in repo git hooks, deterministic evals, and human/GitHub approval.

The session-start check is conditional and injects no duplicate policy when hooks are
already active. `policy.mjs` contains pure tool classification and path detection. Its
Node tests pin the
current CLI names (`powershell`, `create_pull_request`, and `apply_patch`) while retaining
compatibility with `bash`, `shell`, `edit`, and `create`.

The c64 layer patterns cover specs, C++/web/test/example/asset surfaces, CMake/build scripts,
gallery metadata, and deployment workflows. Keep project credentials, runtime state, model
selections, user ROM/media data, scheduled-workflow state, and template checkpoints out of
this extension. Template lineage is reviewed explicitly through
`scripts/dev/review-template-updates.mjs`, not injected every session.

```sh
node --check .github/extensions/compliance-hooks/extension.mjs
node --test .github/extensions/compliance-hooks/policy.test.mjs
```

The git pre-push hook is the caller-independent enforcement point for PR state, the
learnings budget, and project-configured tests. Human/GitHub approval is the merge
authority.
