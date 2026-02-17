param(
    [string]$Message = "chore: update",
    [string]$Branch = "main",
    [string]$Remote = "origin",
    [string]$ProjectName = "supervisor-dashboard",
    [switch]$IncludeUntracked
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptJsPath = Join-Path $repoRoot "script.js"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$Description
    )

    Write-Host "`n==> $Description" -ForegroundColor Cyan
    Write-Host "    $Command" -ForegroundColor DarkGray
    Invoke-Expression $Command
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

function Update-AppVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$FilePath
    )

    if (!(Test-Path $FilePath)) {
        throw "script.js not found at: $FilePath"
    }

    $lines = Get-Content $FilePath
    $updatedAny = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Contains('const APP_VERSION')) {
            $lines[$i] = "const APP_VERSION = '$Version'; // Version: YYYY.MM.DD.NN"
            $updatedAny = $true
            break
        }
    }

    if (-not $updatedAny) {
        throw "APP_VERSION declaration not found or already in unexpected format."
    }

    Set-Content -Path $FilePath -Value $lines
}

Write-Host "Starting publish workflow (git push + Cloudflare deploy)..." -ForegroundColor Green

# 1) Validate repo
Invoke-Step "git rev-parse --is-inside-work-tree" "Checking git repository"

# 1.5) Always bump app version for this push
$newVersion = Get-NextAppVersion
Update-AppVersion -Version $newVersion -FilePath $scriptJsPath
Write-Host "Updated APP_VERSION to $newVersion" -ForegroundColor Green

# 2) Stage files
if ($IncludeUntracked) {
    Invoke-Step "git add -A" "Staging tracked + untracked changes"
} else {
    Invoke-Step "git add -u" "Staging tracked changes only"
    $untracked = git ls-files --others --exclude-standard
    if ($untracked) {
        Write-Host "`n⚠️ Untracked files were NOT included (use -IncludeUntracked to include):" -ForegroundColor Yellow
        $untracked | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
    }
}

# 3) Commit only if there are staged changes
git diff --cached --quiet
$hasStaged = ($LASTEXITCODE -ne 0)
if ($hasStaged) {
    $safeMessage = $Message.Replace("'", "''")
    Invoke-Step "git commit -m '$safeMessage'" "Creating commit"
} else {
    Write-Host "`nNo staged changes to commit. Continuing with push + deploy..." -ForegroundColor Yellow
}

# 4) Push
Invoke-Step "git push $Remote $Branch" "Pushing to $Remote/$Branch"

# 5) Deploy to Cloudflare Pages
Invoke-Step "npx wrangler pages deploy . --project-name $ProjectName --commit-dirty=true" "Deploying to Cloudflare Pages ($ProjectName)"

Write-Host "`n✅ Publish workflow complete." -ForegroundColor Green
