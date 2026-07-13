# AIProjectTemplate

**A reusable operating system for running a software project with an AI workforce.**

This template is the distilled, project-agnostic machinery from a real, production
AI-operated company — extracted so a new "automated AI company" can be spun up in an
afternoon instead of rediscovering the same governance the hard way.

It is **not** an app skeleton (no framework, no build). It is the *operating layer* that
sits on top of whatever you build: how an AI workforce remembers, enforces its own rules,
reviews itself, and stays pointed at the mission across stateless sessions.

> **Start here:** [`SETUP.md`](./SETUP.md) — stamp the placeholders and go live in ~30 min.

---

## The problem it solves

An AI workforce has no persistent memory between sessions and will, left alone, drift:
re-make solved mistakes, let rules rot, self-merge unreviewed work, and grow process
faster than it ships product. This template encodes the countermeasures **as mechanism**,
not as good intentions.

## The six ideas worth stealing

1. **Capped, tiered memory.** `docs/LEARNINGS.md` is an always-loaded **Tier-1 rules
   digest** with a hard **token cap** enforced by a `pre-push` guard. New lessons are
   *distilled and promoted competitively*, not appended forever; full narratives live in
   `docs/learnings/` (sessions → weekly → monthly). Memory that stays small stays read.

2. **Governance-as-code.** The `compliance-hooks` Copilot extension + a `.githooks/pre-push`
   hook make the rules **mechanical**: the right checklist is injected at the right moment,
   self-merging is hard-stopped, and pushing to an already-merged PR branch is blocked —
   for *any* caller, so it doesn't depend on anyone remembering.

3. **Refreshing checklists at the moment of action.** Rule context decays. Instead of one
   giant doc nobody re-reads, short checklists in `.github/instructions/` are re-injected
   exactly when you commit, push, open a PR, or edit a layer file — so the rule is in front
   of you when it matters.

4. **An agent template + model-diverse review.** A reusable **anti-sycophancy core** turns
   agreeable assistants into colleagues who tell you you're wrong, and two **read-only
   reviewers on different model vendors** challenge every code PR to break single-model
   blind spots.

5. **Lenses & gates, on a mission clock.** A small set of specialist **lenses** you consult
   for judgment, a few **non-negotiable gates** that protect the critical path, and a
   **mission-clock rule** that forbids growing org machinery faster than the product needs
   it. (`docs/ROLES.md`)

6. **A living template lineage.** Every specialization retains a checkpoint back to this
   canonical template. Session-start checks expose new operating-system improvements;
   projects explicitly adopt, adapt, defer, or reject each one, while reusable discoveries
   flow back upstream. No blind merges, no permanent private process forks.

---

## What's in the box

```
.github/
  copilot-instructions.md        # session-start mandatory reading + core rules
  agents/                        # anti-sycophancy template + 2 model-diverse reviewers
  instructions/                  # the checklists injected at commit/push/PR/cross-layer
  extensions/compliance-hooks/   # the governance-as-code extension
  ISSUE_TEMPLATE/ + PULL_REQUEST_TEMPLATE.md
.githooks/pre-push               # LEARNINGS cap + test gate + PR-state guard
scripts/dev/                     # setup guards + review canonical template updates
.template-source                 # specialization's last reviewed upstream checkpoint
docs/
  LEARNINGS.md                   # the capped Tier-1 rules digest (seed)
  learnings/                     # sessions/weekly/monthly/archive lifecycle
  MISSION.md  ROLES.md  SUGGESTIONS.md  CODE-REVIEW-PANEL.md
specs/                           # specs-as-source-of-truth scaffolding (SYSTEM + _TEMPLATE)
status/SYSTEM-STATUS.md          # current runtime reality
SETUP.md                         # how to instantiate
```

## Design stance

- **Mechanism over memory.** If a rule matters, a hook enforces it.
- **Small and current beats big and stale.** Capped memory, lazy-loaded specs, lean status.
- **Improve once, inherit deliberately.** Reusable process improvements flow upstream, then
  specializations reconcile them without overwriting local product truth.
- **Add machinery only when the product earns it.** The mission-clock gate is load-bearing.
- **Every guard fails open.** The hooks never block legitimate or offline work; they block
  the *forgetful* mistake, which is the common one.

## Provenance & honesty

This is extracted from one real company's setup. Some opinions (a `pre-push` test gate, a
two-vendor review panel, a critical-path eval gate) are deliberately heavy — they exist
because that company wires real consequences to its critical path. **Right-size to your
stakes.** Each piece carries its own *why* and, where relevant, a kill criterion. Delete
what you don't need; the mission-clock rule says trimming is always allowed.

See [`SETUP.md`](./SETUP.md) to begin.
