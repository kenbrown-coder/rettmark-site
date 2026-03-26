param(
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

try {
  $py = Get-Command python -ErrorAction Stop
} catch {
  Write-Host "Python was not found. Install Python, then try again." -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Port/index.html"
Write-Host "Starting preview server at $url"
Write-Host "Press Ctrl+C in this window to stop the server."

Start-Process $url | Out-Null

& $py.Source -m http.server $Port

