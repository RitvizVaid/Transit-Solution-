# Informal transit data, reporting and UX research

Research and source review: 24 November 2026. This is a bounded investigation, not an
exhaustive internet survey. No dataset was imported, permission requested or fieldwork
conducted. Proposals below are not implemented. See the [feature register](ui-feature-register.md),
[deficiency register](ui-deficiency-register.md) and [roadmap](transit-improvement-roadmap.md).

## What the screenshot tells us

The shared screenshot shows a search from Bharat Vandana Park to Ritz hotel, “0 ways to
go”, an install prompt and a message saying no services connect the places. It does not
give the selected coordinates, query time, API response or dataset version. We therefore
cannot establish why this particular search returned zero or whether a real route exists.

The current [planner](../apps/server/src/services/planner.ts) uses the loaded network,
service hours, proximity and search limits; it can also return walking-only results
within a configured distance. [PlanResponse](../packages/shared-types/src/transit.ts)
does not currently explain why there are no results. An empty list means **no itinerary
was found under this search**, not proof that no service exists.

**Proposed screen (UI-09/UI-13):**

> We couldn't find a route in our current network.
>
> Coverage and service hours may be limited.
>
> [Nearby lines] [Change places] [Suggest a route]

Only display a more specific cause, or a nearby alternative, when the backend can
support it. “Suggest a route” must open a real submission flow, not a dead button.
Prioritize the result and recovery over install promotion; retain accessible error and
offline states. Do not generate imaginary itineraries to avoid an empty screen.

## Candidate data sources and limitations

