# Prompt: Approximate MTR Tunnel Depths and 3D Track Profiles

Implement an approximate 3D vertical profile for the MTR routes in:

`C:\Users\ybai3\Documents\Codex\2026-09-10\hk-bus-route-lod-328k`

Start by inspecting the existing MTR viewer, route data, map library version, and working-tree changes. Preserve the current 2D view and existing route, station, fare, and ETA behavior.

## Goal

Give MTR track sections plausible elevations and tunnel depths so they can be visualized in an optional 3D or cutaway view. Treat this as an approximation wherever surveyed track-level data is unavailable; never present inferred depths as official measurements.

## Research and source priority

1. Find published rail-level or vertical-alignment profiles in official project documents, especially EIA drawings. Search for “rail level,” “track level,” “chainage,” and “mPD.”
2. Use official Lands Department/CSDI terrain and 3D data for surface context. Station indoor data may help identify floor ordering, but do not assume a floor number is an absolute rail elevation.
3. Use OpenStreetMap tags such as tunnel, bridge, and layer only to classify track sections. A layer value is relative stacking information, not an absolute height.
4. Use the Hong Kong Railway Standards as a guide for smooth vertical curves and gradients. A LegCo paper describes MTR profiles that can dip between stations with platforms higher; use that only as a prior for uncertain sections, not as a rule for every route.

References:

- Hong Kong Railway Standards: https://www.hyd.gov.hk/en/technical_references/technical_document/railway_standards/HKRS_ENG.pdf
- LegCo paper on MTR railway alignment: https://www.legco.gov.hk/yr11-12/english/panels/tp/tp_rdp/papers/tp_rdp0522cb1-1832-1-e.pdf
- LandsD 3D mapping: https://www.landsd.gov.hk/en/survey-mapping/mapping/3d-mapping.html
- LandsD MTR indoor map API: https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-indoor-mtr-station-map

## Implementation

- Keep all elevations in a consistent vertical datum where source data allows it; record the datum and source for each known anchor.
- For surface track, use terrain elevation. For viaducts and bridges, use a documented or explicitly estimated deck height.
- For tunnels, anchor the profile to known rail levels, portals, and other credible project data. Interpolate the gaps with a smooth profile, keeping it below terrain or seabed with plausible cover. Do not derive tunnel elevation directly from the surface DEM.
- Use a different approach for cross-harbour or immersed-tube sections when source drawings provide seabed, tunnel, or rail levels.
- Attach provenance and a confidence label to each segment or profile range, such as documented, interpolated, or approximate. Make uncertain sections visually distinguishable and explain the approximation in the UI.
- Keep a safe fallback to the existing 2D geometry when 3D data is missing. If vertical exaggeration or a cutaway is needed to make tunnels legible, label it clearly.
- Keep the elevation data generation reproducible and avoid hand-editing a large generated file without a source script.

Before finishing, check representative surface, elevated, tunnel, and cross-harbour sections. Confirm that the route geometry remains connected and that the existing 2D viewer and ETA/fare functions still work. Summarize the data sources, assumptions, and sections that remain approximate.
