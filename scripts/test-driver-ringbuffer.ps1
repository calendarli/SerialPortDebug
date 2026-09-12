# Compile the actual ring buffer implementation without loading/installing a driver.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'build/virtual-serial/ringbuffer-test'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$source = Join-Path $root 'driver/SerialFlowVirtualSerial'
$code = [IO.File]::ReadAllText((Join-Path $source 'ringbuffer.c'))
[IO.File]::WriteAllText((Join-Path $output 'ringbuffer-under-test.c'), $code.Replace('#include "internal.h"', ''))
Copy-Item -LiteralPath (Join-Path $source 'ringbuffer.h') -Destination $output
Copy-Item -LiteralPath (Join-Path $source 'read-queue.h') -Destination $output
Copy-Item -LiteralPath (Join-Path $root 'tests/native/ringbuffer-test.c') -Destination $output
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Visual Studio C++ tools not found' }
$vcvars = Join-Path $vs 'VC/Auxiliary/Build/vcvars64.bat'
[IO.File]::WriteAllText((Join-Path $output 'compile.cmd'), "@call `"$vcvars`" >nul`r`n@if errorlevel 1 exit /b 1`r`n@cl.exe /nologo /W4 /WX ringbuffer-test.c /Fe:ringbuffer-test.exe`r`n")
Push-Location $output
try {
    & cmd.exe /d /c compile.cmd
    if ($LASTEXITCODE -ne 0) { throw 'Ring buffer test compilation failed' }
    & ./ringbuffer-test.exe
    if ($LASTEXITCODE -ne 0) { throw 'Ring buffer regression failed' }
} finally {
    Pop-Location
}
