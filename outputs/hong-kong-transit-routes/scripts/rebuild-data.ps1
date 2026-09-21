$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $projectRoot 'data'
$osmSource = Join-Path $dataDir 'source\hong-kong.osm.pbf'
$roadsFile = Join-Path $dataDir 'roads.geojsonl'
$ogr2ogr = 'C:\Program Files\QGIS 3.40.13\bin\ogr2ogr.exe'
$env:GDAL_DATA = 'C:\Program Files\QGIS 3.40.13\apps\gdal\share\gdal'

if (-not (Test-Path -LiteralPath $ogr2ogr)) {
  throw 'QGIS 3.40.13 with ogr2ogr is required at the default installation path.'
}

& $ogr2ogr -f GeoJSONSeq $roadsFile $osmSource lines -where 'highway IS NOT NULL' -select highway -lco RS=NO
node (Join-Path $PSScriptRoot 'build_gtfs_visual.js')
node (Join-Path $PSScriptRoot 'build_stop_routes.js')
node (Join-Path $PSScriptRoot 'build_route_stop_lists.js')
node --max-old-space-size=4096 (Join-Path $PSScriptRoot 'mapmatch_routes.js')
node (Join-Path $PSScriptRoot 'build_road_base.js')

Write-Host 'Processed route and road datasets rebuilt in data\.'
