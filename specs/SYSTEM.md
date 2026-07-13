# {{PROJECT_NAME}} — System Overview (SYSTEM.md)

> The umbrella spec. Keep this short — it is read at the start of every session. It
> describes the whole system at a glance and **links to every sub-spec**; the detail lives
> in the sub-specs, read lazily.

---

## What this system is

{{One paragraph: what the product does and for whom. The "why" lives in `docs/MISSION.md`.}}

## Architecture at a glance

```
{{User/client}}  →  {{API / service layer}}  →  {{data store}}
                         ↑
                  {{any other components: workers, integrations, etc.}}
```

- **Stack:** {{stack one-liner}}
- **Environments:** dev = {{...}}, prod = {{...}} ({{prod URL if public}})

## Sub-specs (read only the layer you'll touch)

| Layer | Spec | Covers |
|-------|------|--------|
| Data store | [`DATABASE.md`](./DATABASE.md) | Schema, constraints, migrations |
| API / Service | [`API.md`](./API.md) | Endpoints, contracts, validation, auth |
| Client / UI | [`WEB-CLIENT.md`](./WEB-CLIENT.md) | Pages, components, interactions |
| AI operating system | [`TEMPLATE-INHERITANCE.md`](./TEMPLATE-INHERITANCE.md) | Canonical template lineage, downstream review, upstream feedback |
| {{...}} | {{...}} | {{...}} |

> Create each sub-spec from [`_TEMPLATE.md`](./_TEMPLATE.md).

## Cross-cutting concerns

- **Auth model:** {{...}}
- **The critical path:** {{name the cash-/safety-/data-critical flow that must never break —
  this is what the review panel and the pre-push test gate exist to protect.}}

## Implementation status (summary)

| Area | Status |
|------|--------|
| {{feature/area}} | {{Not started / In progress / Shipped}} |
