$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$file = Join-Path $workspace "pulson-alarm-card-v2.js"
$gz = Join-Path $env:TEMP "pulson-alarm-card-v2.js.gz"
$ftpBase = "ftp://192.168.128.143/config/www/community/lovelace-pulson-alarm-demo"
$ftpUser = "sobson:Cymes123!"
$haBaseUrl = "http://192.168.128.143:8123"
$haToken = if ($env:HA_TOKEN) { $env:HA_TOKEN } else { "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxNjM1ZGJlNzZiYjI0YzFiYjQ2YzczOWFkOTY3M2E2NiIsImlhdCI6MTc3ODMzNjQ4NywiZXhwIjoyMDkzNjk2NDg3fQ.VtmG1jhxvEKbirCve4E3UKp4j2iHmNmWL8zGRZyismE" }
$resourcePath = "/hacsfiles/lovelace-pulson-alarm-demo/pulson-alarm-card-v2.js"
$resourceUrl = "${resourcePath}?v=$(Get-Date -Format 'yyyyMMddHHmmss')"

function Receive-HaWsJson {
  param([System.Net.WebSockets.ClientWebSocket]$Client)

  $buffer = [byte[]]::new(65536)
  $stream = [System.IO.MemoryStream]::new()
  try {
    do {
      $segment = [ArraySegment[byte]]::new($buffer)
      $result = $Client.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        throw "Polaczenie WebSocket z HA zostalo zamkniete."
      }
      $stream.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)

    $json = [Text.Encoding]::UTF8.GetString($stream.ToArray())
    return $json | ConvertFrom-Json
  } finally {
    $stream.Dispose()
  }
}

function Send-HaWsJson {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Client,
    [hashtable]$Payload
  )

  $json = $Payload | ConvertTo-Json -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $null = $Client.SendAsync(
    $segment,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult()
}

function Update-HaLovelaceResource {
  param(
    [string]$Token,
    [string]$NewUrl
  )

  $wsUrl = $haBaseUrl -replace "^http", "ws"
  $client = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $null = $client.ConnectAsync([Uri]"$wsUrl/api/websocket", [Threading.CancellationToken]::None).GetAwaiter().GetResult()

    $authRequired = Receive-HaWsJson $client
    if ($authRequired.type -ne "auth_required") {
      throw "HA nie zwrocil auth_required."
    }

    Send-HaWsJson $client @{ type = "auth"; access_token = $Token }
    $authResult = Receive-HaWsJson $client
    if ($authResult.type -ne "auth_ok") {
      throw "Autoryzacja HA nie powiodla sie: $($authResult.message)"
    }

    Send-HaWsJson $client @{ id = 1; type = "lovelace/resources/list" }
    $listResult = Receive-HaWsJson $client
    if (-not $listResult.success) {
      throw "Nie udalo sie pobrac zasobow Lovelace."
    }

    $resource = $listResult.result | Where-Object { $_.url -like "$resourcePath*" } | Select-Object -First 1
    if (-not $resource) {
      throw "Nie znaleziono zasobu Lovelace dla $resourcePath"
    }

    $resourceType = if ($resource.type) { $resource.type } else { "module" }
    Send-HaWsJson $client @{
      id = 2
      type = "lovelace/resources/update"
      resource_id = $resource.id
      url = $NewUrl
      res_type = $resourceType
    }

    $updateResult = Receive-HaWsJson $client
    if (-not $updateResult.success) {
      throw "Nie udalo sie zaktualizowac zasobu Lovelace."
    }
  } finally {
    if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $null = $client.CloseAsync(
        [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
        "done",
        [Threading.CancellationToken]::None
      ).GetAwaiter().GetResult()
    }
    $client.Dispose()
  }
}

if (-not (Test-Path $file)) {
  throw "Nie znaleziono pliku: $file"
}

$inputStream = [System.IO.File]::OpenRead($file)
try {
  $outputStream = [System.IO.File]::Create($gz)
  try {
    $gzipStream = [System.IO.Compression.GzipStream]::new(
      $outputStream,
      [System.IO.Compression.CompressionLevel]::Optimal
    )
    try {
      $inputStream.CopyTo($gzipStream)
    } finally {
      $gzipStream.Dispose()
    }
  } finally {
    $outputStream.Dispose()
  }
} finally {
  $inputStream.Dispose()
}

curl.exe --fail --progress-bar --show-error --ftp-create-dirs `
  -u $ftpUser `
  -T $file `
  "$ftpBase/pulson-alarm-card-v2.js"

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

curl.exe --fail --progress-bar --show-error --ftp-create-dirs `
  -u $ftpUser `
  -T $gz `
  "$ftpBase/pulson-alarm-card-v2.js.gz"

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Remove-Item $gz -ErrorAction SilentlyContinue

Write-Host ""
if ($haToken) {
  Update-HaLovelaceResource -Token $haToken -NewUrl $resourceUrl
  Write-Host "Deploy OK. Zasob Lovelace zaktualizowany automatycznie:"
} else {
  Write-Host "Deploy OK. Ustaw HA_TOKEN, zeby skrypt sam aktualizowal zasob."
  Write-Host "Na razie recznie ustaw zasob w HA jako:"
}
Write-Host $resourceUrl
Write-Host "Odswiez dashboard Ctrl+F5."
