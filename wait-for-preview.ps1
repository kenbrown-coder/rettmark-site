$ErrorActionPreference = "Stop"
$port = if ($env:RETTMARK_PREVIEW_PORT) { $env:RETTMARK_PREVIEW_PORT } else { "8080" }
$url = "http://127.0.0.1:$port/"
for ($i = 0; $i -lt 80; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { exit 0 }
  } catch {
  }
  Start-Sleep -Milliseconds 150
}
Write-Host "Preview did not respond at $url"
exit 1
