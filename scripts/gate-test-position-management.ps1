param(
  [string]$TerminalId = "CACSMS-ICMARK-LD4-36E29650",
  [string]$Ticket = "",
  [string]$Symbol = "XAUUSD",
  [string]$BaseUrl = "http://localhost:3001"
)

$headers = @{ "Content-Type" = "application/json"; "x-forwarded-for" = "127.0.0.1" }

function Wait-Command([string]$CommandId, [int]$MaxSec = 60) {
  for ($i = 0; $i -lt $MaxSec; $i++) {
    Start-Sleep -Seconds 1
    $state = Invoke-RestMethod -Uri "$BaseUrl/api/mt5/execution-bridge/state" -Headers @{ "x-forwarded-for" = "127.0.0.1" }
    $cmd = $state.commands | Where-Object { $_.commandId -eq $CommandId } | Select-Object -First 1
    if ($cmd -and $cmd.lifecycleState -in @("EXECUTED", "ACKNOWLEDGED", "FAILED", "TIMEOUT", "CANCELLED")) {
      return $cmd
    }
  }
  return $null
}

function Enqueue-Command([string]$Type, [hashtable]$Payload) {
  $body = @{
    terminalId = $TerminalId
    type       = $Type
    sandboxMode = $true
    environment = "DEMO"
    payload    = $Payload
  } | ConvertTo-Json -Depth 6
  return Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/mt5/execution-bridge/enqueue" -Headers $headers -Body $body
}

if (-not $Ticket) {
  $positions = Invoke-RestMethod -Uri "$BaseUrl/api/mt5/execution/open-positions" -Headers @{ "x-forwarded-for" = "127.0.0.1" }
  $Ticket = ($positions.positions | Select-Object -First 1).ticket
}

if (-not $Ticket) {
  throw "No open position ticket found. Place a sandbox order first."
}

Write-Host "Using ticket $Ticket on $TerminalId ($Symbol)"

Write-Host "`nSTEP 1 modify_order"
$modify = Enqueue-Command "modify_order" @{ ticket = $Ticket; symbol = $Symbol; stopLoss = 4320.0; takeProfit = 4340.0; reason = "gate-test-modify" }
Wait-Command $modify.command.commandId | Format-List commandId, type, lifecycleState, ackStatus, brokerMessage, ticket

Write-Host "`nSTEP 2 partial_close"
$partial = Enqueue-Command "partial_close" @{ ticket = $Ticket; symbol = $Symbol; volumeLots = 0.005; reason = "gate-test-partial" }
Wait-Command $partial.command.commandId | Format-List commandId, type, lifecycleState, ackStatus, brokerMessage, ticket

Write-Host "`nSTEP 3 close_order"
$close = Enqueue-Command "close_order" @{ ticket = $Ticket; symbol = $Symbol; reason = "gate-test-close" }
Wait-Command $close.command.commandId | Format-List commandId, type, lifecycleState, ackStatus, brokerMessage, ticket

Write-Host "`nOpen positions after test:"
Invoke-RestMethod -Uri "$BaseUrl/api/mt5/execution/open-positions" -Headers @{ "x-forwarded-for" = "127.0.0.1" } | ConvertTo-Json -Depth 4
