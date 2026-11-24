# Transit architecture and code map

Baseline: `main@6344061af6ccd2c8c4b7b0355ed8f5e45cb903cf`.
This map supports learning and planning; no source folders have been moved.

## Follow a trip through the code

1. [PlannerPage](../apps/web/src/pages/PlannerPage.tsx) owns selected places, tab and
   responsive layout. [SearchPanel](../apps/web/src/components/SearchPanel.tsx) collects
   the trip; [usePlan](../apps/web/src/hooks/usePlan.ts) handles request/cache state.
2. [API client](../apps/web/src/api.ts) calls the server.
   [Plan route](../apps/server/src/routes/plan.ts) and
   [plan service](../apps/server/src/services/planService.ts) select the planner.
3. [Built-in planner](../apps/server/src/services/planner.ts) uses GTFS patterns,
   estimated walks, waits, fares and a transfer penalty. It is not a live traffic model.
4. [TripResults](../apps/web/src/components/TripResults.tsx),
   [ItineraryCard](../apps/web/src/components/ItineraryCard.tsx) and
   [LegTimeline](../apps/web/src/components/LegTimeline.tsx) display options;
   [TransitMap](../apps/web/src/map/TransitMap.tsx) displays route geometry.

## Follow a stand report

[DispatchPage](../apps/driver-portal/src/DispatchPage.tsx) creates a report;
[ReportQueue](../apps/driver-portal/src/reportQueue.ts) attempts delivery;
[telemetry route](../apps/server/src/routes/telemetry.ts) applies it to the
[in-memory stand store](../apps/server/src/services/stands.ts).
[WebSocket hub](../apps/server/src/websocket/hub.ts) publishes changes and the
[web live connection](../apps/web/src/lib/live.ts) distributes them to subscribers.
Shared message and status shapes are in
[telemetry types](../packages/shared-types/src/telemetry.ts).

## Boundaries for future changes

| Area | Existing home | Change rule |
| --- | --- | --- |
| Commuter flows | `apps/web/src/pages`, `components`, `hooks`, `lib` | Keep presentation, state and API handling separate; extract only where needed. |
| Map | `apps/web/src/map` | Consume shared route/status contracts; do not invent independent live semantics. |
| API and routing | `apps/server/src/routes`, `services`, `gtfs` | Keep HTTP validation, routing logic and storage concerns distinct. |
| Shared contract | `packages/shared-types/src` and [API spec](API_SPEC.md) | Agree additive or versioned compatibility and fixtures before parallel consumers change. |
| Pilot network | `data/geojson`, `data/pipelines`, `data/gtfs` | Keep source provenance, validation and generated output reproducible. |
| Operator flow and quality | `apps/driver-portal`, `e2e`, `.github`, `deploy` | Test report failure/retry and deployed configuration separately. |

Do not copy the ERP's MUI, auth or page structure: those solve different problems.
Keep this project's Vite/React, map and PWA patterns. Introduce domain subfolders only
when a concrete increment warrants them, rather than a large speculative refactor.
