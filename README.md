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

The route and stop dataset is embedded in `index.html`; the small official MTR
stop catalogue is bundled in `assets/mtr-bus-stops.js`. MapLibre is bundled in
`vendor/`.

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
fallbacks match the selected stop by route-stop names or coordinates. MTR bus
schedules use the local route pattern and published stop catalogue to resolve the
exact MTR stop ID and direction. HKKF uses published route and direction
identifiers and covers the four routes in its open-data ETA service. The bundled
GTFS snapshot may differ from the current operator data.

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

The MTR stop catalogue comes from the official monthly MTR Bus & Feeder Bus Stops
dataset at `https://opendata.mtr.com.hk/data/mtr_bus_stops.csv`; its compact copy
is in `assets/mtr-bus-stops.js` so route matching works without a cross-origin
catalogue request. KMB metadata is cached in memory and, when browser storage
permits, locally until the next 05:00 Hong Kong time boundary. Browser access
requires each live API to permit the page's origin; use localhost or HTTPS hosting
if opening the file directly fails. An API outage does not prevent use of the map.

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

### Ferry route geometry

Ferry geometry is supplemented from OpenStreetMap `route=ferry` relations and
standalone ways. `data/osm-ferry-overpass.json` is the source snapshot; run
`node scripts/import_osm_ferry_routes.cjs --write` to rematch route directions
against the app's ferry terminals and regenerate `assets/osm-ferry-routes.js`.
The importer snaps terminals to OSM paths, extracts the segment between them
when OSM maps a longer service, and joins consecutive ferry legs through
intermediate piers when needed. Ambiguous, unmatched and loop directions without
a complete mapped path keep their bundled geometry. Ferry routes always use the
highest-detail shape at every zoom level, without LOD switching. Ferry geometry
is credited in the map attribution; the source data is © OpenStreetMap
contributors and is available under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).

The Sha Tau Kok–Ap Chau–Kat O–Lai Chi Wo loop uses its mapped OSM legs and a
direct final water crossing back to Sha Tau Kok. The High Island–Sai Kung return
uses a direct crossing because the mapped alternative calls at Kau Sai Village,
which that service skips. These direct ferry segments connect the scheduled
piers and are approximate where OSM has no route line.

### Tram and Peak Tram geometry

Hong Kong Tramways and Peak Tram shapes are derived from OpenStreetMap track
relations. Rebuild them with `node scripts/import_osm_rail_routes.cjs --write`.
The importer follows each app direction's ordered stop pattern over the OSM
track network, so direction-specific paths through the Happy Valley loop are
kept. The rail route geometries use their full detail at all zoom levels. The
bundled OSM snapshots are in `data/osm-relation-*.xml`; map attribution and the
ODbL notice above apply to these shapes as well.

Transit data is from the Hong Kong Transport Department. Road data and street tiles are © OpenStreetMap contributors. MapLibre's license is included in `vendor/MAPLIBRE-LICENSE.txt`.

### MTR rail viewer

Open mtr.html for a separate MTR rail map, linked from the home page.
It draws line shapes from the route relations listed on the
[OpenStreetMap Hong Kong MTR routes page](https://wiki.openstreetmap.org/wiki/Hong_Kong/Transport/Routes/MTR)
and uses MTR Corporation's monthly mtr_lines_and_stations.csv for line
directions, station order, codes, and bilingual names. The current station CSV
snapshot is in data/mtr_lines_and_stations.csv; assets/mtr-network.json
contains the bundled route geometry and station coordinates. The importer
matches CSV station codes/names to OSM stop positions and reports any stations
without geometry.

Run node scripts/refresh_mtr_viewer.cjs (Node 18 or newer) to refresh the CSV
and OSM relations and regenerate the bundled network. This is a separate data
path from the GTFS-based bus viewer. OSM route and stop data is available under
the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/);
MTR schedule and station data is © MTR Corporation Limited.

Click a station to request live predictions from MTR's public
[getSchedule.php API](https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php).
The page requests the selected station only, refreshes it every 20 seconds
while visible, and provides a manual refresh control. It displays both travel
directions, up to four trains per direction, predicted time, destination,
platform, and service-delay notices. The API updates every 10 seconds.