| Source | What was verified | Use and limits |
| --- | --- | --- |
| [IIIT-Delhi shared mobility dataset, v1.0.0](https://github.com/opendata-iiitd/shared-mobility-delhi/tree/v1.0.0) · [Zenodo record](https://zenodo.org/records/15314791) | Published May 2025; authors describe e-rickshaw, auto and Gramin Sewa data collected Jan–Apr 2025 around 158 Delhi metro stations. Repository calls it GTFS Flex and lists GTFS files. Its [repository license](https://github.com/opendata-iiitd/shared-mobility-delhi/blob/v1.0.0/LICENSE) is MIT. | Strong candidate for a **Delhi research prototype**, not proof of current routes, fares, live arrivals or coverage at the screenshot locations. Before import inspect exact records, collection methodology, calendar validity, data rights and attribution; verify with operators. The existing parser's Flex compatibility is unverified. |
| [Delhi Open Transit Data documentation](https://otd.delhi.gov.in/documentation/) | Official Delhi bus GTFS documentation says stop times are rough constant-speed estimates; real-time access is for authorized users with a key. | Formal bus connections may complement informal routes, not replace them. Check current availability, terms, credentials and feed quality before use; no bus feed has been integrated. |
| [Mobility Database catalogue](https://mobilitydatabase.org/feeds?q=India) | Catalogue/search lists Indian transit feeds. | Discovery only: check each feed's operator, license, currency, type, coverage and access. A listing is not evidence that shared autos or real-time data are present. |
| [Delhi Buses GTFS mdb-3666](https://mobilitydatabase.org/feeds/gtfs/mdb-3666) · [Delhi Transport Stack catalogue](https://delhi.transportstack.in/data-services/datadetails/1) | Snapshot `mdb-3666-202611231654`, inspected 24 November 2026: GTFS version v32; calendar 2025-01-01–2040-01-01; 2,574 routes, 6,862 stops, 80,357 scheduled trips and 2,737,136 stop-time rows. No frequency or fare files were present. The date range does not prove schedules are current. | Officially listed Delhi **bus** feed, not an informal-transit feed. The built-in planner cannot plan scheduled departures on it. The [linked licence](https://dts-backend.transportstack.in/api/document/download/5/02fde801-a396-4463-a7ba-3dab62638f68) specifies registered recipients and attribution; review conditions before use or redistribution. Feed not committed or deployed. |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Open map data is ODbL licensed; attribution and applicable share-alike obligations must be considered. | Candidate for roads, landmarks, stops and mapped routes. Informal service coverage is uneven and must be checked locally. Check provider usage policies and data rights; do not copy proprietary maps or scrape sources without permission. |
| [CPPR Shared Mobility India](https://www.cppr.in/shared-mobility-india) | The Indian research/advocacy initiative discusses shared intermediate public transport, operator engagement and field/crowdsourced mapping across several states. | Candidate research/partnership lead, not a downloadable verified feed identified in this review. Local permits and service patterns vary; do not generalize a legal position to every city. |
| [Digital Matatus](https://www.digitalmatatus.com/) | Nairobi researchers rode routes, collected GPS, consulted operators and held community workshops before producing transit data. | Useful collection method by analogy, **not an Indian dataset**. Ask local operators and commuters to validate every selected corridor. |
| [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/) · [GTFS Flex examples](https://gtfs.org/documentation/schedule/examples/flex/) | GTFS supports frequency-based data; Flex addresses demand-responsive service. | Choose a representation that fits the observed service and is actually supported by our parser/router; do not assume Flex is a drop-in solution for hail-and-ride. |
| [Transit GO crowdsourcing](https://help.transitapp.com/article/91-what-is-go-crowdsourcing) | The provider describes trip-based location sharing and short crowding/accessibility feedback. | Example interaction pattern, not evidence that its results or privacy model transfer to this project or India. Start with explicit, voluntary reports; passive GPS is a separate consent and privacy decision. |
| [WRI India: gender-responsive mobility](https://wri-india.org/initiatives/shaping-inclusive-cities-gender-responsive-mobility-systems) · [IIT Guwahati informal transport research](https://www.iitg.ac.in/iitg_press_details.php?p=0235/multi-institutional-team-led-by-iit-guwahati-develops-framework-to-strengthen-informal-transport-and-address-congestion) | WRI discusses inclusive mobility; IIT Guwahati describes a policy framework for integrating informal transport. | Inform user research and stakeholder engagement. Neither proves this app will reduce congestion or makes a route safe. |
| [World Bank: gender-responsive mobility in India](https://blogs.worldbank.org/en/endpovertyinsouthasia/india-making-public-transport-more-women-friendly) | Describes multi-stop trips, waiting and safety concerns in the Indian context, citing specific surveys. | Research trip chaining, transfer costs and boarding experience with diverse local participants; findings are not a safety rating for a route. |
| [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | WCAG 2.2 AA defines a 24×24 CSS-pixel minimum target or qualifying spacing/exceptions, and 4.5:1 normal-text contrast, with defined exceptions. | Use as accessibility acceptance references, not proof this app conforms. Test actual rendered states; aim for larger important touch controls where practical. |
| [GTFS Realtime best practices](https://gtfs.org/documentation/realtime/realtime-best-practices/) | Recommends separate feed and observation timestamps and freshness limits for GTFS vehicle positions, trip updates and alerts. | Useful if a genuine GTFS-RT feed is integrated. These thresholds are not evidence that our human stand reports are live or suitable for the same expiry rules. |
| [web.dev offline cookbook](https://web.dev/articles/offline-cookbook) | Describes service-worker caching and offline fallback patterns. | Guide explicit offline state and cache provenance tests; a cached response must not be silently relabeled as fresh. Browser and cache behavior must be tested here. |

Source conditions can change. Check license, attribution, freshness, geographical coverage,
privacy and API terms at the exact version before downloading, combining or publishing.
Avoid collecting precise individual trips or publishing route suggestions that could
identify operators without appropriate consent and review.

## Practical data collection

1. **Choose the pilot:** city, 2–3 corridors, endpoints, languages, partners and dates are
   decisions for the team, not existing facts. Delhi is convenient for testing the candidate
   dataset; a tier-2/3 city requires its own data and field partners.
2. **Find a starting inventory:** contact stand associations, drivers, commuters, local
   transport authorities, colleges and civil-society groups. Review available open data,
   maps and official bus/metro interchange data and record permission and source dates.
3. **Observe both directions:** with consent, record route name/mode, boarding landmarks,
   actual pickup/drop-off behavior, order of stops, service days/hours, typical fare and
   variability. Record time-stamped departures and journey durations across agreed peak,
   off-peak and weekday/weekend windows. “Not observed” is not “does not operate.”
4. **Review and reconcile:** compare independent observations with operators and regular
   riders; keep uncertainty, conflicts, sample size, survey date and reviewer. Store raw
   participant information separately with restricted access and a deletion policy.
5. **Publish a reviewed snapshot:** transform suitable data through the existing
   [pipeline](../data/README.md), validate the GTFS and routing behavior, record provenance
   and version, and schedule rechecks. Survey fare/headway data is not live telemetry.

For a traffic/ETA model, first define sampling, holdout periods, corridor/time-band
coverage and evaluation thresholds. Compare prediction error and missing-data behavior
against the current headway baseline; do not introduce invented peak multipliers or
promise reliable capacity estimates.

## Additional product and engineering opportunities

- **Service-day correctness (F-18/UI-14):** test real-world feed calendars, exceptions,
  overnight service and multiple frequency windows before claiming an imported route
  operates on a particular date. The current built-in loader has known limitations;
  passing format validation alone does not demonstrate routing compatibility.
- **Search people can trust (F-19/UI-15/UI-16):** use city-specific search bounds and
  local landmark aliases once verified. Ensure suggestions belong to the typed query and
  offer map picking or nearby browsing when geocoding fails. Regional-language search
  quality must be tested, not assumed.
- **Privacy and offline clarity (F-20/F-21):** explain storage and third-party geocoding,
  make trip sharing deliberate, and show when cached data was last obtained. Test slow
  connections and service-worker fallback separately from normal fetches.
- **Inclusive journeys (F-24):** research multi-stop errands, transfer cost and boarding
  accessibility with people of different ages, genders and abilities. Present available
  evidence and limitations rather than unverifiable “safe route” guarantees.
- **Disruptions (F-23):** only show closures or detours from a documented source or a
  reviewed report, with scope, time and expiry. Empty alert lists do not establish that
  service is operating normally.

## Making stand reports real

### What exists today

The [operator screen](../apps/driver-portal/src/DispatchPage.tsx) can submit actions to
the [telemetry endpoint](../apps/server/src/routes/telemetry.ts). The
[stand store](../apps/server/src/services/stands.ts) changes an in-memory status and
broadcasts it. The operator portal was smoke-tested locally; it was not deployed as part
of the documented Render commuter-site deployment. No real operator participation or
public reporting pilot has been verified.

This is a demo, not reliable crowdsourcing: the endpoint has no reporter identity at the
route, reports are applied directly, server restarts lose state, and counts/waits may be
inferred from action types. An HTTP 202 is acceptance by the server, not independent
verification. The [queue](../apps/driver-portal/src/reportQueue.ts) may drop rejected or
old entries, and a send count can include earlier entries rather than the latest tap.

### Proposed supervised MVP (F-13/F-14)

1. Enlist consenting stand operators for chosen stands. Give them a simple mobile
   page with language-reviewed actions such as “vehicle departed”, “queue long” and
   “traffic delay”; allow “unknown” and correction. A QR code selects a stand but is
   **not authentication**. Decide proportionate operator access and recovery with partners.
2. Capture one observation per action: client-generated id, stand/route/direction where
   known, observation kind/value, event time, server receipt time and source category.
   Record only what the person actually observed: a passenger queue is not empty seats;
   a departure alone is not a GPS vehicle position.
3. Persist reports and status with validation, idempotency, rate limits and authorization.
   Handle duplicates, late/out-of-order and conflicting reports; keep review/correction
   history and reject invalid or expired observations explicitly. Decide retention,
   moderation and deletion before accepting public input.
4. Derive and display status with provenance and age: **reported**, **estimated**,
   **stale** or **unavailable**. Do not call a report “verified” merely because it was
   submitted or corroborated. Compute waits only with sufficient observations and
   show an honest fallback when evidence is inadequate.
5. Show the outcome of the **specific** submission: sending, saved on device,
   accepted, rejected, expired or unable to save. Handle timeouts/uncertain acknowledgements
   and retry with the same id without duplication. Test offline/restart and storage failure.

Later, a commuter can suggest a missing route or independently report a stand condition.
Keep suggestions in review, avoid exposing contributor identities, and do not automatically
change the published route network. Optional GPS tracking requires its own clear,
revocable consent, data-minimization and safeguarding design; it is not needed for MVP.
Review applicable Indian privacy requirements and local transport rules with qualified
partners before a field pilot.

## Acceptance and measurement

- Automated contract and browser tests cover report submission, retry, duplicate, stale,
  out-of-order, restart, unknown state and status consistency in card and map.
- Test coverage-unknown, off-hours, disconnected network, offline/cache and API failure
  separately; show a reason only when verified.
- In a supervised pilot record sample sizes, wait/ETA prediction errors, successful route
  discovery and boarding, report acceptance/correction rates, and usability feedback.
  Agree thresholds before collecting results; retain uncertainty and missing data.
- Establish an independent congestion study before attributing congestion reduction to
  the app. A green build or synthetic browser test is not field validation.
