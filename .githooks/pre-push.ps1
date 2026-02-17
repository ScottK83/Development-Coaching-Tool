$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
if (-not $repoRoot) {
    Write-Host "Unable to determine repository root."
    exit 1
}

Set-Location $repoRoot
$scriptJsPath = Join-Path $repoRoot "script.js"

if (!(Test-Path $scriptJsPath)) {
    Write-Host "No script.js found. Skipping APP_VERSION bump."
    exit 0
}

function Get-NextAppVersion {
    $today = Get-Date
    $datePart = $today.ToString("yyyy.MM.dd")
    $since = $today.ToString("yyyy-MM-dd") + " 00:00:00"
    $until = $today.ToString("yyyy-MM-dd") + " 23:59:59"

    $countOutput = git rev-list --count --since="$since" --until="$until" HEAD
    $existingCount = 0
    if ($countOutput) {
        [void][int]::TryParse($countOutput.Trim(), [ref]$existingCount)
    }

    $nextCount = $existingCount + 1
    return "$datePart.$nextCount"
}

$lines = Get-Content $scriptJsPath
$versionLineIndex = -1
$currentVersion = $null

for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Contains('const APP_VERSION')) {
        $versionLineIndex = $i
        if ($lines[$i] -match "'(?<ver>\d{4}\.\d{2}\.\d{2}\.\d+)'") {
            $currentVersion = $matches['ver']
        }
        break
    }
}

if ($versionLineIndex -lt 0) {
    Write-Host "APP_VERSION line not found. Skipping version bump."
    exit 0
}

$nextVersion = Get-NextAppVersion
if ($currentVersion -eq $nextVersion) {
    exit 0
}

$lines[$versionLineIndex] = "const APP_VERSION = '$nextVersion'; // Version: YYYY.MM.DD.NN"
Set-Content -Path $scriptJsPath -Value $lines

git add script.js

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    exit 0
}

# Amend latest commit so the pushed commit always carries the new version.
git commit --amend --no-edit | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to amend commit with updated APP_VERSION."
    exit 1
}

Write-Host "Updated APP_VERSION to $nextVersion and amended HEAD before push."
exit 0
