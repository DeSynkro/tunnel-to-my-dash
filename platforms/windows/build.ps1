$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$buildDir = Join-Path $root "build"
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

Push-Location (Join-Path $root "core")
try {
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    go test ./...
    go build -trimpath -o (Join-Path $buildDir "ttmd-core.exe") ./cmd/ttmd-core
}
finally {
    Pop-Location
}

Push-Location (Join-Path $root "desktop")
try {
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    npm ci
    node node_modules/electron/install.js
    npm run check
    npm run dist:windows
}
finally {
    Pop-Location
}

Write-Host "Built:"
Get-ChildItem (Join-Path $root "desktop\release\*.exe") |
    ForEach-Object { Write-Host "  $($_.FullName)" }
