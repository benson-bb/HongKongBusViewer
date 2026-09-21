$ErrorActionPreference = 'Stop'
# Import the supplied official CSDI route shapes; no road-network routing is used.
& node (Join-Path $PSScriptRoot 'refresh_csdi_routes.cjs')
if ($LASTEXITCODE -ne 0) { throw 'CSDI route-shape import failed; see the preceding error.' }
