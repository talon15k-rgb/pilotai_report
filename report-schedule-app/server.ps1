# Report schedule board - local server
# Runs on Windows PowerShell 5.1 with no extra installs.
# Serves public/index.html and a small JSON API that stores each record
# as one file under data/reports and data/events.
param(
  [int]$Port = 8080,
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$PublicDir = Join-Path $Root 'public'
$DataDir = Join-Path $Root 'data'
$Collections = @('reports', 'events')
$MaxBody = 262144
$Utf8 = New-Object System.Text.UTF8Encoding $false

foreach ($c in $Collections) {
  $d = Join-Path $DataDir $c
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

function Send-Response($stream, [int]$code, [string]$status, [string]$contentType, [byte[]]$body) {
  if ($null -eq $body) { $body = [byte[]]@() }
  $head = "HTTP/1.1 $code $status`r`n" +
          "Content-Type: $contentType`r`n" +
          "Content-Length: $($body.Length)`r`n" +
          "Cache-Control: no-store`r`n" +
          "X-Content-Type-Options: nosniff`r`n" +
          "Connection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Send-Json($stream, [int]$code, [string]$status, [string]$json) {
  Send-Response $stream $code $status 'application/json; charset=utf-8' ($Utf8.GetBytes($json))
}

function Read-Request($stream) {
  # Read headers byte by byte until CRLFCRLF
  $buf = New-Object System.IO.MemoryStream
  $last4 = 0
  while ($true) {
    $b = $stream.ReadByte()
    if ($b -lt 0) { return $null }
    $buf.WriteByte([byte]$b)
    $last4 = (($last4 -shl 8) -bor $b) -band 0xFFFFFFFF
    if ($last4 -eq 0x0D0A0D0A) { break }
    if ($buf.Length -gt 16384) { return $null }
  }
  $headText = [System.Text.Encoding]::ASCII.GetString($buf.ToArray())
  $lines = $headText -split "`r`n"
  $parts = $lines[0] -split ' '
  if ($parts.Length -lt 2) { return $null }
  $len = 0
  foreach ($l in $lines[1..($lines.Length - 1)]) {
    if ($l -match '^(?i)content-length:\s*(\d+)') { $len = [int]$Matches[1] }
  }
  if ($len -gt $MaxBody) { return @{ Method = $parts[0]; Path = $parts[1]; TooLarge = $true; Body = '' } }
  $body = ''
  if ($len -gt 0) {
    $bytes = New-Object byte[] $len
    $read = 0
    while ($read -lt $len) {
      $n = $stream.Read($bytes, $read, $len - $read)
      if ($n -le 0) { return $null }
      $read += $n
    }
    $body = $Utf8.GetString($bytes)
  }
  return @{ Method = $parts[0].ToUpperInvariant(); Path = ($parts[1] -split '\?')[0]; TooLarge = $false; Body = $body }
}

function Get-AllData {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('{')
  $firstCol = $true
  foreach ($c in $Collections) {
    if (-not $firstCol) { [void]$sb.Append(',') }
    $firstCol = $false
    [void]$sb.Append('"' + $c + '":[')
    $first = $true
    foreach ($f in (Get-ChildItem -Path (Join-Path $DataDir $c) -Filter '*.json' -File)) {
      $txt = [System.IO.File]::ReadAllText($f.FullName, $Utf8).Trim()
      if (-not $txt.StartsWith('{')) { continue }
      if (-not $first) { [void]$sb.Append(',') }
      $first = $false
      [void]$sb.Append($txt)
    }
    [void]$sb.Append(']')
  }
  [void]$sb.Append('}')
  return $sb.ToString()
}

function Handle($req, $stream) {
  if ($req.TooLarge) { Send-Json $stream 413 'Payload Too Large' '{"error":"too_large"}'; return }
  $m = $req.Method; $p = $req.Path

  if ($m -eq 'GET' -and ($p -eq '/' -or $p -eq '/index.html')) {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PublicDir 'index.html'))
    Send-Response $stream 200 'OK' 'text/html; charset=utf-8' $bytes
    return
  }
  if ($m -eq 'GET' -and $p -eq '/api/data') {
    Send-Json $stream 200 'OK' (Get-AllData)
    return
  }
  if ($p -match '^/api/(reports|events)/([A-Za-z0-9-]{1,64})$') {
    $col = $Matches[1]; $id = $Matches[2]
    $file = Join-Path (Join-Path $DataDir $col) "$id.json"
    if ($m -eq 'PUT') {
      $body = $req.Body.Trim()
      $obj = $null
      try { $obj = $body | ConvertFrom-Json } catch { $obj = $null }
      if ($null -eq $obj -or -not $body.StartsWith('{') -or $obj.id -ne $id) {
        Send-Json $stream 400 'Bad Request' '{"error":"invalid_body"}'; return
      }
      $tmp = "$file.tmp"
      [System.IO.File]::WriteAllText($tmp, $body, $Utf8)
      Move-Item -LiteralPath $tmp -Destination $file -Force
      Send-Json $stream 200 'OK' '{"ok":true}'
      return
    }
    if ($m -eq 'DELETE') {
      if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
      Send-Json $stream 200 'OK' '{"ok":true}'
      return
    }
    Send-Json $stream 405 'Method Not Allowed' '{"error":"method"}'
    return
  }
  Send-Json $stream 404 'Not Found' '{"error":"not_found"}'
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
try { $listener.Start() } catch {
  Write-Host "Port $Port is already in use. Close the other window or run: start.bat 8081" -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '  Report schedule board is running.' -ForegroundColor Green
Write-Host "  This PC:      http://localhost:$Port"
$ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
  Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not $_.ToString().StartsWith('127.') }
foreach ($ip in $ips) { Write-Host "  Other PCs:    http://$($ip):$Port" }
Write-Host "  Data folder:  $DataDir"
Write-Host '  Close this window (or press Ctrl+C) to stop.'
Write-Host ''
if ($Open) { Start-Process "http://localhost:$Port" }

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 3000
    $client.SendTimeout = 5000
    $stream = $client.GetStream()
    $req = Read-Request $stream
    if ($null -ne $req) {
      try { Handle $req $stream }
      catch {
        Write-Host ("Error: " + $_.Exception.Message) -ForegroundColor Yellow
        try { Send-Json $stream 500 'Internal Server Error' '{"error":"server"}' } catch { }
      }
    }
  } catch {
    # idle or broken connection; ignore
  } finally {
    $client.Close()
  }
}
