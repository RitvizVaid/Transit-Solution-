# Deployment

Three deployables: the **API** (container), the **commuter web app** and the **driver
portal** (static sites). OpenTripPlanner is optional.

## Option A: one host with Docker Compose (simplest pilot)

```sh
docker compose -f deploy/docker-compose.yml up -d --build
```

nginx in each web container serves the static build and proxies `/api` (HTTP and
WebSocket) to the API container, so everything is same-origin. Put a TLS-terminating proxy
(Caddy, Traefik, a cloud load balancer) in front of ports 8080 / 8081. **HTTPS is required**
for geolocation, service workers and "Add to Home Screen".

For a real pilot set `SIMULATE=false` so only genuine marshal reports drive stand status.

## Option B: managed hosting

| Piece          | Where                                   | Build / run                                            |
| -------------- | --------------------------------------- | ------------------------------------------------------ |
| API            | Railway, Fly.io, Render, Cloud Run      | `deploy/Dockerfile.server` (port 3000, `/health`)      |
| Commuter web   | Vercel, Cloudflare Pages, Netlify       | `pnpm --filter @transit/web... build` → `apps/web/dist` |
| Driver portal  | same                                    | `pnpm --filter @transit/driver-portal... build` → `apps/driver-portal/dist` |

Static hosts need:

- `VITE_API_BASE=https://api.your-domain` at build time (the apps then call the API and
  `wss://…/api/v1/live` directly).
- An SPA fallback to `index.html` (Vercel/Netlify/Pages do this for single-page apps;
  add a rewrite rule if yours doesn't).
- Do not cache `sw.js` at the CDN for long; hashed `/assets/*` can be cached forever.

The API needs:

| Env           | Value                                                    |
| ------------- | -------------------------------------------------------- |
| `CORS_ORIGIN` | the web app origin(s), e.g. `https://transit.example`    |
| `SIMULATE`    | `false` for a real pilot                                 |
| `OTP_URL`     | optional, see below                                      |
| `GTFS_DIR`    | already set in the image; rebuild after `pnpm data:build` |

The platform must support WebSockets (all of the above do). Stand state is in memory:
run **one** API instance until `StandStore` is backed by Redis (see `apps/server/README.md`).

## OpenTripPlanner (optional)

The built-in planner covers the pilot. OTP adds street-accurate walking and scales to big
networks:

1. `pnpm data:package` → `deploy/otp/delhi-pilot-gtfs.zip`
2. Put an OSM extract for the area in `deploy/otp/` (e.g. a Delhi extract from BBBike or
   Geofabrik's northern-zone-india, clipped with osmium).
3. `OTP_URL=http://otp:8080 docker compose -f deploy/docker-compose.yml --profile otp up --build`
   (OTP needs ~4 GB RAM to build the graph.)

If OTP is unreachable or returns nothing, the API falls back to the built-in planner and
says so in the `x-planner` response header.

## Updating the network

1. Edit `data/geojson/`, run `pnpm data:build` (validates), commit `data/gtfs/`.
2. CI checks the committed feed matches its sources.
3. Redeploy the API (the feed is baked into the image) and re-package OTP if used.

## QR codes at stands (Sprint 4)

- Commuter app, origin pre-filled: `https://transit.example/?from=28.66620,77.22960,Kashmere%20Gate%20Auto%20Stand`
- Driver portal, stand pre-selected: `https://driver.transit.example/?stand=kg-auto-1`

Stand ids and coordinates are in `data/geojson/stops.geojson`.
