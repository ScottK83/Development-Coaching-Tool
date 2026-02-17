param(
    [string]$Message = "chore: update",
    [string]$Branch = "main",
    [string]$Remote = "origin",
    [string]$ProjectName = "supervisor-dashboard",
    [switch]$IncludeUntracked
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

Write-Host "Starting publish workflow (git push + Cloudflare deploy)..." -ForegroundColor Green

# 1) Validate repo
Invoke-Step "git rev-parse --is-inside-work-tree" "Checking git repository"

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
    Invoke-Step "git commit -m \"$Message\"" "Creating commit"
} else {
    Write-Host "`nNo staged changes to commit. Continuing with push + deploy..." -ForegroundColor Yellow
}

# 4) Push
Invoke-Step "git push $Remote $Branch" "Pushing to $Remote/$Branch"

# 5) Deploy to Cloudflare Pages
Invoke-Step "npx wrangler pages deploy . --project-name $ProjectName --commit-dirty=true" "Deploying to Cloudflare Pages ($ProjectName)"

Write-Host "`n✅ Publish workflow complete." -ForegroundColor Green
