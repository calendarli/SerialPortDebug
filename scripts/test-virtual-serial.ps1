# Run against an existing, idle SerialFlow virtual pair. Does not install/remove devices.
param(
    [Parameter(Mandatory = $true)][string]$First,
    [Parameter(Mandatory = $true)][string]$Second
)
$ErrorActionPreference = 'Stop'
$a = [System.IO.Ports.SerialPort]::new($First, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$b = [System.IO.Ports.SerialPort]::new($Second, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$eventId = 'SerialFlow.DriverTest.' + [guid]::NewGuid().ToString('N')
Register-ObjectEvent -InputObject $b -EventName DataReceived -SourceIdentifier $eventId | Out-Null
try {
    $a.Open()
    $b.Open()
    $a.DiscardInBuffer()
    $b.DiscardInBuffer()
    Write-Output 'OPEN_115200_8N1_AND_PURGE_OK'
    $a.Write('EVENT_RX')
    if (!(Wait-Event -SourceIdentifier $eventId -Timeout 5)) { throw 'Receive notification timed out' }
    if ($b.ReadExisting() -ne 'EVENT_RX') { throw 'Receive event payload mismatch' }
    Write-Output 'WAIT_COMM_EVENT_RX_OK'
    $payload = [byte[]](0, 1, 127, 128, 254, 255)
    $b.Write($payload, 0, $payload.Length)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($a.BytesToRead -lt $payload.Length -and $timer.ElapsedMilliseconds -lt 3000) {
        Start-Sleep -Milliseconds 10
    }
    if ($a.BytesToRead -ne $payload.Length) { throw 'Reverse transfer timed out' }
    $received = [byte[]]::new($payload.Length)
    if ($a.Read($received, 0, $received.Length) -ne $payload.Length) { throw 'Short read' }
    if ([Convert]::ToBase64String($received) -ne [Convert]::ToBase64String($payload)) { throw 'Binary transfer mismatch' }
    $b.Write('discard')
    $timer.Restart()
    while ($a.BytesToRead -lt 7 -and $timer.ElapsedMilliseconds -lt 3000) { Start-Sleep -Milliseconds 10 }
    if ($a.BytesToRead -ne 7) { throw 'Purge fixture did not arrive' }
    $a.DiscardInBuffer()
    if ($a.BytesToRead -ne 0) { throw 'Purge did not clear input' }
    $a.DtrEnable = $true
    $a.DtrEnable = $false
    $a.RtsEnable = $true
    $a.RtsEnable = $false
    Write-Output 'BIDIRECTIONAL_BINARY_PURGE_DTR_RTS_OK'
} finally {
    $a.Dispose()
    $b.Dispose()
    Unregister-Event -SourceIdentifier $eventId
    Remove-Event -SourceIdentifier $eventId -ErrorAction SilentlyContinue
}
