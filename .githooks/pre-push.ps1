$ErrorActionPreference = "Stop"

$autoBumpEnabled = ($env:AUTO_BUMP_ON_PUSH -ne "0")

$repoRoot = git rev-parse --show-toplevel
if (-not $repoRoot) {
    Write-Host "Unable to determine repository root."
    exit 1
}

Set-Location $repoRoot

# Gate the push on the test suite. Zero dependencies -- plain node, no npm --
# so this works on any machine that can already run the repo's tooling.
# Set SKIP_TESTS_ON_PUSH=1 to bypass when you need to push a work in progress.
$testRunner = Join-Path $repoRoot "tests\run.js"
if ((Test-Path $testRunner) -and ($env:SKIP_TESTS_ON_PUSH -ne "1")) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        Write-Host "Running tests..."
        & node $testRunner | Out-String -Stream | Select-Object -Last 3 | Write-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "Tests failed. Push aborted."
            Write-Host "Run 'node tests/run.js' for the full output, or set SKIP_TESTS_ON_PUSH=1 to bypass."
            exit 1
        }
    } else {
        Write-Host "node not found on PATH; skipping tests."
    }
}

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
#
# A branch with no upstream yet -- every new branch, on its first push -- makes
# git write "fatal: no upstream configured" to stderr. With
# $ErrorActionPreference = "Stop" set at the top of this file, PowerShell 7 turns
# native stderr into a terminating error, so the hook died here and the push was
# refused. 2>$null does not prevent that; only catching it does. The try/catch
# below leaves $upstream empty, which is exactly the "no upstream" case the
# following test already handles.
$upstream = $null
try {
    $upstream = git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
} catch {
    $upstream = $null
}
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
    Write-Host "AUTO_BUMP_ON_PUSH=0 detected. Skipping APP_VERSION bump."
    exit 0
}

$lines[$versionLineIndex] = "const APP_VERSION = '$nextVersion'; // Version: YYYY.MM.DD.NN"
# LF, not Set-Content. Set-Content writes CRLF on Windows, which re-inflates
# every line of the file the hook just edited and leaves the working tree
# bigger than the blob that ships. .gitattributes pins these to LF on checkout;
# writing CRLF here would put them straight back on every push.
[IO.File]::WriteAllText($scriptJsPath, ($lines -join "`n") + "`n")

# index.html carries the same version as its script cache key. It has to be
# rewritten here because the loader reads it before script.js exists, so it
# cannot take the value from APP_VERSION at runtime.
#
# If these two drift, the browser serves cached modules from an older deploy
# against a newer script.js. A test fails the build when they disagree, but
# keeping them in step is this hook's job.
$indexHtmlPath = Join-Path $repoRoot 'index.html'
if (Test-Path $indexHtmlPath) {
    $htmlLines = Get-Content $indexHtmlPath
    $buildLineIndex = -1
    for ($i = 0; $i -lt $htmlLines.Count; $i++) {
        if ($htmlLines[$i].Contains('// APP_BUILD')) { $buildLineIndex = $i; break }
    }
    if ($buildLineIndex -ge 0) {
        $htmlLines[$buildLineIndex] = "            var APP_BUILD = '$nextVersion'; // APP_BUILD"
        # LF here too, for the same reason. index.html is 178,636 bytes as
        # deployed and the budget test caps it at 179,200, so the 1,934 CRs
        # Set-Content adds are the difference between passing and failing.
        [IO.File]::WriteAllText($indexHtmlPath, ($htmlLines -join "`n") + "`n")
        git add index.html
    } else {
        Write-Host "APP_BUILD marker not found in index.html. Script caching will fall back to per-load."
    }
}

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
