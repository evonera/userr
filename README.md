# Userr

Open, local-first feedback infrastructure. It runs in an application's own
backend and database; it is not a hosted feedback service.

The working reference path is **Convex + Next.js**. The repository currently
contains the portable domain kernel, a Convex component scaffold, React UI
primitives, and a safe CLI installer foundation. See [docs/plan.md](./docs/plan.md) for
the product roadmap, [docs/architecture.md](./docs/architecture.md) for contracts, and
[docs/README.md](./docs/README.md) for the detailed product specification.

## Development

```bash
npm install
npm run build
npm test
```

To inspect an installation without changing a project:

```bash
npm run userr -- init --dry-run --backend convex --framework next
```
