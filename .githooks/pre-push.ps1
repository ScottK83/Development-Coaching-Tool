$ErrorActionPreference = "Stop"

$autoBumpEnabled = ($env:AUTO_BUMP_ON_PUSH -eq "1")

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
    param(
        [string]$CurrentVersion
    )

    $today = Get-Date
    $datePart = $today.ToString("yyyy.MM.dd")

    if ($CurrentVersion -match "^(?<date>\d{4}\.\d{2}\.\d{2})\.(?<count>\d+)$" -and $matches['date'] -eq $datePart) {
        $nextCount = ([int]$matches['count']) + 1
        return "$datePart.$nextCount"
    }

    return "$datePart.1"
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

# If this branch is behind upstream, skip bump to avoid repeated bumps on failed pushes.
$upstream = git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
if ($LASTEXITCODE -eq 0 -and $upstream) {
    $counts = git rev-list --left-right --count "$upstream...HEAD" 2>$null
    if ($LASTEXITCODE -eq 0 -and $counts) {
        $parts = $counts.Trim().Split("`t", [System.StringSplitOptions]::RemoveEmptyEntries)
        if ($parts.Count -lt 2) {
            $parts = $counts.Trim().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
        }

        if ($parts.Count -ge 2) {
            $behind = 0
            [void][int]::TryParse($parts[0], [ref]$behind)
            if ($behind -gt 0) {
                Write-Host "Branch is behind $upstream. Skipping APP_VERSION bump until branch is rebased/pulled."
                exit 0
            }
        }
    }
}

$nextVersion = Get-NextAppVersion -CurrentVersion $currentVersion
if ($currentVersion -eq $nextVersion) {
    # Already at today's version, no bump needed
    exit 0
}

# Check if HEAD commit message is a version bump commit from pre-push
$headCommitMsg = git log -1 --pretty=%B
if ($headCommitMsg.Trim() -match "^chore: bump app version to") {
    # The previous push already created a version bump commit, don't loop
    Write-Host "HEAD is already a version bump commit from pre-push. Allowing push."
    exit 0
}

if (-not $autoBumpEnabled) {
    Write-Host "APP_VERSION ($currentVersion) is behind expected $nextVersion. Skipping auto-bump during push to avoid push retries."
    Write-Host "Set AUTO_BUMP_ON_PUSH=1 to restore legacy auto-commit behavior."
    exit 0
}

$lines[$versionLineIndex] = "const APP_VERSION = '$nextVersion'; // Version: YYYY.MM.DD.NN"
Set-Content -Path $scriptJsPath -Value $lines

git add script.js

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    exit 0
}

# Create a new commit instead of amending.
git commit -m "chore: bump app version to $nextVersion" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to commit updated APP_VERSION."
    exit 1
}

Write-Host "Updated APP_VERSION to $nextVersion and created a new commit. Re-run push."
exit 1
