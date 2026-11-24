# Contributing

1. Set up your machine with [docs/CONTRIBUTOR_SETUP.md](docs/CONTRIBUTOR_SETUP.md).
2. Branch from `main` unless the team has agreed on an integration branch: `feat/c1-...`, `feat/c2-...`, `feat/c3-...`, `data/c4-...`, `infra/c5-...`.
3. Before pushing, run `pnpm typecheck && pnpm test && pnpm build` at the repo root.
4. Open a PR into the agreed base branch. CI must pass and one teammate must approve.
5. Changes to `packages/shared-types` need a review from every contributor whose app uses the changed type.
6. Add web platform features under `apps/` or `packages/`.

See the [improvement roadmap](docs/transit-improvement-roadmap.md) for contributor roles
and integration guidance.
