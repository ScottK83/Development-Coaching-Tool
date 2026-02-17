param(
    [Parameter(Mandatory = $true)]
    [string]$Ref,
    [string]$ProjectName = "supervisor-dashboard",
    [string]$BranchName = ""
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$Description
    )

    Write-Host "`n==> $Description" -ForegroundColor Cyan
    Write-Host "    $Command" -ForegroundColor DarkGray
    Invoke-Expression $Command
}

Write-Host "Starting rollback deploy workflow..." -ForegroundColor Green

# Ensure working tree is clean to avoid accidental loss
$dirty = git status --porcelain
if ($dirty) {
    throw "Working tree is not clean. Commit/stash changes before rollback deploy."
}

Invoke-Step "git rev-parse --is-inside-work-tree" "Checking git repository"
Invoke-Step "git fetch --tags origin" "Fetching latest refs and tags"

$resolved = (git rev-parse --verify $Ref).Trim()
if (-not $resolved) {
    throw "Could not resolve ref: $Ref"
}

$shortSha = (git rev-parse --short $resolved).Trim()
if ([string]::IsNullOrWhiteSpace($BranchName)) {
    $BranchName = "rollback/" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-$shortSha"
}

Invoke-Step "git switch -C $BranchName $resolved" "Checking out rollback branch ($BranchName)"
Invoke-Step "npx wrangler pages deploy . --project-name $ProjectName --commit-dirty=true" "Deploying rollback build to Cloudflare Pages ($ProjectName)"

Write-Host "`n✅ Rollback deploy complete." -ForegroundColor Green
Write-Host "Branch: $BranchName" -ForegroundColor Yellow
Write-Host "Ref:    $resolved" -ForegroundColor Yellow
Write-Host "`nWhen ready, return to main:" -ForegroundColor DarkGray
Write-Host "git switch main" -ForegroundColor DarkGray
