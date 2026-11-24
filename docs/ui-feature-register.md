# Transit UI feature register

Baseline: `main@6344061af6ccd2c8c4b7b0355ed8f5e45cb903cf`, 24 November 2026.
This is a source inventory, not field or production acceptance. The
[GitHub CI run](https://github.com/RitvizVaid/Transit-Solution-/actions/runs/45435367534)
passed the configured jobs on this baseline. The deployed site was previously smoke-tested
with a sample trip; that does not verify its data in the field.

[Deficiency register](ui-deficiency-register.md) ·
[Improvement roadmap](transit-improvement-roadmap.md) ·
[Architecture review](transit-architecture-review.md) ·
[Data and reporting research](transit-data-reporting-research.md)

## Status definitions

- **Implemented (demo):** code exists; no claim that its data or usability is field verified.
- **Partial:** a related capability exists but does not meet the stated goal.
- **Planned:** not implemented or not established by this review.

| ID | Feature | Current disposition and evidence | Related work |
| --- | --- | --- | --- |
| F-01 | Search and trip planning | **Implemented (demo):** origin/destination, current location, recent trips and shareable URLs; [planner page](../apps/web/src/pages/PlannerPage.tsx), [planner](../apps/server/src/services/planner.ts). Existing network is a Delhi demo, not a surveyed tier-2/3 city network. | UI-02, UI-05, F-09 |
| F-02 | Trip comparisons | **Partial:** cards show duration, estimated fare, walking and legs; [trip results](../apps/web/src/components/TripResults.tsx), [card](../apps/web/src/components/ItineraryCard.tsx). Ranking preferences and confidence ranges are not established. | UI-02, F-10 |
| F-03 | Stand waits and capacity | **Partial:** stand reports and headway baselines feed the UI; [stand store](../apps/server/src/services/stands.ts), [badge](../apps/web/src/components/LiveArrivalBadge.tsx). Defaults may be shown as live and vehicle counts are not verified capacity. | UI-01, UI-06, F-08 |
| F-04 | Map and nearby lines | **Implemented (demo):** map, route geometry and nearby lines; [map](../apps/web/src/map/TransitMap.tsx), [nearby hook](../apps/web/src/hooks/useNearbyLines.ts). Boarding landmarks and real-world accessibility still need validation. | UI-05, F-09 |
| F-05 | Offline and install | **Partial:** saved trips, PWA and operator report queue exist; [recent trips](../apps/web/src/lib/recentTrips.ts), [report queue](../apps/driver-portal/src/reportQueue.ts), [PWA tests](../e2e/pwa.spec.ts). Coverage is bounded by cache availability and browser storage. | UI-03, UI-08 |
| F-06 | Operator reporting | **Implemented (demo):** bilingual stand actions and an offline queue; [operator page](../apps/driver-portal/src/DispatchPage.tsx), [report endpoint](../apps/server/src/routes/telemetry.ts). No operator identity is established by this endpoint; stand state is in memory. | UI-06, UI-08, F-08 |
| F-07 | Inclusive commuter interface | **Partial:** responsive layout, some keyboard/assistive labels and motion handling exist; [planner page](../apps/web/src/pages/PlannerPage.tsx), [results](../apps/web/src/components/TripResults.tsx). The commuter interface is English; broader accessibility and translation acceptance remain open. | UI-03, UI-04 |
| F-08 | Trusted crowdsourced data | **Planned:** source, freshness, report governance, persistence and honest unavailable states across API and UI. | UI-01, UI-06, UI-08 |
| F-09 | Field-verified pilot network | **Planned:** choose a city, survey routes/stops/headways/fares, review consent and refresh data. An [IIIT-Delhi research dataset](transit-data-reporting-research.md#candidate-data-sources-and-limitations) is a candidate for evaluation, not integrated or validated for current use. Existing [data sources](../data/README.md) are pilot inputs, not evidence of field verification. | UI-05, UI-07 |
| F-10 | Preference and traffic-aware routing | **Planned:** compare fastest/cheapest/less walking from supported results first; calibrated time-of-day or traffic estimates require suitable observations and evaluation. | UI-02, UI-07, F-09 |
| F-11 | Coverage-aware empty results | **Partial:** the current zero-results screen offers only a landmark suggestion; [results](../apps/web/src/components/TripResults.tsx). An empty response does not establish that no real service exists. | UI-09, F-09 |
| F-12 | Community route discovery | **Planned:** collect user-suggested routes, stops, operating times and fare observations for review; a suggestion is not automatically a verified route. | UI-10, UI-11, F-09 |
| F-13 | Usable stand reporting | **Partial:** operator buttons post reports, but acknowledgements and inferred values do not establish an observed departure, vehicle count or seat availability; [operator page](../apps/driver-portal/src/DispatchPage.tsx), [stand store](../apps/server/src/services/stands.ts). | UI-01, UI-06, UI-08, UI-12 |
| F-14 | Report verification and moderation | **Planned:** deduplicated submissions with source, event/receipt times, review and correction; distinguish queue size from available seats and estimated waits. | UI-06, UI-11, UI-12 |
| F-15 | Boarding guidance and nearby alternatives | **Partial:** route legs and nearby lines exist; there is no verified street-level boarding or evidence-backed alternatives for every empty trip. | UI-05, UI-09, UI-13 |
| F-16 | Measurable access and interface quality | **Partial:** responsive interface and offline building blocks exist; a complete accessible, multilingual, low-bandwidth field-tested commuter journey remains open. | UI-03, UI-04, UI-13 |
| F-17 | Realistic traffic and reliability | **Planned:** time-band estimates and confidence calibrated against collected journey observations, with a transparent fallback when samples are inadequate. | UI-07, F-09 |

## Updating this register

For each completed increment, link its deficiency ID, PR and a short acceptance record:
revision tested, commands/results, browser or API scenarios, fixtures versus real inputs,
and what was not tested. Track deployed or field acceptance separately from local/CI results.
Do not mark a feature field-verified based on synthetic tests.
