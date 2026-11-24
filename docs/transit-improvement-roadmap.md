# Transit improvement roadmap

Baseline: `main@6344061af6ccd2c8c4b7b0355ed8f5e45cb903cf`, 24 November 2026.
This is a proposal, not a commitment or an implementation. Track actual status in the
[feature register](ui-feature-register.md) and
[deficiency register](ui-deficiency-register.md).

## Product goal and open decisions

Help commuters find understandable, affordable informal-transit options and help
operators share useful stand information. The present network is a Delhi demo; choose a
specific tier-2/3 pilot city, corridors, languages, users and data partners before claiming
local coverage. Confirm whether the initial delivery is a demo or a supervised field pilot.
Do not promise reduced congestion without a separately designed evaluation.

## Proposed phases

### 0. Shared understanding and trust (first increment)

- Agree terms for estimated, reported, stale and unavailable data; specify source,
  timestamp and missing values across HTTP, WebSocket, cache, cards and map (UI-01).
- Stop presenting defaults as observed vehicles or verified live waits. No synthetic data
  should be described as real. Define backwards compatibility and test fixtures first.
- Refresh the commuter results hierarchy around destination, boarding landmark, duration,
  estimated ₹ fare, walking and status. Retain search, map, selected route and offline flow.
- Address the screenshot's empty-results experience (UI-09): say that the app did not
  find a route; suggest only actions the system can actually perform. Separate network
  errors, cache, out-of-coverage and service-hour explanations only when supported by
  evidence from a documented API contract.
- Resolve stale place suggestions (UI-15) and investigate cache provenance (UI-18)
  before relying on search results or labeling saved data as fresh.
- Acceptance: baseline/report/expiry/restart cases in server and UI tests; browser checks on
  narrow mobile and desktop, including keyboard use and no misleading live text. Record
  actual results, revisions and limits; no field verification is implied.

### 1. Pilot data and safer reporting

- Choose corridors with local operators and commuters. Survey stop names/coordinates,
  directions, operating hours, headways and fares, with collection dates and provenance
  (F-09, UI-05, UI-07). Obtain consent and minimize personal/location data.
- Before importing external feeds, validate calendar exceptions, multiple frequency
  windows, service-day boundaries and parser compatibility (UI-14); choose the pilot
  city and configure its search and map consistently (UI-16).
- The inspected Delhi bus GTFS has scheduled trips, no frequency or fare files, and
  millions of stop times. Implement timetable-aware routing and unknown fare states
  rather than inventing headways or free fares; benchmark loading and routing within
  deployment memory limits. Verify permissions and attribution before publication.
- Agree identity, moderation, rate limiting, report deduplication, retention and storage
  before opening reporting to the public (UI-06, UI-08). Design for unreliable networks.
- Invite commuters to suggest missing routes and corrections (UI-10/UI-11), initially
  held for review; survey operators and validate direction, fares and headways before
  publishing or using these suggestions for planning.
- Acceptance: reproducible feed validation; a documented sample and independent checks;
  fresh, late, duplicate, rejected and offline-report scenarios. No real-time or capacity
  claim without supporting data.

### 2. Useful comparisons and inclusive UI

- Present fastest, cheapest and less-walking choices from actual available itineraries
  (UI-02). Avoid presenting a criterion as optimized if the planner never generated the
  relevant alternatives; no invented range or capacity.
- Translate the selected flows with local review; test reading order, labels, focus, contrast,
  large text, narrow screens and limited connectivity (UI-03, UI-04).
- Design clear trip-history and deliberate-sharing controls (UI-17), and evaluate
  multi-stop journeys and accessible boarding with diverse commuters (F-24).
- Acceptance: comparison ordering and ties tested on fixtures; manually review translated
  mobile and desktop journeys, accessible states and the map/list alternative.

### 3. Calibrated routing and field evaluation

- Gather consented observations by corridor and time band. Establish sample thresholds,
  coverage and an evaluation baseline before selecting a traffic/ETA model (UI-07).
- Compare predicted versus observed wait and journey-time error, plus successful boarding
  and fare accuracy. Report sample sizes, missing data and uncertainty; measure commuter
  usability with diverse participants. Congestion requires its own before/after study.
- Acceptance thresholds are to be agreed with the team and pilot partners before testing,
  not chosen after looking at results.

## Parallel contributor branches

Only `main` existed when this baseline was inspected; the existing contribution guide
proposes a `dev` integration branch, which must be created and agreed by the team before
it can be used. Until then, branch from current `main` and use reviewed PRs; do not
assume an unavailable branch exists.

| Contributor | Independent starting work | Integration point |
| --- | --- | --- |
| C1 commuter UI | UI-01 status and UI-02 card designs using agreed fixtures | Contract and status copy with C3; map coordination with C2. |
| C2 map | UI-05 landmark/boarding presentation using fixture data | C4 field data and shared provenance contract; avoid overlapping C1 files. |
| C3 backend | UI-01 source/freshness contract, tests and report semantics | Publish shared types and fixture examples early; coordinate C1, C2 and C5. |
| C4 data | Survey template, pilot selection research and feed provenance | City approval and verified data before replacing demo network. |
| C5 operator and QA | UI-08 queue states, acceptance scenarios and deployment checklist | C3 reporting contract and storage decisions; never assume public reports are trusted. |

Start with a short contract PR or agreed fixture for C1/C2/C3/C5; each branch can then
develop against it. Merge small PRs, run relevant tests and CI, and have affected owners
review shared types. The first integration checkpoint is the end-to-end status flow:
baseline → report → expiry → restart across API, commuter UI and map.

## Acceptance evidence and release

For each increment record: source revision, scenarios, commands and results, device or
browser, data source, skipped/failed checks, PR and deployment status. Separate local
fixture tests, GitHub CI, hosted smoke tests and supervised field observations. Do not
store sensitive participant or precise journey data in the repository.

The current Render services use a public-repository connection; check their deploy status
and trigger a manual redeploy when needed. A green GitHub run alone does not mean the
hosted site has updated. See [deployment guidance](DEPLOYMENT.md).

Detailed research, sources, survey and reporting designs:
[Transit data and reporting research](transit-data-reporting-research.md).
