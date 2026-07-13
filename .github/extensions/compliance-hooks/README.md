# compliance-hooks

This Copilot CLI extension enforces a few durable authority boundaries and injects short
checklists at the moment they matter.

| Event | Behavior |
|-------|----------|
| Session start with inactive hooks | Remind once how to activate `.githooks` |
| Shell contains the direct token sequence `gh pr merge` | Conservatively deny with `permissionDecision: "deny"`; no agent exception |
| Shell attempts `git commit` | Load the concise commit checklist |
| `create_pull_request` | Load the concise PR/review checklist |
| `apply_patch` changes a spec/layer path | Load one cross-layer reminder per turn |
| Shell completes `git pull`, `reset`, `checkout`, or `switch` | Remind the session to re-read changed instructions |

The merge deny is intentionally fail-closed: use `apply_patch`, not shell output, when
editing prose that contains the guarded phrase. The session-start check is conditional
and injects no duplicate policy when hooks are already active. `policy.mjs` contains pure
tool classification and path detection. Its Node tests pin the
current CLI names (`powershell`, `create_pull_request`, and `apply_patch`) while retaining
compatibility with `bash`, `shell`, `edit`, and `create`.

Customize only the layer patterns in `policy.mjs`. Keep project credentials, runtime
state, model selections, scheduled-workflow state, and template checkpoints out of this
extension. Template lineage is reviewed explicitly through
`scripts/dev/review-template-updates.mjs`, not injected every session.

```sh
node --check .github/extensions/compliance-hooks/extension.mjs
node --test .github/extensions/compliance-hooks/policy.test.mjs
```

The git pre-push hook is the caller-independent enforcement point for PR state, the
learnings budget, and project-configured tests.
