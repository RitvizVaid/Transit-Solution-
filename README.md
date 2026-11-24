# Transit

**Live demo:** https://transit-solution-web.onrender.com/

This is a demo; wait times and vehicle counts labeled "Live" are not verified real-time data.

A fast, mobile-first web app (PWA) for **informal public transit**: shared autos,
e-rickshaws, shared taxis and minibuses that run without timetables, stop where they like
and charge by distance. Commuters plan A-to-B trips across these modes, see how busy each
stand is, and watch vehicles live. Stand marshals report conditions from a one-tap,
bilingual (English/Hindi) web portal that works with patchy signal.

Pilot: 7 routes and 23 stops around Kashmere Gate, Old Delhi, Chandni Chowk, Red Fort,
Daryaganj–ITO and New Delhi Railway Station–Connaught Place. Plan, roles and roadmap:
[GAME_PLAN.md](GAME_PLAN.md). Build log: [nitish.md](nitish.md).

## What works

- **Trip planning** for frequency-based routes: walk + up to one transfer, expected waits
  from live stand reports (or headways), per-ride distance fares in ₹, service hours.
- **Live data** over WebSocket: stand queues and waits change the moment a marshal reports;
  vehicles move on the map (simulated until driver GPS is live).
- **Map** (MapLibre + OpenFreeMap): selected route, stands coloured by queue, live vehicles,
  Nearby radius, long-press / right-click to set start or destination.
- **Nearby lines** within 100 / 300 / 500 m.
- **Offline**: installable PWA; recent trips and viewed map areas work without signal.
- **Driver portal**: QR-code stand links, big one-tap reports, live feedback, offline outbox.
- **Data pipeline**: hand-traced corridors → validated GTFS with `frequencies.txt`;
  GPS boarding points → clustered virtual stops.

## Repository layout

```
apps/
  web/              Commuter PWA: Vite + React 19 + Tailwind + MapLibre   (C1, C2)
  server/           Fastify API: planner, OTP client, fares, live WebSocket (C3)
  driver-portal/    Stand-marshal reporting app                          (C5)
packages/
  shared-types/     API contracts shared by all apps                     (C1–C3)
data/               Corridor sources, GTFS feed, Python pipeline          (C4)
deploy/             Dockerfiles, docker-compose, nginx, OTP dir           (C5)
e2e/                Playwright end-to-end tests                           (C5)
docs/               API spec, setup, deployment
```

## Quick start

```sh
corepack enable
pnpm install
pnpm dev
```

| App            | URL                                                    |
| -------------- | ------------------------------------------------------ |
| Commuter web   | http://localhost:5173                                  |
| Driver portal  | http://localhost:5174/?stand=kg-auto-1                 |
| API + docs     | http://localhost:3000/docs                             |

Or everything in Docker: `docker compose -f deploy/docker-compose.yml up --build`
(web :8080, driver :8081, API :3000).

## Quality gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` (110 TS unit/integration tests) ·
`pnpm data:test` (18 pipeline tests) · `pnpm e2e` (17 Playwright tests, mobile + desktop).
All run in CI with the Docker builds and a check that the committed GTFS matches its sources.

## Docs

- [docs/CONTRIBUTOR_SETUP.md](docs/CONTRIBUTOR_SETUP.md): setup, commands, where code lives
- [docs/API_SPEC.md](docs/API_SPEC.md): HTTP + WebSocket contract
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Docker, managed hosting, OTP, stand QR codes
- Per-area READMEs in `apps/*`, `apps/web/src/map`, `data/pipelines`

## Origins and license

This repository started as a clone of [Trufi Core](https://github.com/trufi-association/trufi-core)
by the Trufi Association. The original Flutter code remains available in the upstream repository
as an algorithmic reference.
Licensed under GPL-3.0, see [LICENSE](LICENSE).
