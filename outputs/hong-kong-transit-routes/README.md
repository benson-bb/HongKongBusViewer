# Hong Kong Bus Viewer

An interactive map of Hong Kong public transport routes and stops, built from Transport Department GTFS data and OpenStreetMap road data.

## Run

Open `index.html` in a modern WebGL-capable browser. No installation or local server is required. An internet connection is needed for map tiles.

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

Transit data is from the Hong Kong Transport Department. Road data and street tiles are © OpenStreetMap contributors. MapLibre's license is included in `vendor/MAPLIBRE-LICENSE.txt`.
