# Switch to new clean version
Write-Host "🔄 Switching to new clean version..." -ForegroundColor Cyan

# Backup old files
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Write-Host "📦 Creating backup of old files..." -ForegroundColor Yellow
Copy-Item "index.html" "index.html.old-$timestamp" -ErrorAction SilentlyContinue
Copy-Item "script.js" "script.js.old-$timestamp" -ErrorAction SilentlyContinue

# Replace with new files
Write-Host "✨ Installing new clean files..." -ForegroundColor Green
Copy-Item "index-new.html" "index.html" -Force
Copy-Item "script-new.js" "script.js" -Force

Write-Host ""
Write-Host "✅ SUCCESS! New clean version is now active!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 What changed:" -ForegroundColor Cyan
Write-Host "  • Fixed data parsing (no more 424% transfers!)" -ForegroundColor White
Write-Host "  • Fixed emoji encoding (all emojis display correctly)" -ForegroundColor White
Write-Host "  • Fixed survey percentage parsing" -ForegroundColor White
Write-Host "  • Added nickname memory" -ForegroundColor White
Write-Host "  • Added keyboard shortcuts (Ctrl+G, Ctrl+S, Ctrl+H, Ctrl+T, Escape)" -ForegroundColor White
Write-Host "  • Cleaner, better organized code" -ForegroundColor White
Write-Host ""
Write-Host "🔙 Old files backed up as:" -ForegroundColor Yellow
Write-Host "  • index.html.old-$timestamp" -ForegroundColor Gray
Write-Host "  • script.js.old-$timestamp" -ForegroundColor Gray
Write-Host ""
Write-Host "🎯 Ready to test! Reload the page in your browser." -ForegroundColor Green
