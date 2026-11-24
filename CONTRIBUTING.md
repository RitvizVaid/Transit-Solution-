# Contributing

1. Set up your machine with [docs/CONTRIBUTOR_SETUP.md](docs/CONTRIBUTOR_SETUP.md).
2. Branch from `dev`: `feat/c1-...`, `feat/c2-...`, `feat/c3-...`, `data/c4-...`, `infra/c5-...`.
3. Before pushing, run `pnpm typecheck && pnpm test && pnpm build` at the repo root.
4. Open a PR into `dev`. CI must pass and one teammate must approve.
5. Changes to `packages/shared-types` need a review from every contributor whose app uses the changed type.
6. Add web platform features under `apps/` or `packages/`.

`main` only receives merges from `dev` for releases.
Full rules: [GAME_PLAN.md §6](GAME_PLAN.md#6-git-branching-strategy--contribution-rules).
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
