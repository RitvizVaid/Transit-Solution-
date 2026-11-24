# Contributor setup

## Prerequisites

| Tool    | Version                                          | Needed by                        |
| ------- | ------------------------------------------------ | -------------------------------- |
| Node.js | 22+ (see `.nvmrc`)                               | everyone                         |
| pnpm    | 12 (`corepack enable` picks the pinned version)  | everyone                         |
| Python  | 3.10+ (standard library only)                    | `data/` pipeline                 |
| Docker  | recent                                           | full stack, OpenTripPlanner      |

## First run

```sh
git clone <repo> transit && cd transit
corepack enable
pnpm install          # also builds packages/shared-types
pnpm dev              # API :3000, web :5173, driver portal :5174
```

Open http://localhost:5173/?from=28.6675,77.2282,Kashmere%20Gate%20Metro&to=28.6563,77.2412,Red%20Fort
You should see itineraries (M-14 first), the route on the map, and simulated vehicles
moving. Open http://localhost:5174/?stand=kg-auto-1 and tap a button: the stand's badge in
the commuter app changes within a second.

API docs: http://localhost:3000/docs

## Everyday commands (repo root)

| Command              | Does                                                    |
| -------------------- | ------------------------------------------------------- |
| `pnpm dev`           | All apps in watch mode (`dev:web`, `dev:server`, `dev:driver` for one) |
| `pnpm lint`          | oxlint (correctness + suspicious, React hooks, a11y)    |
| `pnpm typecheck`     | `tsc --noEmit` in every package                         |
| `pnpm test`          | Vitest in every package                                 |
| `pnpm build`         | Production builds (shared-types first)                  |
| `pnpm e2e`           | Playwright against the builds (run `pnpm build` first; `PW_CHANNEL=chrome` to use local Chrome, or `pnpm exec playwright install chromium` once) |
| `pnpm format`        | Prettier                                                |
| `pnpm data:build`    | Rebuild + validate the GTFS feed from `data/geojson/`   |
| `pnpm data:test`     | Pipeline unit tests                                     |
| `pnpm data:package`  | Zip the feed for OpenTripPlanner                        |

Before a PR: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`. CI also runs
`pnpm e2e`, the data tests, a feed-is-up-to-date check, and the Docker builds.

## Full stack in Docker

```sh
docker compose -f deploy/docker-compose.yml up --build
# web :8080, driver portal :8081, API :3000 — see docs/DEPLOYMENT.md for OTP
```

## Where your work goes

| Contributor | Area                         | Directory                                   |
| ----------- | ---------------------------- | ------------------------------------------- |
| C1          | Commuter UI, PWA             | `apps/web/src/{components,hooks,pages,lib}` |
| C2          | Map & geospatial             | `apps/web/src/map`, `apps/web/src/lib/live.ts` |
| C3          | API, routing, real-time      | `apps/server`                               |
| C4          | GTFS & data pipelines        | `data/`                                     |
| C5          | DevOps, QA, driver portal    | `deploy/`, `.github/`, `e2e/`, `apps/driver-portal` |
| C1–C3       | API contracts                | `packages/shared-types`                     |

## Changing shared types

`packages/shared-types` is the contract between the apps and the server. Edit `src/*.ts`,
run `pnpm typecheck` at the root (it checks every consumer), and ask each contributor whose
app uses the type to review. `pnpm dev` rebuilds the package on save.

## Branches and PRs

See [GAME_PLAN.md §6](../GAME_PLAN.md#6-git-branching-strategy--contribution-rules): branch
from `dev` as `feat/c1-…`, `data/c4-…`, `infra/c5-…`; PRs need green CI and one approval.

## Legacy code

The original Flutter app is available as a reference in the
[Trufi Core repository](https://github.com/trufi-association/trufi-core).
