# Custom agents

c64 starts with no repository-defined custom agents. Add a specialist only when a recurring,
expensive decision class proves that the main instructions and layer specs are insufficient.
Use the canonical `ebadger/AIProjectTemplate` skeleton at that time, with a narrow
description, explicit out-of-scope behavior, and least-privilege tools.

Do not copy dynamic project status, credentials, runbooks, role biographies, user ROM/media
data, or a default model pin into agent prompts.

Code review does not use custom reviewer files. Follow `docs/CODE-REVIEW-PANEL.md` and
invoke the runtime's read-only `code-review` specialist twice with explicit model IDs
selected relative to the primary.
