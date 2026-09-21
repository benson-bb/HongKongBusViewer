# Hong Kong Bus Viewer

An interactive map of Hong Kong public transport routes and stops, built from Transport Department GTFS data and OpenStreetMap road data.

## Run

Serve the project through localhost or an HTTPS host, then open `index.html` in a modern WebGL-capable browser. For example, from the project folder run `python -m http.server 8765` and open `http://127.0.0.1:8765/`. An internet connection is needed for map tiles and live arrivals. Opening the file directly still displays the map, but the GMB API rejects `file://` requests.

## Features

- Bus, minibus, ferry, tram, and MTR bus routes
- Traditional Chinese, English, and Simplified Chinese
- Route and stop search
- Directional stop lists, departure times, and adult fares
- Light and dark interface themes, multiple basemaps, and browser geolocation
- Mobile touch and desktop controls
- Live arrivals in the selected stop panel for KMB/LWB, Citybus, GMB, MTR bus, and supported HKKF ferry routes, with English, Traditional Chinese and Simplified Chinese labels

The transit dataset is embedded in `index.html`. MapLibre is bundled in `vendor/`.

## Live arrivals

Select a stop on the map. The arrivals panel uses the official operator APIs:
KMB/LWB (`https://data.etabus.gov.hk/v1/transport/kmb/`), Citybus
(`https://rt.data.gov.hk/v2/transport/citybus/`), GMB
(`https://data.etagmb.gov.hk/`), MTR bus (`getSchedule`), and HKKF ferry
ETA endpoints (`https://www.hkkfeta.com/opendata/`).
It matches each local route direction independently, retaining separate API
directions and service variants. Candidates must be within 60 metres, with adjacent
stops in the same order within 100 metres. Normalized stop names, distance and
neighbour positions rank candidates; a clear score margin is required when more
than one candidate qualifies. Different routes can resolve to different operator
stop IDs. Repeated matches share one stop request, with at most four concurrent
requests. Unresolved route directions are listed separately, and a failed stop
request does not suppress successful arrivals from other stops. Citybus and GMB
fallbacks match the selected stop by route-stop names or coordinates, while MTR
bus schedules match published bus-stop names and HKKF uses published route and
direction identifiers. HKKF coverage is limited to the four routes in its
open-data ETA service. The bundled GTFS snapshot may differ from the current
operator data.

Predictions are filtered by route, direction, service type and stop sequence.
The existing bus list shows up to three upcoming arrivals as numbers beside each
bus, without a separate ETA list. Numbers indicate minutes remaining (0 means due).
Badges are red for 5 minutes or less, amber for 6–15 and green for more than 15.
Unmatched routes and unavailable predictions leave the numbers blank. Destination,
units and remarks are available in tooltips and accessible labels. The refresh icon
beside the bus count supports manual updates and has an accessible label.
Polling runs every minute while the panel is visible, pauses in hidden tabs and
stops when the panel is removed. Responses older than two minutes are not displayed
as current predictions. Times are displayed in Hong Kong time. Scheduled departures
and fares remain separate from live arrivals. Joint routes query each available
operator feed independently. Route geometry is not refreshed by the arrival APIs.

Metadata is cached in memory and, when browser storage permits, locally until the
next 05:00 Hong Kong time boundary. Browser access requires the API to permit the
page's origin; use localhost or HTTPS hosting if opening the file directly fails.
An API outage does not prevent use of the existing route map.

Run matching checks with `node --test tests/kmb-eta.test.cjs`. Browser checks use
`node tests/kmb-eta.browser.cjs` and `node tests/transit-eta.browser.cjs` with
Playwright and Microsoft Edge installed. The browser tests use controlled API
responses; they do not verify live availability.

## Data and licensing

### Official road geometry

Run `node scripts/refresh_csdi_routes.cjs` (Node 18 or newer) to import the
supplied simplified official CSDI route shapes from
`data/Bus_routes_converted.json`. The source is a GeoJSON export of CSDI dataset
`td_rcd_1638844988873_41214`; it is matched by exact Transport Department route
ID and direction code, then embedded in `index.html`. The importer only joins
touching fragments already present in an official shape. It does not run a
path-finding algorithm, query a road network, or invent connecting segments.
The deployed app and file previews therefore need no separate data fetch.

The importer also precomputes low and intermediate route geometry. The current
178,960-vertex tier is used below zoom 11.5, including all zooms below 11. A
328,239-vertex intermediate tier is used from zoom 11.5 onward, including the
highest zoom level. Geometry is swapped only when a zoom boundary is crossed,
and active route or operator filters are preserved across the swap.

Each import also writes the simplified tiers as standalone WGS84 GeoJSON files:
`data/routes-lod-low.geojson` and `data/routes-lod-intermediate.geojson`.
Their features include route ID, route number, operator, direction, pattern index,
LOD name, and geometry provider.

The Valhalla route builder has been retired. The supplied bus export does not
contain GMB features, so existing embedded official GMB shapes are retained.
Uncovered or disconnected directions are listed in the local
`data/csdi-coverage.json` report. Stop lists, fares and timetables remain the
bundled GTFS snapshot, so geometry imports do not claim to refresh those.

`scripts/probe_google_routes.cjs` makes one diagnostic Google request for an
uncovered direction using `google_routes_api` from the process environment.
Load it from the Windows user environment in the launching PowerShell process.
It uses at most ten intermediate stops, reserves requests in a local monthly
ledger before sending, and stops at 9,000 requests. Other clients' usage is not
visible to this guard; Google Cloud quotas must also be configured. Google is
never called by the daily CSDI refresh. No Google response geometry or key is
written into the application. Google route display and persistent storage need
to comply with the applicable Google Maps Platform agreement.

Check matching with `node --test tests/csdi-routes.test.cjs`.

Transit data is from the Hong Kong Transport Department. Road data and street tiles are © OpenStreetMap contributors. MapLibre's license is included in `vendor/MAPLIBRE-LICENSE.txt`.
