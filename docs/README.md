# Userr documentation

This folder holds the product contract and the detailed implementation
specifications for the Userr codebase. Start with the contract, then use the
catalogs for phase implementation.

| Document | Purpose |
| --- | --- |
| [Plan](./plan.md) | Product promise, reference release, non-goals |
| [Architecture](./architecture.md) | Package boundaries, ownership, invariants, contracts |
| [Phases](./phases.md) | Canonical delivery phases (one phase = one PR) |
| [Context](./context.md) | Durable project memory for future agents |
| [Features](./features.md) | Available foundation + planned modules |
| [Dependencies](./dependencies.md) | Dependency policy |
| [Product spec](./product-spec.md) | Positioning, v1 scope, success criteria |
| [Reference architecture](./reference-architecture.md) | Backend and framework design references |
| [Feature catalog](./feature-catalog.md) | Exhaustive feedback-suite feature inventory |
| [Adapter matrix](./adapter-matrix.md) | Supported backend order and capability rules |
| [Integration catalog](./integration-catalog.md) | Plugin priorities and contracts |
| [Webhook protocol](./webhook-protocol.md) | Event envelope, signing, retries, security |
| [Dependency catalog](./dependency-catalog.md) | Package-level dependency candidates |
| [Delivery plan](./delivery-plan.md) | PR-sized implementation tasks |
| [Links](./links.md) | Official documentation and research references |

When a detailed reference conflicts with the root architecture, keep the root
invariants: host-owned auth, domain-shaped adapters, asynchronous optional AI,
and no hosted runtime.
