# Custom agents

The template ships one minimal agent skeleton, not a standing roster. Add a specialist
only when a recurring, expensive decision class justifies its own context.

`template-agent.md` requires a narrow description, explicit out-of-scope behavior, and
least-privilege tools. Do not copy dynamic project status, credentials, runbooks, role
biographies, or a default model pin into agent prompts.

Code review does not use custom reviewer files. Follow `docs/CODE-REVIEW-PANEL.md` and
invoke the runtime's read-only `code-review` specialist twice with explicit model IDs
selected relative to the primary.
